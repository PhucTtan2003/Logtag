using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Security.Claims;
using temperature_humi.Infrastructure; // EndpointRateLimiter, SingleFlight, SimpleMemoryCache
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SensorDataController : ControllerBase
    {
        private readonly LocationReadingService _readingService;
        private readonly DeviceService _deviceService;
        private readonly AccountDeviceService _accountDeviceService;
        private readonly EmployeeAccountDeviceService _employeeAccountDeviceService;
        private readonly AccountService _accountService;
        private readonly RoleService _roleService;
        private readonly LogTagApiClient _api;

        // Realtime + quota helpers
        private readonly EndpointRateLimiter _rate;
        private readonly SingleFlight _sf;
        private readonly SimpleMemoryCache _cache;

        private static readonly TimeSpan MinSpacing = TimeSpan.FromSeconds(1);
        private const int MaxPerMinute = 5;

        public SensorDataController(
            LocationReadingService readingService,
            DeviceService deviceService,
            AccountDeviceService accountDeviceService,
            EmployeeAccountDeviceService employeeAccountDeviceService,
            AccountService accountService,
            RoleService roleService,
            EndpointRateLimiter rate,
            SingleFlight sf,
            SimpleMemoryCache cache,
            LogTagApiClient api)
        {
            _readingService = readingService;
            _deviceService = deviceService;
            _accountDeviceService = accountDeviceService;
            _employeeAccountDeviceService = employeeAccountDeviceService;
            _accountService = accountService;
            _roleService = roleService;
            _rate = rate;
            _sf = sf;
            _cache = cache;
            _api = api;
        }

        // ----------------- Helpers -----------------
        private bool TryGetUserId(out ObjectId uid)
        {
            uid = default;

            // 1) Header
            var fromHeader = Request.Headers["X-User-Id"].FirstOrDefault()
                          ?? Request.Headers["x-user-id"].FirstOrDefault();
            if (ObjectId.TryParse(fromHeader, out uid)) return true;

            // 2) Query cho SSE
            var fromQuery = Request.Query["uid"].FirstOrDefault();
            if (ObjectId.TryParse(fromQuery, out uid)) return true;

            // 3) Claims
            var fromClaim = User?.FindFirstValue(ClaimTypes.NameIdentifier)
                         ?? User?.FindFirstValue("userId")
                         ?? User?.FindFirstValue("sub");
            return ObjectId.TryParse(fromClaim, out uid);
        }

        private async Task<long> GetDefaultTeamIdAsync(CancellationToken ct)
        {
            // Ưu tiên lấy từ query ?teamId=...
            var teamFromQuery = Request.Query["teamId"].FirstOrDefault();
            if (long.TryParse(teamFromQuery, out var qTeam) && qTeam > 0) return qTeam;

            // Không có thì lấy team đầu tiên của tài khoản LogTag
            var dto = await _api.GetTokenDtoAsync(ct);
            return dto.Teams.FirstOrDefault()?.id ?? 0;
        }

        private async Task<bool> IsAdminAsync(ObjectId uid)
        {
            var acc = await _accountService.GetByIdAsync(uid);
            if (acc == null) return false;
            var role = await _roleService.GetRoleByIdAsync(acc.RoleId);
            return string.Equals(role?.RoleName, "Admin", StringComparison.OrdinalIgnoreCase);
        }

        private async Task<bool> IsEmployeeAsync(ObjectId uid)
        {
            var acc = await _accountService.GetByIdAsync(uid);
            if (acc == null) return false;
            var role = await _roleService.GetRoleByIdAsync(acc.RoleId);
            var rn = role?.RoleName ?? "";
            return rn.Equals("Employee", StringComparison.OrdinalIgnoreCase);
        }

        private async Task<bool> IsPrivilegedViewerAsync(ObjectId uid)
        {
            // Privileged chỉ có Admin
            return await IsAdminAsync(uid);
        }

        private IActionResult UnauthorizedIdentity()
          => Unauthorized(new { code = "UNAUTHORIZED", message = "Missing/invalid user identity" });

        private IActionResult ForbiddenNotOwned()
          => StatusCode(403, new { code = "FORBIDDEN_NOT_OWNED", message = "Serial is not assigned to this user" });

        private string ClientKey(string ep)
        {
            if (TryGetUserId(out var uid)) return $"{ep}:{uid}";
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "anon";
            return $"{ep}:{ip}";
        }

        private bool CheckQuotaOr429(string endpointKey, out IActionResult? tooMany)
        {
            tooMany = null;
            if (_rate.TryAcquire(endpointKey, out var retryAfter)) return true;

            Response.Headers["Retry-After"] = Math.Max(1, (int)retryAfter.TotalSeconds).ToString();
            tooMany = StatusCode(429, new { error = "Too Many Requests", retryAfterSeconds = (int)Math.Ceiling(retryAfter.TotalSeconds) });
            return false;
        }

        private static TimeSpan ParseWindow(string window) => window switch
        {
            "1h" => TimeSpan.FromHours(1),
            "6h" => TimeSpan.FromHours(6),
            "24h" => TimeSpan.FromHours(24),
            "7d" => TimeSpan.FromDays(7),
            _ => TimeSpan.FromHours(1)
        };

        /// <summary>
        /// Trả về list serial user được xem theo role:
        /// Admin: tất cả active
        /// Employee: EmployeeAccountDevices
        /// User: AccountDevices
        /// </summary>
        private async Task<List<string>> GetUserSerialsAsync(ObjectId uid)
        {
            if (await IsPrivilegedViewerAsync(uid))
                return (await _deviceService.GetActiveDeviceSerialsAsync()) ?? new();

            if (await IsEmployeeAsync(uid))
                return (await _employeeAccountDeviceService.GetSerialsByAccountOnlyAsync(uid)) ?? new();

            return (await _accountDeviceService.GetSerialsByAccountOnlyAsync(uid)) ?? new();
        }

        private async Task<IActionResult?> EnsureCanAccessSerialAsync(string serialNumber)
        {
            if (!TryGetUserId(out var uid)) return UnauthorizedIdentity();

            // Admin bỏ kiểm tra sở hữu
            if (await IsPrivilegedViewerAsync(uid)) return null;

            var allowed = await GetUserSerialsAsync(uid);
            var ok = allowed.Contains((serialNumber ?? "").Trim(), StringComparer.OrdinalIgnoreCase);
            if (!ok) return ForbiddenNotOwned();
            return null;
        }

        // ----------------- Endpoints -----------------

        /// <summary>
        /// Trả list serial user được xem (theo role)
        /// </summary>
        [HttpGet("GetDeviceSerials")]
        public async Task<IActionResult> GetDeviceSerials()
        {
            if (!TryGetUserId(out var uid)) return UnauthorizedIdentity();

            var isAdmin = await IsPrivilegedViewerAsync(uid);
            var isEmp = !isAdmin && await IsEmployeeAsync(uid);
            var cacheKey = isAdmin ? "devserials:ALL"
                         : isEmp ? $"devserials:EMP:{uid}"
                                   : $"devserials:USR:{uid}";

            if (_cache.TryGet(cacheKey, out List<string>? fresh) && fresh is not null)
            {
                Response.Headers["X-Cache"] = "fresh";
                return Ok(fresh);
            }

            var ep = ClientKey("SensorData:GetDeviceSerials");
            if (!CheckQuotaOr429(ep, out var tooMany))
            {
                if (_cache.TryGet(cacheKey + ":stale", out List<string>? stale) && stale is not null)
                {
                    Response.Headers["X-Cache"] = "stale";
                    return Ok(stale);
                }
                return tooMany!;
            }

            var payload = await _sf.DoAsync(cacheKey, async ct =>
            {
                var serials = await GetUserSerialsAsync(uid);
                _cache.Set(cacheKey, serials, TimeSpan.FromSeconds(10));          // fresh
                _cache.Set(cacheKey + ":stale", serials, TimeSpan.FromMinutes(1)); // stale
                return serials;
            }, HttpContext.RequestAborted);

            Response.Headers["X-Cache"] = "miss->set";
            return Ok(payload);
        }

        /// <summary>
        /// Trả danh sách thiết bị của 1 account (đang active)
        /// - Admin: xem của bất kỳ accountId nào
        /// - User thường: chỉ cho phép khi accountId == chính mình
        /// </summary>
        [HttpGet("GetDevicesByAccount/{accountId}")]
        public async Task<IActionResult> GetDevicesByAccount(string accountId)
        {
            var ep = ClientKey("SensorData:GetDevicesByAccount");
            if (!CheckQuotaOr429(ep, out var tooMany)) return tooMany!;

            if (!ObjectId.TryParse(accountId, out var accId))
                return BadRequest("accountId không hợp lệ.");

            if (!TryGetUserId(out var uid)) return Unauthorized();
            var isAdmin = await IsAdminAsync(uid);

            if (!isAdmin && uid != accId) return Forbid();

            var serials = await _accountDeviceService.GetSerialsByAccountOnlyAsync(accId);
            if (serials == null || !serials.Any()) return Ok(Array.Empty<object>());

            var devices = await _deviceService.GetBySerialsAsync(serials, onlyActive: true);
            return Ok(devices);
        }

        // Kiểu điểm cho GetRecent/SSE
        private sealed record RecentPoint(
            string label,       // ISO UTC "yyyy-MM-ddTHH:mm:ss.fffZ"
            double temperature,
            double humidity
        );

        /// <summary>
        /// Dữ liệu gần đây để vẽ biểu đồ (1h/6h/24h/7d)
        /// </summary>
        /// <summary>
        /// Dữ liệu gần đây để vẽ biểu đồ (1h/6h/24h/7d)
        /// </summary>
        [HttpGet("GetRecent")]
        public async Task<IActionResult> GetRecent(string serialNumber, string window = "1h", int? n = null)
        {
            if (string.IsNullOrWhiteSpace(serialNumber))
                return BadRequest("Thiếu serialNumber.");

            var gate = await EnsureCanAccessSerialAsync(serialNumber.Trim());
            if (gate is IActionResult blocked) return blocked;

            var ts = ParseWindow(window);
            var sn = serialNumber.Trim();
            var sec = (int)ts.TotalSeconds;

            // quyết định CAP: nếu client không truyền n sẽ tự tính theo window
            // (giới hạn 100..2000 điểm để render nhanh)
            var cap = Math.Clamp(n ?? Math.Max(100, sec / 6), 100, 2000);

            var cacheKeyFresh = $"recent:{sn}:{sec}:cap{cap}:fresh";
            var cacheKeyStale = $"recent:{sn}:{sec}:cap{cap}:stale";

            // 1) trả cache trước
            if (_cache.TryGet(cacheKeyFresh, out List<RecentPoint>? fresh) && fresh is not null) { Response.Headers["X-Cache"] = "fresh"; return Ok(fresh); }
            if (_cache.TryGet(cacheKeyStale, out List<RecentPoint>? stale) && stale is not null) { Response.Headers["X-Cache"] = "stale"; return Ok(stale); }

            // 2) quota theo serial+window+cap
            var ep = ClientKey($"SensorData:GetRecent:{sn}:{sec}:cap{cap}");
            if (!CheckQuotaOr429(ep, out var tooMany)) return tooMany!;

            // 3) coalesce + cache
            var payload = await _sf.DoAsync(cacheKeyFresh, async ct =>
            {
                // đọc DB theo cap
                var rows = await _readingService.GetRecentAsync(sn, ts, cap);

                // fallback nếu rỗng → sync 5'
                if (rows.Count == 0)
                {
                    try
                    {
                        var teamId = await GetDefaultTeamIdAsync(ct);
                        if (teamId > 0)
                        {
                            var to = DateTime.UtcNow;
                            var from = to.AddMinutes(-5);
                            await _readingService.PullAndUpsertAsync(teamId, new[] { sn }, from, to, ct);
                            rows = await _readingService.GetRecentAsync(sn, ts, cap);
                        }
                    }
                    catch { /* ignore */ }
                }
                else
                {
                    // nếu quá cũ > 2' → backfill nhẹ nền + clear cache
                    try
                    {
                        var last = rows[^1].DateUtc;
                        if (DateTime.UtcNow - last > TimeSpan.FromMinutes(2))
                        {
                            var teamId = await GetDefaultTeamIdAsync(ct);
                            if (teamId > 0)
                            {
                                var to = DateTime.UtcNow;
                                var from = to.AddMinutes(-5);
                                _ = _readingService.PullAndUpsertAsync(teamId, new[] { sn }, from, to, CancellationToken.None)
                                    .ContinueWith(_ => { _cache.Remove(cacheKeyFresh); _cache.Remove(cacheKeyStale); });
                            }
                        }
                    }
                    catch { /* best-effort */ }
                }

                var mapped = rows.Select(r => new RecentPoint(
                    r.DateUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                    r.Temperature,
                    r.Humidity ?? 0
                )).ToList();

                // fresh 10s, stale 45s → phản hồi nhanh hơn
                _cache.Set(cacheKeyFresh, mapped, TimeSpan.FromSeconds(10));
                _cache.Set(cacheKeyStale, mapped, TimeSpan.FromSeconds(45));
                return mapped;
            }, HttpContext.RequestAborted);

            Response.Headers["X-Cache"] = "miss->set";
            return Ok(payload);
        }



        /// <summary>
        /// Tìm kiếm thiết bị: Admin full; non-admin lọc theo serial được phép
        /// </summary>
        [HttpGet("SearchDevices")]
        public async Task<IActionResult> SearchDevices(string q)
        {
            var ep = ClientKey("SensorData:SearchDevices");
            if (!CheckQuotaOr429(ep, out var tooMany)) return tooMany!;
            if (string.IsNullOrWhiteSpace(q)) return Ok(Array.Empty<object>());

            if (!TryGetUserId(out var uid)) return UnauthorizedIdentity();

            if (await IsPrivilegedViewerAsync(uid))
            {
                var results = await _deviceService.SearchAsync(q.Trim());
                return Ok(results.Select(d => new { serialNumber = d.serialNumber, model = d.model }));
            }

            var mySerials = await GetUserSerialsAsync(uid);
            if (mySerials.Count == 0) return Ok(Array.Empty<object>());

            var resultsUser = await _deviceService.GetBySerialsAsync(mySerials, onlyActive: true);
            var regex = new System.Text.RegularExpressions.Regex(q.Trim(), System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var filtered = resultsUser
                .Where(d => (d.serialNumber != null && regex.IsMatch(d.serialNumber)) ||
                            (d.model != null && regex.IsMatch(d.model)))
                .Take(100)
                .Select(d => new { serialNumber = d.serialNumber, model = d.model });

            return Ok(filtered);
        }

        /// <summary>
        /// Query dữ liệu thô trong khoảng thời gian (vẽ chart lịch sử)
        /// </summary>
        [HttpGet("query-raw")]
        [Obsolete("Dùng range hoặc stream/recent thay thế nếu có thể")]
        public async Task<IActionResult> QueryRaw(
            [FromQuery] string serialNumber,
            [FromQuery] DateTime from,
            [FromQuery] DateTime to,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 5000,
            [FromQuery] bool backfillIfEmpty = false)
        {
            var ep = ClientKey("SensorData:QueryRaw");
            if (!CheckQuotaOr429(ep, out var tooMany)) return tooMany!;

            if (string.IsNullOrWhiteSpace(serialNumber))
                return BadRequest(new { error = "Thiếu serialNumber." });

            if (to <= from)
                return BadRequest(new { error = "`to` phải lớn hơn `from`." });

            if (page < 1) page = 1;
            if (pageSize > 10000) pageSize = 10000;

            var sn = serialNumber.Trim();
            var gate = await EnsureCanAccessSerialAsync(sn);
            if (gate is IActionResult blocked) return blocked;

            var fromUtc = DateTime.SpecifyKind(from, DateTimeKind.Utc);
            var toUtc = DateTime.SpecifyKind(to, DateTimeKind.Utc);

            var cacheKey = $"qr:{sn}:{fromUtc:O}:{toUtc:O}:p{page}:s{pageSize}";
            var ct = HttpContext.RequestAborted;

            if (_cache.TryGet(cacheKey, out List<object>? cachedPayload) && cachedPayload is not null)
                return Ok(cachedPayload);

            var payload = await _sf.DoAsync(cacheKey, async token =>
            {
                var skip = (page - 1) * pageSize;
                var rows = await _readingService.GetCollection()
                    .Find(r => r.SerialNumber == sn && r.DateUtc >= fromUtc && r.DateUtc <= toUtc)
                    .SortBy(r => r.DateUtc)
                    .Skip(skip)
                    .Limit(pageSize)
                    .ToListAsync(token);

                if (rows.Count == 0 && backfillIfEmpty && (DateTime.UtcNow - toUtc) <= TimeSpan.FromMinutes(10))
                {
                    try
                    {
                        var toFix = DateTime.UtcNow;
                        var fromFix = toFix.AddMinutes(-5);
                        await _readingService.PullAndUpsertAsync(
                            serials: new[] { sn },
                            startDate: fromFix,
                            endDate: toFix,
                            ct: token);
                        rows = await _readingService.GetCollection()
                            .Find(r => r.SerialNumber == sn && r.DateUtc >= fromUtc && r.DateUtc <= toUtc)
                            .SortBy(r => r.DateUtc)
                            .Skip(skip)
                            .Limit(pageSize)
                            .ToListAsync(token);
                    }
                    catch { /* ignore */ }
                }

                var mapped = rows.Select(r => new
                {
                    label = r.DateUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                    temperature = r.Temperature,
                    humidity = r.Humidity ?? 0
                }).Cast<object>().ToList();

                _cache.Set(cacheKey, mapped, TimeSpan.FromSeconds(2));
                return mapped;
            }, ct);

            return Ok(new
            {
                page,
                pageSize,
                count = payload.Count,
                data = payload
            });
        }

        // ===================== Realtime SSE =====================
        [HttpGet("stream/recent")]
        public async Task StreamRecent(
            [FromQuery] string serialNumber,
            [FromQuery] string window = "1h",
            [FromQuery] int intervalMs = 1000)
        {
            Response.StatusCode = 200;
            Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
            Response.Headers["Cache-Control"] = "no-cache, no-transform";
            Response.Headers["X-Accel-Buffering"] = "no";

            if (string.IsNullOrWhiteSpace(serialNumber))
            {
                await WriteEventAsync(new { error = "Thiếu serialNumber." });
                return;
            }

            var gate = await EnsureCanAccessSerialAsync(serialNumber.Trim());
            if (gate is IActionResult blocked)
            {
                Response.StatusCode = (blocked as ObjectResult)?.StatusCode
                                      ?? (blocked as StatusCodeResult)?.StatusCode ?? 403;
                await WriteEventAsync(new { error = "Forbidden or Unauthorized" });
                return;
            }

            if (intervalMs < 1000) intervalMs = 1000;
            var ts = ParseWindow(window);
            var sn = serialNumber.Trim();
            var sec = (int)ts.TotalSeconds;

            // Dùng cùng quy ước fresh/stale như GetRecent
            var cacheKeyFresh = $"recent:{sn}:{sec}:fresh";
            var cacheKeyStale = $"recent:{sn}:{sec}:stale";

            await WriteCommentAsync($"stream start for {sn} window={window} intervalMs={intervalMs}");

            DateTimeOffset? lastSent = null;

            while (!HttpContext.RequestAborted.IsCancellationRequested)
            {
                try
                {
                    // Kiểm tra dữ liệu cũ quá → backfill nhẹ và xóa cache
                    if (_cache.TryGet(cacheKeyFresh, out List<RecentPoint>? fresh) && fresh is not null && fresh.Count > 0)
                    {
                        if (DateTimeOffset.TryParse(fresh[^1].label, out var lastTs))
                        {
                            var lag = DateTimeOffset.UtcNow - lastTs;
                            if (lag > TimeSpan.FromMinutes(2))
                            {
                                var to = DateTime.UtcNow;
                                var from = to.AddMinutes(-5);
                                var teamId = await GetDefaultTeamIdAsync(HttpContext.RequestAborted);
                                if (teamId > 0)
                                {
                                    await _readingService.PullAndUpsertAsync(teamId, new[] { sn }, from, to, HttpContext.RequestAborted);
                                    _cache.Remove(cacheKeyFresh);
                                    _cache.Remove(cacheKeyStale);
                                }
                            }
                        }
                    }
                }
                catch { /* ignore backfill errors */ }

                // Lấy allPoints ưu tiên fresh → stale → tính toán
                List<RecentPoint> allPoints;
                if (!(_cache.TryGet(cacheKeyFresh, out allPoints!) && allPoints is not null))
                {
                    if (!(_cache.TryGet(cacheKeyStale, out allPoints!) && allPoints is not null))
                    {
                        // Coalesce tải lần đầu nếu cả 2 đều trống
                        allPoints = await _sf.DoAsync(cacheKeyFresh, async ct =>
                        {
                            var rows = await _readingService.GetRecentAsync(sn, ts);
                            var mapped = rows.Select(r => new RecentPoint(
                                r.DateUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                                r.Temperature,
                                r.Humidity ?? 0
                            )).ToList();

                            _cache.Set(cacheKeyFresh, mapped, TimeSpan.FromSeconds(15));
                            _cache.Set(cacheKeyStale, mapped, TimeSpan.FromSeconds(60));
                            return mapped;
                        }, HttpContext.RequestAborted);
                    }
                }

                if (allPoints.Count == 0)
                {
                    try
                    {
                        var to = DateTime.UtcNow;
                        var from = to.AddHours(-12);
                        var teamId = await GetDefaultTeamIdAsync(HttpContext.RequestAborted);
                        if (teamId > 0)
                        {
                            await _readingService.PullAndUpsertAsync(teamId, new[] { sn }, from, to, HttpContext.RequestAborted);
                            _cache.Remove(cacheKeyFresh);
                            _cache.Remove(cacheKeyStale);
                        }
                    }
                    catch { }
                    await Task.Delay(intervalMs, HttpContext.RequestAborted);
                    continue;
                }

                var newPoints = new List<RecentPoint>();
                foreach (var p in allPoints)
                {
                    if (DateTimeOffset.TryParse(p.label, out var tsPoint))
                    {
                        if (!lastSent.HasValue || tsPoint > lastSent.Value)
                            newPoints.Add(p);
                    }
                }

                if (newPoints.Count > 0)
                {
                    if (DateTimeOffset.TryParse(newPoints[^1].label, out var lastTs))
                        lastSent = lastTs;

                    await WriteEventAsync(new
                    {
                        type = "tick",
                        serialNumber = sn,
                        window,
                        at = DateTimeOffset.UtcNow.ToString("o"),
                        points = newPoints
                    });
                }

                await Task.Delay(intervalMs, HttpContext.RequestAborted);
            }

            async Task WriteEventAsync(object obj)
            {
                var json = System.Text.Json.JsonSerializer.Serialize(obj);
                await Response.WriteAsync($"event: event\ndata: {json}\n\n", HttpContext.RequestAborted);
                await Response.Body.FlushAsync(HttpContext.RequestAborted);
            }

            async Task WriteCommentAsync(string comment)
            {
                await Response.WriteAsync($": {comment}\n\n", HttpContext.RequestAborted);
                await Response.Body.FlushAsync(HttpContext.RequestAborted);
            }
        }

        // ======= Latest per-serials (lọc quyền) =======
        [HttpGet("latest")]
        public async Task<IActionResult> GetLatest([FromQuery] string? teamId, [FromQuery] string serials)
        {
            if (!TryGetUserId(out var uid)) return UnauthorizedIdentity();

            var arr = (serials ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (!await IsPrivilegedViewerAsync(uid))
            {
                var mine = await GetUserSerialsAsync(uid);
                arr = arr.Where(s => mine.Contains(s, StringComparer.OrdinalIgnoreCase)).ToArray();
            }

            if (arr.Length == 0) return Ok(Array.Empty<object>());
            var docs = await _readingService.GetLatestBySerialsAsync(arr, string.IsNullOrWhiteSpace(teamId) ? null : teamId);
            return Ok(docs);
        }

        // ======= Range (có check quyền) =======
        [HttpGet("range")]
        public async Task<IActionResult> GetRange([FromQuery] string serial, [FromQuery] DateTime fromUtc, [FromQuery] DateTime toUtc)
        {
            var gate = await EnsureCanAccessSerialAsync(serial ?? "");
            if (gate is IActionResult blocked) return blocked;

            var docs = await _readingService.GetRangeAsync(serial, fromUtc, toUtc);
            return Ok(docs);
        }

        // ======= Backfill =======
        public sealed record BackfillReq(long teamId, List<string>? serials, DateTime fromUtc, DateTime toUtc);

        [HttpPost("backfill")]
        public async Task<IActionResult> Backfill([FromBody] BackfillReq req, CancellationToken ct)
        {
            if (req.toUtc <= req.fromUtc) return BadRequest("`toUtc` must be > `fromUtc`.");

            var serials = (req.serials?.Where(s => !string.IsNullOrWhiteSpace(s)).ToList()
                          ?? await _deviceService.GetActiveDeviceSerialsAsync()) ?? new List<string>();

            var stats = await _readingService.PullAndUpsertWithStatsAsync(
                req.teamId, serials, req.fromUtc, req.toUtc, ct);

            return Ok(new { ok = true, stats, serials = serials.Count });
        }

        // ======= Sync latest =======
        [HttpPost("sync-latest")]
        public async Task<IActionResult> SyncLatest([FromQuery] long teamId, CancellationToken ct)
        {
            var serials = (await _deviceService.GetAllSerialsAsync(ct))?.ToList() ?? new();
            if (!serials.Any())
                serials = await _readingService.GetKnownSerialsAsync(ct);

            var stats = await _readingService.PullLatestTickAsync(teamId, serials, ct);
            return Ok(new { ok = true, stats });
        }
    }
}
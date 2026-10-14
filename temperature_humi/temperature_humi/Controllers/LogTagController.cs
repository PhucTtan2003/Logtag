// Controllers/LogTagController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Text.Json;
using temperature_humi.Background;
using temperature_humi.Data;
using temperature_humi.Hubs;
using temperature_humi.Models;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;
using temperature_humi.Service.LogtagService.Lt5;   // 👈 thêm LT5 client

[ApiController]
[Route("api/logtag")]
public class LogTagController : ControllerBase
{
    private readonly LogTagApiClient _api;               // client cũ (team main)
    private readonly LogTagApiClientLt5 _apiLt5;         // 👈 client LT5 (team 17953)
    private readonly DeviceService _devices;
    private readonly AccountDeviceService _accountDevices;
    private readonly EmployeeAccountDeviceService _empAccountDevices;
    private readonly StatusService _status;
    private readonly AlertService _alerts;
    private readonly IConfiguration _cfg;
    private readonly LatestStatusSyncOptions _syncOpt;                   // OnlineThresholdMinutes
    private readonly IHubContext<LogTagHub>? _hub;                       // broadcast SignalR (optional)

    private readonly IMongoCollection<Account> _accounts;
    private readonly IMongoCollection<DeviceRegistration> _registrations; // audit register
    private readonly LocationReadingService _loc;

    // Throttle (chưa dùng)
    private static readonly SemaphoreSlim _registerLock = new(1, 1);
    private static DateTime _lastRegisterCallUtc = DateTime.MinValue;
    private static readonly Queue<DateTime> _registerWindow = new(); // 60s window

    public LogTagController(
        LogTagApiClientMain api,
        LogTagApiClientLt5 apiLt5,                 // 👈 inject thêm LT5
        DeviceService devices,
        IConfiguration cfg,
        AccountDeviceService accountDevices,
        EmployeeAccountDeviceService empAccountDevices,
        StatusService status,
        AlertService alerts,
        IOptions<MongoDBSettings> mongoOpt,
        IOptions<LatestStatusSyncOptions> syncOpt,
        IHubContext<LogTagHub>? hub = null,
        LocationReadingService? loc = null)
    {
        _api = api;
        _apiLt5 = apiLt5;                          // 👈 gán field LT5
        _devices = devices;
        _cfg = cfg;
        _accountDevices = accountDevices;
        _empAccountDevices = empAccountDevices;
        _status = status;
        _alerts = alerts;
        _syncOpt = syncOpt.Value;
        _hub = hub;

        var client = new MongoClient(mongoOpt.Value.ConnectionString);
        var db = client.GetDatabase(mongoOpt.Value.DatabaseName);
        _accounts = db.GetCollection<Account>("Account");
        _registrations = db.GetCollection<DeviceRegistration>("DeviceRegistrations");
        _loc = loc;
    }

    private long TeamId => long.Parse(_cfg["LogTagApi:TeamId"]!);

    // ---------------- Events (ADMIN) ----------------
    public record EventsRequestDto(string serialNumber, DateTime? startDateUtc, DateTime? endDateUtc);

    // Giữ 1 endpoint duy nhất để tránh trùng route
    [Authorize(Roles = "Admin")]
    [HttpPost("events")]
    public async Task<IActionResult> GetEvents([FromBody] EventsRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.serialNumber))
            return BadRequest(new { message = "serialNumber is required" });

        try
        {
            var res = await _api.GetEventsAsync(dto.serialNumber, dto.startDateUtc, dto.endDateUtc, ct);
            return Ok(res);
        }
        catch (ArgumentException aex) { return BadRequest(new { message = aex.Message }); }
        catch (Exception ex) { return StatusCode(502, new { message = "Upstream LogTag error", detail = ex.Message }); }
    }

    // ---------------- Refresh Devices ----------------

    // DTO tạm để parse JSON "raw" từ GetDevicesRawAsync
    private sealed record RemoteDeviceItem(
        string? serialNumber,
        string? model,
        string? description,
        string? deviceState,
        DateTime? registrationDateUtc,
        DateTime? lastConnectionDateUtc
    );

    private static List<RemoteDeviceItem> ParseDevicesRaw(string raw)
    {
        var result = new List<RemoteDeviceItem>();
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;

        // chấp nhận cả dạng { data: [...] } lẫn [...]
        JsonElement arr;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var dataEl) && dataEl.ValueKind == JsonValueKind.Array)
        {
            arr = dataEl;
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            arr = root;
        }
        else
        {
            return result;
        }

        foreach (var e in arr.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.Object) continue;

            string? sn = e.TryGetProperty("serialNumber", out var snEl) ? snEl.GetString() : null;
            string? md = e.TryGetProperty("model", out var mEl) ? mEl.GetString() : null;
            string? desc = e.TryGetProperty("description", out var dEl) ? dEl.GetString() : null;
            string? st = e.TryGetProperty("deviceState", out var sEl) ? sEl.GetString() : null;

            DateTime? reg = null;
            if (e.TryGetProperty("registrationDateUtc", out var rEl) && rEl.ValueKind == JsonValueKind.String)
            {
                if (DateTime.TryParse(rEl.GetString(), out var tmp)) reg = DateTime.SpecifyKind(tmp, DateTimeKind.Utc);
            }

            DateTime? last = null;
            if (e.TryGetProperty("lastConnectionDateUtc", out var lEl) && lEl.ValueKind == JsonValueKind.String)
            {
                if (DateTime.TryParse(lEl.GetString(), out var tmp)) last = DateTime.SpecifyKind(tmp, DateTimeKind.Utc);
            }

            result.Add(new RemoteDeviceItem(sn, md, desc, st, reg, last));
        }
        return result;
    }

    [HttpPost("devices/refresh")]
    public async Task<IActionResult> RefreshDevices()
    {
        try
        {
            var raw = await _api.GetDevicesRawAsync(TeamId);
            var remote = ParseDevicesRaw(raw);

            var remoteSerials = remote
                .Select(x => x.serialNumber)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var d in remote)
            {
                if (string.IsNullOrWhiteSpace(d.serialNumber)) continue;
                var entity = new Device
                {
                    teamId = TeamId,
                    serialNumber = d.serialNumber!,
                    model = d.model,
                    description = d.description,
                    deviceState = d.deviceState,
                    registrationDateUtc = d.registrationDateUtc ?? DateTime.UtcNow,
                    lastConnectionDateUtc = d.lastConnectionDateUtc ?? DateTime.MinValue,
                    updatedAtUtc = DateTime.UtcNow
                };
                await _devices.UpsertBySerialAsync(entity);
            }

            // Chỉ soft-delete & không đụng thiết bị mô phỏng
            await _devices.DeleteWhereSerialNotInAsync(
                remoteSerials,
                softDelete: true,
                excludeSimulated: true
            );

            return Ok(new { ok = true, message = "Refreshed", count = remote.Count });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Refresh failed", error = ex.Message });
        }
    }

    // ---------------- Register Device ----------------

    public class RegisterDeviceDto
    {
        public long TeamId { get; set; }
        public string SerialNumber { get; set; } = "";
        public string? DeviceDescription { get; set; }
        public string? RequestedBy { get; set; } // optional: email/userId để audit
    }

    private static string NormalizeSerial(string s)
    {
        var up = (s ?? "").Trim().ToUpperInvariant();
        if (up.EndsWith("-CH1")) return up[..^4];
        if (up.EndsWith("-CH2")) return up[..^4];
        return up;
    }

    [HttpPost("register-device")]
    public async Task<IActionResult> RegisterDevice([FromBody] RegisterDeviceDto dto, CancellationToken ct)
    {
        if (dto == null) return BadRequest(new { ok = false, message = "Body is required" });
        if (dto.TeamId <= 0) return BadRequest(new { ok = false, message = "teamId invalid" });
        if (string.IsNullOrWhiteSpace(dto.SerialNumber)) return BadRequest(new { ok = false, message = "serialNumber required" });

        var serial = NormalizeSerial(dto.SerialNumber);

        var dryRun = string.Equals(Request.Query["dryRun"], "true", StringComparison.OrdinalIgnoreCase)
                     || string.Equals(_cfg["LogTagApi:SimulateRegister"], "true", StringComparison.OrdinalIgnoreCase);

        // Audit: Pending
        var audit = new DeviceRegistration
        {
            TeamId = dto.TeamId,
            SerialNumber = serial,
            Description = dto.DeviceDescription,
            RequestedBy = dto.RequestedBy ?? (User?.Identity?.Name ?? "system")!,
            Status = "Pending",
            Attempts = 1,
            CreatedAtUtc = DateTime.UtcNow
        };
        await _registrations.InsertOneAsync(audit, cancellationToken: ct);

        if (dryRun)
        {
            await _devices.UpsertBySerialAsync(new Device
            {
                teamId = dto.TeamId,
                serialNumber = serial,
                model = "UTRED30-WIFI",
                description = dto.DeviceDescription,
                deviceState = "Simulated",
                registrationDateUtc = DateTime.UtcNow,
                updatedAtUtc = DateTime.UtcNow
            });

            var rawSim = new BsonDocument
            {
                { "dryRun", true },
                { "note", "Skipped LogTag Online call" },
                { "serialNumber", serial }
            };

            var updSim = Builders<DeviceRegistration>.Update
                .Set(x => x.Status, "Success")
                .Set(x => x.RawResponse, rawSim)
                .Set(x => x.CompletedAtUtc, DateTime.UtcNow);

            await _registrations.UpdateOneAsync(
                Builders<DeviceRegistration>.Filter.Eq(x => x.Id, audit.Id),
                updSim,
                cancellationToken: ct
            );

            if (_hub != null)
            {
                await _hub.Clients.All.SendAsync("DeviceRegistered", new
                {
                    serialNumber = serial,
                    deviceType = "Simulated",
                    description = dto.DeviceDescription,
                    simulated = true
                }, ct);
            }

            return Ok(new
            {
                ok = true,
                simulated = true,
                result = new { SerialNumber = serial, DeviceType = "Simulated" }
            });
        }

        try
        {
            var reg = await _api.RegisterDeviceAsync((int)dto.TeamId, serial, dto.DeviceDescription, ct);

            var entity = new Device
            {
                teamId = dto.TeamId,
                serialNumber = serial,
                model = reg.DeviceType ?? "Unknown",
                description = dto.DeviceDescription,
                deviceState = "Active",
                registrationDateUtc = DateTime.UtcNow,
                updatedAtUtc = DateTime.UtcNow
            };
            await _devices.UpsertBySerialAsync(entity);

            var raw = new BsonDocument
            {
                { "serialNumber", reg.SerialNumber },
                { "deviceType", reg.DeviceType != null ? new BsonString(reg.DeviceType) : BsonNull.Value }
            };

            var upd = Builders<DeviceRegistration>.Update
                .Set(x => x.Status, "Success")
                .Set(x => x.RawResponse, raw)
                .Set(x => x.CompletedAtUtc, DateTime.UtcNow);

            await _registrations.UpdateOneAsync(
                Builders<DeviceRegistration>.Filter.Eq(x => x.Id, audit.Id),
                upd,
                cancellationToken: ct
            );

            if (_hub != null)
            {
                await _hub.Clients.All.SendAsync("DeviceRegistered", new
                {
                    serialNumber = serial,
                    deviceType = reg.DeviceType,
                    description = dto.DeviceDescription
                }, ct);
            }

            return Ok(new { ok = true, result = reg });
        }
        catch (Exception ex)
        {
            var updFail = Builders<DeviceRegistration>.Update
                .Set(x => x.Status, "Failed")
                .Set(x => x.ErrorMessage, ex.Message)
                .Set(x => x.CompletedAtUtc, DateTime.UtcNow);

            await _registrations.UpdateOneAsync(
                Builders<DeviceRegistration>.Filter.Eq(x => x.Id, audit.Id),
                updFail,
                cancellationToken: ct
            );

            return StatusCode(500, new { ok = false, message = "Register failed", error = ex.Message });
        }
    }

    // ---------------- Readings (tạm tắt fallback remote) ----------------

    public record HistoryRequest(
        string SerialNumber,
        DateTime? FromUtc,
        DateTime? ToUtc,
        DateTime? startDateUtc,
        DateTime? endDateUtc
    );

    private static (DateTime? fromUtc, DateTime? toUtc) NormalizeRange(HistoryRequest rq)
    {
        var from = rq.startDateUtc ?? rq.FromUtc;
        var to = rq.endDateUtc ?? rq.ToUtc;

        if (from.HasValue && to.HasValue && (to.Value - from.Value).TotalDays > 31)
            throw new ArgumentOutOfRangeException(nameof(rq), "Date range cannot exceed 31 days.");

        return (from, to);
    }

    // NOTE: Client mới chưa có API readings → endpoint này giữ nguyên chữ ký, nhưng không gọi remote.
    [HttpPost("readings")]
    public async Task<IActionResult> Readings([FromBody] HistoryRequest rq)
    {
        if (rq == null || string.IsNullOrWhiteSpace(rq.SerialNumber))
            return BadRequest(new { ok = false, message = "serialNumber is required" });

        try
        {
            var (fromUtc, toUtc) = NormalizeRange(rq);

            var dev = await _devices.FindBySerialAsync(rq.SerialNumber);
            if (dev == null) return NotFound(new { ok = false, message = "Device not found" });

            // Tạm thời trả 501 để minh bạch (khi bổ sung API readings vào client sẽ gắn lại ở đây)
            return StatusCode(501, new { ok = false, message = "Readings API is not available in current client." });
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return BadRequest(new { ok = false, message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Readings failed", error = ex.Message });
        }
    }

    // ---------------- Events (public) dùng client mới ----------------
    [HttpPost("events-v2")]
    public async Task<IActionResult> EventsV2([FromBody] HistoryRequest rq, CancellationToken ct)
    {
        if (rq == null || string.IsNullOrWhiteSpace(rq.SerialNumber))
            return BadRequest(new { ok = false, message = "serialNumber is required" });

        try
        {
            var (fromUtc, toUtc) = NormalizeRange(rq);
            var data = await _api.GetEventsAsync(rq.SerialNumber, fromUtc, toUtc, ct);
            return Ok(data);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return BadRequest(new { ok = false, message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Events failed", error = ex.Message });
        }
    }

    // ---------------- Live Status / Alerts ----------------

    public record LiveStatusDto(
        string SerialNumber,
        string? Notes,
        string Status,
        double? Temperature,
        double? Humidity,
        DateTime? TimeUtc
    );

    // Fallback remote tạm tắt (client chưa có readings)
    private static Task<(double? temp, double? humi, DateTime? timeUtc)> FetchLatestReadingAsync(string serial, bool isLtgeo)
        => Task.FromResult<(double?, double?, DateTime?)>((null, null, null));

    [HttpGet("my-status")]
    public async Task<IActionResult> GetMyStatus([FromQuery] string accountId, [FromQuery] int limit = 10)
    {
        if (string.IsNullOrWhiteSpace(accountId))
            return BadRequest(new { ok = false, message = "accountId is required" });
        if (!ObjectId.TryParse(accountId, out var accountOid))
            return BadRequest(new { ok = false, message = "accountId is invalid" });

        try
        {
            var empMaps = await _empAccountDevices.GetMapsByAccountAsync(accountOid);
            if (empMaps == null || empMaps.Count == 0)
                return Ok(Array.Empty<LiveStatusDto>());

            // Keep original serials (may include -CH1/-CH2) for readings
            static string Clean(string s) => (s ?? "").Trim().ToUpperInvariant();
            static string StripChannel(string s)
            {
                var up = Clean(s);
                return (up.EndsWith("-CH1") || up.EndsWith("-CH2")) ? up[..^4] : up;
            }

            var serialsOrig = empMaps
                .Select(m => Clean(m.SerialNumber))
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (serialsOrig.Count == 0) return Ok(Array.Empty<LiveStatusDto>());

            // For Device lookups use base serials (no -CHx)
            var baseSerials = serialsOrig
                .Select(StripChannel)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Fetch Device docs by BASE serials
            var devices = await _devices.GetBySerialsAsync(baseSerials, onlyActive: false);
            if (devices.Count == 0)
                // đừng trả rỗng nữa — vẫn trả khung Offline để FE thấy đủ thiết bị
                devices = new List<Device>();

            var devByBaseSerial = devices
                .GroupBy(d => Clean(d.serialNumber), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderByDescending(x => x.updatedAtUtc).First(),
                    StringComparer.OrdinalIgnoreCase
                );

            // 1) Latest readings by ORIGINAL serials (with channel)
            var latestReadings = _loc != null
                ? await _loc.GetLatestBySerialsAsync(serialsOrig)
                : new List<LocationReading>();

            var readingBySerial = latestReadings
                .Where(r => r != null && !string.IsNullOrWhiteSpace(r.SerialNumber))
                .GroupBy(r => Clean(r.SerialNumber))
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.DateUtc).First());

            // 2) Fallback Statuses by DeviceId (device is per BASE serial)
            var deviceIds = devices.Select(d => d.Id).ToList();
            var latestRaw = (deviceIds.Count > 0) ? await _status.GetLatestStatuses(deviceIds) : new List<StatusModel>();
            var statusByDeviceId = latestRaw
                .GroupBy(s => s.DeviceId)
                .Select(g => g.OrderByDescending(x => x.Timestamp).First())
                .ToDictionary(x => x.DeviceId, x => x);

            var now = DateTime.UtcNow;
            var threshold = TimeSpan.FromMinutes(Math.Max(1, _syncOpt.OnlineThresholdMinutes));

            var rows = new List<LiveStatusDto>();

            foreach (var serialOrig in serialsOrig)
            {
                var baseSerial = StripChannel(serialOrig);
                devByBaseSerial.TryGetValue(baseSerial, out var dev);

                double? temp = null, humi = null;
                DateTime? timeUtc = null;
                bool online = false;

                // Prefer channel-level reading
                if (readingBySerial.TryGetValue(serialOrig, out var r))
                {
                    temp = (r.Temperature <= double.MinValue + 2) ? null : r.Temperature;
                    humi = r.Humidity;
                    timeUtc = r.DateUtc;
                    online = (now - r.DateUtc) <= threshold;
                }

                // Fallback Statuses (device-scope) if no reading
                if (temp == null && dev != null && statusByDeviceId.TryGetValue(dev.Id, out var st))
                {
                    var ts = st.Timestamp.Kind == DateTimeKind.Utc ? st.Timestamp : DateTime.SpecifyKind(st.Timestamp, DateTimeKind.Utc);
                    if (ts > now) ts = now;
                    temp = st.Temperature;
                    humi = st.Humidity;
                    timeUtc = ts;
                    online = (now - ts) <= threshold;
                }

                // Fallback last connection
                if (timeUtc == null && dev?.lastConnectionDateUtc is DateTime lc0)
                {
                    var lc = DateTime.SpecifyKind(lc0, DateTimeKind.Utc);
                    timeUtc = lc;
                    online = (now - lc) <= threshold;
                }

                rows.Add(new LiveStatusDto(
                    SerialNumber: serialOrig,        // ⚠️ GIỮ nguyên theo kênh cho FE hiển thị
                    Notes: dev?.description,
                    Status: online ? "Online" : "Offline",
                    Temperature: temp,
                    Humidity: humi,
                    TimeUtc: timeUtc
                ));
            }

            // de-dup & sort
            var final = rows
                .GroupBy(x => x.SerialNumber)
                .Select(g => g.OrderByDescending(x => x.TimeUtc ?? DateTime.MinValue).First())
                .OrderByDescending(x => x.TimeUtc ?? DateTime.MinValue)
                .ToList();

            // bỏ .Take(limit) để FE thấy đủ; nếu muốn giữ limit thì .Take(Math.Max(1, limit))
            return Ok(final);
        }
        catch (Exception ex)
        {
            Console.WriteLine("[GetMyStatus] ERROR: " + ex);
            return StatusCode(500, new { ok = false, message = "GetMyStatus failed", error = ex.Message });
        }
    }

    public record LiveAlertDto(
        string SerialNumber,
        string? Notes,
        string Message,
        DateTime TimeUtc
    );

    [HttpGet("my-alerts")]
    public async Task<IActionResult> GetMyAlerts(
        [FromQuery] string accountId,
        [FromQuery] int hours = 24,
        [FromQuery] int limit = 50)
    {
        if (string.IsNullOrWhiteSpace(accountId))
            return BadRequest(new { ok = false, message = "accountId is required" });
        if (!ObjectId.TryParse(accountId, out var accountOid))
            return BadRequest(new { ok = false, message = "accountId is invalid" });

        try
        {
            var empMaps = await _empAccountDevices.GetMapsByAccountAsync(accountOid);
            if (empMaps == null || empMaps.Count == 0)
                return Ok(Array.Empty<LiveAlertDto>());

            var serials = empMaps
                .Select(m => m.SerialNumber)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (serials.Count == 0) return Ok(Array.Empty<LiveAlertDto>());

            var devices = await _devices.GetBySerialsAsync(serials, onlyActive: false);
            if (devices.Count == 0) return Ok(Array.Empty<LiveAlertDto>());

            var devById = devices.ToDictionary(d => d.Id, d => d);
            var deviceIds = devices.Select(d => d.Id).ToList();

            var alerts = await _alerts.GetAlerts(deviceIds);
            var fromUtc = DateTime.UtcNow.AddHours(-Math.Abs(hours));

            var result = alerts
                .Where(a => a.Time >= fromUtc && devById.ContainsKey(a.DeviceId))
                .OrderByDescending(a => a.Time)
                .Take(Math.Max(1, limit))
                .Select(a =>
                {
                    var d = devById[a.DeviceId];
                    return new LiveAlertDto(
                        d.serialNumber,
                        d.description ?? a.Notes,
                        a.Message,
                        a.Time
                    );
                })
                .ToList();

            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "GetMyAlerts failed", error = ex.Message });
        }
    }

    // ---------------- Team distribution & rebalance ----------------

    private async Task<List<string>> GetTeamSerialsAsync(long teamId)
    {
        // 👇 CHỌN CLIENT THEO TEAM:
        // - Nếu teamId là team LT5 (trùng với _apiLt5.TeamId) → dùng account LT5
        // - Ngược lại → dùng client cũ (_api), thường là team main
        string raw;
        if (teamId == _apiLt5.TeamId)
        {
            raw = await _apiLt5.GetDevicesRawAsync(teamId);
        }
        else
        {
            raw = await _api.GetDevicesRawAsync(teamId);
        }

        var list = ParseDevicesRaw(raw);
        return list
            .Select(d => (d.serialNumber ?? "").Trim())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s)
            .ToList();
    }

    private async Task<List<TeamDistributionRow>> BuildDistributionAsync(long teamId)
    {
        var maps = await _empAccountDevices.GetMapsByTeamAsync(teamId);
        var accIds = maps.Select(m => m.UserId).Distinct().ToList();

        var accs = await _accounts.Find(Builders<Account>.Filter.In(a => a.Id, accIds)).ToListAsync();
        var nameById = accs.ToDictionary(a => a.Id, a => a.FullName ?? "(N/A)");

        var res = maps
            .GroupBy(m => m.UserId)
            .Select(g => new TeamDistributionRow(
                g.Key.ToString(),
                nameById.TryGetValue(g.Key, out var nm) ? nm : "(N/A)",
                g.Count(),
                g.Select(x => x.SerialNumber).OrderBy(x => x).ToList()
            ))
            .OrderByDescending(x => x.count)
            .ToList();

        return res;
    }

    public record TeamDistributionRow(
        string userId,
        string fullName,
        int count,
        List<string> serials
    );

    [HttpGet("devices/team/{teamId}/distribution")]
    public async Task<IActionResult> GetDistribution(long teamId)
    {
        try
        {
            var dist = await BuildDistributionAsync(teamId);
            return Ok(dist);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Get distribution failed", error = ex.Message });
        }
    }

    [HttpDelete("devices/team/{teamId}/clear")]
    public async Task<IActionResult> ClearTeam(long teamId, [FromBody] IEnumerable<string>? userIds = null)
    {
        try
        {
            IEnumerable<ObjectId>? uids = null;
            if (userIds != null && userIds.Any())
            {
                var tmp = new List<ObjectId>();
                foreach (var s in userIds) if (ObjectId.TryParse(s, out var oid)) tmp.Add(oid);
                uids = tmp;
            }

            var deleted = await _empAccountDevices.ClearByTeamAsync(teamId, uids);
            return Ok(new { ok = true, message = $"Đã xoá {deleted} mapping của team {teamId}" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Clear mappings failed", error = ex.Message });
        }
    }

    public class RebalanceReq
    {
        public long TeamId { get; set; }
        public List<string>? Participants { get; set; }
    }

    public class AssignAndRebalanceReq
    {
        public long TeamId { get; set; }
        public string AccountId { get; set; } = null!;
    }

    [HttpPost("devices/rebalance")]
    public async Task<IActionResult> Rebalance([FromBody] RebalanceReq req)
    {
        if (req == null) return BadRequest(new { ok = false, message = "Body is required." });
        if (req.TeamId <= 0) return BadRequest(new { ok = false, message = "teamId invalid." });

        try
        {
            var teamSerials = await GetTeamSerialsAsync(req.TeamId);
            if (teamSerials.Count == 0)
                return Ok(new { ok = true, message = "Không có thiết bị nào trong team.", distribution = Array.Empty<object>() });

            IEnumerable<ObjectId>? participants = null;
            if (req.Participants is { Count: > 0 })
            {
                var ids = new List<ObjectId>();
                foreach (var s in req.Participants)
                    if (ObjectId.TryParse(s, out var oid)) ids.Add(oid);
                participants = ids;
            }
            else
            {
                var cur = await _empAccountDevices.GetMapsByTeamAsync(req.TeamId);
                var ids = cur.Select(m => m.UserId).Distinct().ToList();
                if (ids.Count == 0)
                    return BadRequest(new { ok = false, message = "Chưa có danh sách nhân viên tham gia. Vui lòng chọn Participants." });
                participants = ids;
            }

            var partList = participants!.ToList();

            var allMaps = await _empAccountDevices.GetMapsByTeamAsync(req.TeamId);
            var serialOfOthers = allMaps.Where(m => !partList.Contains(m.UserId))
                                        .Select(m => m.SerialNumber)
                                        .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var pool = teamSerials.Where(s => !serialOfOthers.Contains(s)).ToList();
            if (pool.Count == 0)
            {
                var dist0 = await BuildDistributionAsync(req.TeamId);
                return Ok(new { ok = true, message = "Không có serial nào hợp lệ để chia trong phạm vi đã chọn.", distribution = dist0 });
            }

            await _empAccountDevices.ClearByTeamAsync(req.TeamId, partList);

            int i = 0;
            foreach (var s in pool)
            {
                var uid = partList[i % partList.Count];
                await _empAccountDevices.AssignAsync(uid, req.TeamId, s);
                i++;
            }

            var dist = await BuildDistributionAsync(req.TeamId);
            return Ok(new { ok = true, message = "Đã chia đều thành công.", teamId = req.TeamId, distribution = dist });
        }
        catch (MongoWriteException mwx)
        {
            return StatusCode(500, new { ok = false, message = "Rebalance failed (MongoWriteException)", error = mwx.Message, code = mwx.WriteError?.Code });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Rebalance failed", error = ex.Message });
        }
    }

    [HttpPost("devices/assign-one-and-rebalance")]
    public async Task<IActionResult> AssignOneAndRebalance([FromBody] AssignAndRebalanceReq req)
    {
        if (req == null) return BadRequest(new { ok = false, message = "Body is required." });
        if (req.TeamId <= 0) return BadRequest(new { ok = false, message = "teamId invalid." });
        if (!ObjectId.TryParse(req.AccountId, out var uid)) return BadRequest(new { ok = false, message = "accountId invalid." });

        try
        {
            var teamSerials = await GetTeamSerialsAsync(req.TeamId);
            if (teamSerials.Count == 0)
                return Ok(new { ok = true, message = "Không có thiết bị nào trong team.", distribution = Array.Empty<object>() });

            var maps = await _empAccountDevices.GetMapsByTeamAsync(req.TeamId);
            var participants = maps.Select(m => m.UserId).Distinct().ToHashSet();
            participants.Add(uid);
            var partList = participants.ToList();

            var serialOfOthers = maps.Where(m => !participants.Contains(m.UserId))
                                     .Select(m => m.SerialNumber)
                                     .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var pool = teamSerials.Where(s => !serialOfOthers.Contains(s)).ToList();

            await _empAccountDevices.ClearByTeamAsync(req.TeamId, partList);

            partList = new[] { uid }.Concat(partList.Where(x => x != uid)).ToList();

            int i = 0;
            foreach (var s in pool)
            {
                var who = partList[i % partList.Count];
                await _empAccountDevices.AssignAsync(who, req.TeamId, s);
                i++;
            }

            var dist = await BuildDistributionAsync(req.TeamId);
            return Ok(new { ok = true, message = "Đã thêm người và chia lại thành công.", teamId = req.TeamId, distribution = dist });
        }
        catch (MongoWriteException mwx)
        {
            return StatusCode(500, new { ok = false, message = "Assign & rebalance failed (MongoWriteException)", error = mwx.Message, code = mwx.WriteError?.Code });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, message = "Assign & rebalance failed", error = ex.Message });
        }
    }
}
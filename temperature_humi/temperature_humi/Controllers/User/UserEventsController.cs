using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System.Security.Claims;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers.User
{
    [ApiController]
    [Route("api/user/events")]
    [Authorize]
    [EnableCors("AllowFrontend")]
    public sealed class UserEventsController : ControllerBase
    {
        private const int DefaultLimit = 500;
        private const int MaxStoredLimit = 50_000;
        private const double MaxCloudRangeDays = 31.5;

        private readonly AccountDeviceService _accountDevices;
        private readonly ILogger<UserEventsController> _log;

        public UserEventsController(
            AccountDeviceService accountDevices,
            ILogger<UserEventsController> log)
        {
            _accountDevices = accountDevices;
            _log = log;
        }

        public sealed class EventQueryRequest
        {
            public string SerialNumber { get; set; } = string.Empty;
            public DateTime? StartDateUtc { get; set; }
            public DateTime? EndDateUtc { get; set; }
            public int? Limit { get; set; }
            public string? EventType { get; set; }
        }

        public sealed class EventFetchRequest
        {
            public string SerialNumber { get; set; } = string.Empty;
            public DateTime? StartDateUtc { get; set; }
            public DateTime? EndDateUtc { get; set; }
        }

        // =====================================================
        // GET /api/user/my-serials
        //
        // EventsPage.tsx gọi endpoint này khi mở trang.
        // Lấy toàn bộ serial được gán cho user từ AccountDevices,
        // không chỉ lọc LT5GEO.
        // =====================================================
        [HttpGet("/api/user/my-serials")]
        public async Task<IActionResult> GetMySerials(
            CancellationToken ct)
        {
            var userId = CurrentUserObjectId();

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    message =
                        "Không xác định được tài khoản đăng nhập."
                });
            }

            try
            {
                var assignments =
                    await _accountDevices
                        .GetSerialsByAccountAsync(userId);

                var devices = assignments
                    .Where(x =>
                        x.teamId > 0 &&
                        !string.IsNullOrWhiteSpace(x.serial))
                    .Select(x => new
                    {
                        teamId = x.teamId,
                        serialNumber =
                            NormalizeSerial(x.serial)
                    })
                    .Where(x =>
                        !string.IsNullOrWhiteSpace(
                            x.serialNumber))
                    .GroupBy(
                        x => new
                        {
                            x.teamId,
                            x.serialNumber
                        })
                    .Select(g => g.First())
                    .OrderBy(x => x.teamId)
                    .ThenBy(x => x.serialNumber)
                    .ToList();

                var serials = devices
                    .Select(x => x.serialNumber)
                    .Distinct(
                        StringComparer.OrdinalIgnoreCase)
                    .OrderBy(x => x)
                    .ToList();

                _log.LogInformation(
                    "[UserEvents] UserId={UserId} loaded {Count} assigned serial(s).",
                    userId,
                    serials.Count);

                return Ok(new
                {
                    userId = userId.ToString(),
                    total = serials.Count,
                    serials,
                    devices
                });
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                return StatusCode(499);
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "[UserEvents] Failed loading assigned serials for UserId={UserId}.",
                    userId);

                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new
                    {
                        message =
                            "Không thể đọc danh sách thiết bị được gán.",
                        userId = userId.ToString(),
                        errorType =
                            ex.GetType().FullName,
                        detail = ex.Message,
                        innerDetail =
                            ex.InnerException?.Message
                    });
            }
        }

        // =====================================================
        // POST /api/user/events/query
        //
        // Đọc dữ liệu đã lưu trong MongoDB.
        // EventsPage.tsx cần response dạng { data: [...] }.
        // =====================================================
        [HttpPost("query")]
        public async Task<IActionResult> QuerySavedEvents(
            [FromBody] EventQueryRequest? request,
            [FromServices] EventService events,
            CancellationToken ct)
        {
            if (request == null)
            {
                return BadRequest(new
                {
                    message = "Body không hợp lệ."
                });
            }

            var userId = CurrentUserObjectId();

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    message = "Không xác định được tài khoản đăng nhập."
                });
            }

            var serial = NormalizeSerial(
                request.SerialNumber);

            if (string.IsNullOrWhiteSpace(serial))
            {
                return BadRequest(new
                {
                    message = "Thiếu serialNumber."
                });
            }

            var assignment =
                await ResolveAssignmentAsync(
                    userId,
                    serial);

            if (assignment == null)
            {
                return StatusCode(
                    StatusCodes.Status403Forbidden,
                    new
                    {
                        message =
                            "Thiết bị không được gán cho tài khoản này.",
                        serialNumber = serial
                    });
            }

            var startUtc =
                NormalizeUtc(request.StartDateUtc);

            var endUtc =
                NormalizeUtc(request.EndDateUtc);

            if (startUtc.HasValue &&
                endUtc.HasValue &&
                startUtc.Value > endUtc.Value)
            {
                (startUtc, endUtc) =
                    (endUtc, startUtc);
            }

            var limit = Math.Clamp(
                request.Limit ?? DefaultLimit,
                1,
                MaxStoredLimit);

            var rows = await events.QueryAsync(
                serialNumber: serial,
                startUtc: startUtc,
                endUtc: endUtc,
                limit: limit,
                eventType: request.EventType,
                ct: ct);

            var data = rows.Select(MapEvent).ToList();

            return Ok(new
            {
                serialNumber = serial,
                teamId = assignment.Value.teamId,
                count = data.Count,
                data
            });
        }

        // =====================================================
        // POST /api/user/events/fetch
        //
        // Kéo Event từ đúng LogTag account/team bằng router,
        // lưu vào MongoDB rồi frontend gọi lại /query.
        // =====================================================
        [HttpPost("fetch")]
        public async Task<IActionResult> FetchEventsFromCloud(
            [FromBody] EventFetchRequest? request,
            [FromServices] LogTagAccountRouter logTagRouter,
            [FromServices] EventService events,
            CancellationToken ct)
        {
            if (request == null)
            {
                return BadRequest(new
                {
                    message = "Body không hợp lệ."
                });
            }

            var userId = CurrentUserObjectId();

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    message = "Không xác định được tài khoản đăng nhập."
                });
            }

            var serial = NormalizeSerial(
                request.SerialNumber);

            if (string.IsNullOrWhiteSpace(serial))
            {
                return BadRequest(new
                {
                    message = "Thiếu serialNumber."
                });
            }

            var assignment =
                await ResolveAssignmentAsync(
                    userId,
                    serial);

            if (assignment == null)
            {
                return StatusCode(
                    StatusCodes.Status403Forbidden,
                    new
                    {
                        message =
                            "Thiết bị không được gán cho tài khoản này.",
                        serialNumber = serial
                    });
            }

            var teamId = assignment.Value.teamId;

            var endUtc =
                NormalizeUtc(request.EndDateUtc)
                ?? DateTime.UtcNow;

            var startUtc =
                NormalizeUtc(request.StartDateUtc)
                ?? endUtc.AddDays(-31);

            if (startUtc > endUtc)
            {
                (startUtc, endUtc) =
                    (endUtc, startUtc);
            }

            if ((endUtc - startUtc).TotalDays >
                MaxCloudRangeDays)
            {
                return BadRequest(new
                {
                    message =
                        "Khoảng thời gian kéo LogTag không được vượt quá 31 ngày.",
                    startDateUtc = startUtc,
                    endDateUtc = endUtc
                });
            }

            try
            {
                var client =
                    logTagRouter.GetClientByTeamId(
                        teamId);

                var response =
                    await client.GetEventsAsync(
                        serial,
                        startUtc,
                        endUtc,
                        ct);

                var apiCount =
                    response?.data?.Count ?? 0;

                var inserted =
                    response == null
                        ? 0
                        : await events.SaveNewEventsAsync(
                            serial,
                            response,
                            ct);

                _log.LogInformation(
                    "[UserEvents] Cloud fetch UserId={UserId}, Team={TeamId}, Serial={Serial}, Api={ApiCount}, Inserted={Inserted}.",
                    userId,
                    teamId,
                    serial,
                    apiCount,
                    inserted);

                // Giữ response tương thích LogTagEventsResponse cho
                // phần "Chi tiết lần làm mới gần nhất" ở frontend.
                return Ok(new
                {
                    status = "ok",
                    teamId,
                    serialNumber = serial,
                    startDateUtc = startUtc,
                    endDateUtc = endUtc,
                    apiCount,
                    inserted,
                    data = response?.data
                });
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                return StatusCode(499);
            }
            catch (InvalidOperationException ex)
            {
                _log.LogWarning(
                    ex,
                    "[UserEvents] Team mapping error Team={TeamId}, Serial={Serial}.",
                    teamId,
                    serial);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        message =
                            "Team của thiết bị chưa được cấu hình đúng trong LogTagAccounts.",
                        teamId,
                        serialNumber = serial,
                        detail = ex.Message
                    });
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "[UserEvents] Cloud fetch failed Team={TeamId}, Serial={Serial}.",
                    teamId,
                    serial);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        message =
                            "Không thể kéo sự kiện từ LogTag Cloud.",
                        teamId,
                        serialNumber = serial,
                        detail = ex.Message
                    });
            }
        }

        // =====================================================
        // GET /api/user/events/{serial}
        //
        // Giữ route cũ để không làm vỡ code đang dùng trước đây.
        // Đã bỏ điều kiện chỉ cho LT5GEO.
        // =====================================================
        [HttpGet("{serial}")]
        public async Task<IActionResult> GetMyEventsLegacy(
            string serial,
            [FromServices] EventService events,
            CancellationToken ct)
        {
            var userId = CurrentUserObjectId();

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    message = "Không xác định được tài khoản đăng nhập."
                });
            }

            var normalizedSerial =
                NormalizeSerial(serial);

            if (string.IsNullOrWhiteSpace(
                    normalizedSerial))
            {
                return BadRequest(new
                {
                    message = "Thiếu serial."
                });
            }

            var assignment =
                await ResolveAssignmentAsync(
                    userId,
                    normalizedSerial);

            if (assignment == null)
            {
                return StatusCode(
                    StatusCodes.Status403Forbidden,
                    new
                    {
                        message =
                            "Thiết bị không được gán cho tài khoản này."
                    });
            }

            var rows = await events.QueryAsync(
                serialNumber: normalizedSerial,
                startUtc: null,
                endUtc: null,
                limit: 200,
                eventType: null,
                ct: ct);

            return Ok(rows.Select(MapEvent));
        }

        private async Task<(long teamId, string serial)?>
            ResolveAssignmentAsync(
                ObjectId userId,
                string serial)
        {
            var assignments =
                await _accountDevices
                    .GetSerialsByAccountAsync(userId);

            var matched = assignments
                .Where(x =>
                    x.teamId > 0 &&
                    string.Equals(
                        NormalizeSerial(x.serial),
                        serial,
                        StringComparison.OrdinalIgnoreCase))
                .OrderBy(x => x.teamId)
                .FirstOrDefault();

            if (matched.teamId <= 0 ||
                string.IsNullOrWhiteSpace(
                    matched.serial))
            {
                return null;
            }

            return (
                matched.teamId,
                NormalizeSerial(matched.serial));
        }

        private ObjectId CurrentUserObjectId()
        {
            var raw =
                User.FindFirstValue(
                    ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("userId")
                ?? User.FindFirstValue("UserId")
                ?? User.FindFirstValue("id")
                ?? User.FindFirstValue("Id")
                ?? User.FindFirstValue("accountId")
                ?? User.FindFirstValue("AccountId")
                ?? User.FindFirstValue("sub")
                ?? Request.Headers["X-User-Id"]
                    .FirstOrDefault()
                ?? Request.Headers["accountId"]
                    .FirstOrDefault();

            return ObjectId.TryParse(
                raw,
                out var userId)
                ? userId
                : ObjectId.Empty;
        }

        private static string NormalizeSerial(
            string? serial)
        {
            return (serial ?? string.Empty)
                .Trim()
                .ToUpperInvariant();
        }

        private static DateTime? NormalizeUtc(
            DateTime? value)
        {
            if (!value.HasValue)
                return null;

            return value.Value.Kind switch
            {
                DateTimeKind.Utc =>
                    value.Value,

                DateTimeKind.Local =>
                    value.Value.ToUniversalTime(),

                _ =>
                    DateTime.SpecifyKind(
                        value.Value,
                        DateTimeKind.Utc)
            };
        }

        private static object MapEvent(
            Event item)
        {
            return new
            {
                serialNumber = item.serialNumber,
                eventType = item.eventType,
                eventTimeUtc = item.eventTimeUtc,
                alarmThreshold = item.alarmThreshold,
                alarmValue = item.alarmValue,
                alarmCount = item.alarmCount,
                batteryType = item.batteryType,
                source = item.source,
                ingestedAtUtc = item.ingestedAtUtc
            };
        }
    }
}
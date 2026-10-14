// Controllers/UserController.Events.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using temperature_humi.Helpers;            // UserContext.GetUserId(...)
using temperature_humi.Helpers.Config;     // LogTagApiSettings (TeamId)
using temperature_humi.Service.LogtagService;            // LogTagApiClient, AccountDeviceService, EventService

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/user")]
    [Authorize] // cookie auth
    public class UserController : ControllerBase
    {
        private readonly LogTagApiClient _logtag;
        private readonly AccountDeviceService _accDevs;
        private readonly EventService _eventsStore;
        private readonly LogTagApiSettings _cfg;

        public UserController(
            LogTagApiClient logtag,
            AccountDeviceService accDevs,
            EventService eventsStore,
            IOptions<LogTagApiSettingsMain> cfg)
        {
            _logtag = logtag;
            _accDevs = accDevs;
            _eventsStore = eventsStore;
            _cfg = cfg.Value;
        }

        //// ==================== MY SERIALS ====================
        //[HttpGet("my-serials")]
        //public async Task<IActionResult> MySerials(CancellationToken ct)
        //{
        //    var uidStr = UserContext.GetUserId(HttpContext);
        //    if (string.IsNullOrWhiteSpace(uidStr)) return Unauthorized("Missing user id");
        //    if (!ObjectId.TryParse(uidStr, out var uid)) return Unauthorized("Invalid user id");

        //    // lấy serials theo mapping + team id trong cấu hình; auto chuẩn hóa HOA
        //    var serials = await _accDevs.GetMySerialsAsync(uid, _cfg.TeamId, ct);
        //    return Ok(new { serials });
        //}

        //public record EventsQueryDto(string serialNumber, string? startDateUtc, string? endDateUtc, int? limit);

        //// ==================== QUERY SAVED ====================
        //[HttpPost("events/query")]
        //public async Task<IActionResult> QuerySaved([FromBody] EventsQueryDto dto, CancellationToken ct)
        //{
        //    var uidStr = UserContext.GetUserId(HttpContext);
        //    if (string.IsNullOrWhiteSpace(uidStr)) return Unauthorized("Missing user id");
        //    if (!ObjectId.TryParse(uidStr, out var uid)) return Unauthorized("Invalid user id");

        //    var serialUpper = (dto.serialNumber ?? "").Trim().ToUpperInvariant();
        //    if (string.IsNullOrWhiteSpace(serialUpper)) return BadRequest("serialNumber required");

        //    // ACL: user chỉ xem serial đã được gán
        //    if (!await _accDevs.HasAccessAsync(uid, _cfg.TeamId, serialUpper, ct))
        //        return Forbid();

        //    var start = ParseUtc(dto.startDateUtc);
        //    var end = ParseUtc(dto.endDateUtc);
        //    if (TooWide(start, end)) return BadRequest("Range must be ≤ 31 days.");

        //    // đọc từ DB (đã có index & sort)
        //    var data = await _eventsStore.QueryAsync(serialUpper, start, end, dto.limit ?? 500, null, ct);
        //    return Ok(new { data });
        //}

        //// ==================== FETCH FROM LOGTAG + SAVE ====================
        //[HttpPost("events/fetch")]
        //public async Task<IActionResult> FetchStoreReturn([FromBody] EventsQueryDto dto, CancellationToken ct)
        //{
        //    var uidStr = UserContext.GetUserId(HttpContext);
        //    if (string.IsNullOrWhiteSpace(uidStr)) return Unauthorized("Missing user id");
        //    if (!ObjectId.TryParse(uidStr, out var uid)) return Unauthorized("Invalid user id");

        //    var serialUpper = (dto.serialNumber ?? "").Trim().ToUpperInvariant();
        //    if (string.IsNullOrWhiteSpace(serialUpper)) return BadRequest("serialNumber required");

        //    // ACL trước khi gọi upstream
        //    if (!await _accDevs.HasAccessAsync(uid, _cfg.TeamId, serialUpper, ct))
        //        return Forbid();

        //    var start = ParseUtc(dto.startDateUtc);
        //    var end = ParseUtc(dto.endDateUtc);
        //    if (TooWide(start, end)) return BadRequest("Range must be ≤ 31 days.");

        //    // gọi LogTag (có Access_token, limiter, retry & cache TTL 10s)
        //    var resp = await _logtag.GetEventsAsync(serialUpper, start, end, ct);

        //    // lưu DB (insert-many skip duplicates + đóng dấu source/ingestedAt)
        //    await _eventsStore.SaveNewEventsAsync(serialUpper, resp, ct);

        //    // trả nguyên response để FE hiển thị chi tiết lần kéo
        //    return Ok(resp);
        //}

        // ==================== Helpers ====================
        private static DateTime? ParseUtc(string? s)
            => string.IsNullOrWhiteSpace(s) ? null : DateTime.Parse(s).ToUniversalTime();

        private static bool TooWide(DateTime? s, DateTime? e)
            => s.HasValue && e.HasValue && (e.Value - s.Value).TotalDays > 31.5;
    }
}
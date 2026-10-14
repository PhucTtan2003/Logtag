using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using temperature_humi.Helpers.Config;
using temperature_humi.Service;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/reading-aggregation")]
    [Authorize(Roles = "Admin")]
    public class AdminReadingAggregationController : ControllerBase
    {
        private readonly ReadingAggregationService _aggregation;
        private readonly IOptionsMonitor<ReadingAggregationOptions> _options;

        public AdminReadingAggregationController(
            ReadingAggregationService aggregation,
            IOptionsMonitor<ReadingAggregationOptions> options)
        {
            _aggregation = aggregation;
            _options = options;
        }

        public class BackfillDto
        {
            public string? FromUtc { get; set; }
            public string? ToUtc { get; set; }
            public int ChunkDays { get; set; } = 7;
        }

        [HttpPost("run-recent")]
        public async Task<IActionResult> RunRecent(CancellationToken ct)
        {
            var cfg = _options.CurrentValue ?? new ReadingAggregationOptions();

            var stats = await _aggregation.AggregateRecentAsync(
                TimeSpan.FromHours(Math.Clamp(cfg.LookbackHours, 1, 24 * 14)),
                TimeSpan.FromHours(Math.Clamp(cfg.LatestLookbackHours, 1, 24 * 30)),
                TimeSpan.FromMinutes(Math.Clamp(cfg.OnlineThresholdMinutes, 5, 24 * 60)),
                ct);

            return Ok(new
            {
                message = "recent aggregation completed",
                stats
            });
        }

        [HttpPost("backfill")]
        public async Task<IActionResult> Backfill([FromBody] BackfillDto dto, CancellationToken ct)
        {
            if (dto == null)
                return BadRequest(new { message = "Body is required." });

            var toUtc = ParseUtcOrDefault(dto.ToUtc, DateTime.UtcNow);
            var fromUtc = ParseUtcOrDefault(dto.FromUtc, toUtc.AddDays(-61));

            if ((toUtc - fromUtc).TotalDays > 370)
                return BadRequest(new { message = "Backfill tối đa 370 ngày/lần để tránh quá tải." });

            var stats = await _aggregation.BackfillAsync(
                fromUtc,
                toUtc,
                Math.Clamp(dto.ChunkDays, 1, 31),
                ct);

            return Ok(new
            {
                message = "backfill aggregation completed",
                fromUtc,
                toUtc,
                chunkDays = Math.Clamp(dto.ChunkDays, 1, 31),
                stats
            });
        }

        [HttpGet("latest")]
        public async Task<IActionResult> Latest(
            [FromQuery] string? teamId,
            [FromQuery] string? serials,
            CancellationToken ct)
        {
            var serialList = string.IsNullOrWhiteSpace(serials)
                ? Array.Empty<string>()
                : serials.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

            var rows = await _aggregation.GetLatestAsync(teamId, serialList, ct);
            return Ok(new { total = rows.Count, items = rows });
        }

        private static DateTime ParseUtcOrDefault(string? value, DateTime fallback)
        {
            if (string.IsNullOrWhiteSpace(value))
                return DateTime.SpecifyKind(fallback, DateTimeKind.Utc);

            return DateTime.Parse(value).ToUniversalTime();
        }
    }
}

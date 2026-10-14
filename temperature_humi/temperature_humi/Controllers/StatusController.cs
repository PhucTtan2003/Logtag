using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using temperature_humi.Service;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/status")]
    [Authorize]
    public class StatusController : ControllerBase
    {
        private readonly LocationReadingService _readingService;

        public StatusController(LocationReadingService readingService)
        {
            _readingService = readingService;
        }

        [HttpGet("live")]
        public async Task<IActionResult> GetLive(
            [FromQuery] string? serials,
            CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(serials))
            {
                return BadRequest(new
                {
                    message = "Thiếu danh sách serials."
                });
            }

            var serialList = serials
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => x.ToUpperInvariant())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (serialList.Count == 0)
            {
                return BadRequest(new
                {
                    message = "Danh sách serials không hợp lệ."
                });
            }

            var latest = await _readingService.GetLatestBySerialsAsync(serialList);

            var now = DateTime.UtcNow;
            var onlineThreshold = TimeSpan.FromMinutes(30);

            var data = latest.Select(x =>
            {
                var age = now - x.DateUtc;
                var isOnline = age <= onlineThreshold;

                return new
                {
                    serialNumber = x.SerialNumber,
                    serial = x.SerialNumber,
                    dateUtc = x.DateUtc,
                    timeUtc = x.DateUtc,
                    last = x.DateUtc,
                    temperature = x.Temperature,
                    humidity = x.Humidity,
                    status = isOnline ? "Online" : "Offline",
                    isOnline,
                    ageSeconds = Math.Max(0, (int)age.TotalSeconds),
                    notes = (string?)null
                };
            }).ToList();

            return Ok(new
            {
                status = "ok",
                count = data.Count,
                data
            });
        }
    }
}
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using temperature_humi.Service;

namespace temperature_humi.Controllers.Mobile
{
    [ApiController]
    [Route("api/mobile/v1/readings")]
    [Authorize]
    public class MobileReadingsController : ControllerBase
    {
        private readonly LocationReadingService _readings;

        public MobileReadingsController(LocationReadingService readings)
        {
            _readings = readings;
        }

        // GET /api/mobile/v1/readings/recent?serial=A0A2001951U5-CH1&minutes=60&limit=120
        [HttpGet("recent")]
        public async Task<IActionResult> Recent(
            [FromQuery] string serial,
            [FromQuery] int minutes = 60,
            [FromQuery] int limit = 120)
        {
            serial = (serial ?? "").Trim().ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(serial))
            {
                return BadRequest(new
                {
                    status = "error",
                    message = "Thiếu serial."
                });
            }

            minutes = Math.Clamp(minutes, 5, 1440);
            limit = Math.Clamp(limit, 20, 5000);

            var rows = await _readings.GetRecentAsync(
                serial,
                TimeSpan.FromMinutes(minutes),
                limit
            );

            var items = rows
                .OrderBy(x => x.DateUtc)
                .Select(x => new
                {
                    serialNumber = x.SerialNumber,
                    dateUtc = x.DateUtc,
                    temperature = x.Temperature,
                    humidity = x.Humidity
                })
                .ToList();

            return Ok(new
            {
                status = "ok",
                serialNumber = serial,
                minutes,
                limit,
                total = items.Count,
                items,
                timestampUtc = DateTime.UtcNow
            });
        }
    }
}
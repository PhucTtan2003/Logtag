using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using temperature_humi.Service;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/events")]
    [Authorize(Roles = "Admin")]
    public class AdminEventsController : ControllerBase
    {
        private readonly EventService _events;

        public AdminEventsController(EventService events)
        {
            _events = events;
        }

        // GET /api/admin/events/{serial}?startUtc=...&endUtc=...&limit=200
        [HttpGet("{serial}")]
        public async Task<IActionResult> GetBySerial(
            string serial,
            [FromQuery] string? startUtc,
            [FromQuery] string? endUtc,
            [FromQuery] int? limit,
            CancellationToken ct)
        {
            var sn = (serial ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(sn)) return BadRequest("serial required");

            DateTime? s = string.IsNullOrWhiteSpace(startUtc) ? null : DateTime.Parse(startUtc).ToUniversalTime();
            DateTime? e = string.IsNullOrWhiteSpace(endUtc) ? null : DateTime.Parse(endUtc).ToUniversalTime();

            var rows = await _events.QueryAsync(
                serialNumber: sn,
                startUtc: s,
                endUtc: e,
                limit: limit ?? 200,
                eventType: null,
                ct: ct
            );

          
            var payload = rows.Select(x => new
            {
                serialNumber = x.serialNumber,
                type = x.eventType,               
                eventType = x.eventType,
                timeUtc = x.eventTimeUtc,        
                value = x.alarmValue,             
                alarmValue = x.alarmValue,
                threshold = x.alarmThreshold,     
                alarmThreshold = x.alarmThreshold,
            });

            return Ok(payload);
        }
    }
}

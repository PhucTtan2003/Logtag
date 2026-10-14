using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using System.Text.Json.Serialization;
using temperature_humi.Data; 

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/alerts")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminAlertsController : ControllerBase
    {
        private readonly IMongoCollection<Event> _col;

        public AdminAlertsController(IOptions<MongoDBSettings> mongo)
        {
            var cli = new MongoClient(mongo.Value.ConnectionString);
            var db = cli.GetDatabase(mongo.Value.DatabaseName);
            _col = db.GetCollection<Event>("Events");
        }

        public sealed record RecentAlertDto(
            string SerialNumber,
            string Message,
            DateTime TimeUtc,
            string EventType
        );

  
        [HttpGet("recent")]
        public async Task<IActionResult> GetRecent([FromQuery] int minutes = 60, [FromQuery] int limit = 50, CancellationToken ct = default)
        {
            minutes = Math.Clamp(minutes, 1, 24 * 60);
            limit = Math.Clamp(limit, 1, 200);

            var cutoff = DateTime.UtcNow.AddMinutes(-minutes);

          
            var alertTypes = new[] { "temperature_alarm_high", "temperature_alarm_low", "power_loss", "power_restore", "battery_low" };

            var fb = Builders<Event>.Filter;
            var filter = fb.Gte(x => x.eventTimeUtc, cutoff) & fb.In(x => x.eventType, alertTypes);

            var list = await _col.Find(filter)
                                 .SortByDescending(x => x.eventTimeUtc)
                                 .Limit(limit)
                                 .ToListAsync(ct);

            
            static string BuildMessage(Event ev)
            {
                var t = (ev.eventType ?? "").ToLowerInvariant();
                if (t.StartsWith("temperature_alarm"))
                {
                    var dir = t.EndsWith("_high") ? "HIGH" : t.EndsWith("_low") ? "LOW" : "";
                    var v = ev.alarmValue?.ToString("0.##") ?? "?";
                    var thr = ev.alarmThreshold?.ToString("0.##") ?? "?";
                    return $"⚠️ Temperature {dir} Alarm: {v}°C (threshold {thr}°C)";
                }
                if (t == "power_loss") return "🔋 Power Loss detected (external power lost).";
                if (t == "power_restore") return "🔌 Power Restored (external power back).";
                if (t == "battery_low") return $"🔋 Battery Low{(string.IsNullOrWhiteSpace(ev.batteryType) ? "" : $" ({ev.batteryType})")}.";

                return ev.eventType ?? "Event";
            }

            var payload = list.Select(ev => new RecentAlertDto(
                SerialNumber: (ev.serialNumber ?? "").Trim().ToUpperInvariant(),
                Message: BuildMessage(ev),
                TimeUtc: ev.eventTimeUtc,
                EventType: ev.eventType ?? "event"
            )).ToList();

            return Ok(new
            {
                data = payload,
                status = "ok",
                timestampUtc = DateTime.UtcNow
            });
        }
    }
}

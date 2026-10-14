using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using temperature_humi.DTO;
using temperature_humi.Service;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/devices")]
    [Authorize(Roles = "Admin")]
    public class DevicesController : ControllerBase
    {
        private readonly DeviceService _deviceService;
        private readonly LocationReadingService _readingService;

        public DevicesController(
            DeviceService deviceService,
            LocationReadingService readingService)
        {
            _deviceService = deviceService;
            _readingService = readingService;
        }

        private static string NormSerial(string s)
            => (s ?? "").Trim().ToUpperInvariant();

        private static string BaseSerialOf(string serial)
        {
            var sn = NormSerial(serial);
            var idx = sn.LastIndexOf("-CH", StringComparison.OrdinalIgnoreCase);

            if (idx <= 0) return sn;

            var suffix = sn[(idx + 3)..];
            return int.TryParse(suffix, out _) ? sn[..idx] : sn;
        }

        [HttpGet("all")]
        public async Task<IActionResult> GetAll(CancellationToken ct)
        {
            var fromDevices = new List<string>();
            var fromReadings = new List<string>();

            try
            {
                fromDevices = await _deviceService.GetAllSerialsAsync(ct);
            }
            catch
            {
                fromDevices = new List<string>();
            }

            try
            {
                fromReadings = await _readingService.GetKnownSerialsAsync(ct);
            }
            catch
            {
                fromReadings = new List<string>();
            }

            var serials = fromDevices
                .Concat(fromReadings)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(NormSerial)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(BaseSerialOf)
                .ThenBy(s => s)
                .ToList();

            return Ok(new
            {
                data = serials,
                status = "ok",
                count = serials.Count
            });
        }

        [HttpPost("debug/locationreadings-v2-invalid/{teamId:long}")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> DebugFindInvalidLocationReadingsV2Serials(
            long teamId,
            [FromBody] DebugBatchV2SerialRequest body,
            CancellationToken ct)
        {
            if (teamId <= 0)
                return BadRequest(new { message = "teamId không hợp lệ." });

            var serials = body?.Serials?
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim().ToUpperInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList() ?? new();

            if (serials.Count == 0)
                return BadRequest(new { message = "Thiếu danh sách serials." });

            var invalid = await _readingService.DebugFindInvalidBatchV2SerialsAsync(
                teamId,
                serials,
                ct);

            return Ok(new
            {
                teamId,
                requested = serials.Count,
                invalidCount = invalid.Count,
                invalidSerials = invalid
            });
        }
    }
}
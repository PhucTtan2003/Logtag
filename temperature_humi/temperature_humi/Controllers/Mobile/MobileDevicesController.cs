using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System.Security.Claims;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers.Mobile
{
    [ApiController]
    [Route("api/mobile/v1/devices")]
    [Authorize]
    public class MobileDevicesController : ControllerBase
    {
        private readonly AccountService _accounts;
        private readonly AccountDeviceService _maps;
        private readonly DeviceService _devices;
        private readonly LocationReadingService _readings;

        public MobileDevicesController(
            AccountService accounts,
            AccountDeviceService maps,
            DeviceService devices,
            LocationReadingService readings)
        {
            _accounts = accounts;
            _maps = maps;
            _devices = devices;
            _readings = readings;
        }

        // GET /api/mobile/v1/devices
        [HttpGet]
        public async Task<IActionResult> GetMyDevices(CancellationToken ct)
        {
            var userId = await GetCurrentUserIdAsync();

            if (userId == null)
            {
                return Unauthorized(new
                {
                    status = "error",
                    message = "Không xác định được user hiện tại từ cookie đăng nhập."
                });
            }

            var maps = await _maps.GetMapsByAccountAsync(userId.Value);

            if (maps == null || maps.Count == 0)
            {
                return Ok(new
                {
                    status = "ok",
                    total = 0,
                    items = Array.Empty<object>(),
                    timestampUtc = DateTime.UtcNow
                });
            }

            var serials = maps
                .Select(x => (x.SerialNumber ?? "").Trim())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var deviceInfos = await _devices.GetBySerialsAsync(serials, onlyActive: false);

            var deviceMap = deviceInfos.ToDictionary(
                x => x.serialNumber,
                x => x,
                StringComparer.OrdinalIgnoreCase
            );

            var latestRows = await _readings.GetLatestBySerialsAsync(serials);

            var latestMap = latestRows.ToDictionary(
                x => x.SerialNumber,
                x => x,
                StringComparer.OrdinalIgnoreCase
            );

            var items = maps.Select(m =>
            {
                var serial = (m.SerialNumber ?? "").Trim();

                deviceMap.TryGetValue(serial, out var device);
                latestMap.TryGetValue(serial, out var latest);

                var dateUtc = latest?.DateUtc;
                var isOffline = IsOffline(dateUtc);

                return new
                {
                    teamId = m.TeamId,
                    serialNumber = serial,
                    name = !string.IsNullOrWhiteSpace(m.Notes)
                        ? m.Notes
                        : device?.model ?? serial,
                    notes = m.Notes,
                    assignedAtUtc = m.AssignedAtUtc,

                    device = device == null ? null : new
                    {
                        device.serialNumber,
                        device.model,
                        device.teamId
                    },

                    latest = latest == null ? null : new
                    {
                        serialNumber = latest.SerialNumber,
                        dateUtc = latest.DateUtc,
                        temperature = latest.Temperature,
                        humidity = latest.Humidity
                    },

                    temperature = latest?.Temperature,
                    humidity = latest?.Humidity,
                    dateUtc,
                    updatedAtUtc = dateUtc,

                    status = latest == null
                        ? "offline"
                        : isOffline
                            ? "offline"
                            : "online"
                };
            }).ToList();

            return Ok(new
            {
                status = "ok",
                total = items.Count,
                items,
                timestampUtc = DateTime.UtcNow
            });
        }

        private static bool IsOffline(DateTime? dateUtc)
        {
            if (!dateUtc.HasValue) return true;

            var utc = dateUtc.Value.Kind == DateTimeKind.Utc
                ? dateUtc.Value
                : dateUtc.Value.ToUniversalTime();

            return utc < DateTime.UtcNow.AddMinutes(-30);
        }

        private async Task<ObjectId?> GetCurrentUserIdAsync()
        {
            var id =
                User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("id")
                ?? User.FindFirstValue("userId")
                ?? User.FindFirstValue("sub");

            if (ObjectId.TryParse(id, out var objectId))
                return objectId;

            var email =
                User.FindFirstValue(ClaimTypes.Email)
                ?? User.Identity?.Name;

            if (!string.IsNullOrWhiteSpace(email))
            {
                var acc = await _accounts.FindByEmailAsync(email);
                if (acc != null)
                    return acc.Id;
            }

            return null;
        }
    }
}
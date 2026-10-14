// Controllers/Lt5ShipmentsController.cs
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using temperature_humi.Helpers;
using temperature_humi.Models.LogTag.LT5;
using temperature_humi.Service.LogtagService;
using temperature_humi.Service.LogtagService.Lt5;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/lt5")]
    public class Lt5ShipmentsController : ControllerBase
    {
        private readonly LogTagApiClientLt5 _lt5Client;
        private readonly AccountDeviceService _accDev;
        private readonly Lt5ProfilesStoreService _profilesStore;

        public Lt5ShipmentsController(
            LogTagApiClientLt5 lt5Client,
            AccountDeviceService accDev,
            Lt5ProfilesStoreService profilesStore)
        {
            _lt5Client = lt5Client;
            _accDev = accDev;
            _profilesStore = profilesStore;
        }

        [HttpPost("shipments")]
        public async Task<IActionResult> CreateShipment([FromBody] Lt5CreateShipmentViewModel dto, CancellationToken ct)
        {
            // 1) auth userId (bạn đang có UserContext)
            var uidStr = UserContext.GetUserId(HttpContext);
            if (!ObjectId.TryParse(uidStr, out var uid)) return Unauthorized("Invalid user id");

            var teamId = _lt5Client.TeamId;
            if (teamId <= 0) return StatusCode(500, "LT5 teamId missing");

            if (dto?.Devices == null || dto.Devices.Count == 0)
                return BadRequest("devices required");

            if (dto.Devices.Count > 5)
                return BadRequest("Max 5 devices per shipment");

            // 2) validate each device
            foreach (var d in dto.Devices)
            {
                var serial = (d.SerialNumber ?? "").Trim().ToUpperInvariant();
                if (string.IsNullOrWhiteSpace(serial)) return BadRequest("serialNumber required");

                // ACL: serial phải thuộc user trong team LT5
                if (!await _accDev.HasAccessAsync(uid, teamId, serial, ct))
                    return Forbid();

                // profile tồn tại & còn active
                if (d.LoggerProfileId.HasValue)
                {
                    var okProfile = await _profilesStore.ExistsActiveAsync(teamId, d.LoggerProfileId.Value, ct);
                    if (!okProfile) return BadRequest($"ProfileId {d.LoggerProfileId} is not available (deleted or not found).");
                }

                d.SerialNumber = serial; // normalize back
            }

            // 3) build payload theo doc
            var payload = new
            {
                shipmentName = dto.ShipmentName,
                startDateUtc = dto.StartDateUtc,
                endDateUtc = dto.EndDateUtc,
                devices = dto.Devices.Select(x => new
                {
                    serialNumber = x.SerialNumber,
                    loggerProfileId = x.LoggerProfileId
                }).ToList()
            };

            var res = await _lt5Client.CreateShipmentAsync(teamId, payload, ct);
            return Ok(res);
        }
    }
}
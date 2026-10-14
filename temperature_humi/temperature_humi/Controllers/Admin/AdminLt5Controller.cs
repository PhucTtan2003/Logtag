using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using temperature_humi.Service.LogtagService;
using temperature_humi.Service.LogtagService.Lt5;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/lt5")]
    [Authorize(Roles = "Admin")]
    public class AdminLt5Controller : ControllerBase
    {
        private readonly AccountDeviceService _accDev;
        private readonly Lt5Service _lt5;

        public AdminLt5Controller(AccountDeviceService accDev, Lt5Service lt5)
        {
            _accDev = accDev;
            _lt5 = lt5;
        }

        // ✅ ADMIN: lấy tất cả serial LT5

        [HttpGet("serials")]
        public async Task<IActionResult> GetAllSerials(CancellationToken ct)
        {
            // Chỉ lấy LT5GEO (đuôi 157C)
            var serials = await _accDev.GetAllLt5GeoSerialsAsync(ct);
            return Ok(serials);
        }


        // ✅ ADMIN: đọc readings cho BẤT KỲ serial (không check ownership)
        [HttpPost("readings")]
        public async Task<IActionResult> Readings([FromBody] AdminLt5ReadingsRequest req, CancellationToken ct)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.SerialNumber))
                return BadRequest("SerialNumber is required");

            var serial = req.SerialNumber.Trim().ToUpperInvariant();

            var result = await _lt5.GetReadingsAsync(
                serial,
                req.StartUtc,
                req.EndUtc
            );

            return Ok(result);
        }
    }

    public class AdminLt5ReadingsRequest
    {
        public string SerialNumber { get; set; } = "";
        public DateTime? StartUtc { get; set; }
        public DateTime? EndUtc { get; set; }
    }
}

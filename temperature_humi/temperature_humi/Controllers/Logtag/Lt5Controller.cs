using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using temperature_humi.Service.LogtagService;
using temperature_humi.Service.LogtagService.Lt5;

namespace temperature_humi.Controllers.Logtag
{
    [ApiController]
    [Route("api/lt5")]
    [Authorize] // ✅ User phải login
    public class Lt5Controller : ControllerBase
    {
        private readonly Lt5Service _service;
        private readonly AccountDeviceService _accDev;

        public Lt5Controller(Lt5Service service, AccountDeviceService accDev)
        {
            _service = service;
            _accDev = accDev;
        }

        // ✅ USER: list serial thuộc user
        // FE (mode=user) gọi endpoint này để lock “user chỉ xem device của mình”
        [HttpGet("serials")]
        public async Task<IActionResult> GetMySerials(CancellationToken ct)
        {
            if (!TryGetUserObjectId(out var userId))
                return Unauthorized();

            // ✅ DÙNG ĐÚNG hàm service bạn đang có
            var serials = await _accDev.GetSerialsByAccountOnlyAsync(userId.ToString());
            return Ok(serials);
        }

        // ✅ USER: đọc readings (check ownership)
        [HttpPost("readings")]
        public async Task<IActionResult> Readings([FromBody] Lt5ReadingsRequest req, CancellationToken ct)
        {
            if (!TryGetUserObjectId(out var userId))
                return Unauthorized();

            if (req == null || string.IsNullOrWhiteSpace(req.SerialNumber))
                return BadRequest("SerialNumber is required");

            var serial = (req.SerialNumber ?? "").Trim().ToUpperInvariant();

            // ✅ Check ownership bằng đúng serial list
            var mySerials = await _accDev.GetSerialsByAccountOnlyAsync(userId.ToString());
            if (mySerials == null || !mySerials.Any(s => string.Equals(s, serial, StringComparison.OrdinalIgnoreCase)))
                return Forbid();

            var result = await _service.GetReadingsAsync(
                serial,
                req.StartUtc,
                req.EndUtc
            );

            return Ok(result);
        }

        // ================= Helpers =================

        private bool TryGetUserObjectId(out ObjectId oid)
        {
            oid = ObjectId.Empty;

            // Hệ thống của bạn chỗ này có thể dùng claim khác nhau.
            // Mình thử nhiều key để không bị “đúng máy này sai máy kia”
            string?[] keys = new[]
            {
                "UserId",
                "userId",
                "AccountId",
                "accountId",
                "sub",
                "id"
            };

            foreach (var k in keys)
            {
                var v = User.FindFirst(k)?.Value;
                if (!string.IsNullOrWhiteSpace(v) && ObjectId.TryParse(v, out oid))
                    return true;
            }

            return false;
        }
    }

    public class Lt5ReadingsRequest
    {
        public string SerialNumber { get; set; } = "";
        public DateTime? StartUtc { get; set; }
        public DateTime? EndUtc { get; set; }
    }
}


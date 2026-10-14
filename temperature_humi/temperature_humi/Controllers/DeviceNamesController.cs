using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/device-names")]
    [Authorize]
    public class DeviceNamesController : ControllerBase
    {
        private const int MaxDeviceNameLength = 80;
        private readonly IMongoCollection<AccountDevice> _maps;
        private readonly ILogger<DeviceNamesController> _log;

        public DeviceNamesController(
            IOptions<MongoDBSettings> mongo,
            ILogger<DeviceNamesController> log)
        {
            var client = new MongoClient(mongo.Value.ConnectionString);
            var db = client.GetDatabase(mongo.Value.DatabaseName);
            _maps = db.GetCollection<AccountDevice>("AccountDevices");
            _log = log;
        }

        public sealed record UpdateMyDeviceNameRequest(long TeamId, string? Name);

        public sealed record UpdateDeviceNameByAdminRequest(
            string UserId,
            long TeamId,
            string SerialNumber,
            string? Name);

        private static string NormSerial(string? value)
            => (value ?? string.Empty).Trim().ToUpperInvariant();

        private static string? CleanName(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            var cleaned = string.Join(" ", value
                .Trim()
                .Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));

            if (cleaned.Length > MaxDeviceNameLength)
                throw new ArgumentException($"Tên thiết bị tối đa {MaxDeviceNameLength} ký tự.");

            return cleaned;
        }

        private bool TryGetCurrentUserId(out ObjectId userId)
        {
            userId = ObjectId.Empty;

            var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? User.FindFirstValue("userId")
                   ?? User.FindFirstValue("accountId")
                   ?? Request.Headers["X-User-Id"].FirstOrDefault()
                   ?? Request.Headers["x-user-id"].FirstOrDefault();

            return ObjectId.TryParse(raw, out userId);
        }

        // GET /api/device-names/mine
        [HttpGet("mine")]
        public async Task<IActionResult> GetMine(CancellationToken ct)
        {
            if (!TryGetCurrentUserId(out var userId))
                return Unauthorized(new { message = "Không xác định được tài khoản hiện tại." });

            var rows = await _maps
                .Find(x => x.UserId == userId)
                .SortBy(x => x.TeamId)
                .ThenBy(x => x.SerialNumber)
                .ToListAsync(ct);

            return Ok(rows.Select(x => new
            {
                userId = x.UserId.ToString(),
                teamId = x.TeamId,
                serialNumber = x.SerialNumber,
                name = x.Notes,
                notes = x.Notes,
                assignedAtUtc = x.AssignedAtUtc
            }));
        }

        // PUT /api/device-names/mine/{serialNumber}
        [HttpPut("mine/{serialNumber}")]
        public async Task<IActionResult> UpdateMine(
            string serialNumber,
            [FromBody] UpdateMyDeviceNameRequest request,
            CancellationToken ct)
        {
            if (!TryGetCurrentUserId(out var userId))
                return Unauthorized(new { message = "Không xác định được tài khoản hiện tại." });

            if (request.TeamId <= 0)
                return BadRequest(new { message = "TeamId không hợp lệ." });

            var serial = NormSerial(serialNumber);
            if (string.IsNullOrWhiteSpace(serial))
                return BadRequest(new { message = "Serial không hợp lệ." });

            string? name;
            try
            {
                name = CleanName(request.Name);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { message = ex.Message });
            }

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, request.TeamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, serial);

            var result = await _maps.UpdateOneAsync(
                filter,
                Builders<AccountDevice>.Update.Set(x => x.Notes, name),
                cancellationToken: ct);

            if (result.MatchedCount == 0)
                return NotFound(new { message = "Thiết bị không thuộc tài khoản hiện tại." });

            _log.LogInformation(
                "[DeviceName] UserId={UserId} renamed TeamId={TeamId}, Serial={Serial}, Name={Name}",
                userId,
                request.TeamId,
                serial,
                name ?? "(empty)");

            return Ok(new
            {
                ok = true,
                teamId = request.TeamId,
                serialNumber = serial,
                name
            });
        }

        // PUT /api/device-names/admin
        [HttpPut("admin")]
        [Authorize(Roles = "Admin,Employee")]
        public async Task<IActionResult> UpdateByAdmin(
            [FromBody] UpdateDeviceNameByAdminRequest request,
            CancellationToken ct)
        {
            if (!ObjectId.TryParse(request.UserId, out var userId))
                return BadRequest(new { message = "UserId không hợp lệ." });

            if (request.TeamId <= 0)
                return BadRequest(new { message = "TeamId không hợp lệ." });

            var serial = NormSerial(request.SerialNumber);
            if (string.IsNullOrWhiteSpace(serial))
                return BadRequest(new { message = "Serial không hợp lệ." });

            string? name;
            try
            {
                name = CleanName(request.Name);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { message = ex.Message });
            }

            // Có cả userId trong filter để tránh admin đổi tên nhầm nếu thiết bị
            // vừa được chuyển mapping sang tài khoản khác trên một tab khác.
            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, request.TeamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, serial);

            var result = await _maps.UpdateOneAsync(
                filter,
                Builders<AccountDevice>.Update.Set(x => x.Notes, name),
                cancellationToken: ct);

            if (result.MatchedCount == 0)
                return NotFound(new { message = "Không tìm thấy mapping thiết bị cần cập nhật." });

            _log.LogInformation(
                "[DeviceName][Admin] Actor={Actor}, UserId={UserId}, TeamId={TeamId}, Serial={Serial}, Name={Name}",
                User.Identity?.Name ?? "unknown",
                userId,
                request.TeamId,
                serial,
                name ?? "(empty)");

            return Ok(new
            {
                ok = true,
                userId = userId.ToString(),
                teamId = request.TeamId,
                serialNumber = serial,
                name
            });
        }
    }
}

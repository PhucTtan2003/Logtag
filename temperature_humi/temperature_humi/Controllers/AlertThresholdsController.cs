using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Bson;
using System.Security.Claims;
using temperature_humi.Hubs;
using temperature_humi.Models;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/alert-thresholds")]
    [Route("api/alert-thresholds/v1")]
    [Route("alert-thresholds")] // giữ tạm để FE cũ không bị 404
    [Authorize]
    public sealed class AlertThresholdsController : ControllerBase
    {
        private readonly AlertThresholdService _svc;
        private readonly AccountDeviceService _maps;
        private readonly DeviceService _devices;
        private readonly IHubContext<LogTagHub> _hub;
        private readonly ILogger<AlertThresholdsController> _log;

        public AlertThresholdsController(
            AlertThresholdService svc,
            AccountDeviceService maps,
            DeviceService devices,
            IHubContext<LogTagHub> hub,
            ILogger<AlertThresholdsController> log)
        {
            _svc = svc;
            _maps = maps;
            _devices = devices;
            _hub = hub;
            _log = log;
        }

        public sealed record UpsertDto(
            string? SerialNumber,
            double? UpperThreshold,
            double? LowerThreshold
        );

        private static string Norm(string? serial)
            => (serial ?? "").Trim().ToUpperInvariant();

        private string CurrentActor()
        {
            return User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.Email)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirst("userId")?.Value
                ?? User.FindFirst("UserId")?.Value
                ?? "system";
        }

        private ObjectId? CurrentUserObjectId()
        {
            var raw =
                User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirst("userId")?.Value
                ?? User.FindFirst("UserId")?.Value
                ?? User.FindFirst("id")?.Value
                ?? User.FindFirst("Id")?.Value
                ?? User.FindFirst("accountId")?.Value
                ?? User.FindFirst("AccountId")?.Value
                ?? User.FindFirst("sub")?.Value;

            if (ObjectId.TryParse(raw, out var id))
                return id;

            return null;
        }

        private async Task<HashSet<string>> GetCurrentUserSerialSetAsync()
        {
            var uid = CurrentUserObjectId();

            if (uid == null)
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var maps = await _maps.GetMapsByAccountAsync(uid.Value);

            return maps
                .Select(x => Norm(x.SerialNumber))
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        private async Task<bool> CanAccessSerialAsync(string serial)
        {
            serial = Norm(serial);

            if (string.IsNullOrWhiteSpace(serial))
                return false;

            // Admin được thao tác tất cả thiết bị
            if (User.IsInRole("Admin"))
                return true;

            // User chỉ được thao tác serial đã được gán trong AccountDevice
            var allowed = await GetCurrentUserSerialSetAsync();
            return allowed.Contains(serial);
        }

        private static object ToPayload(AlertThreshold? rule, string serial, object? device = null)
        {
            serial = Norm(serial);

            return new
            {
                serialNumber = serial,

                // Cho view cài ngưỡng
                upperThreshold = rule?.UpperThreshold,
                lowerThreshold = rule?.LowerThreshold,
                updatedAtUtc = rule?.UpdatedAtUtc,
                updatedBy = rule?.UpdatedBy,

                // Cho chart cũ đang dùng min/max
                min = rule?.LowerThreshold,
                max = rule?.UpperThreshold,

                device,
                canEdit = true
            };
        }

        private async Task NotifyRuleChangedAsync(
            string serial,
            double? upper,
            double? lower,
            bool deleted,
            CancellationToken ct)
        {
            var payload = new
            {
                SerialNumber = serial,
                Upper = upper,
                Lower = lower,
                UpperThreshold = upper,
                LowerThreshold = lower,
                Deleted = deleted,
                TimestampUtc = DateTime.UtcNow
            };

            // Admin panel nhận để refresh danh sách.
            await _hub.Clients.Group("Admin").SendAsync("DeviceRuleChanged", payload, ct);

            // User/chart đang join group serial:{SERIAL} cũng nhận được ngưỡng mới ngay.
            await _hub.Clients.Group($"serial:{serial}").SendAsync("DeviceRuleChanged", payload, ct);
        }

        // =========================================================
        // GET /api/alert-thresholds
        // Admin: xem tất cả ngưỡng
        // User: chỉ xem ngưỡng của thiết bị đã gán
        // =========================================================
        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            if (User.IsInRole("Admin"))
            {
                var adminRules = await _svc.ListAsync(ct);

                var adminItems = adminRules
                    .OrderBy(x => x.SerialNumber)
                    .Select(x => ToPayload(x, x.SerialNumber))
                    .ToList();

                return Ok(new
                {
                    status = "ok",
                    role = "Admin",
                    total = adminItems.Count,
                    data = adminItems,
                    items = adminItems,
                    timestampUtc = DateTime.UtcNow
                });
            }

            var allowedSerials = await GetCurrentUserSerialSetAsync();

            if (allowedSerials.Count == 0)
            {
                return Ok(new
                {
                    status = "ok",
                    role = "User",
                    total = 0,
                    data = Array.Empty<object>(),
                    items = Array.Empty<object>(),
                    timestampUtc = DateTime.UtcNow
                });
            }

            var userRules = await _svc.ListBySerialsAsync(allowedSerials, ct);

            var ruleMap = userRules
                .GroupBy(x => Norm(x.SerialNumber), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            var userDevices = await _devices.GetBySerialsAsync(
                allowedSerials.ToList(),
                onlyActive: false
            );

            var devMap = userDevices
                .Where(d => !string.IsNullOrWhiteSpace(d.serialNumber))
                .GroupBy(d => Norm(d.serialNumber), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            var userItems = allowedSerials
                .OrderBy(x => x)
                .Select(sn =>
                {
                    ruleMap.TryGetValue(sn, out var rule);
                    devMap.TryGetValue(sn, out var dev);

                    object? device = dev == null
                        ? null
                        : new
                        {
                            serialNumber = Norm(dev.serialNumber),
                            dev.model,
                            dev.teamId
                        };

                    return ToPayload(rule, sn, device);
                })
                .ToList();

            return Ok(new
            {
                status = "ok",
                role = "User",
                total = userItems.Count,
                data = userItems,
                items = userItems,
                timestampUtc = DateTime.UtcNow
            });
        }
        [HttpGet("{serial}")]
        public async Task<IActionResult> GetBySerial(string serial, CancellationToken ct)
        {
            serial = Norm(serial);

            if (string.IsNullOrWhiteSpace(serial))
                return BadRequest(new { status = "invalid", message = "Thiếu serialNumber." });

            if (!await CanAccessSerialAsync(serial))
            {
                return StatusCode(403, new
                {
                    status = "forbidden",
                    message = "Bạn không có quyền xem ngưỡng của thiết bị này."
                });
            }

            var rule = await _svc.GetBySerialAsync(serial, ct);

            return Ok(ToPayload(rule, serial));
        }

        // =========================================================
        // PUT /api/alert-thresholds
        // Body có SerialNumber
        // =========================================================
        [HttpPut]
        public async Task<IActionResult> UpsertFromBody(
            [FromBody] UpsertDto? dto,
            CancellationToken ct)
        {
            if (dto == null)
                return BadRequest(new { status = "invalid", message = "Body không hợp lệ." });

            return await UpsertCore(
                dto.SerialNumber,
                dto.UpperThreshold,
                dto.LowerThreshold,
                ct
            );
        }

        // =========================================================
        // PUT /api/alert-thresholds/{serial}
        // Body không cần SerialNumber
        // =========================================================
        [HttpPut("{serial}")]
        public async Task<IActionResult> UpsertBySerial(
            string serial,
            [FromBody] UpsertDto? dto,
            CancellationToken ct)
        {
            return await UpsertCore(
                serial,
                dto?.UpperThreshold,
                dto?.LowerThreshold,
                ct
            );
        }

        // POST cũng hỗ trợ như PUT để FE nào đang dùng POST vẫn chạy
        [HttpPost]
        public async Task<IActionResult> PostFromBody(
            [FromBody] UpsertDto? dto,
            CancellationToken ct)
        {
            if (dto == null)
                return BadRequest(new { status = "invalid", message = "Body không hợp lệ." });

            return await UpsertCore(
                dto.SerialNumber,
                dto.UpperThreshold,
                dto.LowerThreshold,
                ct
            );
        }

        [HttpPost("{serial}")]
        public async Task<IActionResult> PostBySerial(
            string serial,
            [FromBody] UpsertDto? dto,
            CancellationToken ct)
        {
            return await UpsertCore(
                serial,
                dto?.UpperThreshold,
                dto?.LowerThreshold,
                ct
            );
        }

        private async Task<IActionResult> UpsertCore(
            string? serial,
            double? upper,
            double? lower,
            CancellationToken ct)
        {
            serial = Norm(serial);

            if (string.IsNullOrWhiteSpace(serial))
            {
                return BadRequest(new
                {
                    status = "invalid",
                    message = "SerialNumber is required"
                });
            }

            if (!await CanAccessSerialAsync(serial))
            {
                return StatusCode(403, new
                {
                    status = "forbidden",
                    message = "Bạn không có quyền cài ngưỡng cho thiết bị này."
                });
            }

            if (!upper.HasValue && !lower.HasValue)
            {
                return BadRequest(new
                {
                    status = "invalid",
                    message = "Vui lòng nhập ít nhất ngưỡng trên hoặc ngưỡng dưới."
                });
            }

            // Lấy ngưỡng cũ để nếu FE chỉ gửi 1 field thì không làm mất field còn lại.
            var oldRule = await _svc.GetBySerialAsync(serial, ct);
            var finalUpper = upper ?? oldRule?.UpperThreshold;
            var finalLower = lower ?? oldRule?.LowerThreshold;

            if (finalUpper.HasValue && finalLower.HasValue && finalUpper.Value <= finalLower.Value)
            {
                return BadRequest(new
                {
                    status = "invalid",
                    message = "Ngưỡng trên phải lớn hơn ngưỡng dưới."
                });
            }

            var rule = new AlertThreshold
            {
                SerialNumber = serial,
                UpperThreshold = finalUpper,
                LowerThreshold = finalLower
            };

            await _svc.UpsertAsync(rule, CurrentActor(), ct);

            await NotifyRuleChangedAsync(
                serial,
                finalUpper,
                finalLower,
                deleted: false,
                ct);

            var saved = await _svc.GetBySerialAsync(serial, ct);

            _log.LogInformation(
                "[AlertThreshold] {actor} upsert serial={serial}, upper={upper}, lower={lower}",
                CurrentActor(),
                serial,
                finalUpper,
                finalLower);

            return Ok(new
            {
                status = "ok",
                message = "Đã lưu ngưỡng cảnh báo. SMS sẽ dùng ngưỡng này ở lần đọc dữ liệu tiếp theo.",
                item = ToPayload(saved, serial)
            });
        }

        // =========================================================
        // DELETE /api/alert-thresholds/{serial}
        // =========================================================
        [HttpDelete("{serial}")]
        public async Task<IActionResult> Delete(string serial, CancellationToken ct)
        {
            serial = Norm(serial);

            if (string.IsNullOrWhiteSpace(serial))
            {
                return BadRequest(new
                {
                    status = "invalid",
                    message = "Thiếu serialNumber."
                });
            }

            if (!await CanAccessSerialAsync(serial))
            {
                return StatusCode(403, new
                {
                    status = "forbidden",
                    message = "Bạn không có quyền xóa ngưỡng của thiết bị này."
                });
            }

            var ok = await _svc.DeleteAsync(serial, ct);

            if (ok)
            {
                await NotifyRuleChangedAsync(
                    serial,
                    upper: null,
                    lower: null,
                    deleted: true,
                    ct
                );
            }

            return Ok(new
            {
                status = "ok",
                message = ok ? "Đã xóa ngưỡng." : "Thiết bị này chưa có ngưỡng.",
                deleted = ok,
                serialNumber = serial
            });
        }
    }
}
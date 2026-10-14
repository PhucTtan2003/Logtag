using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using temperature_humi.Models;
using temperature_humi.Service;
using MongoDB.Driver;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace temperature_humi.Controllers
{
    [Route("api/warranty")]
    [ApiController]
    public class WarrantyController : ControllerBase
    {
        private readonly WarrantyService _warrantyService;
        private readonly DeviceService _deviceService;
        private readonly NotificationService _notificationService;
        private readonly EmployeeAccountDeviceService _empAccountDeviceService; // ✅ mapping mới
        private readonly AccountService _accountService;
        private readonly RoleService _roleService;

        public WarrantyController(
            WarrantyService warrantyService,
            DeviceService deviceService,
            EmployeeAccountDeviceService empAccountDeviceService,
            NotificationService notificationService,
            AccountService accountService,
            RoleService roleService)
        {
            _warrantyService = warrantyService;
            _deviceService = deviceService;
            _notificationService = notificationService;
            _empAccountDeviceService = empAccountDeviceService;
            _accountService = accountService;
            _roleService = roleService;
        }

        // Lấy AccountId từ Claims (cookie auth), KHÔNG dựa vào header
        private ObjectId GetAccountIdFromClaimsOrThrow()
        {
            var idStr = User?.FindFirstValue(ClaimTypes.NameIdentifier)
                       ?? User?.FindFirstValue("AccountId");
            if (!ObjectId.TryParse(idStr, out var id))
                throw new Exception("Không xác định được AccountId từ phiên đăng nhập.");
            return id;
        }

        private async Task<(ObjectId accountId, bool isAdmin)> GetAccountAndRoleAsync()
        {
            var accId = GetAccountIdFromClaimsOrThrow();
            var acc = await _accountService.GetByIdAsync(accId) ?? throw new Exception("Tài khoản không tồn tại.");
            var role = await _roleService.GetRoleByIdAsync(acc.RoleId);
            var isAdmin = string.Equals(role?.RoleName, "Admin", StringComparison.OrdinalIgnoreCase);
            return (acc.Id, isAdmin);
        }

        // ---------- Create ----------
        [HttpPost("create")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> Create([FromBody] WarrantyCreateDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.SerialNumber))
                return BadRequest("Thiếu SerialNumber");

            if (!ObjectId.TryParse(dto.AssignedEmployeeId, out var empId))
                return BadRequest("AssignedEmployeeId không hợp lệ");

            var model = new WarrantyRequest
            {
                Id = ObjectId.GenerateNewId().ToString(),
                DeviceId = dto.SerialNumber, // lưu serialNumber theo thiết kế của bạn
                Title = dto.Title,
                Content = dto.Content,
                AssignedEmployeeId = empId,
                CreatedAt = DateTime.UtcNow,
                IsSeen = false
            };

            await _notificationService.SendWarrantyToUser(model.AssignedEmployeeId.ToString(), new
            {
                title = model.Title,
                content = model.Content,
                createdAt = model.CreatedAt,
                deviceId = model.DeviceId
            });

            await _warrantyService.CreateAsync(model);
            return Ok(new { message = "Gửi bảo hành thành công." });
        }

        // ---------- Get all devices ----------
        // Admin: không truyền accountId -> trả tất cả.
        // Employee: luôn dùng accountId từ claims, bỏ qua query accountId, giới hạn 10 thiết bị.
        [HttpGet("get-all-devices")]
        [Authorize] // cần đăng nhập để có claims
        public async Task<IActionResult> GetDevices([FromQuery] string? accountId = null)
        {
            try
            {
                var (callerId, isAdmin) = await GetAccountAndRoleAsync();

                if (isAdmin && string.IsNullOrWhiteSpace(accountId))
                {
                    var listAll = _deviceService
                        .GetAll()
                        .Select(d => new
                        {
                            id = d.Id.ToString(),
                            teamId = d.teamId,
                            serialNumber = d.serialNumber,
                            model = d.model,
                            description = string.IsNullOrWhiteSpace(d.description) ? "Không có" : d.description,
                            deviceState = d.deviceState,
                            lastConnectionDateUtc = d.lastConnectionDateUtc
                        })
                        .OrderByDescending(x => x.lastConnectionDateUtc)
                        .ToList();

                    return Ok(listAll);
                }

                // Xác định user mục tiêu:
                ObjectId targetUserId;
                if (isAdmin && !string.IsNullOrWhiteSpace(accountId))
                {
                    if (!ObjectId.TryParse(accountId, out targetUserId))
                        return BadRequest("accountId không hợp lệ.");
                }
                else
                {
                    targetUserId = callerId;
                }

                // 🔁 Dùng mapping mới
                var maps = await _empAccountDeviceService.GetMapsByAccountAsync(targetUserId);
                if (maps == null || maps.Count == 0) return Ok(Array.Empty<object>());

                var serials = maps
                    .Select(m => m.SerialNumber)
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (!isAdmin) serials = serials.Take(10).ToList(); // giới hạn cho employee

                if (serials.Count == 0) return Ok(Array.Empty<object>());

                var devices = await _deviceService.GetBySerialsAsync(serials, onlyActive: false);

                var result = devices.Select(d => new
                {
                    id = d.Id.ToString(),
                    teamId = d.teamId,
                    serialNumber = d.serialNumber,
                    model = d.model,
                    description = string.IsNullOrWhiteSpace(d.description) ? "Không có" : d.description,
                    deviceState = d.deviceState,
                    lastConnectionDateUtc = d.lastConnectionDateUtc
                })
                .OrderByDescending(x => x.lastConnectionDateUtc)
                .ToList();

                return Ok(result);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Lỗi khi lấy danh sách thiết bị: {ex.Message}" });
            }
        }

        // ---------- GetByEmployee ----------
        // Employee xem phiếu của chính mình; Admin có thể xem bất kỳ.
        [HttpGet("get-by-employee/{employeeId}")]
        [Authorize]
        public async Task<IActionResult> GetByEmployee(string employeeId)
        {
            try
            {
                var (callerId, isAdmin) = await GetAccountAndRoleAsync();

                if (!ObjectId.TryParse(employeeId, out var targetId))
                    return BadRequest("employeeId không hợp lệ.");

                if (!isAdmin && targetId != callerId)
                    return Forbid("Bạn chỉ được xem phiếu bảo hành của chính bạn.");

                var list = await _warrantyService.Collection
                                .Find(w => w.AssignedEmployeeId == targetId)
                                .SortByDescending(w => w.CreatedAt)
                                .ToListAsync();

                var result = list.Select(w => new
                {
                    w.DeviceId,
                    w.Title,
                    w.Content,
                    CreatedAt = w.CreatedAt.ToLocalTime().ToString("dd/MM/yyyy HH:mm"),
                    w.IsSeen
                });

                return Ok(result);
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // ---------- Unseen count ----------
        [HttpGet("unseen-count/{employeeId}")]
        [Authorize(Roles = "Employee")]
        public async Task<IActionResult> GetUnseenCount(string employeeId)
        {
            if (!ObjectId.TryParse(employeeId, out var objId))
                return BadRequest(new { message = "ID không hợp lệ." });

            var filter = Builders<WarrantyRequest>.Filter.And(
                Builders<WarrantyRequest>.Filter.Eq(w => w.AssignedEmployeeId, objId),
                Builders<WarrantyRequest>.Filter.Eq(w => w.IsSeen, false)
            );

            var count = await _warrantyService.Collection.CountDocumentsAsync(filter);

            return Ok(new { count });
        }

        // ---------- Mark as seen ----------
        [HttpPut("mark-as-seen/{employeeId}")]
        [Authorize(Roles = "Employee")]
        public async Task<IActionResult> MarkAsSeen(string employeeId)
        {
            if (!ObjectId.TryParse(employeeId, out var objId))
                return BadRequest(new { message = "ID không hợp lệ" });

            var filter = Builders<WarrantyRequest>.Filter.And(
                Builders<WarrantyRequest>.Filter.Eq(w => w.AssignedEmployeeId, objId),
                Builders<WarrantyRequest>.Filter.Eq(w => w.IsSeen, false)
            );

            var update = Builders<WarrantyRequest>.Update.Set(w => w.IsSeen, true);
            await _warrantyService.Collection.UpdateManyAsync(filter, update);

            return Ok(new { message = "Đã đánh dấu đã xem" });
        }
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using temperature_humi.DTO;
using temperature_humi.Service;

namespace temperature_humi.Controllers
{
    // Định nghĩa route: tất cả endpoint đều bắt đầu bằng /api/employee
    #region EmpployeeController
    [Route("api/employee")]
    [ApiController]
    [Authorize(Roles = "Employee")]
    public class EmployeeController : ControllerBase
    {
        private readonly NotificationService _notificationService;
        private readonly AccountService _accountService;
        private readonly RoleService _roleService;

        public EmployeeController(NotificationService notificationService, AccountService accountService, RoleService roleService)
        {
            _notificationService = notificationService;
            _accountService = accountService;
            _roleService = roleService;
        }
        #endregion

        
        #region GetNotificationsForEmployee
        [HttpGet("notifications/{employeeId}")]
        public async Task<IActionResult> GetNotificationsForEmployee(string employeeId)
        {
            if (!ObjectId.TryParse(employeeId, out var empObjId))
                return BadRequest("employeeId không hợp lệ!");

            var notifications = await _notificationService.GetForEmployeeAsync(empObjId);

            // Nếu sentTo: ObjectId?  (1-1)
            var result = notifications.Select(n => new
            {
                notificationId = n.Id.ToString(),
                title = n.Title,
                message = n.Message,
                sentAt = n.SentAt,
                status = n.Status,                         // 👈 Trả status
                sentTo = n.SentTo == ObjectId.Empty
                            ? null
                            : n.SentTo == null ? null : n.SentTo.ToString(),  // 👈 Chuẩn hoá về string/null
                isRead = n.IsRead,
                isPersonal = n.SentTo != null && n.SentTo == empObjId          // 👈 Trả cờ isPersonal
            })
            .OrderByDescending(x => x.sentAt)
            .ToList();

            return Ok(result);
        }
        #endregion


        // ✅ API: POST /api/employee/notifications/read-all/{employeeId}
        // → Đánh dấu tất cả thông báo của nhân viên là đã đọc
        #region MarkAllAsRead
        [HttpPost("notifications/read-all/{employeeId}")]
        public async Task<IActionResult> MarkAllAsRead(string employeeId)
        {
            if (!ObjectId.TryParse(employeeId, out var empObjId))
                return BadRequest("employeeId không hợp lệ!");

            await _notificationService.MarkAllAsReadAsync(empObjId);
            return Ok(new { message = "Đã đánh dấu tất cả là đã đọc" });
        }
        #endregion

        // ✅ API: POST /api/employee/notifications/mark-read/{notificationId}/{employeeId}
        // → Dùng khi bấm vào từng thông báo để đánh dấu riêng
        #region MarkAsRead
        [HttpPost("notifications/mark-read/{notificationId}/{employeeId}")]
        public async Task<IActionResult> MarkAsRead(string notificationId, string employeeId)
        {
            if (!ObjectId.TryParse(notificationId, out var notifObjId) ||
                !ObjectId.TryParse(employeeId, out var empObjId))
                return BadRequest("Id không hợp lệ!");

            await _notificationService.MarkAsReadAsync(notifObjId, empObjId);
            return Ok();
        }
        #endregion

        #region GetEmployeeInfo
        [HttpGet("info/{employeeId}")]
        public async Task<IActionResult> GetEmployeeInfo(string employeeId)
        {
            if (!ObjectId.TryParse(employeeId, out var objId))
                return BadRequest(new { message = "ID không hợp lệ" });

            var account = await _accountService.GetByIdAsync(objId);
            if (account == null)
                return NotFound(new { message = "Không tìm thấy tài khoản" });

            var role = await _roleService.GetRoleByIdAsync(account.RoleId);

            return Ok(new
            {
                account.FullName,
                account.Email,
                account.Phone,
                account.Address,
                account.CreateAt,
                RoleName = role?.RoleName ?? "N/A",
                account.IsActive
            });
        }


        #endregion

        [HttpPost("notifications/{id}/status")]
        public async Task<IActionResult> UpdateStatus(string id, [FromBody] NotificationStatusDto dto)
        {
            // Body missing / wrong content-type
            if (dto is null)
                return BadRequest(new { message = "Body is missing or invalid JSON." });

            if (!ObjectId.TryParse(id, out var notifId))
                return BadRequest(new { message = "Invalid notification id.", id });

            if (string.IsNullOrWhiteSpace(dto.Status))
                return BadRequest(new { message = "Status is required." });

            var empIdStr = User.FindFirst("AccountId")?.Value;
            if (!ObjectId.TryParse(empIdStr, out var empId))
                return Unauthorized(new { message = "No AccountId claim." });

            // Only allow changing a notification sent to THIS employee
            var result = await _notificationService.UpdateStatusForAsync(notifId, dto.Status, empId);

            if (result.MatchedCount == 0)
                return BadRequest(new
                {
                    message = "Không tìm thấy thông báo thuộc về bạn (hoặc đây là thông báo chung)."
                });

            return Ok(new { message = "Cập nhật trạng thái thành công." });
        }

    }
}

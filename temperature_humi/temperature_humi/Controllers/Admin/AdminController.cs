// Controllers/AdminController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using temperature_humi.Data;
using temperature_humi.Models;
using temperature_humi.Service;
using temperature_humi.DTO;
using System.Linq;
using temperature_humi.Service.LogtagService;
using temperature_humi.Service.LogtagService.Lt5; 

namespace temperature_humi.Controllers.Admin
{
    [Route("api/admin")]
    [ApiController]
    [Authorize]
    public class AdminController : ControllerBase
    {
        // ===== Services (cũ)
        private readonly AccountService _accountService;
        private readonly RoleService _roleService;
        private readonly NotificationService _notificationService;
        private readonly EventService _eventsStore;
        private readonly LogTagApiClient _logtag;

        // ===== Services (mới, từ AccountDeviceAdminController)
        private readonly AccountDeviceService _maps;
        private readonly DeviceService _devices;

        // ✅ LT5 service (ADD)
        private readonly Lt5Service _lt5;

        public AdminController(
            AccountService accountService,
            RoleService roleService,
            NotificationService notificationService,
            EventService eventsStore,
            LogTagApiClient logtag,
            AccountDeviceService maps,
            DeviceService devices,
            Lt5Service lt5
        )
        {
            _accountService = accountService;
            _roleService = roleService;
            _notificationService = notificationService;
            _eventsStore = eventsStore;
            _logtag = logtag;

            _maps = maps;
            _devices = devices;

            _lt5 = lt5;
        }



        [HttpGet("accounts")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> GetAccounts()
        {
            var accounts = await _accountService.GetAllAsync();
            var roles = await _roleService.GetAllAsync();
            var roleMap = roles.ToDictionary(r => r.Id, r => r.RoleName);

            var result = accounts.Select(a => new
            {
                Id = a.Id.ToString(),
                a.FullName,
                a.Email,
                a.Phone,
                a.Address,
                a.IsActive,
                a.RoleId,
                RoleName = roleMap.TryGetValue(a.RoleId, out var name) ? name : "N/A",
                a.CreateAt,
                a.UpdateAt,
                a.LastLoginAt
            });

            return Ok(result);
        }

        [Authorize(Roles = "Admin")]
        [HttpGet("accounts/{id}")]
        public async Task<IActionResult> GetAccountById(string id)
        {
            if (!ObjectId.TryParse(id, out var accountObjectId))
                return BadRequest(new { message = "Id không hợp lệ." });

            var account = await _accountService.GetByIdAsync(accountObjectId);
            if (account == null) return NotFound(new { message = "Không tìm thấy tài khoản." });

            var role = await _roleService.GetRoleByIdAsync(account.RoleId);

            return Ok(new
            {
                Id = account.Id.ToString(),
                account.FullName,
                account.Email,
                account.Phone,
                account.Address,
                account.IsActive,
                RoleId = account.RoleId.ToString(),
                RoleName = role?.RoleName ?? "N/A",
                account.CreateAt,
                account.UpdateAt,
                account.LastLoginAt
            });
        }

        [HttpGet("roles")]
        public async Task<IActionResult> GetRoles()
        {
            var roles = await _roleService.GetAllAsync();
            return Ok(roles.Select(r => new { Id = r.Id.ToString(), r.RoleName }));
        }

        [HttpPost("accounts")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> CreateAccount([FromBody] CreateAccountRequest request)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (string.IsNullOrEmpty(request.Email))
                return BadRequest(new { message = "Email không được để trống" });

            var existing = await _accountService.FindByEmailAsync(request.Email);
            if (existing != null) return Conflict(new { message = "Email đã tồn tại." });

            if (!ObjectId.TryParse(request.RoleId, out var roleObjId))
                return BadRequest(new { message = "RoleId không hợp lệ." });

            var account = new Account
            {
                Id = ObjectId.GenerateNewId(),
                Username = string.IsNullOrEmpty(request.Username) ? request.Email.Split('@')[0] : request.Username,
                Passwords = PasswordHasher.Hash(request.Passwords),
                FullName = request.FullName,
                Email = request.Email,
                Phone = request.Phone,
                Address = request.Address,
                RoleId = roleObjId,
                IsActive = true,
                CreateAt = DateTime.UtcNow,
                UpdateAt = DateTime.UtcNow,
                LastLoginAt = DateTime.UtcNow
            };

            await _accountService.CreateAsync(account);
            return Ok(new { message = "Tạo tài khoản thành công", accountId = account.Id.ToString() });
        }

        [HttpPut("accounts/{id}")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> UpdateAccount(string id, [FromBody] UpdateAccountRequest request)
        {
            if (!ObjectId.TryParse(id, out var objId))
                return BadRequest(new { message = "Id không hợp lệ." });

            var account = await _accountService.GetByIdAsync(objId);
            if (account == null) return NotFound(new { message = "Không tìm thấy tài khoản." });

            if (!ObjectId.TryParse(request.RoleId, out var roleObjId))
                return BadRequest(new { message = "RoleId không hợp lệ." });

            account.FullName = request.FullName;
            account.Phone = request.Phone;
            account.Address = request.Address;
            account.RoleId = roleObjId;
            account.IsActive = request.IsActive;
            account.UpdateAt = DateTime.UtcNow;

            if (!string.IsNullOrWhiteSpace(request.Passwords))
                account.Passwords = PasswordHasher.Hash(request.Passwords);

            await _accountService.UpdateAsync(objId, account);
            return Ok(new { message = "Cập nhật tài khoản thành công." });
        }

        [HttpDelete("accounts/{id}")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> DeleteAccount(string id, CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(id, out var objId))
                return BadRequest(new { message = "Id không hợp lệ." });

            var account = await _accountService.GetByIdAsync(objId);
            if (account == null)
                return NotFound(new { message = "Không tìm thấy tài khoản." });

            var role = await _roleService.GetRoleByIdAsync(account.RoleId);
            if (role?.RoleName?.ToLower() == "admin")
                return BadRequest(new { message = "Không thể xóa tài khoản Admin." });

            // Xóa cứng mapping AccountDevices trước để tránh còn dòng "(no name)"
            var forcedDeviceMappingsDeleted = await _maps.DeleteAllByUserAsync(objId, ct);

            // Xóa dây chuyền: subscription, SMS, license code, notification, account...
            var result = await _accountService.DeleteAccountAndServicesAsync(objId, ct);

            result.DeviceAssignmentsDeleted += forcedDeviceMappingsDeleted;

            return Ok(new
            {
                message = "Xóa tài khoản và các dịch vụ liên quan thành công.",
                accountId = objId.ToString(),
                deletedAccount = result.AccountsDeleted,
                deviceAssignmentsDeleted = result.DeviceAssignmentsDeleted,
                subscriptionsDeleted = result.SubscriptionsDeleted,
                smsActivationsDeleted = result.SmsActivationsDeleted,
                smsSchedulesDeleted = result.SmsSchedulesDeleted,
                loginSessionsDeleted = result.LoginSessionsDeleted,
                accountEventsDeleted = result.AccountEventsDeleted,
                notificationsDeleted = result.NotificationsDeleted,
                licenseCodesTouched = result.LicenseCodesTouched
            });
        }
        [HttpPatch("accounts/{id}/toggle-active")]
        public async Task<IActionResult> ToggleAccountActive(string id)
        {
            if (!ObjectId.TryParse(id, out var objId))
                return BadRequest(new { message = "Id không hợp lệ." });

            var account = await _accountService.GetByIdAsync(objId);
            if (account == null) return NotFound(new { message = "Không tìm thấy tài khoản." });

            var role = await _roleService.GetRoleByIdAsync(account.RoleId);
            if (role?.RoleName?.ToLower() == "admin")
                return BadRequest(new { message = "Không thể vô hiệu hóa tài khoản quản trị (Admin)." });

            account.IsActive = !account.IsActive;
            account.UpdateAt = DateTime.UtcNow;

            await _accountService.UpdateAsync(objId, account);
            return Ok(new { message = "Trạng thái tài khoản đã được thay đổi." });
        }

        [HttpPost("accounts/auto-lock-inactive")]
        public async Task<IActionResult> AutoLockInactiveAccounts()
        {
            var now = DateTime.UtcNow;
            var threshold = now.AddDays(-30);
            var inactiveAccounts = await _accountService.GetInactiveAccountsAsync(threshold);

            var accountsToLock = new List<Account>();
            foreach (var acc in inactiveAccounts)
            {
                var role = await _roleService.GetRoleByIdAsync(acc.RoleId);
                if (role?.RoleName?.ToLower() != "admin")
                {
                    acc.IsActive = false;
                    acc.UpdateAt = now;
                    accountsToLock.Add(acc);
                }
            }

            if (accountsToLock.Count > 0)
                await _accountService.UpdateManyAsync(accountsToLock);

            return Ok(new { message = $"{accountsToLock.Count} tài khoản đã bị khóa do không hoạt động trong 30 ngày." });
        }

        [HttpPost("notifications/send")]
        public async Task<IActionResult> SendNotification([FromBody] NotificationDto model)
        {
            if (!ObjectId.TryParse(model.SentBy, out var senderId))
                return BadRequest(new { message = "SentBy không hợp lệ." });

            var sender = await _accountService.GetByIdAsync(senderId);
            if (sender == null) return BadRequest(new { message = "Người gửi không tồn tại." });

            var role = await _roleService.GetRoleByIdAsync(sender.RoleId);
            if (role?.RoleName?.ToLower() != "admin")
                return BadRequest(new { message = "Chỉ admin mới được gửi thông báo." });

            var notifications = new List<Notification>();

            if (model.SentTo == null || model.SentTo.Count == 0)
            {
                notifications.Add(new Notification
                {
                    Title = model.Title,
                    Message = model.Message,
                    SentBy = senderId,
                    SentTo = null,
                    SentAt = DateTime.UtcNow
                });
            }
            else
            {
                foreach (var idStr in model.SentTo)
                {
                    if (ObjectId.TryParse(idStr, out var sentToId))
                    {
                        notifications.Add(new Notification
                        {
                            Title = model.Title,
                            Message = model.Message,
                            SentBy = senderId,
                            SentTo = sentToId,
                            SentAt = DateTime.UtcNow,
                            IsRead = false
                        });
                    }
                }
            }

            await _notificationService.CreateManyAsync(notifications);

            foreach (var noti in notifications)
            {
                if (noti.SentTo != null)
#pragma warning disable CS8604
                    await _notificationService.SendNotificationToUser(noti.SentTo.ToString(), noti);
#pragma warning restore CS8604
            }

            return Ok(new { message = "Gửi thông báo thành công." });
        }

        [HttpGet("employees")]
        public async Task<IActionResult> GetEmployees()
        {
            var employeeRoleId = await _roleService.GetRoleIdByNameAsync("Employee");
            if (employeeRoleId == null)
                return NotFound(new { message = "Không tìm thấy vai trò Employee." });

            var employees = await _accountService.GetAccountsByRoleIdAsync(employeeRoleId.Value);

            var result = employees.Select(e => new
            {
                AccountId = e.Id.ToString(),
                e.FullName
            });

            return Ok(result);
        }

        [HttpGet("notifications-status")]
        public async Task<IActionResult> GetNotificationStatuses()
        {
            var data = await _notificationService.GetAllWithStatusAsync(_accountService);
            return Ok(data);
        }

        // =====================================================================
        // ====================  B. EVENTS / LOGTAG (cũ)  ======================
        // =====================================================================

        public record AdminQueryDto(string? startDateUtc, string? endDateUtc, string? eventType, int? limit);
        public record AdminFetchDto(string serialNumber, string? startDateUtc, string? endDateUtc);

        [HttpPost("events/query-all")]
        public async Task<IActionResult> QueryAll([FromBody] AdminQueryDto dto, CancellationToken ct)
        {
            var start = ParseUtc(dto.startDateUtc);
            var end = ParseUtc(dto.endDateUtc);
            var rows = await _eventsStore.QueryAllAsync(start, end, dto.eventType, dto.limit ?? 500, ct);
            return Ok(new { data = rows });
        }

        [HttpPost("events/fetch")]
        public async Task<IActionResult> FetchOne([FromBody] AdminFetchDto dto, CancellationToken ct)
        {
            var serialUpper = (dto.serialNumber ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(serialUpper)) return BadRequest("serialNumber required");

            var start = ParseUtc(dto.startDateUtc);
            var end = ParseUtc(dto.endDateUtc);
            if (TooWide(start, end)) return BadRequest("Range must be ≤ 31 days.");

            var resp = await _logtag.GetEventsAsync(serialUpper, start, end, ct);

            await _eventsStore.SaveNewEventsAsync(serialUpper, resp, ct);

            return Ok(resp);
        }

        public record AdminBackfillDto(string serialNumber, string? fromUtc, string? toUtc);

        [HttpPost("events/backfill")]
        public async Task<IActionResult> Backfill([FromBody] AdminBackfillDto dto, CancellationToken ct)
        {
            var serial = (dto.serialNumber ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(serial)) return BadRequest("serialNumber required");

            DateTime to = string.IsNullOrWhiteSpace(dto.toUtc) ? DateTime.UtcNow : DateTime.Parse(dto.toUtc!).ToUniversalTime();
            DateTime from = string.IsNullOrWhiteSpace(dto.fromUtc) ? to.AddYears(-2) : DateTime.Parse(dto.fromUtc!).ToUniversalTime();
            if (from > to) (from, to) = (to, from);

            var window = TimeSpan.FromDays(30);
            var totalApi = 0;
            var totalInserted = 0;

            for (var s = from; s < to; s = s.Add(window))
            {
                var e = s.Add(window);
                if (e > to) e = to;

                var resp = await _logtag.GetEventsAsync(serial, s, e, ct);
                var apiCount = resp.data?.Count ?? 0;
                var inserted = await _eventsStore.SaveNewEventsAsync(serial, resp, ct);

                totalApi += apiCount;
                totalInserted += inserted;
                await Task.Delay(150, ct);
            }

            return Ok(new { serial, fromUtc = from, toUtc = to, apiCount = totalApi, inserted = totalInserted });
        }

        // =====================================================================
        // ==================== ✅ D. LT5GEO (ADD) ==============================
        // =====================================================================

        //// ✅ GET /api/admin/lt5/serials
        //[HttpGet("lt5/serials")]
        //[Authorize(Roles = "Admin")]
        //public async Task<IActionResult> GetAllLt5Serials(CancellationToken ct)
        //{
        //    var serials = await _maps.GetAllSerialsAsync(ct);
        //    return Ok(serials);
        //}

        //// ✅ POST /api/admin/lt5/readings
        //[HttpPost("lt5/readings")]
        //[Authorize(Roles = "Admin")]
        //public async Task<IActionResult> AdminLt5Readings([FromBody] AdminLt5ReadingsRequest req, CancellationToken ct)
        //{
        //    if (req == null || string.IsNullOrWhiteSpace(req.SerialNumber))
        //        return BadRequest("SerialNumber is required");

        //    var serial = req.SerialNumber.Trim().ToUpperInvariant();

        //    var result = await _lt5.GetReadingsAsync(
        //        serial,
        //        req.StartUtc,
        //        req.EndUtc
        //    );

        //    return Ok(result);
        //}

        public class AdminLt5ReadingsRequest
        {
            public string SerialNumber { get; set; } = "";
            public DateTime? StartUtc { get; set; }
            public DateTime? EndUtc { get; set; }
        }

        // =====================================================================
        // =======================  C. QUẢN LÝ PHÂN QUYỀN THIẾT BỊ  =======================

        [HttpGet("users")]
        public async Task<IActionResult> GetUsers([FromQuery] bool onlyActive = true)
        {
            var userRoleId = await _roleService.GetRoleIdByNameAsync("User");
            if (userRoleId == null)
                return NotFound(new { message = "Không tìm thấy vai trò User." });

            var users = await _accountService.GetAccountsByRoleIdAsync(userRoleId.Value);

            if (onlyActive)
                users = users.Where(u => u.IsActive).ToList();

            var result = users.Select(u => new
            {
                id = u.Id.ToString(),
                fullName = u.FullName,
                email = u.Email
            });

            return Ok(result);
        }

        [HttpGet("account-device/options/{teamId:long}")]
        [HttpGet("account-devices/options/{teamId:long}")]
        [Authorize(Roles = "Admin,Employee")]
        public async Task<IActionResult> GetAccountDeviceOptions(long teamId, CancellationToken ct)
        {
            if (teamId <= 0) return BadRequest("teamId không hợp lệ.");

            var targetRoleName = User.IsInRole("Employee") ? "User" : "Employee";
            var targetRoleId = await _roleService.GetRoleIdByNameAsync(targetRoleName);
            if (targetRoleId == null)
                return NotFound(new { message = $"Không tìm thấy vai trò {targetRoleName}." });

            var targetAccounts = await _accountService.GetAccountsByRoleIdAsync(targetRoleId.Value);
            var userLite = targetAccounts.Select(u => new
            {
                id = u.Id.ToString(),
                name = u.FullName ?? u.Username,
                email = u.Email
            });

            var devs = await _devices.GetByTeamAsync(teamId);
            var maps = await _maps.GetMapsByTeamAsync(teamId, ct);

            var assigned = maps.ToDictionary(
                m => m.SerialNumber,
                m => m.UserId.ToString(),
                StringComparer.OrdinalIgnoreCase
            );

            var devices = devs.Select(d => new
            {
                d.serialNumber,
                d.model,
                assignedToUserId = assigned.TryGetValue(d.serialNumber, out var uid) ? uid : null
            });

            var mapping = maps.Select(m => new
            {
                userId = m.UserId.ToString(),
                teamId = m.TeamId,
                serialNumber = m.SerialNumber,
                notes = m.Notes,
                assignedAtUtc = m.AssignedAtUtc
            });

            return Ok(new { users = userLite, devices, mapping });
        }

        [HttpGet("account-device/by-team")]
        [HttpGet("account-devices/by-team")]
        [Authorize(Roles = "Admin,Employee")]
        public Task<IActionResult> GetAccountDeviceByTeamQuery([FromQuery] long teamId, CancellationToken ct)
            => GetByTeamCore(teamId, ct);

        [HttpGet("account-device/by-team/{teamId:long}")]
        [HttpGet("account-devices/by-team/{teamId:long}")]
        public Task<IActionResult> GetAccountDeviceByTeamSegment(long teamId, CancellationToken ct)
            => GetByTeamCore(teamId, ct);

        private async Task<IActionResult> GetByTeamCore(long teamId, CancellationToken ct)
        {
            if (teamId <= 0) return BadRequest("teamId không hợp lệ.");

            var maps = await _maps.GetMapsByTeamAsync(teamId, ct);

            var serials = maps.Select(x => x.SerialNumber).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var devs = await _devices.GetBySerialsAsync(serials, onlyActive: false);
            var devMap = devs.ToDictionary(
                d => d.serialNumber,
                d => new { d.model },
                StringComparer.OrdinalIgnoreCase
            );

            var payload = maps.Select(m => new
            {
                userId = m.UserId.ToString(),
                teamId = m.TeamId,
                serialNumber = m.SerialNumber,
                notes = m.Notes,
                assignedAtUtc = m.AssignedAtUtc,
                device = devMap.TryGetValue(m.SerialNumber, out var d) ? d : null
            });

            return Ok(payload);
        }

        [HttpGet("account-device/by-user/{userId}")]
        [HttpGet("account-devices/by-user/{userId}")]
        [Authorize(Roles = "Admin,Employee")]
        public async Task<IActionResult> GetAccountDeviceByUser(string userId)
        {
            if (!ObjectId.TryParse(userId, out var uid)) return BadRequest("userId không hợp lệ.");
            var maps = await _maps.GetMapsByAccountAsync(uid);
            return Ok(maps);
        }

        [HttpPost("account-device/assign")]
        [HttpPost("account-devices/assign")]
        [Authorize(Roles = "Admin,Employee")]
        public async Task<IActionResult> AssignAccountDevice(
     [FromBody] AccountDeviceAssignDto dto,
     CancellationToken ct)
        {
            if (dto == null)
            {
                return BadRequest(new
                {
                    message = "Body không hợp lệ.",
                    detail = "Request body bị null."
                });
            }

            if (!ObjectId.TryParse(dto.userId, out var uid))
            {
                return BadRequest(new
                {
                    message = "userId không hợp lệ.",
                    userId = dto.userId
                });
            }

            if (dto.teamId <= 0)
            {
                return BadRequest(new
                {
                    message = "teamId không hợp lệ.",
                    teamId = dto.teamId
                });
            }

            if (string.IsNullOrWhiteSpace(dto.serialNumber))
            {
                return BadRequest(new
                {
                    message = "Thiếu serialNumber."
                });
            }

            // Serial gán cho user giữ nguyên dạng FE gửi lên.
            // Ví dụ: A0A6001264TT-CH1 / A0A6001264TT-CH2
            var assignSerial = dto.serialNumber.Trim().ToUpperInvariant();

            // Serial dùng để lookup trong collection Devices.
            // Nếu Devices chỉ lưu serial gốc thì A0A6001264TT-CH1 -> A0A6001264TT.
            var lookupSerial = NormalizeDeviceLookupSerial(assignSerial);

            var targetAcc = await _accountService.GetByIdAsync(uid);
            if (targetAcc == null)
            {
                return NotFound(new
                {
                    message = "Không tìm thấy tài khoản đích.",
                    userId = uid.ToString()
                });
            }

            var targetRole = await _roleService.GetRoleByIdAsync(targetAcc.RoleId);
            var targetRoleName = targetRole?.RoleName?.Trim().ToLowerInvariant() ?? "";

            if (User.IsInRole("Employee"))
            {
                if (targetRoleName is "admin" or "employee")
                {
                    return BadRequest(new
                    {
                        message = "Nhân viên chỉ được gán thiết bị cho tài khoản vai trò 'User'.",
                        targetRole = targetRoleName
                    });
                }
            }

            // Ưu tiên tìm đúng serial FE gửi lên.
            var dev = await _devices.GetBySerialAsync(assignSerial);

            // Nếu không thấy, fallback về serial gốc.
            if (dev == null && !assignSerial.Equals(lookupSerial, StringComparison.OrdinalIgnoreCase))
            {
                dev = await _devices.GetBySerialAsync(lookupSerial);
            }

            if (dev == null)
            {
                return NotFound(new
                {
                    message = "Không tìm thấy thiết bị trong collection Devices.",
                    serialNumber = assignSerial,
                    lookupSerial,
                    selectedTeamId = dto.teamId
                });
            }

            if (dev.teamId != dto.teamId)
            {
                return BadRequest(new
                {
                    message = "Thiết bị không thuộc teamId đã chọn.",
                    serialNumber = assignSerial,
                    lookupSerial,
                    selectedTeamId = dto.teamId,
                    deviceTeamId = dev.teamId
                });
            }

            // Lưu mapping theo đúng channel FE chọn.
            // Nếu admin chọn CH1 thì lưu CH1, chọn CH2 thì lưu CH2.
            await _maps.AssignAsync(uid, dto.teamId, assignSerial, dto.notes);

            return Ok(new
            {
                ok = true,
                message = "Gán thiết bị thành công.",
                userId = uid.ToString(),
                teamId = dto.teamId,
                serialNumber = assignSerial,
                lookupSerial
            });
        }

        [HttpDelete("account-device/remove")]
        [HttpDelete("account-devices/remove")]
        public async Task<IActionResult> RemoveAccountDevice(
            [FromQuery] string? userId,
            [FromQuery] string? serialNumber,
            [FromBody] AccountDeviceRemoveDto? body,
            CancellationToken ct)
        {
            var uidStr = userId ?? body?.userId;
            var sn = (serialNumber ?? body?.serialNumber)?.Trim();

            if (!ObjectId.TryParse(uidStr, out var uid)) return BadRequest("userId không hợp lệ.");
            if (string.IsNullOrWhiteSpace(sn)) return BadRequest("Thiếu serialNumber.");

            var ok = await _maps.RemoveAsync(uid, sn, ct);
            return Ok(new { ok });
        }

        [HttpPost("account-device/rebalance/{teamId:long}")]
        [HttpPost("account-devices/rebalance/{teamId:long}")]
        public async Task<IActionResult> RebalanceAccountDevices(long teamId, [FromBody] RebalanceRequestDto? body, CancellationToken ct)
        {
            if (teamId <= 0) return BadRequest("teamId không hợp lệ.");

            IEnumerable<ObjectId>? uids = null;
            if (body?.UserIds?.Count > 0)
            {
                var list = new List<ObjectId>();
                foreach (var s in body.UserIds)
                    if (ObjectId.TryParse(s, out var id)) list.Add(id);
                uids = list;
            }

            await _maps.RebalanceTeamAsync(teamId, uids, ct);
            return Ok(new { ok = true });
        }

        // =====================================================================
        // =========================  Helpers  ==================================
        // =====================================================================

        private static DateTime? ParseUtc(string? s)
            => string.IsNullOrWhiteSpace(s) ? null : DateTime.Parse(s).ToUniversalTime();

        private static bool TooWide(DateTime? s, DateTime? e)
            => s.HasValue && e.HasValue && (e.Value - s.Value).TotalDays > 31.5;
        private static string NormalizeDeviceLookupSerial(string serialNumber)
        {
            var sn = (serialNumber ?? string.Empty).Trim().ToUpperInvariant();

            if (sn.EndsWith("-CH1", StringComparison.OrdinalIgnoreCase))
                return sn[..^4];

            if (sn.EndsWith("-CH2", StringComparison.OrdinalIgnoreCase))
                return sn[..^4];

            if (sn.EndsWith("-CH-1", StringComparison.OrdinalIgnoreCase))
                return sn[..^5];

            if (sn.EndsWith("-CH-2", StringComparison.OrdinalIgnoreCase))
                return sn[..^5];

            return sn;
        }
    }

}


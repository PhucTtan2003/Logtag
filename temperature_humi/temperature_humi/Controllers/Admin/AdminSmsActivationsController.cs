// Controllers/AdminSmsActivationsController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service;
using temperature_humi.Service.Admin;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    public class AdminSmsActivationsController : ControllerBase
    {
        private readonly SmsActivationService _smsActs;
        private readonly AccountService _accounts;

        public AdminSmsActivationsController(
            SmsActivationService smsActs,
            AccountService accounts)
        {
            _smsActs = smsActs;
            _accounts = accounts;
        }

        // ===============================
        // 🔑 Helper: lấy userId hiện tại
        // ===============================
        private ObjectId GetUserId()
        {
            var id =
                User.FindFirst("id")?.Value ??
                User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

            if (string.IsNullOrWhiteSpace(id))
                throw new Exception("Cannot determine current user id.");

            return ObjectId.Parse(id);
        }

        // ===============================
        // ☎️ Chuẩn hoá số điện thoại
        // ===============================
        private static string NormalizePhone(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";

            var digits = new string(raw.Where(char.IsDigit).ToArray());

            if (digits.StartsWith("84")) return digits;
            if (digits.StartsWith("0")) return "84" + digits[1..];

            return digits;
        }

        // ============================================================
        // ⭐ USER: GET /api/sms-activation/lt5
        // ============================================================
        [HttpGet]
        [Route("api/sms-activation/lt5")]
        [Authorize]
        public async Task<IActionResult> GetLt5(CancellationToken ct = default)
        {
            var userId = GetUserId();
            var act = await _smsActs.GetLt5ByUserAsync(userId, ct);

            return Ok(new
            {
                phone = act?.Phone ?? "",
                activatedAtUtc = act?.ActivatedAtUtc,
                notes = act?.Notes,
                activated = act != null
            });
        }

        // ============================================================
        // ⭐ USER: POST /api/sms-activation/lt5
        // ============================================================
        public class Lt5SmsDto
        {
            public string Phone { get; set; } = "";
        }

        [HttpPost]
        [Route("api/sms-activation/lt5")]
        [Authorize]
        public async Task<IActionResult> SaveLt5(
            [FromBody] Lt5SmsDto dto,
            CancellationToken ct = default)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Phone))
                return BadRequest(new { message = "Số điện thoại không được để trống." });

            var phone = NormalizePhone(dto.Phone);

            if (phone.Length < 10)
                return BadRequest(new { message = "Số điện thoại không hợp lệ." });

            var userId = GetUserId();

            var saved = await _smsActs.UpsertLt5PhonesForUserAsync(
                userId,
                phone,
                ct
            );

            return Ok(new
            {
                message = "saved",
                phone = saved.Phone,
                activatedAtUtc = saved.ActivatedAtUtc,
                activated = true
            });
        }

        // ============================================================
        // ⭐ ADMIN: GET /api/admin/sms-activations
        // ============================================================
        [HttpGet]
        [Route("api/admin/sms-activations")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> List(
            [FromQuery] string? search,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            try
            {
                var (total, items) = await _smsActs.AdminListAsync(search, skip, take, ct);

                if (items == null || !items.Any())
                {
                    return Ok(new { total, items = Array.Empty<object>() });
                }

                var userIds = items.Select(i => i.UserId).Distinct().ToList();
                var accounts = await _accounts.GetByIdsAsync(userIds, ct);

                var accMap = accounts?
                    .Where(a => a != null)
                    .GroupBy(a => (object)a.Id)
                    .ToDictionary(g => g.Key, g => g.First().Email)
                    ?? new Dictionary<object, string?>();

                var resultItems = items.Select(x =>
                {
                    accMap.TryGetValue(x.UserId, out var email);

                    var displayName = email != null && email.Contains('@')
                        ? email.Split('@')[0]
                        : null;

                    return new
                    {
                        id = x.Id.ToString(),
                        userId = x.UserId.ToString(),
                        email,
                        name = displayName,
                        phone = x.Phone,
                        activatedAtUtc = x.ActivatedAtUtc,
                        licenseCode = x.LicenseCode,
                        notes = x.Notes
                    };
                }).ToList();

                return Ok(new { total, items = resultItems });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    message = "Có lỗi khi lấy danh sách SMS activations.",
                    detail = ex.Message
                });
            }
        }
    }
}

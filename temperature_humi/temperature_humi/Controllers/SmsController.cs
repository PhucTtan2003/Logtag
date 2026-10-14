using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service.Admin;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using temperature_humi.Models.CreateCode;
using temperature_humi.Models;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/sms")]
    public class SmsController : ControllerBase
    {
        private readonly IHttpContextAccessor _http;
        private readonly SubscriptionService _subs;
        private readonly SmsActivationService _smsActs;

        public SmsController(
            IHttpContextAccessor http,
            SubscriptionService subs,
            SmsActivationService smsActs)
        {
            _http = http;
            _subs = subs;
            _smsActs = smsActs;
        }

        public class PhonesDto
        {
            public string? Phone1 { get; set; }
            public string? Phone2 { get; set; }
            public string? Phone3 { get; set; }
            public string? Phone4 { get; set; }
            public string? Phone5 { get; set; }
        }

        // =============================================
        // GET /api/sms/my-phones  (ĐÃ SỬA: ĐỌC TỪ DB)
        // =============================================
        [HttpGet("my-phones")]
        [Authorize]
        public async Task<IActionResult> MyPhones(CancellationToken ct)
        {
            var userId = User.GetObjectId();
            if (userId == ObjectId.Empty)
                return Ok(EmptyPhones());

            // 📌 ĐỌC TỪ DB (SmsActivations)
            var act = await _smsActs.GetByUserAsync(userId, ct);
            if (act == null || string.IsNullOrWhiteSpace(act.Phone))
                return Ok(EmptyPhones());

            var parts = act.Phone
                .Split(new[] { ',', ';', ' ', '|' }, System.StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .Take(5)
                .ToList();

            // pad đủ 5 ô
            while (parts.Count < 5)
                parts.Add("");

            return Ok(new
            {
                phone1 = parts[0],
                phone2 = parts[1],
                phone3 = parts[2],
                phone4 = parts[3],
                phone5 = parts[4]
            });
        }

        private static object EmptyPhones() => new
        {
            phone1 = "",
            phone2 = "",
            phone3 = "",
            phone4 = "",
            phone5 = ""
        };

        // =============================================
        // POST /api/sms/set-phones  (KHÔNG ĐỔI LOGIC)
        // =============================================
        [HttpPost("set-phones")]
        [Authorize]
        public async Task<IActionResult> SetPhones(
            [FromBody] PhonesDto dto,
            CancellationToken ct = default)
        {
            var ctx = _http.HttpContext;
            if (ctx == null)
                return BadRequest(new { message = "No HttpContext" });

            var rawPhones = new[] { dto.Phone1, dto.Phone2, dto.Phone3, dto.Phone4, dto.Phone5 };

            List<string> phones = rawPhones
                .Select(NormalizePhone)
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Distinct()
                .ToList();

            if (phones.Count == 0)
                return BadRequest(new { message = "Cần ít nhất 1 số điện thoại." });

            // Validate VN format
            foreach (var p in phones)
            {
                if (!IsValidVnPhone(p))
                    return BadRequest(new { message = $"Số điện thoại {p} không hợp lệ." });
            }

            // Save Session (optional)
            ctx.Session.SetString("Phone1", phones.ElementAtOrDefault(0) ?? "");
            ctx.Session.SetString("Phone2", phones.ElementAtOrDefault(1) ?? "");
            ctx.Session.SetString("Phone3", phones.ElementAtOrDefault(2) ?? "");
            ctx.Session.SetString("Phone4", phones.ElementAtOrDefault(3) ?? "");
            ctx.Session.SetString("Phone5", phones.ElementAtOrDefault(4) ?? "");

            // Save to DB
            var userId = User.GetObjectId();
            if (userId != ObjectId.Empty)
            {
                var sub = await _subs.GetActiveAsync(userId, ct);
                var hasSms = sub?.Features?.Contains(SubscriptionFeatures.SmsAlert) == true;

                if (!hasSms)
                {
                    return StatusCode(403, new
                    {
                        message = "Tài khoản chưa được kích hoạt tính năng SMS cảnh báo."
                    });
                }

                string csv = string.Join(",", phones);

                await _smsActs.UpsertForUserAsync(
                    userId: userId,
                    phone: csv,
                    licenseCode: null,
                    notes: "User updated SMS phones (multi-phone)",
                    ct: ct
                );
            }

            return Ok(new { message = "Đã lưu số điện thoại." });
        }

        // =============================================
        // Helpers
        // =============================================

        private static string NormalizePhone(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            raw = raw.Trim();

            if (raw.StartsWith("+84"))
                raw = "0" + raw[3..];

            if (raw.StartsWith("84"))
                raw = "0" + raw[2..];

            var digits = new string(raw.Where(char.IsDigit).ToArray());
            return digits;
        }

        private static bool IsValidVnPhone(string digits)
        {
            return Regex.IsMatch(digits, @"^(0\d{9})$");
        }
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using MongoDB.Bson;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Models;
using temperature_humi.Service.Admin;
using System.Security.Claims;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/subscriptions")]
    public class SubscriptionController : ControllerBase
    {
        private readonly SubscriptionService _subs;
        private readonly SmsActivationService _smsActs;

        public SubscriptionController(
            SubscriptionService subs,
            SmsActivationService smsActs)
        {
            _subs = subs;
            _smsActs = smsActs;
        }

        public class RedeemDto
        {
            public string Code { get; set; } = string.Empty;
        }

        // POST /api/subscriptions/redeem
        [HttpPost("redeem")]
        [Authorize]
        public async Task<IActionResult> Redeem([FromBody] RedeemDto dto, CancellationToken ct = default)
        {
            var userId = User.GetObjectId();   // 🔥 dùng claims identity
            if (userId == ObjectId.Empty)
                return Unauthorized(new { message = "Missing or invalid user." });

            if (string.IsNullOrWhiteSpace(dto?.Code))
                return BadRequest(new { message = "Code is required." });

            try
            {
                var rawCode = dto.Code.Trim();

                var (plan, features, startedAt, endsAt) =
                    await _subs.RedeemCodeAsync(userId, rawCode, ct);

                // 👉 Nếu gói có feature "sms" thì ghi log kích hoạt SMS
                if (features != null &&
                    features.Any(f => string.Equals(f, "sms", StringComparison.OrdinalIgnoreCase)))
                {
                    // Lấy số điện thoại đang lưu trong session (đã set ở SmsController)
                    string? phone = HttpContext?.Session?.GetString("Phone1");
                    if (string.IsNullOrWhiteSpace(phone))
                        phone = HttpContext?.Session?.GetString("Phone2");

                    await _smsActs.AddActivationAsync(
                        userId: userId,
                        phone: phone,
                        licenseCode: rawCode,
                        notes: $"Redeem SMS subscription, plan = '{plan}'",
                        ct: ct
                    );
                }

                await _subs.InvalidateUserCacheAsync(userId);

                return Ok(new
                {
                    plan,
                    features,
                    startedAtUtc = startedAt,
                    endsAtUtc = endsAt
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // GET /api/subscriptions/me
        [HttpGet("me")]
        [Authorize]
        public async Task<IActionResult> Me(CancellationToken ct = default)
        {
            var userId = User.GetObjectId();  // 🔥 dùng identity
            if (userId == ObjectId.Empty)
                return Unauthorized(new { message = "Invalid user" });

            var sub = await _subs.GetActiveAsync(userId, ct);

            if (sub != null)
            {
                var (rawActive, rawDaysLeft) =
                    SubscriptionService.ComputeState(sub.StartedAtUtc, sub.EndsAtUtc);

                var isActive = rawActive && rawDaysLeft > 0;
                var daysLeft = Math.Max(0, rawDaysLeft);

                if (isActive)
                {
                    return Ok(new
                    {
                        state = "active",
                        active = true,
                        isActive = true,
                        plan = sub.Plan,
                        features = sub.Features ?? Array.Empty<string>(),
                        startedAtUtc = sub.StartedAtUtc,
                        endsAtUtc = sub.EndsAtUtc,
                        daysLeft
                    });
                }
            }

            var last = await _subs.GetLastAsync(userId, ct);

            if (last == null)
            {
                return Ok(new
                {
                    state = "never",
                    active = false,
                    isActive = false,
                    plan = "basic",
                    features = Array.Empty<string>(),
                    startedAtUtc = (DateTime?)null,
                    endsAtUtc = (DateTime?)null,
                    daysLeft = 0
                });
            }

            return Ok(new
            {
                state = "expired",
                active = false,
                isActive = false,
                plan = "basic",
                features = Array.Empty<string>(),
                startedAtUtc = (DateTime?)null,
                endsAtUtc = last.EndsAtUtc,
                daysLeft = 0
            });
        }
        [HttpGet("my-codes")]
        [Authorize]
        public async Task<IActionResult> GetMyCodes(CancellationToken ct = default)
        {
            // 🔥 dùng đúng extension giống /me và /redeem
            var userId = User.GetObjectId();
            if (userId == ObjectId.Empty)
                return Unauthorized(new { message = "Invalid user id." });

            var list = await _subs.GetUserLicenseHistoryAsync(userId, ct);
            
            var items = list.Select(t =>
            {
                var lic = t.lic;
                var act = t.act;

                var durationDays = lic.DurationDays <= 0 ? 1 : lic.DurationDays;
                var redeemedAt = act.RedeemedAtUtc;
                var expiresAt = redeemedAt.AddDays(durationDays);

                return new
                {
                    code = lic.Code,
                    plan = lic.Plan ?? "basic",
                    features = lic.Features ?? Array.Empty<string>(),
                    durationDays,
                    redeemedAtUtc = redeemedAt,
                    expiresAtUtc = expiresAt,
                    notes = lic.Notes
                };
            });

            return Ok(new { items });
        }


    }
}

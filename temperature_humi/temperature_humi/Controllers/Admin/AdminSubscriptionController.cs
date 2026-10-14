// Controllers/AdminSubscriptionController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Models.CreateCode;
using temperature_humi.Service;
using temperature_humi.Service.Admin;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/subscriptions")]
    [Authorize(Roles = "Admin")]
    public class AdminSubscriptionController : ControllerBase
    {
        private const string FeatureSmsAlert = "sms_alert";
        private const string FeatureSmsSchedule = "sms_schedule";

        private readonly SubscriptionService _subs;
        private readonly AccountService _accounts;

        public AdminSubscriptionController(
            SubscriptionService subs,
            AccountService accounts)
        {
            _subs = subs;
            _accounts = accounts;
        }

        public sealed class AdminRedeemForUserDto
        {
            public string Code { get; set; } = string.Empty;
            public string UserId { get; set; } = string.Empty;
        }

        // GET /api/admin/subscriptions?status=active|expired&skip=0&take=50
        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] string? status,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 50,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 200);

            // SubscriptionService tự backfill quota cho subscription cũ.
            // Truyền status xuống service để total và phân trang chính xác.
            var (total, items) = await _subs.AdminListSubsAsync(
                status,
                skip,
                take,
                ct);

            var userIds = items
                .Select(x => x.UserId)
                .Where(x => x != ObjectId.Empty)
                .Distinct()
                .ToList();

            var accounts = await _accounts.GetByIdsAsync(userIds, ct);

            var accountMap = accounts
                .GroupBy(x => x.Id)
                .ToDictionary(
                    group => group.Key,
                    group => group.First().Email);

            var mapped = items.Select(subscription =>
            {
                var (isActive, daysLeft) =
                    SubscriptionService.ComputeState(
                        subscription.StartedAtUtc,
                        subscription.EndsAtUtc);

                accountMap.TryGetValue(
                    subscription.UserId,
                    out var email);

                string? displayName = null;

                if (!string.IsNullOrWhiteSpace(email))
                {
                    var at = email.IndexOf('@');

                    if (at > 0)
                        displayName = email[..at];
                }

                var features = subscription.Features
                    ?? Array.Empty<string>();

                var hasSmsFeature = features.Any(feature =>
                    string.Equals(
                        feature,
                        FeatureSmsAlert,
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    string.Equals(
                        feature,
                        FeatureSmsSchedule,
                        StringComparison.OrdinalIgnoreCase));

                var smsUsed = Math.Max(
                    0,
                    subscription.SmsQuotaUsed);

                var smsQuotaTotal = subscription.SmsUnlimited
                    ? null
                    : subscription.SmsQuotaTotal;

                // null = chưa cấu hình quota.
                // 0 = đã cấu hình nhưng đã dùng hết.
                int? smsRemaining = subscription.SmsUnlimited
                    ? null
                    : smsQuotaTotal.HasValue
                        ? Math.Max(
                            0,
                            smsQuotaTotal.Value - smsUsed)
                        : null;

                var smsQuotaConfigured =
                    subscription.SmsUnlimited
                    || (smsQuotaTotal.HasValue
                        && smsQuotaTotal.Value > 0);

                var smsIsLow =
                    !subscription.SmsUnlimited
                    && smsRemaining.HasValue
                    && subscription.SmsWarnAtRemaining.HasValue
                    && smsRemaining.Value
                        <= subscription.SmsWarnAtRemaining.Value;

                return new
                {
                    userId = subscription.UserId.ToString(),
                    userName = displayName,
                    email,

                    plan = subscription.Plan ?? "basic",
                    features,
                    startedAtUtc = subscription.StartedAtUtc,
                    endsAtUtc = subscription.EndsAtUtc,
                    isActive,
                    daysLeft,

                    source = subscription.Source == null
                        ? null
                        : new
                        {
                            type = subscription.Source.Type,
                            code = subscription.Source.Code,
                            note = subscription.Source.Note
                        },

                    hasSmsFeature,
                    smsQuotaConfigured,
                    smsQuotaTotal,
                    smsQuotaUsed = smsUsed,
                    smsUnlimited = subscription.SmsUnlimited,
                    smsRemaining,
                    smsWarnAtRemaining = subscription.SmsWarnAtRemaining,
                    smsIsLow,
                    smsLowQuotaWarned = subscription.SmsLowQuotaWarned,
                    smsLowQuotaWarnedAtUtc = subscription.SmsLowQuotaWarnedAtUtc,
                    lastSmsSentAtUtc = subscription.LastSmsSentAtUtc
                };
            }).ToList();

            return Ok(new
            {
                total,
                skip,
                take,
                items = mapped
            });
        }

        // POST /api/admin/subscriptions/redeem-for-user
        [HttpPost("redeem-for-user")]
        public async Task<IActionResult> RedeemForUser(
            [FromBody] AdminRedeemForUserDto? dto,
            CancellationToken ct = default)
        {
            if (dto == null)
            {
                return BadRequest(new
                {
                    message = "Body không hợp lệ."
                });
            }

            var code = (dto.Code ?? string.Empty)
                .Trim()
                .ToUpperInvariant();

            var rawUserId = (dto.UserId ?? string.Empty)
                .Trim();

            if (string.IsNullOrWhiteSpace(code))
            {
                return BadRequest(new
                {
                    message = "Vui lòng nhập mã kích hoạt."
                });
            }

            if (!ObjectId.TryParse(
                    rawUserId,
                    out var userId))
            {
                return BadRequest(new
                {
                    message = "Tài khoản được chọn có UserId không hợp lệ."
                });
            }

            var targetAccount = await _accounts.GetByIdAsync(userId);

            if (targetAccount == null)
            {
                return NotFound(new
                {
                    message = "Không tìm thấy tài khoản cần kích hoạt."
                });
            }

            if (!targetAccount.IsActive)
            {
                return BadRequest(new
                {
                    message = "Tài khoản đang bị khóa nên không thể kích hoạt dịch vụ."
                });
            }

            try
            {
                var result = await _subs.RedeemCodeAsync(
                    userId,
                    code,
                    ct);

                // Đọc lại subscription để response trả quota mới ngay.
                var activeSubscription = await _subs.GetActiveAsync(
                    userId,
                    ct);

                var quota = BuildSmsQuota(activeSubscription);

                return Ok(new
                {
                    message = "activated",
                    code,
                    userId = userId.ToString(),
                    email = targetAccount.Email,
                    plan = result.plan,
                    features = result.features,
                    startedAtUtc = result.startedAt,
                    endsAtUtc = result.endsAt,

                    smsQuotaTotal = quota.total,
                    smsQuotaUsed = quota.used,
                    smsUnlimited = quota.unlimited,
                    smsRemaining = quota.remaining,
                    smsWarnAtRemaining = quota.warnAt,
                    smsIsLow = quota.isLow
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new
                {
                    message = TranslateRedeemError(ex.Message),
                    detail = ex.Message
                });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new
                {
                    message = TranslateRedeemError(ex.Message),
                    detail = ex.Message
                });
            }
        }

        // POST /api/admin/subscriptions/sync-quota/{userId}
        // Ép backend đọc lại LicenseCodes và backfill quota cho account.
        [HttpPost("sync-quota/{userId}")]
        public async Task<IActionResult> SyncQuota(
            string userId,
            CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(
                    userId,
                    out var objectId))
            {
                return BadRequest(new
                {
                    message = "UserId không hợp lệ."
                });
            }

            var account = await _accounts.GetByIdAsync(objectId);

            if (account == null)
            {
                return NotFound(new
                {
                    message = "Không tìm thấy tài khoản."
                });
            }

            // GetActiveAsync gọi TryBackfillSmsQuotaAsync trong service.
            var subscription = await _subs.GetActiveAsync(
                objectId,
                ct);

            if (subscription == null)
            {
                return NotFound(new
                {
                    message = "Tài khoản chưa có subscription đang hoạt động."
                });
            }

            var quota = BuildSmsQuota(subscription);

            return Ok(new
            {
                message = "synced",
                userId = objectId.ToString(),
                email = account.Email,
                plan = subscription.Plan,
                features = subscription.Features,
                smsQuotaTotal = quota.total,
                smsQuotaUsed = quota.used,
                smsUnlimited = quota.unlimited,
                smsRemaining = quota.remaining,
                smsWarnAtRemaining = quota.warnAt,
                smsIsLow = quota.isLow
            });
        }

        // GET /api/admin/accounts-users?onlyActive=true&search=abc&skip=0&take=100
        [HttpGet("/api/admin/accounts-users")]
        public async Task<IActionResult> AdminListUserAccounts(
            [FromQuery] bool onlyActive = true,
            [FromQuery] string? search = null,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            var list = await _accounts.GetByRoleAsync("User");

            if (onlyActive)
            {
                list = list
                    .Where(x => x.IsActive)
                    .ToList();
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var keyword = search
                    .Trim()
                    .ToLowerInvariant();

                list = list
                    .Where(account =>
                    {
                        var email = account.Email
                            ?? string.Empty;

                        var local = email;
                        var at = email.IndexOf('@');

                        if (at > 0)
                            local = email[..at];

                        return
                            (!string.IsNullOrEmpty(email)
                             && email.ToLowerInvariant().Contains(keyword))
                            ||
                            (!string.IsNullOrEmpty(local)
                             && local.ToLowerInvariant().Contains(keyword));
                    })
                    .ToList();
            }

            var total = list.Count;

            skip = Math.Max(0, skip);
            take = take <= 0 || take > 1000
                ? 100
                : take;

            var items = list
                .Skip(skip)
                .Take(take)
                .Select(account =>
                {
                    var email = account.Email
                        ?? string.Empty;

                    string? displayName = null;
                    var at = email.IndexOf('@');

                    if (at > 0)
                        displayName = email[..at];

                    return new
                    {
                        id = account.Id.ToString(),
                        email = account.Email,
                        name = displayName
                    };
                })
                .ToList();

            return Ok(new
            {
                total,
                items
            });
        }

        private static (
            int? total,
            int used,
            bool unlimited,
            int? remaining,
            int? warnAt,
            bool isLow)
            BuildSmsQuota(Subscription? subscription)
        {
            if (subscription == null)
            {
                return (
                    null,
                    0,
                    false,
                    null,
                    null,
                    false);
            }

            var used = Math.Max(
                0,
                subscription.SmsQuotaUsed);

            var total = subscription.SmsUnlimited
                ? null
                : subscription.SmsQuotaTotal;

            int? remaining = subscription.SmsUnlimited
                ? null
                : total.HasValue
                    ? Math.Max(
                        0,
                        total.Value - used)
                    : null;

            var isLow =
                !subscription.SmsUnlimited
                && remaining.HasValue
                && subscription.SmsWarnAtRemaining.HasValue
                && remaining.Value <= subscription.SmsWarnAtRemaining.Value;

            return (
                total,
                used,
                subscription.SmsUnlimited,
                remaining,
                subscription.SmsWarnAtRemaining,
                isLow);
        }

        private static string TranslateRedeemError(string? message)
        {
            var text = message ?? string.Empty;

            if (text.Contains(
                    "Code not found",
                    StringComparison.OrdinalIgnoreCase))
            {
                return "Mã kích hoạt không tồn tại.";
            }

            if (text.Contains(
                    "no remaining activation slot",
                    StringComparison.OrdinalIgnoreCase))
            {
                return "Mã kích hoạt đã hết lượt sử dụng.";
            }

            if (text.Contains(
                    "reserved for another user",
                    StringComparison.OrdinalIgnoreCase))
            {
                return "Mã kích hoạt đã được dành cho một tài khoản khác.";
            }

            if (text.Contains(
                    "already redeemed",
                    StringComparison.OrdinalIgnoreCase))
            {
                return "Tài khoản này đã sử dụng mã kích hoạt trước đó.";
            }

            if (text.Contains(
                    "Invalid user id",
                    StringComparison.OrdinalIgnoreCase))
            {
                return "UserId không hợp lệ.";
            }

            if (text.Contains(
                    "Code is required",
                    StringComparison.OrdinalIgnoreCase))
            {
                return "Thiếu mã kích hoạt.";
            }

            return string.IsNullOrWhiteSpace(text)
                ? "Không thể kích hoạt mã cho tài khoản."
                : text;
        }
    }
}
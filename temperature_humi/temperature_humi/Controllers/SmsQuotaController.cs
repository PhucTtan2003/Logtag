using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System.Security.Claims;
using temperature_humi.Service;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/sms/quota")]   
    [Authorize]
    public sealed class SmsQuotaController : ControllerBase
    {
        private readonly SmsQuotaService _quota;
        private readonly ILogger<SmsQuotaController> _log;

        public SmsQuotaController(
            SmsQuotaService quota,
            ILogger<SmsQuotaController> log)
        {
            _quota = quota;
            _log = log;
        }
        
        // GET /api/sms/quota/me
        [HttpGet("me")]
        public async Task<IActionResult> Me(CancellationToken ct)
        {
            var userId = CurrentUserObjectId();

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    status = "unauthorized",
                    message = "Không xác định được tài khoản đăng nhập."
                });
            }

            var state = await _quota.GetQuotaAsync(userId, ct);

            var remaining = state.SmsRemaining;
            var shouldRenew =
                state.SmsEnabled &&
                !state.SmsUnlimited &&
                remaining.HasValue &&
                remaining.Value < 50;

            return Ok(new
            {
                status = "ok",
                userId = userId.ToString(),

                hasSubscription = state.HasSubscription,
                isActive = state.IsActive,
                smsEnabled = state.SmsEnabled,

                smsUnlimited = state.SmsUnlimited,
                smsQuotaTotal = state.SmsQuotaTotal,
                smsQuotaUsed = state.SmsQuotaUsed,
                smsRemaining = state.SmsRemaining,
                smsWarnAtRemaining = state.SmsWarnAtRemaining,

                isLow = state.IsLow,
                shouldRenew,
                renewMessage = shouldRenew
                    ? "Bạn vui lòng gia hạn để tiếp tục sử dụng dịch vụ."
                    : null,

                endsAtUtc = state.EndsAtUtc,
                reason = state.Reason,
                timestampUtc = DateTime.UtcNow
            });
        }

        private ObjectId CurrentUserObjectId()
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

            return ObjectId.TryParse(raw, out var id) ? id : ObjectId.Empty;
        }
    }
}

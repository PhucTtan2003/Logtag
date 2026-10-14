using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using temperature_humi.Models.Logtag.Requests;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/logtag-webhooks")]
    [Authorize(Roles = "Admin")]
    public class AdminLogTagWebhooksController : ControllerBase
    {
        private readonly LogTagAccountRouter _router;
        private readonly ILogger<AdminLogTagWebhooksController> _logger;
        private readonly IHostEnvironment _env;
        private readonly IConfiguration _configuration;

        public AdminLogTagWebhooksController(
            LogTagAccountRouter router,
            ILogger<AdminLogTagWebhooksController> logger,
            IHostEnvironment env,
            IConfiguration configuration)
        {
            _router = router;
            _logger = logger;
            _env = env;
            _configuration = configuration;
        }

        // ============================================================
        // 1. PRODUCTION - GET STATUS
        //
        // GET /api/admin/logtag-webhooks/{teamId}/status
        // ============================================================
        [HttpGet("{teamId:long}/status")]
        public async Task<IActionResult> GetStatus(
            long teamId,
            CancellationToken ct)
        {
            if (teamId <= 0)
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "teamId không hợp lệ."
                });
            }

            try
            {
                var client = _router.GetClientByTeamId(teamId);

                var result =
                    await client.GetReadingsWebhookConfigAsync(
                        teamId,
                        ct);

                _logger.LogInformation(
                    "[LOGTAG-WEBHOOK-ADMIN] GET status success. TeamId={TeamId}, Status={Status}",
                    teamId,
                    result?.deliveryStatus);

                return Ok(new
                {
                    ok = true,
                    teamId,
                    message = "Backend gọi LogTag Readings Webhook API thành công.",
                    data = result
                });
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return StatusCode(499, new
                {
                    ok = false,
                    teamId,
                    message = "Request đã bị huỷ."
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "[LOGTAG-WEBHOOK-ADMIN] GET status failed. TeamId={TeamId}",
                    teamId);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        ok = false,
                        teamId,
                        message = "Backend chưa gọi thành công LogTag Readings Webhook API.",
                        error = ex.Message
                    });
            }
        }

        // ============================================================
        // 2. LOCAL TEST - GET STATUS
        //
        // GET /api/admin/logtag-webhooks/{teamId}/test-status
        //
        // Không cần login.
        // Chỉ hoạt động khi ASPNETCORE_ENVIRONMENT=Development
        // ============================================================
        [AllowAnonymous]
        [HttpGet("{teamId:long}/test-status")]
        public async Task<IActionResult> TestStatus(
            long teamId,
            CancellationToken ct)
        {
            if (!_env.IsDevelopment())
            {
                return NotFound();
            }

            if (teamId <= 0)
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "teamId không hợp lệ."
                });
            }

            try
            {
                _logger.LogInformation(
                    "[LOGTAG-WEBHOOK-TEST] Starting status check TeamId={TeamId}",
                    teamId);

                var client = _router.GetClientByTeamId(teamId);

                var result =
                    await client.GetReadingsWebhookConfigAsync(
                        teamId,
                        ct);

                _logger.LogInformation(
                    "[LOGTAG-WEBHOOK-TEST] Status SUCCESS TeamId={TeamId}, Status={Status}",
                    teamId,
                    result?.deliveryStatus);

                return Ok(new
                {
                    ok = true,
                    teamId,
                    message = "Backend gọi LogTag Readings Webhook API thành công.",
                    data = result
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "[LOGTAG-WEBHOOK-TEST] Status FAILED TeamId={TeamId}",
                    teamId);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        ok = false,
                        teamId,
                        message = "Backend gọi LogTag Readings Webhook API thất bại.",
                        error = ex.Message
                    });
            }
        }

        // ============================================================
        // 3. PRODUCTION - CONFIGURE / ENABLE WEBHOOK
        //
        // PUT /api/admin/logtag-webhooks/{teamId}/configure
        //
        // Body:
        // {
        //    "publicBaseUrl": "https://your-domain.com",
        //    "enabled": true
        // }
        //
        // Backend tự tạo:
        // https://your-domain.com/api/logtag/webhooks/readings/{teamId}
        //
        // SigningSecret KHÔNG nhận từ request.
        // Secret được lấy từ Configuration.
        // ============================================================
        [HttpPut("{teamId:long}/configure")]
        public async Task<IActionResult> Configure(
            long teamId,
            [FromBody] ConfigureWebhookRequest request,
            CancellationToken ct)
        {
            return await ConfigureInternal(
                teamId,
                request,
                ct);
        }

        // ============================================================
        // 4. LOCAL TEST - CONFIGURE / ENABLE WEBHOOK
        //
        // PUT /api/admin/logtag-webhooks/{teamId}/test-configure
        //
        // Không cần login.
        // Chỉ Development.
        // ============================================================
        [AllowAnonymous]
        [HttpPut("{teamId:long}/test-configure")]
        public async Task<IActionResult> TestConfigure(
            long teamId,
            [FromBody] ConfigureWebhookRequest request,
            CancellationToken ct)
        {
            if (!_env.IsDevelopment())
            {
                return NotFound();
            }

            return await ConfigureInternal(
                teamId,
                request,
                ct);
        }

        // ============================================================
        // INTERNAL CONFIGURE
        // ============================================================
        private async Task<IActionResult> ConfigureInternal(
            long teamId,
            ConfigureWebhookRequest request,
            CancellationToken ct)
        {
            if (teamId <= 0)
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "teamId không hợp lệ."
                });
            }

            if (request == null)
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "Request body là bắt buộc."
                });
            }

            if (string.IsNullOrWhiteSpace(request.PublicBaseUrl))
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "PublicBaseUrl là bắt buộc."
                });
            }

            // --------------------------------------------------------
            // Validate URL cơ bản
            // --------------------------------------------------------
            var baseUrl = request.PublicBaseUrl
                .Trim()
                .TrimEnd('/');

            if (!Uri.TryCreate(
                    baseUrl,
                    UriKind.Absolute,
                    out var uri))
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "PublicBaseUrl không hợp lệ."
                });
            }

            if (!string.Equals(
                    uri.Scheme,
                    Uri.UriSchemeHttps,
                    StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "Webhook của LogTag yêu cầu public HTTPS URL."
                });
            }

            // Không cho localhost
            if (uri.IsLoopback ||
                string.Equals(
                    uri.Host,
                    "localhost",
                    StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "LogTag không chấp nhận localhost làm targetUrl."
                });
            }

            try
            {
                // ----------------------------------------------------
                // Lấy SigningSecret của đúng team
                // ----------------------------------------------------
                var secret =
                    _configuration[
                        $"LogTagReadingsWebhook:Teams:{teamId}:SigningSecret"];

                if (string.IsNullOrWhiteSpace(secret))
                {
                    return BadRequest(new
                    {
                        ok = false,
                        teamId,
                        message =
                            $"Chưa cấu hình SigningSecret cho team {teamId}."
                    });
                }

                // ----------------------------------------------------
                // Chọn đúng account LogTag theo team
                // ----------------------------------------------------
                var client =
                    _router.GetClientByTeamId(teamId);

                // ----------------------------------------------------
                // URL thật mà LogTag sẽ POST readings vào
                // ----------------------------------------------------
                var targetUrl =
                    $"{baseUrl}/api/logtag/webhooks/readings/{teamId}";

                _logger.LogInformation(
                    "[LOGTAG-WEBHOOK-CONFIG] Configure START TeamId={TeamId}, Enabled={Enabled}, TargetUrl={TargetUrl}",
                    teamId,
                    request.Enabled,
                    targetUrl);

                // ----------------------------------------------------
                // Gọi PUT sang LogTag Online
                // ----------------------------------------------------
                var result =
                    await client.ConfigureReadingsWebhookAsync(
                        teamId,
                        targetUrl,
                        enabled: request.Enabled,
                        signingSecret: secret,
                        ct);

                _logger.LogInformation(
                    "[LOGTAG-WEBHOOK-CONFIG] Configure SUCCESS TeamId={TeamId}, Enabled={Enabled}, TargetUrl={TargetUrl}",
                    teamId,
                    request.Enabled,
                    targetUrl);

                return Ok(new
                {
                    ok = true,
                    teamId,
                    enabled = request.Enabled,
                    targetUrl,
                    message = request.Enabled
                        ? "Đã cấu hình và bật LogTag Readings Webhook."
                        : "Đã cập nhật và tắt LogTag Readings Webhook.",
                    data = result
                });
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return StatusCode(499, new
                {
                    ok = false,
                    teamId,
                    message = "Request đã bị huỷ."
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "[LOGTAG-WEBHOOK-CONFIG] Configure FAILED TeamId={TeamId}",
                    teamId);

                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    new
                    {
                        ok = false,
                        teamId,
                        message =
                            "Không cấu hình được LogTag Readings Webhook.",
                        error = ex.Message
                    });
            }
        }
        [HttpPost("{teamId:long}/subscriptions")]
        public async Task<IActionResult> CreateSubscription(
    long teamId,
    [FromBody] CreateLogTagSubscriptionRequest request,
    CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(request.SerialNumber))
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "SerialNumber required"
                });
            }


            try
            {
                var client = _router.GetClientByTeamId(teamId);


                var result =
                    await client.CreateReadingSubscriptionAsync(
                        teamId,
                        request.SerialNumber,
                        ct);


                return Ok(new
                {
                    ok = true,
                    teamId,
                    serialNumber = request.SerialNumber,
                    message = "Subscription created successfully",
                    data = result
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Create subscription failed Team={TeamId}",
                    teamId);


                return StatusCode(502, new
                {
                    ok = false,
                    error = ex.Message
                });
            }
        }
        [HttpGet("{teamId:long}/subscriptions")]
        public async Task<IActionResult> GetSubscriptions(
    long teamId,
    CancellationToken ct)
        {
            try
            {
                var client =
                    _router.GetClientByTeamId(teamId);


                var result =
                    await client.GetReadingSubscriptionsAsync(
                        teamId,
                        ct);


                return Ok(new
                {
                    ok = true,
                    teamId,
                    data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(502, new
                {
                    ok = false,
                    error = ex.Message
                });
            }
        }
        [HttpDelete("{teamId:long}/subscriptions/{serialNumber}")]
        public async Task<IActionResult> DeleteSubscription(
    long teamId,
    string serialNumber,
    CancellationToken ct)
        {
            try
            {
                var client =
                    _router.GetClientByTeamId(teamId);


                var result =
                    await client.DeleteReadingSubscriptionAsync(
                        teamId,
                        serialNumber,
                        ct);


                return Ok(new
                {
                    ok = true,
                    teamId,
                    serialNumber,
                    data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(502, new
                {
                    ok = false,
                    error = ex.Message
                });
            }
        }
        // ============================================================
        // REQUEST DTO
        // ============================================================
        public sealed class ConfigureWebhookRequest
        {
            public string PublicBaseUrl { get; set; } = string.Empty;

            public bool Enabled { get; set; } = true;
        }
    }
}
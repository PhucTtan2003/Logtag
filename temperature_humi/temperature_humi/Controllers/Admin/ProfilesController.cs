// Controllers/ProfilesController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Net;
using System.Text.Json;
using temperature_humi.Infrastructure; // EndpointRateLimiter, SingleFlight, SimpleMemoryCache
using temperature_humi.DTO;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/external")]
    [Authorize]
    [Produces("application/json")]
    public class ProfilesController : ControllerBase
    {
        private readonly LogTagApiClient _api;
        private readonly EndpointRateLimiter _rate;
        private readonly SingleFlight _sf;
        private readonly SimpleMemoryCache _cache;

        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

        public ProfilesController(
            LogTagApiClient api,
            EndpointRateLimiter rate,
            SingleFlight sf,
            SimpleMemoryCache cache)
        {
            _api = api;
            _rate = rate;
            _sf = sf;
            _cache = cache;
        }

        // Controllers/ProfilesController.cs (trong GetProfiles)
        [HttpGet("profiles/v1/{teamId:long}")]
        public async Task<IActionResult> GetProfiles(long teamId, CancellationToken ct)
        {
            var epKey = $"external:profiles:{teamId}";

            // ... (rate-limit & cache như cũ)

            // 3) Single-flight to upstream, with stale-on-fail
            try
            {
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
                linked.CancelAfter(TimeSpan.FromSeconds(20)); // timeout cho call này

                var envelope = await _sf.DoAsync(epKey, async () =>
                {
                    var upstream = await _api.GetProfilesAsync(teamId, linked.Token);

                    var env = new ApiEnvelopeProfiles
                    {
                        Data = upstream.Data ?? new List<TeamProfileDto>(),
                        Status = upstream.Status ?? "ok",
                        TimestampUtc = upstream.TimestampUtc ?? DateTime.UtcNow
                    };

                    _cache.Set(epKey, env, CacheTtl);
                    _cache.Set(epKey + ":stale", env, TimeSpan.FromMinutes(10));
                    return env;
                });

                Response.Headers["X-Cache"] = "miss";
                SetEtagHeader(envelope, out var etag);
                if (Request.Headers.TryGetValue("If-None-Match", out var inm) && inm == etag)
                    return StatusCode(StatusCodes.Status304NotModified);

                return Ok(envelope);
            }
            catch (OperationCanceledException)
            {
                // client cancel / timeout: trả 499 cho FE tự hiểu
                Response.Headers["X-Error"] = "canceled";
                return StatusCode(499, new { error = "client_canceled", message = "Request was canceled/aborted." });
            }
            catch (Exception ex)
            {
                if (_cache.TryGet(epKey + ":stale", out ApiEnvelopeProfiles? stale) && stale is not null)
                {
                    Response.Headers["X-Cache"] = "stale";
                    Response.Headers["X-Error"] = "upstream";
                    return Ok(stale);
                }
                return StatusCode(502, new { error = "upstream_error", message = ex.Message });
            }
        }


        private void SetEtagHeader<T>(T obj, out string etag)
        {
            var json = JsonSerializer.Serialize(obj);
            var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json));
            etag = "\"" + Convert.ToHexString(hash) + "\"";
            Response.Headers["ETag"] = etag;
            Response.Headers["Cache-Control"] = "no-store"; // or short max-age if desired
        }
    }
}

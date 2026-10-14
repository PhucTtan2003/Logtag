using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using temperature_humi.Background;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/devices")]
    public class DevicesSyncController : ControllerBase
    {
        private readonly ILogger<DevicesSyncController> _log;
        private readonly DevicesSyncWorker _worker;

        // rate limit 3 lần / 60s / key
        private class Bucket { public int Count; public DateTime WindowStartUtc; }
        private static readonly ConcurrentDictionary<string, Bucket> _buckets = new();
        private static bool TryTake(string key, int limit, TimeSpan window, out int remaining)
        {
            var now = DateTime.UtcNow;
            var b = _buckets.GetOrAdd(key, _ => new Bucket { Count = 0, WindowStartUtc = now });
            lock (b)
            {
                if (now - b.WindowStartUtc >= window) { b.Count = 0; b.WindowStartUtc = now; }
                if (b.Count >= limit) { remaining = 0; return false; }
                b.Count++; remaining = limit - b.Count; return true;
            }
        }

        public DevicesSyncController(ILogger<DevicesSyncController> log, DevicesSyncWorker worker)
        {
            _log = log;
            _worker = worker;
        }

        // POST /api/devices/sync?teamId=16922
        // Header: X-User-Id: <userId-tu-frontend>
        [HttpPost("sync")]
        public async Task<IActionResult> SyncNow([FromQuery] long teamId, CancellationToken ct)
        {
            if (teamId <= 0) return BadRequest("teamId is required.");

            var userId = Request.Headers["X-User-Id"].ToString().Trim();
            if (string.IsNullOrEmpty(userId))
                userId = $"ip:{HttpContext.Connection.RemoteIpAddress}";

            var key = $"manual-sync:{userId}";
            if (!TryTake(key, limit: 3, window: TimeSpan.FromMinutes(1), out var remaining))
            {
                Response.Headers["Retry-After"] = "60";
                return StatusCode(429, new { message = "Tối đa 3 lần/phút.", retryAfterSec = 60 });
            }

            try
            {
                var (upserts, total) = await _worker.SyncTeamAsync(teamId, ct);
                return Ok(new
                {
                    message = "Đã đồng bộ thiết bị.",
                    teamId,
                    upserts,
                    totalFromApi = total,
                    remainingCallsThisMinute = remaining
                });
            }
            catch (OperationCanceledException)
            { return BadRequest(new { message = "Bị hủy bởi client." }); }
            catch (Exception ex)
            {
                _log.LogError(ex, "Manual devices sync error for team {TeamId}", teamId);
                return StatusCode(500, new { message = "Lỗi khi đồng bộ thiết bị.", detail = ex.Message });
            }
        }
    }
}
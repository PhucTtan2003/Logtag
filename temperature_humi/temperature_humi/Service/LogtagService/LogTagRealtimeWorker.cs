// temperature_humi/Service/LogTagRealtimeWorker.cs
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Helpers.Config;
using temperature_humi.Infrastructure;

namespace temperature_humi.Service.LogtagService
{
    /// <summary>
    /// Worker kéo readings từ LogTag khi có client đang "watch" serial (Hub gọi Watch/Unwatch).
    ///
    /// Bản Batch API v2:
    /// - Không gọi từng serial nữa.
    /// - Gom tối đa 500 serial đang được watch vào 1 request batch.
    /// - Tôn trọng quota Location Readings Batch API v2: 1 request/phút.
    /// - Serial có Webhook Active + team delivery Enabled sẽ KHÔNG bị REST polling.
    /// - Serial không có Webhook Active sẽ tiếp tục dùng Batch API v2.
    /// - Nếu webhook bị Disabled/Suspended hoặc subscription bị remove,
    ///   serial sẽ tự quay lại REST polling sau khi snapshot refresh.
    /// - LocationReadingService sẽ gọi /external/locationreadings/v2/{teamId}/batch,
    ///   upsert MongoDB, update latest status, push SignalR và kiểm tra cảnh báo.
    ///
    /// ⚠ Worker này CHẠY THEO tài khoản MAIN (LogTagApiClientMain + LogTagApiSettingsMain)
    /// </summary>
    public sealed class LogTagRealtimeWorker : BackgroundService
    {
        private readonly ILogger<LogTagRealtimeWorker> _log;
        private readonly LocationReadingService _readings;

        // Giữ lại để không ảnh hưởng DI cũ; bản v2 dùng EndpointScheduler trong LocationReadingService.
        private readonly EndpointRateLimiter _rateLimiter;

        private readonly LogTagApiSettingsMain _cfg;
        private readonly LogTagApiClientMain _api;

        // ===== Tuning cho Batch API v2 =====
        // Worker vẫn thức dậy thường xuyên để biết có watcher hay không,
        // nhưng chỉ được gọi batch v2 tối đa 1 lần/phút.
        private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan BatchV2MinInterval = TimeSpan.FromSeconds(65);

        // API v2 cho tối đa 500 unique serialNumbers/request.
        private const int MaxSerialPerBatch = 500;

        // API v2 yêu cầu date window <= 15 phút.
        // Dùng 14 phút + 2 phút overlap để giảm rủi ro thiếu dữ liệu upload trễ.
        private static readonly TimeSpan BatchV2Window = TimeSpan.FromMinutes(14);
        private static readonly TimeSpan Overlap = TimeSpan.FromMinutes(2);

        private static readonly TimeSpan TeamResolveCooldown = TimeSpan.FromSeconds(30);

        // Webhook subscription được refresh định kỳ để quyết định serial nào
        // không cần REST polling nữa.
        private static readonly TimeSpan WebhookSubscriptionRefreshInterval =
            TimeSpan.FromMinutes(1);

        // Serial đang có readings webhook Active.
        // Nếu serial nằm trong collection này thì RealtimeWorker KHÔNG gọi Batch API v2.
        private readonly ConcurrentDictionary<string, byte> _webhookSerials =
            new(StringComparer.OrdinalIgnoreCase);

        private DateTime _lastWebhookSubscriptionRefreshUtc = DateTime.MinValue;
        private long _webhookSnapshotTeamId = 0;

        // Watchers (serial -> số subscriber)
        private readonly ConcurrentDictionary<string, int> _watchers =
            new(StringComparer.OrdinalIgnoreCase);

        // Ưu tiên serial lâu chưa poll
        private readonly ConcurrentDictionary<string, DateTime> _lastPolled =
            new(StringComparer.OrdinalIgnoreCase);

        // Đánh dấu đã thấy serial trong vòng đời tiến trình.
        // Với v2, recovery realtime chỉ lấy window gần nhất vì API giới hạn 15 phút.
        private readonly ConcurrentDictionary<string, bool> _recoveryDone =
            new(StringComparer.OrdinalIgnoreCase);

        // Gate nội bộ để không enqueue request v2 quá dày.
        private DateTime _nextBatchAllowedUtc = DateTime.MinValue;

        private long TeamId => _cfg.TeamId;

        public LogTagRealtimeWorker(
            ILogger<LogTagRealtimeWorker> log,
            LocationReadingService readings,
            EndpointRateLimiter rateLimiter,
            IOptions<LogTagApiSettingsMain> cfg,
            LogTagApiClientMain api)
        {
            _log = log;
            _readings = readings;
            _rateLimiter = rateLimiter;
            _cfg = cfg.Value ?? new LogTagApiSettingsMain();
            _api = api;
        }

        /// <summary>Hub gọi khi client JoinSerial.</summary>
        public void Watch(string serial)
        {
            if (string.IsNullOrWhiteSpace(serial)) return;

            var key = serial.Trim().ToUpperInvariant();
            _watchers.AddOrUpdate(key, 1, (_, n) => n + 1);
        }

        /// <summary>Hub gọi khi client LeaveSerial/disconnect.</summary>
        public void Unwatch(string serial)
        {
            if (string.IsNullOrWhiteSpace(serial)) return;

            var key = serial.Trim().ToUpperInvariant();
            _watchers.AddOrUpdate(key, 0, (_, n) => Math.Max(0, n - 1));

            if (_watchers.TryGetValue(key, out var cnt) && cnt <= 0)
                _watchers.TryRemove(key, out _);
        }

        public IReadOnlyCollection<string> GetWatchedSerials() =>
            GetWatchedSerialsInternal();

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            _log.LogInformation("LogTagRealtimeWorker starting Batch V2 (MAIN cfg.TeamId={TeamId}).", _cfg.TeamId);

            // Jitter nhẹ để tránh nhiều worker/service cùng gọi API ngay khi app start.
            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(Random.Shared.Next(250, 1250)), ct);
            }
            catch
            {
                // ignore on shutdown
            }

            long teamId = _cfg.TeamId;
            if (teamId <= 0)
                teamId = await ResolveTeamIdSafeAsync(ct);

            if (teamId <= 0)
                _log.LogWarning("TeamId is not configured and cannot be resolved at start. Worker will retry periodically and idle meanwhile.");

            DateTime lastTeamResolveAttemptUtc = DateTime.MinValue;

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    if (teamId <= 0 && DateTime.UtcNow - lastTeamResolveAttemptUtc >= TeamResolveCooldown)
                    {
                        lastTeamResolveAttemptUtc = DateTime.UtcNow;
                        var resolved = await ResolveTeamIdSafeAsync(ct);

                        if (resolved > 0)
                        {
                            teamId = resolved;
                            _log.LogInformation("Resolved teamId={TeamId} successfully (MAIN).", teamId);
                        }
                    }

                    var allWatched = GetWatchedSerialsInternal();
                    if (allWatched.Count == 0 || teamId <= 0)
                    {
                        await DelaySafe(TimeSpan.FromSeconds(5), ct);
                        continue;
                    }

                    // Webhook-first:
                    // - Serial có subscription Active => nhận reading qua webhook.
                    // - Serial không có subscription => tiếp tục REST Batch V2.
                    await RefreshWebhookSubscriptionsIfNeededAsync(teamId, ct);

                    var pollCandidates = allWatched
                        .Where(s => !_webhookSerials.ContainsKey(s))
                        .ToList();

                    if (pollCandidates.Count == 0)
                    {
                        _log.LogDebug(
                            "[RT MAIN] All watched serials are covered by webhook. watching={Watching}, webhook={Webhook}",
                            allWatched.Count,
                            _webhookSerials.Count);

                        await DelaySafe(TimeSpan.FromSeconds(5), ct);
                        continue;
                    }

                    var nowUtc = DateTime.UtcNow;
                    if (nowUtc < _nextBatchAllowedUtc)
                    {
                        var wait = _nextBatchAllowedUtc - nowUtc;
                        _log.LogDebug(
                            "[RT MAIN V2] Waiting for batch quota window. watched={Count}, waitSec={WaitSec:0}",
                            allWatched.Count,
                            wait.TotalSeconds);

                        await DelaySafe(wait > TimeSpan.FromSeconds(5) ? TimeSpan.FromSeconds(5) : wait, ct);
                        continue;
                    }

                    var serials = pollCandidates
                        .OrderBy(s => _lastPolled.TryGetValue(s, out var last) ? last : DateTime.MinValue)
                        .Take(MaxSerialPerBatch)
                        .ToList();

                    if (serials.Count == 0)
                    {
                        await DelaySafe(TimeSpan.FromSeconds(5), ct);
                        continue;
                    }

                    var toUtc = DateTime.UtcNow.AddSeconds(2);
                    var fromUtc = await ComputeBatchFromUtcAsync(teamId, serials, toUtc, ct);

                    if (toUtc <= fromUtc)
                        toUtc = fromUtc.AddMinutes(1);

                    _log.LogWarning(
                        "[RT MAIN V2] Batch tick. watching={Watching}, webhook={Webhook}, polling={Polling}, teamId={TeamId}, from={From:o}, to={To:o}",
                        allWatched.Count,
                        _webhookSerials.Count,
                        serials.Count,
                        teamId,
                        fromUtc,
                        toUtc);

                    try
                    {
                        var stats = await _readings.PullAndUpsertWithStatsAsync(
                            teamId,
                            serials,
                            fromUtc,
                            toUtc,
                            ct);

                        var polledAt = DateTime.UtcNow;
                        foreach (var serial in serials)
                        {
                            _lastPolled[serial] = polledAt;
                            _recoveryDone[serial] = true;
                        }

                        _nextBatchAllowedUtc = DateTime.UtcNow.Add(BatchV2MinInterval);

                        _log.LogWarning(
                            "[RT MAIN V2] Batch done. teamId={TeamId}, serials={Serials}, fetched={Fetched}, inserted={Inserted}, updated={Updated}, nextAllowed={Next:o}",
                            teamId,
                            serials.Count,
                            stats.Fetched,
                            stats.Inserted,
                            stats.Updated,
                            _nextBatchAllowedUtc);
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        // Với Batch API v2, 503/quota phải chờ ít nhất 1 phút rồi mới gọi lại.
                        _nextBatchAllowedUtc = DateTime.UtcNow.Add(BatchV2MinInterval);

                        _log.LogWarning(
                            ex,
                            "[RT MAIN V2] Batch pull failed. teamId={TeamId}, serials={Serials}, nextAllowed={Next:o}",
                            teamId,
                            serials.Count,
                            _nextBatchAllowedUtc);
                    }
                }
                catch (OperationCanceledException)
                {
                    // normal on shutdown
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "Realtime batch v2 tick failed (MAIN).");
                }

                await DelaySafe(TickInterval, ct);
            }

            _log.LogInformation("LogTagRealtimeWorker Batch V2 (MAIN) stopped.");
        }

        /// <summary>
        /// Refresh danh sách readings webhook subscription Active của team.
        ///
        /// Quy tắc:
        /// - Active subscription => serial được loại khỏi REST Batch V2 polling.
        /// - Serial vừa rời webhook => reset trạng thái polling/recovery để lần poll
        ///   tiếp theo có thể lấy lại dữ liệu gần nhất.
        /// - Nếu API quản lý webhook lỗi tạm thời, giữ snapshot cũ thay vì xoá sạch,
        ///   tránh đột ngột chuyển hàng loạt serial sang REST polling.
        /// </summary>
        private async Task RefreshWebhookSubscriptionsIfNeededAsync(
            long teamId,
            CancellationToken ct)
        {
            var nowUtc = DateTime.UtcNow;

            if (_webhookSnapshotTeamId == teamId &&
                nowUtc - _lastWebhookSubscriptionRefreshUtc <
                WebhookSubscriptionRefreshInterval)
            {
                return;
            }

            try
            {
                if (_webhookSnapshotTeamId != 0 &&
                    _webhookSnapshotTeamId != teamId)
                {
                    _webhookSerials.Clear();
                    _lastPolled.Clear();
                    _recoveryDone.Clear();
                    _lastWebhookSubscriptionRefreshUtc = DateTime.MinValue;
                }

                // Trước tiên kiểm tra team webhook có thực sự đang Enabled.
                // Chỉ có subscription Active thôi chưa đủ: nếu team bị Disabled/Suspended
                // thì LogTag không gửi webhook và serial phải quay lại REST polling.
                var config = await _api.GetReadingsWebhookConfigAsync(teamId, ct);

                var webhookDeliveryEnabled =
                    config != null &&
                    config.enabled &&
                    string.Equals(
                        config.deliveryStatus,
                        "Enabled",
                        StringComparison.OrdinalIgnoreCase);

                List<LogTagApiClient.ReadingsWebhookSubscriptionDto> subscriptions;

                if (!webhookDeliveryEnabled)
                {
                    subscriptions = new List<LogTagApiClient.ReadingsWebhookSubscriptionDto>();
                }
                else
                {
                    subscriptions =
                        await _api.ListReadingsWebhookSubscriptionsAsync(teamId, ct);
                }

                var activeSerials = new HashSet<string>(
                    subscriptions
                        .Where(x =>
                            x != null &&
                            string.Equals(
                                x.subscriptionStatus,
                                "Active",
                                StringComparison.OrdinalIgnoreCase))
                        .Select(x => NormalizeSerial(x.serialNumber))
                        .Where(x => x.Length > 0),
                    StringComparer.OrdinalIgnoreCase);

                var previousSerials = _webhookSerials.Keys.ToHashSet(
                    StringComparer.OrdinalIgnoreCase);

                var removed = previousSerials
                    .Where(x => !activeSerials.Contains(x))
                    .ToList();

                var added = activeSerials
                    .Where(x => !previousSerials.Contains(x))
                    .ToList();

                foreach (var serial in removed)
                {
                    _webhookSerials.TryRemove(serial, out _);

                    // Serial quay lại REST polling:
                    // cho phép recovery window gần nhất chạy lại.
                    _lastPolled.TryRemove(serial, out _);
                    _recoveryDone.TryRemove(serial, out _);
                }

                foreach (var serial in activeSerials)
                    _webhookSerials[serial] = 0;

                _lastWebhookSubscriptionRefreshUtc = DateTime.UtcNow;
                _webhookSnapshotTeamId = teamId;

                _log.LogInformation(
                    "[RT WEBHOOK] Snapshot refreshed. TeamId={TeamId}, delivery={Delivery}, active={Active}, added={Added}, removed={Removed}",
                    teamId,
                    webhookDeliveryEnabled ? "Enabled" : (config?.deliveryStatus ?? "NotConfigured"),
                    activeSerials.Count,
                    added.Count,
                    removed.Count);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // Fail-safe: giữ snapshot cũ.
                // Không xoá _webhookSerials chỉ vì một lần GET subscription lỗi.
                _log.LogWarning(
                    ex,
                    "[RT WEBHOOK] Cannot refresh subscriptions for TeamId={TeamId}. Keeping previous snapshot. activeCached={ActiveCached}",
                    teamId,
                    _webhookSerials.Count);
            }
        }

        private static string NormalizeSerial(string? serial)
        {
            return string.IsNullOrWhiteSpace(serial)
                ? string.Empty
                : serial.Trim().ToUpperInvariant();
        }

        private async Task<DateTime> ComputeBatchFromUtcAsync(
            long teamId,
            IReadOnlyCollection<string> serials,
            DateTime toUtc,
            CancellationToken ct)
        {
            // Base window an toàn theo spec v2: <= 15 phút.
            var defaultFrom = toUtc - BatchV2Window;
            var earliestNeeded = toUtc;
            var hasLatest = false;

            foreach (var serial in serials)
            {
                ct.ThrowIfCancellationRequested();

                var isFirstSeen = !_recoveryDone.ContainsKey(serial);

                try
                {
                    var latest = await _readings.GetHistoryBySerialAsync(serial, 1, teamId.ToString());
                    if (latest.Count == 0)
                    {
                        var latestNoTeam = await _readings.GetHistoryBySerialAsync(serial, 1, null);
                        if (latestNoTeam.Count > 0)
                            latest = latestNoTeam;
                    }

                    if (latest.Count > 0)
                    {
                        hasLatest = true;
                        var candidate = latest[0].DateUtc.ToUniversalTime() - Overlap;

                        // Không để batch window vượt quá giới hạn v2.
                        if (candidate < defaultFrom)
                            candidate = defaultFrom;

                        if (candidate < earliestNeeded)
                            earliestNeeded = candidate;
                    }
                    else if (isFirstSeen)
                    {
                        // Serial mới/chưa có raw DB: lấy nguyên window gần nhất.
                        if (defaultFrom < earliestNeeded)
                            earliestNeeded = defaultFrom;
                    }
                }
                catch (Exception ex)
                {
                    _log.LogDebug(ex, "[RT MAIN V2] Cannot read latest for serial={Serial}. Use default window.", serial);

                    if (defaultFrom < earliestNeeded)
                        earliestNeeded = defaultFrom;
                }
            }

            if (!hasLatest && earliestNeeded == toUtc)
                earliestNeeded = defaultFrom;

            // Guard cuối cùng: không vượt 15 phút.
            if (toUtc - earliestNeeded > BatchV2Window)
                earliestNeeded = defaultFrom;

            return TruncateToSecond(earliestNeeded);
        }

        private List<string> GetWatchedSerialsInternal() =>
            _watchers
                .Where(kv => kv.Value > 0)
                .Select(kv => kv.Key)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        private static DateTime TruncateToSecond(DateTime dt)
        {
            var utc = dt.Kind == DateTimeKind.Utc ? dt : dt.ToUniversalTime();
            var ticks = utc.Ticks - utc.Ticks % TimeSpan.TicksPerSecond;
            return new DateTime(ticks, DateTimeKind.Utc);
        }

        private static async Task DelaySafe(TimeSpan ts, CancellationToken ct)
        {
            if (ts <= TimeSpan.Zero) return;

            try
            {
                await Task.Delay(ts, ct);
            }
            catch
            {
                // ignore
            }
        }

        private async Task<long> ResolveTeamIdSafeAsync(CancellationToken ct)
        {
            try
            {
                var dto = await _api.GetTokenDtoAsync(ct);
                return dto?.Teams?.FirstOrDefault()?.id ?? 0;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Cannot obtain teamId from token API (MAIN).");
                return 0;
            }
        }
    }
}

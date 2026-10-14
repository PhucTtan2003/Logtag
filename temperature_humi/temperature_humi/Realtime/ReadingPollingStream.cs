// Realtime/ReadingsPollingStream.cs
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using temperature_humi.Helpers.Config;
using temperature_humi.Hubs;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

public sealed class ReadingsPollingStream : BackgroundService
{
    private readonly DeviceService _devices;
    private readonly AccountDeviceService _accountDevices;
    private readonly LocationReadingService _readings;
    private readonly LogTagAccountRouter _logtagRouter;
    private readonly IHubContext<LogTagHub> _hub;
    private readonly ILogger<ReadingsPollingStream> _log;
    private readonly IOptionsMonitor<ReadingsPollingSettings> _opt;
    private readonly IOptionsMonitor<LogTagTeamRoutingOptions> _routingOpt;

    // Theo tài liệu Location Readings Batch API v2:
    // - 500 devices trở xuống: 1 request mỗi 5–6 phút.
    // - 501–1000 devices: chia batch, request cách nhau 1 phút.
    // - Window không quá 15 phút.
    //
    // Chọn default an toàn:
    // - Poll 6 phút/lần để còn buffer quota.
    // - Backfill 14 phút để bắt được logger upload trễ, nhưng không chạm trần 15 phút.
    private const int DefaultPollIntervalSeconds = 360;  // 6 phút
    private const int MinPollIntervalSeconds = 300;      // không cho xuống 60s vì v2 quota 1 request/phút
    private const int MaxPollIntervalSeconds = 900;      // 15 phút

    private const int DefaultBackfillSeconds = 840;      // 14 phút
    private const int MinBackfillSeconds = 420;          // 7 phút = poll 6 phút + overlap 1 phút
    private const int MaxBackfillSeconds = 890;          // né sát trần 900s vì service có cộng buffer giây

    private static readonly TimeSpan DisabledDelay = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ErrorDelay = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan StartupJitterMin = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan StartupJitterMax = TimeSpan.FromMilliseconds(1250);

    public ReadingsPollingStream(
        DeviceService devices,
        AccountDeviceService accountDevices,
        LocationReadingService readings,
        LogTagAccountRouter logtagRouter,
        IHubContext<LogTagHub> hub,
        ILogger<ReadingsPollingStream> log,
        IOptionsMonitor<ReadingsPollingSettings> opt,
        IOptionsMonitor<LogTagTeamRoutingOptions> routingOpt)
    {
        _devices = devices;
        _accountDevices = accountDevices;
        _readings = readings;
        _logtagRouter = logtagRouter;
        _hub = hub;
        _log = log;
        _opt = opt;
        _routingOpt = routingOpt;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var initialTeamIds = GetLocationReadingTeamIds();

        if (initialTeamIds.Count == 0)
        {
            _log.LogWarning(
                "[ReadingsPolling] No teamId available from LogTagAccounts or LogTagTeamRouting.MainTeams. Worker will not run.");

            return;
        }

        _log.LogInformation(
            "[ReadingsPolling] Teams loaded for LocationReadings v2: {Teams}. Source=LogTagAccounts/MainTeams",
            string.Join(",", initialTeamIds));

        var jitterMs = Random.Shared.Next(
            (int)StartupJitterMin.TotalMilliseconds,
            (int)StartupJitterMax.TotalMilliseconds);

        await DelaySafe(TimeSpan.FromMilliseconds(jitterMs), ct);

        _log.LogInformation("[ReadingsPolling] Started.");

        while (!ct.IsCancellationRequested)
        {
            var loopStartedUtc = DateTime.UtcNow;

            var cfg = _opt.CurrentValue ?? new ReadingsPollingSettings();
            if (!cfg.Enabled)
            {
                _log.LogDebug("[ReadingsPolling] Disabled via config.");
                await DelaySafe(DisabledDelay, ct);
                continue;
            }

            var pollSec = NormalizePollIntervalSeconds(cfg.PollIntervalSeconds);
            var backfillSec = NormalizeBackfillSeconds(cfg.BackfillSeconds);

            var pollInterval = TimeSpan.FromSeconds(pollSec);
            var backfill = TimeSpan.FromSeconds(backfillSec);

            try
            {
                var teamSerials = await ResolveTeamSerialsAsync(ct);

                if (teamSerials.Count == 0)
                {
                    _log.LogWarning("[ReadingsPolling] No active serials found for configured LogTagAccounts/MainTeams.");
                }
                else
                {
                    var toUtc = DateTime.UtcNow.AddSeconds(5);
                    var fromUtc = toUtc.Subtract(backfill);

                    var totalSerials = teamSerials.Values.Sum(x => x.Count);

                    _log.LogInformation(
                        "[ReadingsPolling] Cycle start. Teams={TeamCount}, Serials={SerialCount}, Range={From:o}->{To:o}, Poll={PollSec}s, Backfill={BackfillSec}s",
                        teamSerials.Count,
                        totalSerials,
                        fromUtc,
                        toUtc,
                        pollSec,
                        backfillSec);

                    foreach (var kv in teamSerials.OrderBy(x => x.Key))
                    {
                        ct.ThrowIfCancellationRequested();

                        var teamId = kv.Key;
                        var serials = kv.Value;

                        if (serials.Count == 0)
                            continue;

                        var teamStartedUtc = DateTime.UtcNow;
                        var accountKey = GetAccountKeySafe(teamId);

                        // ============================================================
                        // WEBHOOK ROUTING
                        // Serial nào đang có Readings Webhook Active thì KHÔNG
                        // đưa vào Location Readings V2.
                        //
                        // Nếu không thể xác định trạng thái Webhook (API lỗi, timeout,
                        // mapping lỗi...) thì fail-open về V2 để ưu tiên không mất data.
                        // ============================================================
                        var v2Serials = await ExcludeWebhookSerialsAsync(
                            teamId,
                            serials,
                            ct);

                        if (v2Serials.Count == 0)
                        {
                            _log.LogInformation(
                                "[ReadingsPolling] Team={TeamId}, account={AccountKey}: all {Count} serials are handled by Webhook. Skip V2.",
                                teamId,
                                accountKey,
                                serials.Count);

                            continue;
                        }

                        _log.LogInformation(
                            "[ReadingsPolling] Polling team={TeamId}, account={AccountKey}, total={Total}, V2={V2Count}, Sample={Sample}",
                            teamId,
                            accountKey,
                            serials.Count,
                            v2Serials.Count,
                            BuildSerialSample(v2Serials));

                        // LocationReadingService bên trong đã dùng
                        // LogTagAccountRouter.GetClientByTeamId(teamId)
                        // nên mỗi team sẽ đi đúng account theo routing hiện tại.
                        var stats = await _readings.PullAndUpsertWithStatsAsync(
                            teamId,
                            v2Serials,
                            fromUtc,
                            toUtc,
                            ct);

                        _log.LogInformation(
                            "[ReadingsPolling] Team={TeamId} Account={AccountKey} Result: Fetched={Fetched}, Inserted={Inserted}, Updated={Updated}, Elapsed={ElapsedMs}ms",
                            teamId,
                            accountKey,
                            stats.Fetched,
                            stats.Inserted,
                            stats.Updated,
                            (long)(DateTime.UtcNow - teamStartedUtc).TotalMilliseconds);
                    }

                    _log.LogInformation(
                        "[ReadingsPolling] Cycle done. Elapsed={ElapsedMs}ms",
                        (long)(DateTime.UtcNow - loopStartedUtc).TotalMilliseconds);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "[ReadingsPolling] Loop error.");
                await DelaySafe(ErrorDelay, ct);
            }

            var nextRunUtc = loopStartedUtc.Add(pollInterval);
            var delay = nextRunUtc - DateTime.UtcNow;

            if (delay > TimeSpan.Zero)
            {
                await DelaySafe(delay, ct);
            }
            else
            {
                await DelaySafe(TimeSpan.FromSeconds(2), ct);
            }
        }

        _log.LogInformation("[ReadingsPolling] Stopped.");
    }

    private async Task<Dictionary<long, List<string>>> ResolveTeamSerialsAsync(CancellationToken ct)
    {
        var result = new Dictionary<long, List<string>>();
        var teamIds = GetLocationReadingTeamIds();

        foreach (var teamId in teamIds)
        {
            ct.ThrowIfCancellationRequested();

            try
            {
                // Validate sớm để nếu team chưa map trong LogTagAccounts thì thấy lỗi rõ trong log.
                _ = _logtagRouter.GetClientByTeamId(teamId);

                var maps = await _accountDevices.GetMapsByTeamAsync(teamId, ct);

                var serials = NormalizeSerials(
                    maps.Select(x => x.SerialNumber));

                if (serials.Count > 0)
                {
                    result[teamId] = serials;

                    _log.LogDebug(
                        "[ReadingsPolling] Team={TeamId} Account={AccountKey} serials from AccountDevice maps: {Count}",
                        teamId,
                        GetAccountKeySafe(teamId),
                        serials.Count);
                }
                else
                {
                    _log.LogWarning(
                        "[ReadingsPolling] Team={TeamId} Account={AccountKey} has no AccountDevice maps. Add serial mappings with correct TeamId before polling.",
                        teamId,
                        GetAccountKeySafe(teamId));
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "[ReadingsPolling] Failed to load serial maps for team={TeamId}",
                    teamId);
            }
        }

        // Fallback cũ: chỉ dùng khi còn đúng 1 team, để tránh gán serial nhầm account/team.
        if (result.Count == 0 && teamIds.Count == 1)
        {
            try
            {
                var fallbackTeamId = teamIds.FirstOrDefault();
                var serials = NormalizeSerials(await _devices.GetActiveDeviceSerialsAsync());

                if (fallbackTeamId > 0 && serials.Count > 0)
                {
                    result[fallbackTeamId] = serials;

                    _log.LogWarning(
                        "[ReadingsPolling] Fallback to DeviceService.GetActiveDeviceSerialsAsync. Team={TeamId}, Serials={Count}. Please verify serials belong to this team.",
                        fallbackTeamId,
                        serials.Count);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "[ReadingsPolling] Fallback DeviceService serial load failed.");
            }
        }

        if (result.Count == 0 && teamIds.Count > 1)
        {
            _log.LogWarning(
                "[ReadingsPolling] Multiple teams configured ({Teams}) but no AccountDevice maps found. Fallback disabled to avoid assigning serials to the wrong team.",
                string.Join(",", teamIds));
        }

        return result;
    }

    private IReadOnlyList<long> GetLocationReadingTeamIds()
    {
        var ids = new List<long>();

        // Chuẩn mới: lấy toàn bộ Main teams từ LogTagAccounts, ví dụ 16922 + 13524.
        try
        {
            ids.AddRange(_logtagRouter.GetEnabledTeamIds("Main"));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "[ReadingsPolling] Cannot load Main teams from LogTagAccounts. Fallback to LogTagTeamRouting.MainTeams.");
        }

        // Tương thích cũ: nếu LogTagAccounts chưa có dữ liệu, dùng MainTeams.
        if (ids.Count == 0)
        {
            var routing = _routingOpt.CurrentValue;
            if (routing?.MainTeams != null)
            {
                ids.AddRange(routing.MainTeams.Where(x => x > 0));
            }
        }

        return ids
            .Where(x => x > 0)
            .Distinct()
            .OrderBy(x => x)
            .ToList();
    }

    private string GetAccountKeySafe(long teamId)
    {
        try
        {
            return _logtagRouter.GetAccountKeyByTeamId(teamId);
        }
        catch
        {
            return "unknown";
        }
    }

    /// <summary>
    /// Loại các serial đang có Readings Webhook Active khỏi danh sách V2.
    ///
    /// Routing:
    /// - Webhook config phải enabled=true và deliveryStatus=Enabled.
    /// - Subscription phải có subscriptionStatus=Active.
    /// - Serial không thỏa các điều kiện trên sẽ tiếp tục dùng V2.
    /// - Nếu kiểm tra Webhook thất bại, fallback toàn bộ serial về V2
    ///   để tránh làm mất dữ liệu.
    /// </summary>
    private async Task<List<string>> ExcludeWebhookSerialsAsync(
        long teamId,
        IReadOnlyCollection<string> serials,
        CancellationToken ct)
    {
        var normalizedSerials = NormalizeSerials(serials);

        if (normalizedSerials.Count == 0)
            return new List<string>();

        try
        {
            // Lấy đúng LogTag client theo team/account routing hiện tại.
            var client = _logtagRouter.GetClientByTeamId(teamId);

            // ------------------------------------------------------------
            // 1. Kiểm tra cấu hình Webhook của team.
            // ------------------------------------------------------------
            var config = await client.GetReadingsWebhookConfigAsync(
                teamId,
                ct);

            var webhookEnabled =
                config != null &&
                config.enabled &&
                string.Equals(
                    config.deliveryStatus,
                    "Enabled",
                    StringComparison.OrdinalIgnoreCase);

            // Webhook chưa được cấu hình/bật hoặc đang Disabled/Suspended.
            // Khi đó toàn bộ serial tiếp tục đi qua V2.
            if (!webhookEnabled)
            {
                _log.LogDebug(
                    "[ReadingsPolling] Team={TeamId} Webhook not active. deliveryStatus={DeliveryStatus}, enabled={Enabled}. All {Count} serials remain on V2.",
                    teamId,
                    config?.deliveryStatus ?? "NotConfigured",
                    config?.enabled ?? false,
                    normalizedSerials.Count);

                return normalizedSerials;
            }

            // ------------------------------------------------------------
            // 2. Lấy danh sách subscription hiện tại của team.
            // ------------------------------------------------------------
            var subscriptions = await client.GetReadingSubscriptionsAsync(
                teamId,
                ct);

            var webhookSerials = subscriptions
                .Where(x =>
                    string.Equals(
                        x.subscriptionStatus,
                        "Active",
                        StringComparison.OrdinalIgnoreCase))
                .Select(x => x.serialNumber)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToUpperInvariant())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            // ------------------------------------------------------------
            // 3. Chỉ giữ lại serial KHÔNG có Webhook Active để polling V2.
            // ------------------------------------------------------------
            var v2Serials = normalizedSerials
                .Where(serial => !webhookSerials.Contains(serial))
                .ToList();

            var webhookCount = normalizedSerials.Count - v2Serials.Count;

            _log.LogInformation(
                "[ReadingsPolling] Team={TeamId} Reading routing: Total={Total}, Webhook={WebhookCount}, V2={V2Count}",
                teamId,
                normalizedSerials.Count,
                webhookCount,
                v2Serials.Count);

            if (webhookCount > 0)
            {
                _log.LogDebug(
                    "[ReadingsPolling] Team={TeamId} Webhook serials: {Serials}",
                    teamId,
                    string.Join(
                        ",",
                        normalizedSerials.Where(x => webhookSerials.Contains(x))));
            }

            return v2Serials;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Không được vì lỗi kiểm tra Webhook mà bỏ luôn dữ liệu.
            // Nếu không xác định được trạng thái Webhook => fallback V2.
            _log.LogWarning(
                ex,
                "[ReadingsPolling] Failed to resolve Webhook routing for team={TeamId}. Fallback ALL {Count} serials to V2.",
                teamId,
                normalizedSerials.Count);

            return normalizedSerials;
        }
    }

    private static int NormalizePollIntervalSeconds(int value)
    {
        if (value <= 0)
            value = DefaultPollIntervalSeconds;

        return Math.Clamp(value, MinPollIntervalSeconds, MaxPollIntervalSeconds);
    }

    private static int NormalizeBackfillSeconds(int value)
    {
        if (value <= 0)
            value = DefaultBackfillSeconds;

        return Math.Clamp(value, MinBackfillSeconds, MaxBackfillSeconds);
    }

    private static List<string> NormalizeSerials(IEnumerable<string?> serials)
    {
        return (serials ?? Array.Empty<string?>())
            .Select(s => (s ?? string.Empty).Trim().ToUpperInvariant())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s)
            .ToList();
    }

    private static string BuildSerialSample(IReadOnlyCollection<string> serials)
    {
        var sample = serials
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Take(10)
            .ToArray();

        if (sample.Length == 0)
            return "(empty)";

        var suffix = serials.Count > sample.Length
            ? $", ... +{serials.Count - sample.Length} more"
            : string.Empty;

        return string.Join(",", sample) + suffix;
    }

    private static async Task DelaySafe(TimeSpan ts, CancellationToken ct)
    {
        if (ts <= TimeSpan.Zero)
            return;

        try
        {
            await Task.Delay(ts, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // app đang stop
        }
        catch
        {
            // ignore
        }
    }
}

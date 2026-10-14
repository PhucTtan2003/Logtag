using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using temperature_humi.Helpers.Config;
using temperature_humi.Service;

namespace temperature_humi.Background
{
    public class ReadingAggregationWorker : BackgroundService
    {
        private readonly ReadingAggregationService _aggregation;
        private readonly IOptionsMonitor<ReadingAggregationOptions> _options;
        private readonly ILogger<ReadingAggregationWorker> _log;

        public ReadingAggregationWorker(
            ReadingAggregationService aggregation,
            IOptionsMonitor<ReadingAggregationOptions> options,
            ILogger<ReadingAggregationWorker> log)
        {
            _aggregation = aggregation;
            _options = options;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Jitter nhỏ để tránh toàn bộ worker chạy cùng thời điểm khi app start.
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(Random.Shared.Next(5, 20)), stoppingToken);
            }
            catch { /* ignore */ }

            _log.LogInformation("[ReadingAggregation] Worker started.");

            while (!stoppingToken.IsCancellationRequested)
            {
                var cfg = _options.CurrentValue ?? new ReadingAggregationOptions();

                if (!cfg.Enabled)
                {
                    _log.LogDebug("[ReadingAggregation] Disabled via config.");
                    await DelaySafe(TimeSpan.FromMinutes(1), stoppingToken);
                    continue;
                }

                var interval = TimeSpan.FromMinutes(Math.Clamp(cfg.IntervalMinutes, 5, 1440));
                var lookback = TimeSpan.FromHours(Math.Clamp(cfg.LookbackHours, 1, 24 * 14));
                var latestLookback = TimeSpan.FromHours(Math.Clamp(cfg.LatestLookbackHours, 1, 24 * 30));
                var onlineThreshold = TimeSpan.FromMinutes(Math.Clamp(cfg.OnlineThresholdMinutes, 5, 24 * 60));

                var started = DateTime.UtcNow;

                try
                {
                    _log.LogInformation(
                        "[ReadingAggregation] Running. Lookback={LookbackHours}h, LatestLookback={LatestLookbackHours}h, OnlineThreshold={OnlineThresholdMinutes}m",
                        lookback.TotalHours,
                        latestLookback.TotalHours,
                        onlineThreshold.TotalMinutes);

                    var stats = await _aggregation.AggregateRecentAsync(
                        lookback,
                        latestLookback,
                        onlineThreshold,
                        stoppingToken);

                    _log.LogInformation(
                        "[ReadingAggregation] Done. Hourly={Hourly}, Daily={Daily}, Latest={Latest}, Duration={DurationSeconds:0.0}s",
                        stats.HourlyBuckets,
                        stats.DailyBuckets,
                        stats.LatestStatuses,
                        (DateTime.UtcNow - started).TotalSeconds);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[ReadingAggregation] Loop error.");
                }

                var elapsed = DateTime.UtcNow - started;
                var delay = interval - elapsed;
                if (delay < TimeSpan.FromSeconds(30))
                    delay = TimeSpan.FromSeconds(30);

                await DelaySafe(delay, stoppingToken);
            }

            _log.LogInformation("[ReadingAggregation] Worker stopped.");
        }

        private static async Task DelaySafe(TimeSpan delay, CancellationToken ct)
        {
            try { await Task.Delay(delay, ct); }
            catch { /* ignore */ }
        }
    }
}

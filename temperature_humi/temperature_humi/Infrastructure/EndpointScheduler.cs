using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Collections.Concurrent;
using System.Threading.Channels;
using temperature_humi.Service;

namespace temperature_humi.Infrastructure
{
    public class EndpointSchedulerOptions
    {
        public EndpointQuotaRule Default { get; set; } = new();

        public Dictionary<string, EndpointQuotaRule> Rules { get; set; }
            = new(StringComparer.OrdinalIgnoreCase);

        public EndpointQuotaRule GetRule(string endpointKey)
        {
            var key = string.IsNullOrWhiteSpace(endpointKey)
                ? string.Empty
                : endpointKey.Trim();

            // 1) Ưu tiên exact key, ví dụ:
            // logtag:team:13524:locationreadings:v2:batch
            if (!string.IsNullOrWhiteSpace(key) &&
                Rules.TryGetValue(key, out var exactRule))
            {
                return exactRule.CloneAndNormalize();
            }

            // 2) Batch V2 phải luôn ưu tiên trước rule locationreadings chung.
            // Nếu appsettings chưa bind hoặc thiếu rule, vẫn ép rule an toàn 1 request/phút
            // để tránh LogTag trả 503 quota khi split batch tìm serial lỗi.
            if (!string.IsNullOrWhiteSpace(key) &&
                key.Contains(":locationreadings:v2:batch", StringComparison.OrdinalIgnoreCase))
            {
                if (Rules.TryGetValue("logtag:locationreadings:v2:batch", out var genericBatchV2Rule))
                    return genericBatchV2Rule.CloneAndNormalize();

                return EndpointQuotaRule.BatchV2SafeDefault();
            }

            // 3) Locationreadings v1 / rule cũ.
            if (!string.IsNullOrWhiteSpace(key) &&
                key.Contains(":locationreadings", StringComparison.OrdinalIgnoreCase) &&
                Rules.TryGetValue("logtag:locationreadings", out var locationRule))
            {
                return locationRule.CloneAndNormalize();
            }

            // 4) LT5 geo readings.
            if (!string.IsNullOrWhiteSpace(key) &&
                key.Contains(":ltgeoreadings", StringComparison.OrdinalIgnoreCase) &&
                Rules.TryGetValue("logtag:ltgeoreadings", out var ltgeoRule))
            {
                return ltgeoRule.CloneAndNormalize();
            }

            return Default.CloneAndNormalize();
        }
    }

    public class EndpointQuotaRule
    {
        public int MaxRequestsPerSecond { get; set; } = 2;
        public int MaxRequestsPerMinute { get; set; } = 110;
        public int MaxConcurrency { get; set; } = 10;
        public int QueueCapacity { get; set; } = 50000;
        public int CooldownSecondsOnQuota { get; set; } = 60;
        public int RetryOnQuota { get; set; } = 1;

        public static EndpointQuotaRule BatchV2SafeDefault()
            => new()
            {
                MaxRequestsPerSecond = 1,
                MaxRequestsPerMinute = 1,
                MaxConcurrency = 1,
                QueueCapacity = 100000,
                CooldownSecondsOnQuota = 65,
                RetryOnQuota = 0
            };

        public EndpointQuotaRule CloneAndNormalize()
        {
            return new EndpointQuotaRule
            {
                MaxRequestsPerSecond = Math.Clamp(MaxRequestsPerSecond, 1, 1000),
                MaxRequestsPerMinute = Math.Clamp(MaxRequestsPerMinute, 1, 100000),
                MaxConcurrency = Math.Clamp(MaxConcurrency, 1, 200),
                QueueCapacity = Math.Clamp(QueueCapacity, 100, 500000),
                CooldownSecondsOnQuota = Math.Clamp(CooldownSecondsOnQuota, 1, 3600),
                RetryOnQuota = Math.Clamp(RetryOnQuota, 0, 5)
            };
        }
    }

    public sealed class EndpointScheduler : BackgroundService, LocationReadingService.IEndpointScheduler
    {
        private readonly ILogger<EndpointScheduler> _log;
        private readonly IOptionsMonitor<EndpointSchedulerOptions> _options;
        private readonly ConcurrentDictionary<string, EndpointQueue> _queues = new(StringComparer.OrdinalIgnoreCase);
        private readonly CancellationTokenSource _shutdown = new();

        public EndpointScheduler(
            ILogger<EndpointScheduler> log,
            IOptionsMonitor<EndpointSchedulerOptions> options)
        {
            _log = log;
            _options = options;
        }

        public async Task<T> Enqueue<T>(
            string endpointKey,
            Func<CancellationToken, Task<T>> work,
            CancellationToken ct = default)
        {
            endpointKey = string.IsNullOrWhiteSpace(endpointKey)
                ? "default"
                : endpointKey.Trim().ToLowerInvariant();

            var queue = _queues.GetOrAdd(endpointKey, CreateQueue);

            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var job = new ScheduledJob<T>(work, tcs);

            await queue.Channel.Writer.WriteAsync(job, ct);

            return await tcs.Task.WaitAsync(ct);
        }

        private EndpointQueue CreateQueue(string key)
        {
            var rule = _options.CurrentValue.GetRule(key);

            var channel = Channel.CreateBounded<IScheduledJob>(
                new BoundedChannelOptions(rule.QueueCapacity)
                {
                    FullMode = BoundedChannelFullMode.Wait,
                    SingleReader = false,
                    SingleWriter = false
                });

            var queue = new EndpointQueue(key, channel);

            // Nếu đổi MaxConcurrency sau khi queue đã tạo, cần restart app để số worker đổi.
            for (var i = 0; i < rule.MaxConcurrency; i++)
            {
                _ = Task.Run(() => WorkerLoopAsync(queue, _shutdown.Token));
            }

            _log.LogWarning(
                "[EndpointScheduler] Created queue key={Key}, max={PerSecond}/s, {PerMinute}/min, concurrency={Concurrency}, capacity={Capacity}",
                key,
                rule.MaxRequestsPerSecond,
                rule.MaxRequestsPerMinute,
                rule.MaxConcurrency,
                rule.QueueCapacity);

            return queue;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var reg = stoppingToken.Register(() => _shutdown.Cancel());

            _log.LogWarning("[EndpointScheduler] Started");

            try
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // normal shutdown
            }
        }

        public override async Task StopAsync(CancellationToken cancellationToken)
        {
            _shutdown.Cancel();
            await base.StopAsync(cancellationToken);
        }

        private async Task WorkerLoopAsync(EndpointQueue queue, CancellationToken ct)
        {
            await foreach (var job in queue.Channel.Reader.ReadAllAsync(ct))
            {
                var rule = _options.CurrentValue.GetRule(queue.Key);

                try
                {
                    await ExecuteWithRateLimitAndRetryAsync(queue, job, rule, ct);
                }
                catch (OperationCanceledException ex)
                {
                    job.SetException(ex);
                }
                catch (Exception ex)
                {
                    job.SetException(ex);
                }
            }
        }

        private async Task ExecuteWithRateLimitAndRetryAsync(
            EndpointQueue queue,
            IScheduledJob job,
            EndpointQuotaRule rule,
            CancellationToken ct)
        {
            var attempt = 0;

            while (true)
            {
                attempt++;

                try
                {
                    await WaitForQuotaSlotAsync(queue, rule, ct);
                    await job.ExecuteAsync(ct);
                    return;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested && IsQuotaException(ex))
                {
                    if (attempt > rule.RetryOnQuota + 1)
                    {
                        _log.LogError(
                            ex,
                            "[EndpointScheduler] Quota retry exhausted. key={Key}, attempt={Attempt}",
                            queue.Key,
                            attempt);

                        job.SetException(ex);
                        return;
                    }

                    var cooldown = TimeSpan.FromSeconds(rule.CooldownSecondsOnQuota);

                    _log.LogWarning(
                        ex,
                        "[EndpointScheduler] Quota hit. key={Key}, attempt={Attempt}, cooldown={CooldownSeconds}s",
                        queue.Key,
                        attempt,
                        cooldown.TotalSeconds);

                    await Task.Delay(cooldown, ct);
                }
            }
        }

        private async Task WaitForQuotaSlotAsync(
            EndpointQueue queue,
            EndpointQuotaRule rule,
            CancellationToken ct)
        {
            while (true)
            {
                TimeSpan wait;

                lock (queue.Lock)
                {
                    var now = DateTimeOffset.UtcNow;

                    Prune(queue.SecondWindow, now, TimeSpan.FromSeconds(1));
                    Prune(queue.MinuteWindow, now, TimeSpan.FromMinutes(1));

                    var secondOk = queue.SecondWindow.Count < rule.MaxRequestsPerSecond;
                    var minuteOk = queue.MinuteWindow.Count < rule.MaxRequestsPerMinute;

                    if (secondOk && minuteOk)
                    {
                        queue.SecondWindow.Enqueue(now);
                        queue.MinuteWindow.Enqueue(now);
                        return;
                    }

                    var waitSecond = TimeSpan.Zero;
                    var waitMinute = TimeSpan.Zero;

                    if (!secondOk && queue.SecondWindow.Count > 0)
                        waitSecond = queue.SecondWindow.Peek().AddSeconds(1) - now;

                    if (!minuteOk && queue.MinuteWindow.Count > 0)
                        waitMinute = queue.MinuteWindow.Peek().AddMinutes(1) - now;

                    wait = waitSecond > waitMinute ? waitSecond : waitMinute;

                    if (wait < TimeSpan.FromMilliseconds(50))
                        wait = TimeSpan.FromMilliseconds(50);
                }

                if (wait.TotalSeconds >= 1)
                {
                    _log.LogDebug(
                        "[EndpointScheduler] Waiting quota. key={Key}, waitMs={WaitMs}",
                        queue.Key,
                        wait.TotalMilliseconds);
                }

                await Task.Delay(wait, ct);
            }
        }

        private static void Prune(
            Queue<DateTimeOffset> timestamps,
            DateTimeOffset now,
            TimeSpan window)
        {
            while (timestamps.Count > 0 && now - timestamps.Peek() >= window)
            {
                timestamps.Dequeue();
            }
        }

        private static string ExceptionMessages(Exception ex)
        {
            var parts = new List<string>();
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (!string.IsNullOrWhiteSpace(e.Message))
                    parts.Add(e.Message);
            }

            return string.Join(" | ", parts);
        }

        private static bool IsInvalidInputException(Exception ex)
        {
            var msg = ExceptionMessages(ex);

            return msg.Contains("InvalidInput", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("BadRequest", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("serial numbers are invalid", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("invalid or unavailable", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsQuotaException(Exception ex)
        {
            // Không dùng ex.ToString() vì stack trace có chữ EndpointQuota/Quota làm lỗi 400 bị nhận nhầm quota.
            if (IsInvalidInputException(ex))
                return false;

            var msg = ExceptionMessages(ex);

            return msg.Contains("API requests quota exceeded", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("quota exceeded", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("rate limit", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("too many requests", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("429", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("503", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("ServiceUnavailable", StringComparison.OrdinalIgnoreCase);
        }

        private sealed class EndpointQueue
        {
            public string Key { get; }
            public Channel<IScheduledJob> Channel { get; }

            public object Lock { get; } = new();
            public Queue<DateTimeOffset> SecondWindow { get; } = new();
            public Queue<DateTimeOffset> MinuteWindow { get; } = new();

            public EndpointQueue(string key, Channel<IScheduledJob> channel)
            {
                Key = key;
                Channel = channel;
            }
        }

        private interface IScheduledJob
        {
            Task ExecuteAsync(CancellationToken ct);
            void SetException(Exception ex);
        }

        private sealed class ScheduledJob<T> : IScheduledJob
        {
            private readonly Func<CancellationToken, Task<T>> _work;
            private readonly TaskCompletionSource<T> _tcs;

            public ScheduledJob(
                Func<CancellationToken, Task<T>> work,
                TaskCompletionSource<T> tcs)
            {
                _work = work;
                _tcs = tcs;
            }

            public async Task ExecuteAsync(CancellationToken ct)
            {
                var result = await _work(ct);
                _tcs.TrySetResult(result);
            }

            public void SetException(Exception ex)
            {
                _tcs.TrySetException(ex);
            }
        }
    }
}

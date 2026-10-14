// Infrastructure/EndpointRateLimiter.cs
using System.Collections.Concurrent;

namespace temperature_humi.Infrastructure
{
    /// <summary>
    /// Giới hạn theo endpoint key:
    /// - Khoảng cách giữa 2 lần gọi (minSpacing, mặc định 1s)
    /// - Tối đa N lần trong 60s (maxPerMinute, mặc định 5)
    /// In-memory per-process. Nếu scale-out nhiều instance, cân nhắc Redis/Dist. cache.
    /// </summary>
    public class EndpointRateLimiter
    {
        private sealed class Bucket
        {
            public DateTimeOffset LastHitUtc = DateTimeOffset.MinValue;
            public readonly ConcurrentQueue<DateTimeOffset> Hits = new(); // sliding window 60s
            public readonly SemaphoreSlim Gate = new(1, 1);               // serialize per-key
        }

        private sealed class NoopDisposable : IDisposable
        {
            public static readonly NoopDisposable Instance = new();
            public void Dispose() { /* no-op */ }
        }

        private readonly ConcurrentDictionary<string, Bucket> _buckets = new();

        private readonly TimeSpan _minSpacing;
        private readonly int _maxPerMinute;
        private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

        /// <param name="minSpacing">Khoảng cách tối thiểu giữa 2 lần cấp slot (mặc định 1s)</param>
        /// <param name="maxPerMinute">Tối đa số lần trong 60s (mặc định 5)</param>
        public EndpointRateLimiter(TimeSpan? minSpacing = null, int maxPerMinute = 5)
        {
            _minSpacing = minSpacing ?? TimeSpan.FromSeconds(1);
            _maxPerMinute = maxPerMinute <= 0 ? 5 : maxPerMinute;
        }

        private static void PruneOldHits(Bucket bucket, DateTimeOffset now)
        {
            while (bucket.Hits.TryPeek(out var t) && (now - t) > Window)
                bucket.Hits.TryDequeue(out _);
        }

        /// <summary>
        /// Đợi đến khi có slot theo 2 rule (minSpacing &amp; maxPerMinute/60s), sau đó ghi nhận lượt gọi.
        /// Dùng khi muốn server tự đợi thay vì trả 429.
        /// </summary>
        public async Task WaitForSlotAsync(string endpointKey, CancellationToken ct = default)
        {
            var bucket = _buckets.GetOrAdd(endpointKey, _ => new Bucket());
            await bucket.Gate.WaitAsync(ct).ConfigureAwait(false);

            try
            {
                while (true)
                {
                    ct.ThrowIfCancellationRequested();
                    var now = DateTimeOffset.UtcNow;

                    // 1) min spacing
                    var sinceLast = now - bucket.LastHitUtc;
                    var waitSpacing = sinceLast >= _minSpacing ? TimeSpan.Zero : (_minSpacing - sinceLast);

                    // 2) quota 60s
                    PruneOldHits(bucket, now);
                    var waitWindow = TimeSpan.Zero;
                    if (bucket.Hits.Count >= _maxPerMinute && bucket.Hits.TryPeek(out var oldest))
                    {
                        var until = Window - (now - oldest);
                        if (until > TimeSpan.Zero) waitWindow = until;
                    }

                    if (waitSpacing == TimeSpan.Zero && waitWindow == TimeSpan.Zero)
                    {
                        // cấp slot
                        var stamp = DateTimeOffset.UtcNow;
                        bucket.LastHitUtc = stamp;
                        bucket.Hits.Enqueue(stamp);
                        return;
                    }

                    var wait = waitSpacing > waitWindow ? waitSpacing : waitWindow;
                    await Task.Delay(wait, ct).ConfigureAwait(false);
                }
            }
            finally
            {
                bucket.Gate.Release();
            }
        }

        /// <summary>
        /// Non-blocking: kiểm tra ngay có slot không. Nếu không, trả về retryAfter gợi ý.
        /// Hữu ích khi muốn trả 429 + Retry-After thay vì chờ.
        /// </summary>
        public bool TryAcquire(string endpointKey, out TimeSpan retryAfter)
        {
            retryAfter = TimeSpan.Zero;
            var bucket = _buckets.GetOrAdd(endpointKey, _ => new Bucket());

            bucket.Gate.Wait(); // serialize ngắn hạn
            try
            {
                var now = DateTimeOffset.UtcNow;

                // spacing
                var sinceLast = now - bucket.LastHitUtc;
                var waitSpacing = sinceLast >= _minSpacing ? TimeSpan.Zero : (_minSpacing - sinceLast);

                // window (60s)
                PruneOldHits(bucket, now);
                var waitWindow = TimeSpan.Zero;
                if (bucket.Hits.Count >= _maxPerMinute && bucket.Hits.TryPeek(out var oldest))
                {
                    var until = Window - (now - oldest);
                    if (until > TimeSpan.Zero) waitWindow = until;
                }

                if (waitSpacing > TimeSpan.Zero || waitWindow > TimeSpan.Zero)
                {
                    var wait = waitSpacing > waitWindow ? waitSpacing : waitWindow;
                    var secs = (int)Math.Ceiling(wait.TotalSeconds);
                    if (secs < 1) secs = 1;
                    retryAfter = TimeSpan.FromSeconds(secs);
                    return false;
                }

                // OK – cấp slot
                var stamp = DateTimeOffset.UtcNow;
                bucket.LastHitUtc = stamp;
                bucket.Hits.Enqueue(stamp);
                return true;
            }
            finally
            {
                bucket.Gate.Release();
            }
        }

        /// <summary>
        /// Cho biết thời điểm sớm nhất dự kiến có thể gọi tiếp (không ghi nhận lượt).
        /// </summary>
        public TimeSpan TryGetNextAvailable(string endpointKey)
        {
            var bucket = _buckets.GetOrAdd(endpointKey, _ => new Bucket());
            if (!bucket.Gate.Wait(0))
                return TimeSpan.FromSeconds(1); // đang bận, ước lượng an toàn

            try
            {
                var now = DateTimeOffset.UtcNow;
                var sinceLast = now - bucket.LastHitUtc;
                var waitSpacing = sinceLast >= _minSpacing ? TimeSpan.Zero : (_minSpacing - sinceLast);

                PruneOldHits(bucket, now);
                var waitWindow = TimeSpan.Zero;
                if (bucket.Hits.Count >= _maxPerMinute && bucket.Hits.TryPeek(out var oldest))
                {
                    var until = Window - (now - oldest);
                    if (until > TimeSpan.Zero) waitWindow = until;
                }

                return waitSpacing > waitWindow ? waitSpacing : waitWindow;
            }
            finally
            {
                bucket.Gate.Release();
            }
        }

        /// <summary>
        /// API tương thích với code hiện tại: chờ slot rồi trả về IDisposable rỗng để dùng với from 'using'.
        /// Ví dụ:
        /// using (await _limiter.AcquireAsync("LT:location-readings", ct)) { /* call HTTP */ }
        /// </summary>
        public async Task<IDisposable> AcquireAsync(string endpointKey, CancellationToken ct = default)
        {
            await WaitForSlotAsync(endpointKey, ct);
            return NoopDisposable.Instance; // không cần giữ lock sau khi đã cấp slot
        }

        /// <summary>Tra cứu thời điểm gọi được tiếp theo và số lượt còn lại trong 60s.</summary>
        public (DateTimeOffset nextAllowedUtc, int remainingInMinute) Inspect(string endpointKey)
        {
            var bucket = _buckets.GetOrAdd(endpointKey, _ => new Bucket());
            if (!bucket.Gate.Wait(0))
                return (DateTimeOffset.UtcNow.AddSeconds(1), Math.Max(0, _maxPerMinute - bucket.Hits.Count));

            try
            {
                var now = DateTimeOffset.UtcNow;

                // spacing
                var next1 = bucket.LastHitUtc + _minSpacing;

                // window
                PruneOldHits(bucket, now);
                var remaining = Math.Max(0, _maxPerMinute - bucket.Hits.Count);
                DateTimeOffset next2 = now;
                if (bucket.Hits.Count >= _maxPerMinute && bucket.Hits.TryPeek(out var oldest))
                    next2 = oldest + Window;

                var next = next1 > next2 ? next1 : next2;
                if (next < now) next = now;

                return (next, remaining);
            }
            finally
            {
                bucket.Gate.Release();
            }
        }

        /// <summary>Snapshot trạng thái tất cả key.</summary>
        public IReadOnlyDictionary<string, (DateTimeOffset nextAllowedUtc, int remainingInMinute)> Snapshot()
        {
            var now = DateTimeOffset.UtcNow;
            var dict = new Dictionary<string, (DateTimeOffset, int)>();
            foreach (var kv in _buckets.Keys)
            {
                dict[kv] = Inspect(kv);
            }
            return dict;
        }
    }
}

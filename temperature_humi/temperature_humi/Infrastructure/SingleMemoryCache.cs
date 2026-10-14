using System.Collections.Concurrent;

namespace temperature_humi.Infrastructure
{
    /// <summary>
    /// Cache memory TTL đơn giản (in-memory, per-process).
    /// Không phù hợp cho scale-out, nếu nhiều instance nên dùng Redis.
    /// </summary>
    public class SimpleMemoryCache
    {
        private sealed class Entry
        {
            public object Value { get; init; } = default!;
            public DateTimeOffset Expiry { get; init; }
        }

        private readonly ConcurrentDictionary<string, Entry> _cache = new();

        /// <summary>
        /// Lấy giá trị từ cache, kiểm tra hết hạn.
        /// </summary>
        public bool TryGet<T>(string key, out T? value)
        {
            value = default;
            if (_cache.TryGetValue(key, out var entry))
            {
                if (entry.Expiry > DateTimeOffset.UtcNow)
                {
                    value = (T)entry.Value;
                    return true;
                }
                else
                {
                    // hết hạn thì xoá
                    _cache.TryRemove(key, out _);
                }
            }
            return false;
        }

        /// <summary>
        /// Đặt giá trị vào cache với TTL.
        /// </summary>
        public void Set<T>(string key, T value, TimeSpan ttl)
        {
            var e = new Entry
            {
                Value = value!,
                Expiry = DateTimeOffset.UtcNow.Add(ttl)
            };
            _cache[key] = e;
        }

        /// <summary>
        /// Xoá 1 key.
        /// </summary>
        public bool Remove(string key)
            => _cache.TryRemove(key, out _);

        /// <summary>
        /// Xoá toàn bộ cache.
        /// </summary>
        public void Clear() => _cache.Clear();
    }
}
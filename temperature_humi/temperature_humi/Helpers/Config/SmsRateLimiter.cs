using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using temperature_humi.Helpers.Config;

public interface ISmsRateLimiter
{
    // API mới: reserve trước, commit khi FPT thành công, release khi gửi thất bại rõ ràng.
    bool TryReserve(
        string phone,
        string eventType,
        DateTime nowUtc,
        out string? reason,
        out TimeSpan? retryAfter);

    void Commit(string phone, string eventType, DateTime sentAtUtc);
    void Release(string phone, string eventType, DateTime nowUtc);

    // API cũ giữ tương thích. Nó reserve + commit ngay, chỉ nên dùng cho code legacy.
    bool ShouldAllow(
        string phone,
        string eventType,
        DateTime nowUtc,
        out string? reason,
        out TimeSpan? retryAfter);
}

public class SmsRateLimiter : ISmsRateLimiter
{
    private readonly IMemoryCache _cache;
    private readonly SmsEventOptions _opt;

    private sealed class Counter
    {
        public object Gate { get; } = new();
        public DateTime HourKey { get; set; }
        public DateTime DayKey { get; set; }
        public int HourSent { get; set; }
        public int DaySent { get; set; }
        public int Pending { get; set; }
        public DateTime? LastSentUtc { get; set; }
    }

    public SmsRateLimiter(IMemoryCache cache, IOptions<SmsEventOptions> opt)
    {
        _cache = cache;
        _opt = opt.Value;
    }

    public bool TryReserve(
        string phone,
        string eventType,
        DateTime nowUtc,
        out string? reason,
        out TimeSpan? retryAfter)
    {
        reason = null;
        retryAfter = null;

        if (!_opt.Enable)
        {
            reason = "disabled";
            return false;
        }

        nowUtc = EnsureUtc(nowUtc);
        var counter = GetCounter(phone, eventType, nowUtc);

        lock (counter.Gate)
        {
            ResetWindows(counter, nowUtc);

            // Không cho 2 request cùng phone+eventType chạy song song.
            if (counter.Pending > 0)
            {
                reason = "inflight";
                retryAfter = TimeSpan.FromSeconds(1);
                return false;
            }

            var minGap = TimeSpan.FromSeconds(Math.Max(0, _opt.MinGapSeconds));
            if (minGap > TimeSpan.Zero && counter.LastSentUtc.HasValue)
            {
                var diff = nowUtc - counter.LastSentUtc.Value;
                if (diff < minGap)
                {
                    retryAfter = minGap - diff;
                    reason = "min_gap";
                    return false;
                }
            }

            if (_opt.MaxPerHour > 0 && counter.HourSent + counter.Pending >= _opt.MaxPerHour)
            {
                reason = "hour_quota";
                return false;
            }

            if (_opt.MaxPerDay > 0 && counter.DaySent + counter.Pending >= _opt.MaxPerDay)
            {
                reason = "day_quota";
                return false;
            }

            counter.Pending++;
            return true;
        }
    }

    public void Commit(string phone, string eventType, DateTime sentAtUtc)
    {
        sentAtUtc = EnsureUtc(sentAtUtc);
        var counter = GetCounter(phone, eventType, sentAtUtc);

        lock (counter.Gate)
        {
            ResetWindows(counter, sentAtUtc);
            if (counter.Pending > 0)
                counter.Pending--;

            counter.HourSent++;
            counter.DaySent++;
            counter.LastSentUtc = sentAtUtc;
        }
    }

    public void Release(string phone, string eventType, DateTime nowUtc)
    {
        nowUtc = EnsureUtc(nowUtc);
        var counter = GetCounter(phone, eventType, nowUtc);

        lock (counter.Gate)
        {
            ResetWindows(counter, nowUtc);
            if (counter.Pending > 0)
                counter.Pending--;
        }
    }

    public bool ShouldAllow(
        string phone,
        string eventType,
        DateTime nowUtc,
        out string? reason,
        out TimeSpan? retryAfter)
    {
        var allowed = TryReserve(phone, eventType, nowUtc, out reason, out retryAfter);
        if (allowed)
            Commit(phone, eventType, nowUtc);
        return allowed;
    }

    private Counter GetCounter(string phone, string eventType, DateTime nowUtc)
    {
        var key = $"smsrate|{phone}|{eventType}";
        var hourKey = HourKey(nowUtc);
        var dayKey = DayKey(nowUtc);

        return _cache.GetOrCreate(key, entry =>
        {
            entry.SlidingExpiration = TimeSpan.FromDays(2);
            return new Counter
            {
                HourKey = hourKey,
                DayKey = dayKey
            };
        })!;
    }

    private static void ResetWindows(Counter counter, DateTime nowUtc)
    {
        var hourKey = HourKey(nowUtc);
        var dayKey = DayKey(nowUtc);

        if (counter.HourKey != hourKey)
        {
            counter.HourKey = hourKey;
            counter.HourSent = 0;
        }

        if (counter.DayKey != dayKey)
        {
            counter.DayKey = dayKey;
            counter.DaySent = 0;
        }
    }

    private static DateTime HourKey(DateTime utc)
        => new(utc.Year, utc.Month, utc.Day, utc.Hour, 0, 0, DateTimeKind.Utc);

    private static DateTime DayKey(DateTime utc)
        => new(utc.Year, utc.Month, utc.Day, 0, 0, 0, DateTimeKind.Utc);

    private static DateTime EnsureUtc(DateTime value)
    {
        if (value.Kind == DateTimeKind.Utc)
            return value;
        if (value.Kind == DateTimeKind.Unspecified)
            return DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return value.ToUniversalTime();
    }
}

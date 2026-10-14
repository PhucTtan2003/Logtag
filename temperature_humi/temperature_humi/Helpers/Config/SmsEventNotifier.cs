using Microsoft.Extensions.Options;
using MongoDB.Bson;
using System.Runtime.CompilerServices;
using temperature_humi.Helpers.Config;
using temperature_humi.Models.SmsFpt;
using temperature_humi.Service;

public interface ISmsEventNotifier
{
    // Legacy APIs giữ để code cũ không vỡ.
    Task NotifyAsync(
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        CancellationToken ct);

    Task NotifyLt5TemperatureAsync(
        IEnumerable<string> phones,
        string serialNumber,
        double? temperature,
        double? threshold,
        string? brandName,
        CancellationToken ct);

    Task NotifyAsync(
        ObjectId userId,
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        CancellationToken ct);

    Task NotifyLt5TemperatureAsync(
        ObjectId userId,
        IEnumerable<string> phones,
        string serialNumber,
        double? temperature,
        double? threshold,
        string? brandName,
        CancellationToken ct);

    // API mới cho EventService: dùng eventTimeUtc thật để tạo idempotency key ổn định.
    Task NotifyEventAsync(
        ObjectId userId,
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        string serialNumber,
        DateTime eventTimeUtc,
        CancellationToken ct);
}

public class SmsEventNotifier : ISmsEventNotifier
{
    private readonly IFptSmsService _fpt;
    private readonly ISmsRateLimiter _rl;
    private readonly SmsQuotaService _quota;
    private readonly SmsDispatchService _dispatch;
    private readonly SmsEventOptions _opt;
    private readonly FptSmsOptions _fptOpt;
    private readonly ILogger<SmsEventNotifier>? _log;

    public SmsEventNotifier(
        IFptSmsService fpt,
        ISmsRateLimiter rl,
        SmsQuotaService quota,
        SmsDispatchService dispatch,
        IOptions<SmsEventOptions> opt,
        IOptions<FptSmsOptions> fptOpt,
        ILogger<SmsEventNotifier>? log = null)
    {
        _fpt = fpt;
        _rl = rl;
        _quota = quota;
        _dispatch = dispatch;
        _opt = opt.Value;
        _fptOpt = fptOpt.Value;
        _log = log;
    }

    private static string NormalizePhone(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return string.Empty;

        raw = raw.Trim();

        if (raw.StartsWith("+84", StringComparison.Ordinal))
            raw = "0" + raw[3..];
        else if (raw.StartsWith("84", StringComparison.Ordinal) && raw.Length >= 11)
            raw = "0" + raw[2..];

        return new string(raw.Where(char.IsDigit).ToArray());
    }

    public Task NotifyAsync(
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        CancellationToken ct)
    {
        return NotifyInternalAsync(
            userId: null,
            phones,
            message,
            eventType,
            brandName,
            serialNumber: null,
            eventTimeUtc: null,
            idempotencySeed: null,
            ct);
    }

    public Task NotifyAsync(
        ObjectId userId,
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        CancellationToken ct)
    {
        return NotifyInternalAsync(
            userId,
            phones,
            message,
            eventType,
            brandName,
            serialNumber: null,
            eventTimeUtc: null,
            idempotencySeed: null,
            ct);
    }

    public Task NotifyEventAsync(
        ObjectId userId,
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        string serialNumber,
        DateTime eventTimeUtc,
        CancellationToken ct)
    {
        var eventUtc = EnsureUtc(eventTimeUtc);
        var seed = $"event|{serialNumber.Trim().ToUpperInvariant()}|{eventType.Trim().ToLowerInvariant()}|{eventUtc:O}";

        return NotifyInternalAsync(
            userId,
            phones,
            message,
            eventType,
            brandName,
            serialNumber,
            eventUtc,
            seed,
            ct);
    }

    public Task NotifyLt5TemperatureAsync(
        IEnumerable<string> phones,
        string serialNumber,
        double? temperature,
        double? threshold,
        string? brandName,
        CancellationToken ct)
    {
        return NotifyLt5TemperatureInternalAsync(
            userId: null,
            phones,
            serialNumber,
            temperature,
            threshold,
            brandName,
            eventTimeUtc: null,
            ct);
    }

    public Task NotifyLt5TemperatureAsync(
        ObjectId userId,
        IEnumerable<string> phones,
        string serialNumber,
        double? temperature,
        double? threshold,
        string? brandName,
        CancellationToken ct)
    {
        return NotifyLt5TemperatureInternalAsync(
            userId,
            phones,
            serialNumber,
            temperature,
            threshold,
            brandName,
            eventTimeUtc: null,
            ct);
    }

    private Task NotifyLt5TemperatureInternalAsync(
        ObjectId? userId,
        IEnumerable<string> phones,
        string serialNumber,
        double? temperature,
        double? threshold,
        string? brandName,
        DateTime? eventTimeUtc,
        CancellationToken ct)
    {
        const string eventType = "lt5_temperature_alarm";
        var tempTxt = temperature?.ToString("0.##") ?? "?";
        var thrTxt = threshold?.ToString("0.##") ?? "?";
        var message = $"[{serialNumber}] Nhiệt độ vượt ngưỡng: {tempTxt}°C (ngưỡng {thrTxt}°C)";

        return NotifyInternalAsync(
            userId,
            phones,
            message,
            eventType,
            brandName,
            serialNumber,
            eventTimeUtc,
            idempotencySeed: null,
            ct);
    }

    private async Task NotifyInternalAsync(
        ObjectId? userId,
        IEnumerable<string> phones,
        string message,
        string eventType,
        string? brandName,
        string? serialNumber,
        DateTime? eventTimeUtc,
        string? idempotencySeed,
        CancellationToken ct,
        [CallerMemberName] string caller = "",
        [CallerFilePath] string file = "",
        [CallerLineNumber] int line = 0)
    {
        if (!_opt.Enable)
        {
            _log?.LogWarning(
                "[SMS] Disabled by config (caller={Caller}, file={File}, line={Line})",
                caller,
                file,
                line);
            return;
        }

        if (_opt.AllowedTypes?.Length > 0
            && !_opt.AllowedTypes.Contains(eventType, StringComparer.OrdinalIgnoreCase))
        {
            _log?.LogInformation(
                "[SMS] EventType {Type} not allowed by config (caller={Caller})",
                eventType,
                caller);
            return;
        }

        var normalizedPhones = (phones ?? Array.Empty<string>())
            .Select(NormalizePhone)
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (normalizedPhones.Count == 0)
        {
            _log?.LogWarning("[SMS] No valid phone to send. type={Type}", eventType);
            return;
        }

        foreach (var phone in normalizedPhones)
        {
            ct.ThrowIfCancellationRequested();
            var now = DateTime.UtcNow;

            if (!_rl.TryReserve(phone, eventType, now, out var rateReason, out var retryAfter))
            {
                if (retryAfter.HasValue)
                {
                    _log?.LogWarning(
                        "[SMS-RATE] BLOCKED phone={Phone}, type={Type}, reason={Reason}, retry_after={Seconds}s",
                        phone,
                        eventType,
                        rateReason,
                        (int)Math.Ceiling(retryAfter.Value.TotalSeconds));
                }
                else
                {
                    _log?.LogWarning(
                        "[SMS-RATE] BLOCKED phone={Phone}, type={Type}, reason={Reason}",
                        phone,
                        eventType,
                        rateReason);
                }

                continue;
            }

            SmsDispatchBeginResult begin;
            try
            {
                begin = await _dispatch.TryBeginAsync(
                    userId,
                    phone,
                    eventType,
                    serialNumber,
                    eventTimeUtc,
                    message,
                    idempotencySeed,
                    ct);
            }
            catch
            {
                _rl.Release(phone, eventType, DateTime.UtcNow);
                throw;
            }

            if (!begin.Created)
            {
                _rl.Release(phone, eventType, DateTime.UtcNow);
                _log?.LogInformation(
                    "[SMS-IDEMPOTENCY] SKIP duplicate phone={Phone}, type={Type}, status={Status}, key={Key}",
                    phone,
                    eventType,
                    begin.Dispatch.Status,
                    begin.Dispatch.IdempotencyKey);
                continue;
            }

            var quotaReserved = false;

            try
            {
                if (userId.HasValue && userId.Value != ObjectId.Empty)
                {
                    var quota = await _quota.TryReserveAsync(
                        userId.Value,
                        1,
                        eventType,
                        serialNumber,
                        ct);

                    if (!quota.Allowed)
                    {
                        _rl.Release(phone, eventType, DateTime.UtcNow);
                        await _dispatch.CancelBeforeSendAsync(begin.Dispatch.IdempotencyKey, ct);

                        _log?.LogWarning(
                            "[SMS-QUOTA] BLOCKED userId={UserId}, phone={Phone}, type={Type}, reason={Reason}, remaining={Remaining}, total={Total}",
                            userId.Value,
                            phone,
                            eventType,
                            quota.Reason,
                            quota.State.SmsRemaining,
                            quota.State.SmsQuotaTotal);
                        continue;
                    }

                    quotaReserved = quota.Reason == "reserved";
                }
                else
                {
                    _log?.LogWarning(
                        "[SMS-QUOTA] userId missing. SMS will be sent but account quota will NOT be checked. caller={Caller}, type={Type}",
                        caller,
                        eventType);
                }

                var brand = string.IsNullOrWhiteSpace(brandName)
                    ? _fptOpt.DefaultBrandName
                    : brandName!;

                _log?.LogInformation(
                    "[SMS] Sending phone={Phone}, brand={Brand}, type={Type}, key={Key}, session={Session}",
                    phone,
                    brand,
                    eventType,
                    begin.Dispatch.IdempotencyKey,
                    begin.Dispatch.SessionId);

                var response = await SendWithControlledRetryAsync(
                    begin.Dispatch,
                    brand,
                    phone,
                    message,
                    ct);

                await _dispatch.MarkSentAsync(
                    begin.Dispatch.IdempotencyKey,
                    response,
                    ct);

                _rl.Commit(phone, eventType, DateTime.UtcNow);

                if (userId.HasValue && userId.Value != ObjectId.Empty)
                {
                    var state = await _quota.MarkSentAsync(userId.Value, ct);
                    if (state?.LowQuotaJustReached == true)
                    {
                        _log?.LogWarning(
                            "[SMS-QUOTA] LOW WARNING userId={UserId}, remaining={Remaining}, total={Total}, warnAt={WarnAt}",
                            userId.Value,
                            state.SmsRemaining,
                            state.SmsQuotaTotal,
                            state.SmsWarnAtRemaining);
                    }
                }

                _log?.LogInformation(
                    "[SMS] OK phone={Phone}, type={Type}, key={Key}",
                    phone,
                    eventType,
                    begin.Dispatch.IdempotencyKey);
            }
            catch (FptSmsException ex)
            {
                await HandleSendFailureAsync(
                    begin.Dispatch,
                    userId,
                    quotaReserved,
                    phone,
                    eventType,
                    ex.IsAmbiguous,
                    ex.Message,
                    ex.ResponseBody,
                    ct);

                _log?.LogError(
                    ex,
                    "[SMS] FAILED phone={Phone}, type={Type}, ambiguous={Ambiguous}, stage={Stage}, key={Key}, caller={Caller}, file={File}, line={Line}",
                    phone,
                    eventType,
                    ex.IsAmbiguous,
                    ex.Stage,
                    begin.Dispatch.IdempotencyKey,
                    caller,
                    file,
                    line);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Không biết request đã tới FPT hay chưa => xem là unknown, không gửi lại tự động.
                await HandleSendFailureAsync(
                    begin.Dispatch,
                    userId,
                    quotaReserved,
                    phone,
                    eventType,
                    ambiguous: true,
                    error: "Operation canceled while SMS dispatch was in progress.",
                    providerResponse: null,
                    CancellationToken.None);
                throw;
            }
            catch (Exception ex)
            {
                // Lỗi không phân loại được: ưu tiên chống duplicate.
                await HandleSendFailureAsync(
                    begin.Dispatch,
                    userId,
                    quotaReserved,
                    phone,
                    eventType,
                    ambiguous: true,
                    error: ex.Message,
                    providerResponse: null,
                    CancellationToken.None);

                _log?.LogError(
                    ex,
                    "[SMS] UNKNOWN FAILURE phone={Phone}, type={Type}, key={Key}",
                    phone,
                    eventType,
                    begin.Dispatch.IdempotencyKey);
            }
        }
    }

    private async Task<object> SendWithControlledRetryAsync(
        SmsDispatch dispatch,
        string brand,
        string phone,
        string message,
        CancellationToken ct)
    {
        var maxAttempts = Math.Clamp(_fptOpt.SendMaxAttempts, 1, 5);
        var baseDelay = Math.Max(1, _fptOpt.RetryBaseDelaySeconds);
        var maxDelay = Math.Max(baseDelay, _fptOpt.RetryMaxDelaySeconds);

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            await _dispatch.MarkAttemptAsync(dispatch.IdempotencyKey, ct);

            try
            {
                return await _fpt.SendDomesticAsync(
                    brand,
                    phone,
                    message,
                    dispatch.SessionId,
                    ct);
            }
            catch (FptSmsException ex) when (ShouldRetry(ex, attempt, maxAttempts))
            {
                var delaySeconds = Math.Min(
                    maxDelay,
                    baseDelay * (int)Math.Pow(2, attempt - 1));

                _log?.LogWarning(
                    "[SMS-RETRY] attempt={Attempt}/{Max}, delay={Delay}s, phone={Phone}, status={Status}, stage={Stage}, key={Key}",
                    attempt,
                    maxAttempts,
                    delaySeconds,
                    phone,
                    ex.StatusCode,
                    ex.Stage,
                    dispatch.IdempotencyKey);

                await Task.Delay(TimeSpan.FromSeconds(delaySeconds), ct);
            }
        }

        throw new InvalidOperationException("SMS retry loop ended unexpectedly.");
    }

    private static bool ShouldRetry(FptSmsException ex, int attempt, int maxAttempts)
    {
        if (attempt >= maxAttempts)
            return false;

        if (ex.IsAmbiguous)
            return false;

        if (!ex.IsRetryable)
            return false;

        // Token-stage lỗi tạm thời có thể retry an toàn vì SMS chưa được gửi.
        if (string.Equals(ex.Stage, "token", StringComparison.OrdinalIgnoreCase))
            return true;

        // Send-stage chỉ retry khi server trả 408/429 rõ ràng.
        var code = (int?)ex.StatusCode;
        return code is 408 or 429;
    }

    private async Task HandleSendFailureAsync(
        SmsDispatch dispatch,
        ObjectId? userId,
        bool quotaReserved,
        string phone,
        string eventType,
        bool ambiguous,
        string? error,
        string? providerResponse,
        CancellationToken ct)
    {
        await _dispatch.MarkFailedAsync(
            dispatch.IdempotencyKey,
            ambiguous,
            error,
            providerResponse,
            ct);

        if (ambiguous)
        {
            // Có khả năng FPT đã nhận SMS. Giữ quota + cooldown để không phát sinh duplicate.
            _rl.Commit(phone, eventType, DateTime.UtcNow);
            return;
        }

        _rl.Release(phone, eventType, DateTime.UtcNow);

        if (quotaReserved && userId.HasValue && userId.Value != ObjectId.Empty)
            await _quota.ReleaseAsync(userId.Value, 1, ct);
    }

    private static DateTime EnsureUtc(DateTime value)
    {
        if (value.Kind == DateTimeKind.Utc)
            return value;
        if (value.Kind == DateTimeKind.Unspecified)
            return DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return value.ToUniversalTime();
    }
}

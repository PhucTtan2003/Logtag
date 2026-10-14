using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Models.SmsFpt;

namespace temperature_humi.Service.Admin
{
    public class FptSmsService : IFptSmsService
    {
        private const string CacheKey = "FPT_SMS_TOKEN";
        private const string StageToken = "token";
        private const string StageSend = "send";

        private readonly HttpClient _http;
        private readonly IMemoryCache _cache;
        private readonly FptSmsOptions _opt;

        private static readonly JsonSerializerOptions JsonOpts =
            new(JsonSerializerDefaults.Web);

        private static readonly JsonSerializerOptions NoCase = new()
        {
            PropertyNamingPolicy = null
        };

        public FptSmsService(
            HttpClient http,
            IMemoryCache cache,
            IOptions<FptSmsOptions> opt)
        {
            _http = http;
            _cache = cache;
            _opt = opt.Value;
        }

        private static bool IsRetryableStatus(HttpStatusCode statusCode)
        {
            var code = (int)statusCode;

            return statusCode == HttpStatusCode.RequestTimeout
                   || code == 429
                   || code >= 500;
        }

        private static bool IsAmbiguousSendStatus(HttpStatusCode statusCode)
        {
            // 5xx có thể xảy ra sau khi request đã tới hệ thống upstream.
            // Để tránh gửi trùng SMS, xem đây là trạng thái mơ hồ
            // và không auto-retry ở tầng notifier.
            return (int)statusCode >= 500;
        }

        private async Task<T> PostJsonAndReadAsync<T>(
            string url,
            object payload,
            string stage,
            CancellationToken ct)
        {
            try
            {
                using var content =
                    JsonContent.Create(payload, options: NoCase);

                using var res =
                    await _http.PostAsync(url, content, ct);

                var text =
                    await res.Content.ReadAsStringAsync(ct);

                if (!res.IsSuccessStatusCode)
                {
                    var ambiguous =
                        stage == StageSend
                        && IsAmbiguousSendStatus(res.StatusCode);

                    throw new FptSmsException(
                        $"FPT {(int)res.StatusCode} {res.StatusCode}: {text}",
                        res.StatusCode,
                        isRetryable: IsRetryableStatus(res.StatusCode),
                        isAmbiguous: ambiguous,
                        stage: stage,
                        responseBody: text);
                }

                if (typeof(T) == typeof(string))
                    return (T)(object)text;

                try
                {
                    var obj =
                        JsonSerializer.Deserialize<T>(text, JsonOpts);

                    if (obj == null)
                        throw new JsonException("Empty JSON response.");

                    return obj;
                }
                catch (Exception ex)
                    when (ex is JsonException or NotSupportedException)
                {
                    // Nếu FPT đã trả 2xx nhưng parse response lỗi,
                    // request gửi SMS có thể đã được FPT nhận.
                    throw new FptSmsException(
                        $"FPT response deserialize error: {ex.Message}",
                        res.StatusCode,
                        isRetryable: false,
                        isAmbiguous: stage == StageSend,
                        stage: stage,
                        responseBody: text,
                        innerException: ex);
                }
            }
            catch (OperationCanceledException ex)
                when (!ct.IsCancellationRequested)
            {
                var ambiguous = stage == StageSend;

                throw new FptSmsException(
                    $"FPT request timeout during {stage}.",
                    statusCode: null,
                    isRetryable: !ambiguous,
                    isAmbiguous: ambiguous,
                    stage: stage,
                    responseBody: null,
                    innerException: ex);
            }
            catch (HttpRequestException ex)
            {
                var ambiguous = stage == StageSend;

                throw new FptSmsException(
                    $"FPT network error during {stage}: {ex.Message}",
                    statusCode: ex.StatusCode,
                    isRetryable: !ambiguous,
                    isAmbiguous: ambiguous,
                    stage: stage,
                    responseBody: null,
                    innerException: ex);
            }
        }

        private async Task<byte[]> PostJsonAndReadBytesAsync(
            string url,
            object payload,
            CancellationToken ct)
        {
            try
            {
                using var content =
                    JsonContent.Create(payload, options: NoCase);

                using var res =
                    await _http.PostAsync(url, content, ct);

                var bytes =
                    await res.Content.ReadAsByteArrayAsync(ct);

                if (!res.IsSuccessStatusCode)
                {
                    var text = Encoding.UTF8.GetString(bytes);

                    throw new FptSmsException(
                        $"FPT {(int)res.StatusCode} {res.StatusCode}: {text}",
                        res.StatusCode,
                        isRetryable: IsRetryableStatus(res.StatusCode),
                        isAmbiguous: false,
                        stage: "ads",
                        responseBody: text);
                }

                return bytes;
            }
            catch (OperationCanceledException ex)
                when (!ct.IsCancellationRequested)
            {
                throw new FptSmsException(
                    "FPT request timeout.",
                    statusCode: null,
                    isRetryable: true,
                    isAmbiguous: false,
                    stage: "ads",
                    responseBody: null,
                    innerException: ex);
            }
            catch (HttpRequestException ex)
            {
                throw new FptSmsException(
                    $"FPT network error: {ex.Message}",
                    statusCode: ex.StatusCode,
                    isRetryable: true,
                    isAmbiguous: false,
                    stage: "ads",
                    responseBody: null,
                    innerException: ex);
            }
        }

        public async Task<string> GetTokenAsync(
            CancellationToken ct = default)
        {
            if (_cache.TryGetValue(
                    CacheKey,
                    out string? cachedToken)
                && !string.IsNullOrWhiteSpace(cachedToken))
            {
                return cachedToken;
            }

            var body = new
            {
                client_id = _opt.ClientId,
                client_secret = _opt.ClientSecret,
                scope = _opt.Scope,
                session_id = Guid.NewGuid().ToString("N"),
                grant_type = "client_credentials"
            };

            var url =
                Combine(_opt.BaseUrl, "/oauth2/token");

            var json =
                await PostJsonAndReadAsync<TokenResp>(
                    url,
                    body,
                    StageToken,
                    ct);

            if (string.IsNullOrWhiteSpace(json.access_token))
            {
                throw new FptSmsException(
                    "FPT token response does not contain access_token.",
                    HttpStatusCode.OK,
                    isRetryable: false,
                    isAmbiguous: false,
                    stage: StageToken);
            }

            var ttlSeconds =
                Math.Max(json.expires_in - 300, 60);

            _cache.Set(
                CacheKey,
                json.access_token,
                TimeSpan.FromSeconds(ttlSeconds));

            return json.access_token;
        }

        // ============================================================
        // DOMESTIC SMS
        // ============================================================

        // Hàm cũ: giữ compatibility với các chỗ đang gọi 4 tham số.
        public Task<object> SendDomesticAsync(
            string brandName,
            string phone,
            string plainTextMessage,
            CancellationToken ct = default)
        {
            return SendDomesticAsync(
                brandName,
                phone,
                plainTextMessage,
                Guid.NewGuid().ToString("N"),
                ct);
        }

        // Hàm mới: cho phép truyền sessionId ổn định từ SmsDispatch
        // để dùng cùng một session_id khi retry cùng một dispatch.
        public async Task<object> SendDomesticAsync(
            string brandName,
            string phone,
            string plainTextMessage,
            string sessionId,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(phone))
            {
                throw new ArgumentException(
                    "Phone is empty before calling FPT",
                    nameof(phone));
            }

            if (string.IsNullOrWhiteSpace(plainTextMessage))
            {
                throw new ArgumentException(
                    "Message is empty before calling FPT",
                    nameof(plainTextMessage));
            }

            sessionId = NormalizeSessionId(sessionId);

            async Task<object> SendOnceAsync(string token)
            {
                var payload = new
                {
                    access_token = token,
                    session_id = sessionId,
                    BrandName = brandName,
                    Phone = phone,
                    Message = Convert.ToBase64String(
                        Encoding.UTF8.GetBytes(plainTextMessage))
                };

                var url =
                    Combine(
                        _opt.BaseUrl,
                        "/api/push-brandname-otp");

                return await PostJsonAndReadAsync<object>(
                    url,
                    payload,
                    StageSend,
                    ct);
            }

            var token = await GetTokenAsync(ct);

            try
            {
                return await SendOnceAsync(token);
            }
            catch (FptSmsException ex)
                when (ex.StatusCode == HttpStatusCode.Unauthorized)
            {
                // Token hết hạn / không hợp lệ:
                // xóa cache và thử lại đúng 1 lần,
                // vẫn giữ nguyên session_id.
                _cache.Remove(CacheKey);

                token = await GetTokenAsync(ct);

                return await SendOnceAsync(token);
            }
        }

        public async Task<object> SendInternationalAsync(
            string brandName,
            string phoneIntl,
            string plainTextMessage,
            CancellationToken ct = default)
        {
            var token = await GetTokenAsync(ct);

            var payload = new
            {
                access_token = token,
                session_id = Guid.NewGuid().ToString("N"),
                BrandName = brandName,
                Phone = phoneIntl,
                Message = Convert.ToBase64String(
                    Encoding.UTF8.GetBytes(plainTextMessage))
            };

            var url =
                Combine(
                    _opt.BaseUrl,
                    "/api/push-brandname-international");

            return await PostJsonAndReadAsync<object>(
                url,
                payload,
                StageSend,
                ct);
        }

        public async Task<string> CreateCampaignAsync(
            string campaignName,
            string brandName,
            string message,
            DateTime scheduleTime,
            int quota,
            CancellationToken ct = default)
        {
            var token = await GetTokenAsync(ct);

            var payload = new
            {
                access_token = token,
                session_id = Guid.NewGuid().ToString("N"),
                CampaignName = campaignName,
                BrandName = brandName,
                Message = message,
                ScheduleTime =
                    scheduleTime.ToString("yyyy-MM-dd HH:mm"),
                Quota = quota
            };

            var url =
                Combine(
                    _opt.BaseUrl,
                    "/api/create-campaign");

            var data =
                await PostJsonAndReadAsync<CreateCampaignResp>(
                    url,
                    payload,
                    "ads",
                    ct);

            return data.CampaignCode;
        }

        public async Task<object> PushAdsAsync(
            string campaignCode,
            IEnumerable<string> phoneList,
            CancellationToken ct = default)
        {
            var token = await GetTokenAsync(ct);

            var payload = new
            {
                access_token = token,
                session_id = Guid.NewGuid().ToString("N"),
                CampaignCode = campaignCode,
                PhoneList = string.Join(",", phoneList)
            };

            var url =
                Combine(
                    _opt.BaseUrl,
                    "/api/push-brandname-ads");

            return await PostJsonAndReadAsync<object>(
                url,
                payload,
                "ads",
                ct);
        }

        public async Task<object> GetCampaignDetailAsync(
            string campaignCode,
            CancellationToken ct = default)
        {
            var token = await GetTokenAsync(ct);

            var payload = new
            {
                access_token = token,
                CampaignCode = campaignCode
            };

            var url =
                Combine(
                    _opt.BaseUrl,
                    "/api/detail-ads");

            return await PostJsonAndReadAsync<object>(
                url,
                payload,
                "ads",
                ct);
        }

        public async Task<byte[]> GetAdsDlrCsvAsync(
            string campaignCode,
            CancellationToken ct = default)
        {
            var token = await GetTokenAsync(ct);

            var payload = new
            {
                access_token = token,
                campaign_code = campaignCode
            };

            var url =
                Combine(
                    _opt.BaseUrl,
                    "/api/dlr-ads");

            return await PostJsonAndReadBytesAsync(
                url,
                payload,
                ct);
        }

        public async Task<object> GetAdsRecheckAsync(
            DateOnly from,
            DateOnly to,
            CancellationToken ct = default)
        {
            var token = await GetTokenAsync(ct);

            var payload = new
            {
                access_token = token,
                FromDate = from.ToString("yyyy-MM-dd"),
                ToDate = to.ToString("yyyy-MM-dd")
            };

            var url =
                Combine(
                    _opt.BaseUrl,
                    "/dlr-ads-recheck");

            return await PostJsonAndReadAsync<object>(
                url,
                payload,
                "ads",
                ct);
        }

        private static string NormalizeSessionId(
            string? sessionId)
        {
            if (string.IsNullOrWhiteSpace(sessionId))
                return Guid.NewGuid().ToString("N");

            var cleaned =
                new string(
                    sessionId
                        .Where(char.IsLetterOrDigit)
                        .ToArray());

            if (cleaned.Length == 0)
                return Guid.NewGuid().ToString("N");

            return cleaned.Length <= 32
                ? cleaned
                : cleaned[..32];
        }

        private static string Combine(
            string baseUrl,
            string path)
        {
            return baseUrl.TrimEnd('/') + path;
        }

        private sealed record TokenResp(
            string access_token,
            int expires_in,
            string token_type,
            string scope);

        private sealed record CreateCampaignResp(
            string CampaignCode);
    }
}

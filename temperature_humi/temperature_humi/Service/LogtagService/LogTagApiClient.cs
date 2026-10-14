using Microsoft.Extensions.Options;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using temperature_humi.DTO;
using temperature_humi.Helpers.Config;
using temperature_humi.Infrastructure;
using temperature_humi.Models;
using temperature_humi.Models.LogTag.LT5;

namespace temperature_humi.Service.LogtagService
{
    public class LogTagApiClient
    {
        private readonly IHttpClientFactory _httpClientFactory;
        protected readonly LogTagApiSettings _cfg;
        private readonly EndpointRateLimiter _rateLimiter;
        private readonly SingleFlight _singleFlight;
        private readonly SimpleMemoryCache _cache;

        // cache token trong memory
        private string? _token;
        public long TeamId => _cfg.TeamId;
        private DateTime _tokenExpiryUtc = DateTime.MinValue;

        private static readonly JsonSerializerOptions _jsonInsensitive =
            new() { PropertyNameCaseInsensitive = true };

        private static readonly JsonSerializerOptions _jsonCamel =
            new()
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
            };

        #region ===== DTOs =====
        public record LogTagTeamDto(long id, string name, string userAccountType);

        // Hợp nhất: có Token, ExpiryUtc, Teams (chi tiết) và FromCache
        public record LogTagTokenDto(string Token, DateTime ExpiryUtc, List<LogTagTeamDto> Teams, bool FromCache)
        {
            public List<long> TeamIds => Teams.Select(t => t.id).ToList();
        }

        // File 2
        public record LocationReadingDto(double? temperature, DateTime dateUtc, double? humidity);
        public record LocationReadingsApiResponse(
            List<LocationReadingDto> Data,
            string Status,
            DateTime TimestampUtc
        );
        // Request/Response mới cho Batch API v2:
        // POST /external/locationreadings/v2/{teamId}/batch
        public sealed class LocationReadingsBatchV2Request
        {
            public List<string> serialNumbers { get; set; } = new();
            public DateTime startDateUtc { get; set; }
            public DateTime endDateUtc { get; set; }
        }

        public sealed class LocationReadingsBatchV2Response
        {
            public List<LocationReadingsBatchV2Group> data { get; set; } = new();
            public string? status { get; set; }
            public DateTime? timestampUtc { get; set; }
        }

        public sealed class LocationReadingsBatchV2Group
        {
            public string serialNumber { get; set; } = string.Empty;
            public List<LocationReadingDto> readings { get; set; } = new();
        }

        // ============================================================
        // Readings Webhooks v1 - Management API DTOs
        // Base path: /external/webhooks/readings/v1
        // ============================================================
        public sealed class ReadingsWebhookConfigRequest
        {
            public string targetUrl { get; set; } = string.Empty;
            public bool enabled { get; set; }
            public string? signingSecret { get; set; }
        }

        public sealed class ReadingsWebhookConfigDto
        {
            public long teamId { get; set; }
            public bool enabled { get; set; }
            public string? deliveryStatus { get; set; }
            public string? targetUrl { get; set; }
            public bool signingSecretConfigured { get; set; }
            public int subscriptionCount { get; set; }
            public int consecutiveFailures { get; set; }
            public DateTime? lastAttemptUtc { get; set; }
            public DateTime? lastSentUtc { get; set; }
            public DateTime? suspendedUtc { get; set; }
            public string? lastError { get; set; }
            public DateTime? createdUtc { get; set; }
        }

        public sealed class ReadingsWebhookSubscriptionRequest
        {
            public string serialNumber { get; set; } = string.Empty;
        }

        public sealed class ReadingsWebhookSubscriptionDto
        {
            public string serialNumber { get; set; } = string.Empty;
            public string? model { get; set; }
            public long? locationId { get; set; }
            public string? locationName { get; set; }
            public string? subscriptionStatus { get; set; }
        }
        #endregion

        #region ===== Ctor =====
        public LogTagApiClient(
            IHttpClientFactory httpClientFactory,
            IOptions<LogTagApiSettings> options,
            EndpointRateLimiter rateLimiter,
            SingleFlight singleFlight,
            SimpleMemoryCache? cache = null)
        {
            _httpClientFactory = httpClientFactory;
            _cfg = options.Value;
            _rateLimiter = rateLimiter;
            _singleFlight = singleFlight;
            _cache = cache ?? new SimpleMemoryCache();
        }
        #endregion

        #region ===== Helpers =====
        private static string HashString(string s)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
            return Convert.ToHexString(bytes);
        }

        private HttpRequestMessage NewReq(HttpMethod method, string url, string token)
        {
            var req = new HttpRequestMessage(method, url);
            // theo spec: header tên "Access_token"
            req.Headers.Add("Access_token", token);
            return req;
        }

        // OLD:
        // private async Task<HttpResponseMessage> SendWithRetryAsync(HttpRequestMessage req, CancellationToken ct)

        private async Task<HttpResponseMessage> SendWithRetryAsync(
            Func<HttpRequestMessage> makeRequest,
            CancellationToken ct,
            bool retryQuotaErrors = true)
        {
            var http = _httpClientFactory.CreateClient();

            for (int attempt = 1; ; attempt++)
            {
                using var req = makeRequest(); // luôn tạo MỚI request cho mỗi attempt
                using var res = await http.SendAsync(req, ct).ConfigureAwait(false);

                // Trả về bản sao response (để caller tự using), vì 'using var res' sẽ dispose ở cuối vòng
                // Cách đơn giản: buffer lại Content và dựng HttpResponseMessage mới.
                var clone = new HttpResponseMessage(res.StatusCode)
                {
                    ReasonPhrase = res.ReasonPhrase,
                    Version = res.Version,
                    RequestMessage = null // không gắn lại req cũ
                };

                foreach (var h in res.Headers) clone.Headers.TryAddWithoutValidation(h.Key, h.Value);

                var bytes = await res.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
                clone.Content = new ByteArrayContent(bytes);
                foreach (var h in res.Content.Headers) clone.Content.Headers.TryAddWithoutValidation(h.Key, h.Value);

                // 200-299
                if (res.IsSuccessStatusCode) return clone;

                // 401 -> để wrapper refresh token và gọi lại
                if (res.StatusCode == HttpStatusCode.Unauthorized) return clone;

                // 429/503:
                // - Các API thường có thể retry nhẹ.
                // - Riêng Location Readings Batch v2 quota rất chặt 1 request/phút,
                //   nên caller có thể truyền retryQuotaErrors=false để không tự bắn thêm request.
                if (res.StatusCode == (HttpStatusCode)429 || res.StatusCode == HttpStatusCode.ServiceUnavailable)
                {
                    if (!retryQuotaErrors)
                        return clone;

                    var delay = res.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(_cfg.RetryDefaultDelaySecs);
                    if (attempt >= _cfg.RetryMaxAttempts) return clone;
                    await Task.Delay(delay, ct).ConfigureAwait(false);
                    continue;
                }

                // lỗi khác -> trả về luôn
                return clone;
            }
        }


        /// <summary>
        /// RateLimiter → (cache) → SingleFlight → Call (retry 401/429/503) → cache.
        /// </summary>
        private async Task<T> ExecWithPoliciesAsync<T>(
         string limiterKey,
         string cacheKey,
         TimeSpan? ttl,
         Func<string, HttpRequestMessage> makeRequestWithToken,
         Func<string, T> parseBody,
         CancellationToken ct,
         bool retryQuotaErrors = true)
        {
            if (ttl.HasValue && _cache.TryGet(cacheKey, out string cachedRaw))
                return parseBody(cachedRaw);

            await _rateLimiter.WaitForSlotAsync(limiterKey, ct);

            return await _singleFlight.DoAsync(cacheKey, async () =>
            {
                var token = await EnsureTokenAsync(ct);

                // Attempt #1 (factory)
                using var res1 = await SendWithRetryAsync(
                    () => makeRequestWithToken(token),
                    ct,
                    retryQuotaErrors);
                if (res1.StatusCode == HttpStatusCode.Unauthorized)
                {
                    // refresh token rồi thử lại
                    _token = null;
                    token = await EnsureTokenAsync(ct);

                    using var res2 = await SendWithRetryAsync(
                        () => makeRequestWithToken(token),
                        ct,
                        retryQuotaErrors);
                    var body2 = await res2.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                    if (!res2.IsSuccessStatusCode)
                        throw new Exception($"Upstream error {res2.StatusCode}: {body2}");

                    if (ttl.HasValue) _cache.Set(cacheKey, body2, ttl.Value);
                    return parseBody(body2);
                }

                var body1 = await res1.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if (!res1.IsSuccessStatusCode)
                    throw new Exception($"Upstream error {res1.StatusCode}: {body1}");

                if (ttl.HasValue) _cache.Set(cacheKey, body1, ttl.Value);
                return parseBody(body1);
            });
        }

        #endregion

        #region ===== TOKEN =====
        public async Task<LogTagTokenDto> GetTokenDtoAsync(CancellationToken ct = default)
        {
            if (!string.IsNullOrWhiteSpace(_token) && DateTime.UtcNow < _tokenExpiryUtc)
                return new LogTagTokenDto(_token!, _tokenExpiryUtc, new List<LogTagTeamDto>(), true);

            var http = _httpClientFactory.CreateClient();
            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/token/v1/public";
            var payload = new { email = _cfg.Email, password = _cfg.Password };

            using var res = await http.PostAsJsonAsync(url, payload, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new Exception($"Token request failed: {(int)res.StatusCode} {res.ReasonPhrase} - {body}");

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            _token = root.GetProperty("token").GetString() ?? throw new Exception("Token null");
            // token 48h, buffer 10'
            _tokenExpiryUtc = DateTime.UtcNow.AddHours(48).AddMinutes(-10);

            var teams = new List<LogTagTeamDto>();
            if (root.TryGetProperty("teams", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var e in arr.EnumerateArray())
                {
                    var id = e.TryGetProperty("id", out var pid) ? pid.GetInt64() : 0;
                    var name = e.TryGetProperty("name", out var pn) ? pn.GetString() ?? "" : "";
                    var typ = e.TryGetProperty("userAccountType", out var pt) ? pt.GetString() ?? "" : "";
                    teams.Add(new LogTagTeamDto(id, name, typ));
                }
            }

            return new LogTagTokenDto(_token!, _tokenExpiryUtc, teams, false);
        }

        private async Task<string> EnsureTokenAsync(CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(_token) || DateTime.UtcNow >= _tokenExpiryUtc)
            {
                var dto = await GetTokenDtoAsync(ct);
                _token = dto.Token;
                _tokenExpiryUtc = dto.ExpiryUtc;
            }
            return _token!;
        }
        #endregion

        #region ===== TEAMS (raw) =====
        public async Task<string> GetTeamsRawAsync(CancellationToken ct = default)
        {
            var ttl = TimeSpan.FromSeconds(_cfg.TtlTeamsSec);
            var baseUrl = _cfg.BaseUrl.TrimEnd('/');

            return await ExecWithPoliciesAsync(
                limiterKey: "teams",
                cacheKey: "teams",
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/teams/v1";
                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Add("Access_token", token);
                    return req;
                },
                parseBody: body => body,
                ct: ct
            );
        }
        #endregion

        #region ===== DEVICES (raw) =====
        public async Task<string> GetDevicesRawAsync(long teamId, CancellationToken ct = default)
        {
            var ttl = TimeSpan.FromSeconds(_cfg.TtlDevicesSec);
            var baseUrl = _cfg.BaseUrl.TrimEnd('/');

            return await ExecWithPoliciesAsync(
                limiterKey: "devices",
                cacheKey: $"devices:{teamId}",
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/devices/v1/{teamId}";
                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Add("Access_token", token);
                    return req;
                },
                parseBody: body => body,
                ct: ct
            );
        }
        #endregion

        #region ===== EVENTS (parsed) =====
        public record LogTagEventItem(
            string eventType,
            DateTime eventTimeUtc,
            double? alarmThreshold,
            double? alarmValue,
            int? alarmCount,
            string? batteryType
        );

        public record LogTagEventsResponse(
            List<LogTagEventItem> data,
            string status,
            DateTime timestampUtc
        );

        private static bool TryParseUtc(string? s, out DateTime utc)
        {
            utc = DateTime.MinValue;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var fmts = new[]
            {
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.FFF'Z'",
        "yyyy-MM-dd'T'HH:mm:ss",
        "yyyy-MM-dd'T'HH:mm:ss.FFF",
        "o"
    };
            if (DateTime.TryParseExact(s, fmts,
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out utc)) return true;

            return DateTime.TryParse(s,
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out utc);
        }

        public async Task<LogTagEventsResponse> GetEventsAsync(
            string serialNumber,
            DateTime? startDateUtc = null,
            DateTime? endDateUtc = null,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(serialNumber))
                throw new ArgumentException("serialNumber is required");

            var serialUpper = serialNumber.Trim().ToUpperInvariant();

            if (startDateUtc.HasValue && endDateUtc.HasValue &&
                endDateUtc - startDateUtc > TimeSpan.FromDays(31))
                throw new ArgumentException("Date range must be within 1 month.");

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var teamId = _cfg.TeamId;
            var ttl = TimeSpan.FromSeconds(_cfg.TtlEventsSec);
            var cacheKey = $"events:{teamId}:{serialUpper}:{startDateUtc:yyyyMMddHHmmss}:{endDateUtc:yyyyMMddHHmmss}";

            return await ExecWithPoliciesAsync(
                limiterKey: "events",
                cacheKey: cacheKey,
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/events/v1/{teamId}";
                    var payload = new Dictionary<string, object?> { ["serialNumber"] = serialUpper };
                    if (startDateUtc.HasValue) payload["startDateUtc"] = startDateUtc.Value.ToUniversalTime().ToString("o");
                    if (endDateUtc.HasValue) payload["endDateUtc"] = endDateUtc.Value.ToUniversalTime().ToString("o");

                    var req = new HttpRequestMessage(HttpMethod.Post, url);
                    req.Headers.Add("Access_token", token); // giữ nguyên theo backend của bạn
                    req.Content = JsonContent.Create(payload);
                    return req;
                },
                parseBody: body =>
                {
                    using var doc = JsonDocument.Parse(body);
                    var root = doc.RootElement;

                    string status = root.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String
                        ? st.GetString() ?? "Unknown"
                        : "Unknown";

                    DateTime timestampUtc = DateTime.MinValue;
                    if (root.TryGetProperty("timestampUtc", out var ts) && ts.ValueKind != JsonValueKind.Null)
                    {
                        if (ts.ValueKind == JsonValueKind.String) TryParseUtc(ts.GetString(), out timestampUtc);
                        else { try { timestampUtc = ts.GetDateTime(); } catch { } }
                    }

                    var list = new List<LogTagEventItem>();
                    if (root.TryGetProperty("data", out var arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var e in arr.EnumerateArray())
                        {
                            string eventType = e.TryGetProperty("eventType", out var et) && et.ValueKind == JsonValueKind.String
                                ? et.GetString() ?? ""
                                : "";

                            DateTime eventTimeUtc = DateTime.MinValue;
                            if (e.TryGetProperty("eventTimeUtc", out var t) && t.ValueKind != JsonValueKind.Null)
                            {
                                if (t.ValueKind == JsonValueKind.String) TryParseUtc(t.GetString(), out eventTimeUtc);
                                else { try { eventTimeUtc = t.GetDateTime(); } catch { } }
                            }

                            double? alarmThreshold = e.TryGetProperty("alarmThreshold", out var th) && th.ValueKind == JsonValueKind.Number ? th.GetDouble() : null;
                            double? alarmValue = e.TryGetProperty("alarmValue", out var av) && av.ValueKind == JsonValueKind.Number ? av.GetDouble() : null;
                            int? alarmCount = e.TryGetProperty("alarmCount", out var ac) && ac.ValueKind == JsonValueKind.Number ? ac.GetInt32() : null;
                            string? batteryType = e.TryGetProperty("batteryType", out var bt) && bt.ValueKind == JsonValueKind.String ? bt.GetString() : null;

                            list.Add(new LogTagEventItem(eventType, eventTimeUtc, alarmThreshold, alarmValue, alarmCount, batteryType));
                        }
                    }

                    return new LogTagEventsResponse(list, status, timestampUtc);
                },
                ct: ct
            );
        }
        #endregion

        #region ===== REGISTER DEVICE =====
        private record RegisterDeviceBody(string serialNumber, string? deviceDescription);
        private record RegisterDeviceItem(string serialNumber, string? deviceType);
        private record Envelope<T>(T? data, string status, DateTime timestampUtc);
        public sealed record RegisterDeviceResult(string SerialNumber, string? DeviceType);

        public async Task<RegisterDeviceResult> RegisterDeviceAsync(
            int teamId, string serialNumber, string? deviceDescription, CancellationToken ct = default)
        {
            if (!_cfg.EnableRegister)
                throw new InvalidOperationException("Register device is disabled by configuration.");

            if (_cfg.SimulateRegister)
                return new RegisterDeviceResult(serialNumber.Trim().ToUpperInvariant(), null);

            var token = await EnsureTokenAsync(ct);
            var http = _httpClientFactory.CreateClient();
            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/registerdevice/v1/{teamId}";

            using var req = NewReq(HttpMethod.Post, url, token);
            req.Content = JsonContent.Create(new RegisterDeviceBody(
                serialNumber.Trim(),
                string.IsNullOrWhiteSpace(deviceDescription) ? null : deviceDescription!.Trim()
            ));

            using var res = await http.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new Exception($"RegisterDevice failed: {(int)res.StatusCode} {res.ReasonPhrase} - {body}");

            // Parse linh hoạt (data có thể array/object hoặc ở root)
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;

                if (root.TryGetProperty("data", out var data))
                {
                    if (data.ValueKind == JsonValueKind.Array)
                    {
                        var first = data.EnumerateArray().FirstOrDefault();
                        if (first.ValueKind == JsonValueKind.Object)
                        {
                            var sn = first.TryGetProperty("serialNumber", out var snEl) ? snEl.GetString() : null;
                            var dt = first.TryGetProperty("deviceType", out var dtEl) ? dtEl.GetString() : null;
                            return new RegisterDeviceResult(sn ?? serialNumber, dt);
                        }
                    }
                    else if (data.ValueKind == JsonValueKind.Object)
                    {
                        var sn = data.TryGetProperty("serialNumber", out var snEl) ? snEl.GetString() : null;
                        var dt = data.TryGetProperty("deviceType", out var dtEl) ? dtEl.GetString() : null;
                        return new RegisterDeviceResult(sn ?? serialNumber, dt);
                    }
                }

                if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("serialNumber", out var snRoot))
                {
                    var sn = snRoot.GetString();
                    var dt = root.TryGetProperty("deviceType", out var dtEl) ? dtEl.GetString() : null;
                    return new RegisterDeviceResult(sn ?? serialNumber, dt);
                }

                // fallback Envelope
                var envArr = JsonSerializer.Deserialize<Envelope<List<RegisterDeviceItem>>>(body, _jsonInsensitive);
                var first2 = envArr?.data?.FirstOrDefault();
                if (first2 != null) return new RegisterDeviceResult(first2.serialNumber ?? serialNumber, first2.deviceType);

                var envObj = JsonSerializer.Deserialize<Envelope<RegisterDeviceItem>>(body, _jsonInsensitive);
                if (envObj?.data != null) return new RegisterDeviceResult(envObj.data.serialNumber ?? serialNumber, envObj.data.deviceType);

                throw new Exception("Unexpected register-device response: " + body);
            }
            catch (Exception ex)
            {
                throw new Exception("RegisterDevice parse error: " + ex.Message + " | raw: " + body, ex);
            }
        }
        #endregion

        #region ===== READINGS (parsed) – overloads =====
        private record ReadingsQuery(string serialNumber, DateTime? startDateUtc, DateTime? endDateUtc);

        /// <summary>
        /// (Giữ từ file 2) Trả về danh sách readings đơn giản.
        /// </summary>
        public async Task<List<LocationReadingDto>> GetLocationReadingsAsync(
            string serialNumber, DateTime? fromUtc, DateTime? toUtc, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(serialNumber))
                throw new ArgumentException("serialNumber is required");

            var serialUpper = serialNumber.Trim().ToUpperInvariant();

            // guard 1 tháng
            if (fromUtc.HasValue && toUtc.HasValue &&
                toUtc - fromUtc > TimeSpan.FromDays(31))
                throw new ArgumentException("Date range must be within 1 month.");

            // ❗ Dùng TeamId từ cấu hình MAIN, không nhận từ parameter
            long teamId = _cfg.TeamId;
            if (teamId <= 0)
                throw new InvalidOperationException("TeamId for LogTagApiMain is not configured.");

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var ttl = TimeSpan.FromSeconds(_cfg.TtlEventsSec);

            // cache theo MAIN
            var cacheKey = $"locread:MAIN:{teamId}:{serialUpper}:{fromUtc:yyyyMMddHHmmss}:{toUtc:yyyyMMddHHmmss}";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings",
                cacheKey: cacheKey,
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/locationreadings/v1/{teamId}";

                    var payload = new ReadingsQuery(serialUpper, fromUtc, toUtc);
                    var req = new HttpRequestMessage(HttpMethod.Post, url);

                    req.Headers.Add("Access_token", token);
                    req.Content = JsonContent.Create(payload);

                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<List<LocationReadingDto>>>(body, _jsonInsensitive)
                              ?? throw new Exception("Cannot parse location readings envelope.");

                    return env.data ?? new List<LocationReadingDto>();
                },
                ct: ct
            );
        }

        /// <summary>
        /// (Từ file 1) Overload nhận request “đầy đủ” và trả envelope `LocationReadingsApiResponse`.
        /// Có cache bằng hash(req).
        /// </summary>
        public async Task<LocationReadingsApiResponse> GetLocationReadingsAsync(
            long teamId,
            temperature_humi.Models.LocationReadingsRequest reqBody,
            CancellationToken ct = default)
        {
            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var reqJson = JsonSerializer.Serialize(reqBody, _jsonCamel);
            var keyHash = HashString($"{teamId}:{reqJson}");
            var cacheKey = $"locread:full:{keyHash}";
            var ttl = TimeSpan.FromSeconds(_cfg.TtlEventsSec);

            return await ExecWithPoliciesAsync(
                limiterKey: "readings",
                cacheKey: cacheKey,
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/locationreadings/v1/{teamId}";
                    var httpReq = new HttpRequestMessage(HttpMethod.Post, url);
                    httpReq.Headers.Add("Access_token", token);
                    httpReq.Content = new StringContent(reqJson, Encoding.UTF8, "application/json");
                    return httpReq;
                },
                parseBody: text =>
                {
                    // Parse theo kiểu file 1
                    using var doc = JsonDocument.Parse(text);
                    var root = doc.RootElement;

                    string status = root.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String
                        ? st.GetString() ?? "Unknown"
                        : "Unknown";

                    DateTime timestampUtc = DateTime.MinValue;
                    if (root.TryGetProperty("timestampUtc", out var ts) && ts.ValueKind != JsonValueKind.Null)
                    {
                        if (ts.ValueKind == JsonValueKind.String)
                        {
                            var s = ts.GetString();
                            if (!string.IsNullOrWhiteSpace(s))
                                _ = DateTime.TryParse(s,
                                    System.Globalization.CultureInfo.InvariantCulture,
                                    System.Globalization.DateTimeStyles.AdjustToUniversal |
                                    System.Globalization.DateTimeStyles.AssumeUniversal,
                                    out timestampUtc);
                        }
                        else { try { timestampUtc = ts.GetDateTime(); } catch { } }
                    }

                    var list = new List<LocationReadingDto>();
                    if (root.TryGetProperty("data", out var arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var e in arr.EnumerateArray())
                        {
                            double temp = e.TryGetProperty("temperature", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetDouble() : 0;
                            double? hum = e.TryGetProperty("humidity", out var h) && h.ValueKind == JsonValueKind.Number ? h.GetDouble() : null;

                            DateTime dateUtc = DateTime.MinValue;
                            if (e.TryGetProperty("dateUtc", out var d) && d.ValueKind != JsonValueKind.Null)
                            {
                                if (d.ValueKind == JsonValueKind.String)
                                {
                                    var s = d.GetString();
                                    if (!string.IsNullOrWhiteSpace(s))
                                        _ = DateTime.TryParse(s,
                                            System.Globalization.CultureInfo.InvariantCulture,
                                            System.Globalization.DateTimeStyles.AdjustToUniversal |
                                            System.Globalization.DateTimeStyles.AssumeUniversal,
                                            out dateUtc);
                                }
                                else { try { dateUtc = d.GetDateTime(); } catch { } }
                            }

                            list.Add(new LocationReadingDto(temp, dateUtc, hum));
                        }
                    }

                    return new LocationReadingsApiResponse(list, status, timestampUtc);
                },
                ct: ct
            );
        }

        /// <summary>
        /// Location Readings Batch API v2.
        /// 1 request lấy tối đa 500 serialNumbers, date window tối đa 15 phút.
        /// Endpoint:
        /// POST /external/locationreadings/v2/{teamId}/batch
        /// </summary>
        public async Task<LocationReadingsBatchV2Response> GetLocationReadingsBatchV2Async(
            long teamId,
            LocationReadingsBatchV2Request reqBody,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            if (reqBody == null)
                throw new ArgumentNullException(nameof(reqBody));

            var serials = (reqBody.serialNumbers ?? new List<string>())
                .Select(s => (s ?? string.Empty).Trim().ToUpperInvariant())
                .Where(s => s.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (serials.Count == 0)
                throw new ArgumentException("At least one serial number must be requested.");

            if (serials.Count > 500)
                throw new ArgumentException("A maximum of 500 unique serial numbers may be requested.");

            static DateTime NormalizeUtc(DateTime dt)
            {
                if (dt.Kind == DateTimeKind.Unspecified)
                    return DateTime.SpecifyKind(dt, DateTimeKind.Utc);

                return dt.ToUniversalTime();
            }

            var startUtc = NormalizeUtc(reqBody.startDateUtc);
            var endUtc = NormalizeUtc(reqBody.endDateUtc);

            if (startUtc == default)
                throw new ArgumentException("startDateUtc must be provided.");

            if (endUtc == default)
                throw new ArgumentException("endDateUtc must be provided.");

            if (endUtc <= startUtc)
                throw new ArgumentException("endDateUtc must be after startDateUtc.");

            if (endUtc - startUtc > TimeSpan.FromMinutes(15))
                throw new ArgumentException("The requested date range must not exceed 15 minutes.");

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');

            var normalizedReq = new LocationReadingsBatchV2Request
            {
                serialNumbers = serials,
                startDateUtc = startUtc,
                endDateUtc = endUtc
            };

            var reqJson = JsonSerializer.Serialize(normalizedReq, _jsonCamel);
            var keyHash = HashString($"{teamId}:{reqJson}");
            var cacheKey = $"locread:v2:batch:{keyHash}";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings",
                cacheKey: cacheKey,

                // Realtime readings không nên cache lâu vì device có thể upload trễ.
                // Nếu muốn cache nhẹ khi debug, có thể đổi thành TimeSpan.FromSeconds(5).
                ttl: null,

                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/locationreadings/v2/{teamId}/batch";
                    var httpReq = new HttpRequestMessage(HttpMethod.Post, url);
                    httpReq.Headers.Add("Access_token", token);
                    httpReq.Content = new StringContent(reqJson, Encoding.UTF8, "application/json");
                    return httpReq;
                },

                parseBody: text =>
                {
                    var parsed = JsonSerializer.Deserialize<LocationReadingsBatchV2Response>(
                        text,
                        _jsonInsensitive
                    );

                    if (parsed == null)
                        throw new Exception("Cannot parse Location Readings Batch API v2 response.");

                    parsed.data ??= new List<LocationReadingsBatchV2Group>();

                    foreach (var g in parsed.data)
                    {
                        g.serialNumber = (g.serialNumber ?? string.Empty).Trim().ToUpperInvariant();
                        g.readings ??= new List<LocationReadingDto>();
                    }

                    return parsed;
                },
                ct: ct,
                retryQuotaErrors: false
            );
        }

        public async Task<List<LtgeoReadingDto>> GetLtgeoReadingsAsync(
            long teamId, string serialNumber, DateTime? fromUtc, DateTime? toUtc, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(serialNumber))
                throw new ArgumentException("serialNumber is required");

            var serialUpper = serialNumber.Trim().ToUpperInvariant();

            if (fromUtc.HasValue && toUtc.HasValue &&
                toUtc - fromUtc > TimeSpan.FromDays(31))
                throw new ArgumentException("Date range must be within 1 month.");

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var ttl = TimeSpan.FromSeconds(_cfg.TtlEventsSec);
            var cacheKey = $"ltgeoread:{teamId}:{serialUpper}:{fromUtc:yyyyMMddHHmmss}:{toUtc:yyyyMMddHHmmss}";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings",
                cacheKey: cacheKey,
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/ltgeoreadings/v1/{teamId}";
                    var payload = new ReadingsQuery(serialUpper, fromUtc, toUtc);
                    var req = new HttpRequestMessage(HttpMethod.Post, url);
                    req.Headers.Add("Access_token", token);
                    req.Content = JsonContent.Create(payload);
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<List<LtgeoReadingDto>>>(body, _jsonInsensitive)
                              ?? throw new Exception("Cannot parse ltgeo readings envelope.");
                    return env.data ?? new List<LtgeoReadingDto>();
                },
                ct: ct
            );
        }
        #endregion

        #region ===== READINGS WEBHOOKS v1 - MANAGEMENT API =====

        /// <summary>
        /// Lấy cấu hình readings webhook hiện tại của team.
        /// GET /external/webhooks/readings/v1/{teamId}
        /// </summary>
        public async Task<ReadingsWebhookConfigDto?> GetReadingsWebhookConfigAsync(
            long teamId,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/webhooks/readings/v1/{teamId}";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings-webhook-management",
                cacheKey: $"readings-webhook:config:{teamId}",
                ttl: null,
                makeRequestWithToken: token =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Add("Access_token", token);
                    req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<ReadingsWebhookConfigDto>>(
                        body, _jsonInsensitive)
                        ?? throw new Exception("Cannot parse readings webhook configuration response.");

                    return env.data;
                },
                ct: ct);
        }

        /// <summary>
        /// Tạo hoặc cập nhật cấu hình readings webhook của team.
        /// PUT /external/webhooks/readings/v1/{teamId}
        ///
        /// signingSecret:
        /// - Bắt buộc khi enabled=true nếu team chưa có secret.
        /// - Có thể để null ở lần cập nhật sau để giữ secret hiện tại.
        /// </summary>
        public async Task<ReadingsWebhookConfigDto?> ConfigureReadingsWebhookAsync(
            long teamId,
            string targetUrl,
            bool enabled,
            string? signingSecret = null,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            ValidateWebhookTargetUrl(targetUrl);

            if (signingSecret != null)
                ValidateWebhookSigningSecret(signingSecret);

            var payload = new ReadingsWebhookConfigRequest
            {
                targetUrl = targetUrl.Trim(),
                enabled = enabled,
                signingSecret = string.IsNullOrWhiteSpace(signingSecret)
                    ? null
                    : signingSecret
            };

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/webhooks/readings/v1/{teamId}";
            var json = JsonSerializer.Serialize(payload, _jsonCamel);
            var hash = HashString($"{teamId}:{json}");

            return await ExecWithPoliciesAsync(
                limiterKey: "readings-webhook-management",
                cacheKey: $"readings-webhook:put:{hash}",
                ttl: null,
                makeRequestWithToken: token =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Put, url);
                    req.Headers.Add("Access_token", token);
                    req.Content = new StringContent(json, Encoding.UTF8, "application/json");
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<ReadingsWebhookConfigDto>>(
                        body, _jsonInsensitive)
                        ?? throw new Exception("Cannot parse readings webhook configuration response.");

                    return env.data;
                },
                ct: ct);
        }

        /// <summary>
        /// Tạo hoặc xác nhận subscription cho một serial.
        /// POST /external/webhooks/readings/v1/{teamId}/subscriptions
        /// </summary>
        public async Task<ReadingsWebhookSubscriptionDto?> CreateOrConfirmReadingsWebhookSubscriptionAsync(
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            var serial = NormalizeWebhookSerial(serialNumber);

            var payload = new ReadingsWebhookSubscriptionRequest
            {
                serialNumber = serial
            };

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/webhooks/readings/v1/{teamId}/subscriptions";
            var json = JsonSerializer.Serialize(payload, _jsonCamel);

            return await ExecWithPoliciesAsync(
                limiterKey: "readings-webhook-management",
                cacheKey: $"readings-webhook:subscribe:{teamId}:{serial}",
                ttl: null,
                makeRequestWithToken: token =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Post, url);
                    req.Headers.Add("Access_token", token);
                    req.Content = new StringContent(json, Encoding.UTF8, "application/json");
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<ReadingsWebhookSubscriptionDto>>(
                        body, _jsonInsensitive)
                        ?? throw new Exception("Cannot parse readings webhook subscription response.");

                    if (env.data != null)
                        env.data.serialNumber = NormalizeWebhookSerial(env.data.serialNumber);

                    return env.data;
                },
                ct: ct);
        }

        /// <summary>
        /// Lấy toàn bộ subscription readings webhook đang active của team.
        /// GET /external/webhooks/readings/v1/{teamId}/subscriptions
        /// </summary>
        public async Task<List<ReadingsWebhookSubscriptionDto>> ListReadingsWebhookSubscriptionsAsync(
            long teamId,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/webhooks/readings/v1/{teamId}/subscriptions";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings-webhook-management",
                cacheKey: $"readings-webhook:subscriptions:{teamId}",
                ttl: null,
                makeRequestWithToken: token =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Add("Access_token", token);
                    req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<List<ReadingsWebhookSubscriptionDto>>>(
                        body, _jsonInsensitive)
                        ?? throw new Exception("Cannot parse readings webhook subscriptions response.");

                    var list = env.data ?? new List<ReadingsWebhookSubscriptionDto>();

                    foreach (var item in list)
                        item.serialNumber = NormalizeWebhookSerial(item.serialNumber);

                    return list;
                },
                ct: ct);
        }

        /// <summary>
        /// Lấy một subscription theo serial number.
        /// GET /external/webhooks/readings/v1/{teamId}/subscriptions/{serialNumber}
        /// </summary>
        public async Task<ReadingsWebhookSubscriptionDto?> GetReadingsWebhookSubscriptionAsync(
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            var serial = NormalizeWebhookSerial(serialNumber);
            var serialPath = Uri.EscapeDataString(serial);

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/webhooks/readings/v1/{teamId}/subscriptions/{serialPath}";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings-webhook-management",
                cacheKey: $"readings-webhook:subscription:{teamId}:{serial}",
                ttl: null,
                makeRequestWithToken: token =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Add("Access_token", token);
                    req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<ReadingsWebhookSubscriptionDto>>(
                        body, _jsonInsensitive)
                        ?? throw new Exception("Cannot parse readings webhook subscription response.");

                    if (env.data != null)
                        env.data.serialNumber = NormalizeWebhookSerial(env.data.serialNumber);

                    return env.data;
                },
                ct: ct);
        }

        /// <summary>
        /// Xoá subscription readings webhook theo serial.
        /// DELETE /external/webhooks/readings/v1/{teamId}/subscriptions/{serialNumber}
        /// Chỉ xoá webhook subscription, không xoá device/location.
        /// </summary>
        public async Task<bool> DeleteReadingsWebhookSubscriptionAsync(
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentException("teamId is required.", nameof(teamId));

            var serial = NormalizeWebhookSerial(serialNumber);
            var serialPath = Uri.EscapeDataString(serial);

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var url = $"{baseUrl}/external/webhooks/readings/v1/{teamId}/subscriptions/{serialPath}";

            return await ExecWithPoliciesAsync(
                limiterKey: "readings-webhook-management",
                cacheKey: $"readings-webhook:delete:{teamId}:{serial}",
                ttl: null,
                makeRequestWithToken: token =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Delete, url);
                    req.Headers.Add("Access_token", token);
                    return req;
                },
                parseBody: body =>
                {
                    var env = JsonSerializer.Deserialize<Envelope<bool>>(
                        body, _jsonInsensitive)
                        ?? throw new Exception("Cannot parse readings webhook delete response.");

                    return env.data;
                },
                ct: ct);
        }

        private static string NormalizeWebhookSerial(string? serialNumber)
        {
            if (string.IsNullOrWhiteSpace(serialNumber))
                throw new ArgumentException("serialNumber is required.", nameof(serialNumber));

            return serialNumber.Trim().ToUpperInvariant();
        }

        private static void ValidateWebhookTargetUrl(string? targetUrl)
        {
            if (string.IsNullOrWhiteSpace(targetUrl))
                throw new ArgumentException("targetUrl is required.", nameof(targetUrl));

            var trimmed = targetUrl.Trim();

            if (trimmed.Length > 512)
                throw new ArgumentException("targetUrl must be 512 characters or fewer.", nameof(targetUrl));

            if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ||
                !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    "targetUrl must be an absolute HTTPS URL.",
                    nameof(targetUrl));
            }

            if (!string.IsNullOrEmpty(uri.UserInfo))
                throw new ArgumentException("targetUrl must not contain user-info.", nameof(targetUrl));

            if (!string.IsNullOrEmpty(uri.Fragment))
                throw new ArgumentException("targetUrl must not contain a URL fragment.", nameof(targetUrl));

            if (string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    "targetUrl must be a public HTTPS URL; localhost is not allowed.",
                    nameof(targetUrl));
            }

            if (IPAddress.TryParse(uri.Host, out var ip) && !IsPublicWebhookIp(ip))
            {
                throw new ArgumentException(
                    "targetUrl must resolve to a public address; private/link-local/loopback IPs are not allowed.",
                    nameof(targetUrl));
            }
        }

        private static bool IsPublicWebhookIp(IPAddress ip)
        {
            if (IPAddress.IsLoopback(ip))
                return false;

            if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
            {
                var b = ip.GetAddressBytes();

                // 10.0.0.0/8
                if (b[0] == 10) return false;

                // 127.0.0.0/8
                if (b[0] == 127) return false;

                // 169.254.0.0/16
                if (b[0] == 169 && b[1] == 254) return false;

                // 172.16.0.0/12
                if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return false;

                // 192.168.0.0/16
                if (b[0] == 192 && b[1] == 168) return false;

                return true;
            }

            if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
            {
                if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal)
                    return false;

                var bytes = ip.GetAddressBytes();

                // fc00::/7 - unique local addresses
                if ((bytes[0] & 0xFE) == 0xFC)
                    return false;

                return true;
            }

            return false;
        }

        private static void ValidateWebhookSigningSecret(string signingSecret)
        {
            if (string.IsNullOrWhiteSpace(signingSecret))
                throw new ArgumentException("signingSecret must not be blank.", nameof(signingSecret));

            if (signingSecret.Length < 32)
                throw new ArgumentException("signingSecret must be at least 32 characters.", nameof(signingSecret));

            if (signingSecret.Length > 256)
                throw new ArgumentException("signingSecret must be 256 characters or fewer.", nameof(signingSecret));

            if (Encoding.UTF8.GetByteCount(signingSecret) > 256)
                throw new ArgumentException("signingSecret must be 256 UTF-8 bytes or fewer.", nameof(signingSecret));

            foreach (var ch in signingSecret)
            {
                // printable ASCII only, without spaces
                if (ch < 33 || ch > 126)
                {
                    throw new ArgumentException(
                        "signingSecret must contain only printable ASCII characters without spaces.",
                        nameof(signingSecret));
                }
            }
        }

        #endregion

        #region ===== Generic POST (giữ từ file 1, dùng lại policies ở ngoài nếu cần) =====
        // Nếu muốn đi qua ExecWithPoliciesAsync, anh có thể tạo wrapper riêng.
        private async Task<TRes> PostAsync<TReq, TRes>(string url, TReq body, CancellationToken ct = default)
        {
            var token = await EnsureTokenAsync(ct);

            var http = _httpClientFactory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Add("Access_token", token);

            var json = JsonSerializer.Serialize(body, _jsonCamel);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");

            using var res = await http.SendAsync(req, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new Exception($"POST {url} failed: {(int)res.StatusCode} {res.ReasonPhrase} - {text}");

            var obj = JsonSerializer.Deserialize<TRes>(text, _jsonCamel);
            if (obj == null) throw new Exception($"Cannot parse response to {typeof(TRes).Name}");
            return obj;
        }
        #endregion
        /// <summary>
        /// Proxy GET /external/profiles/v1/{teamId} (LogTag).
        /// - Header: Access_token (48h) — tự động chèn từ EnsureTokenAsync()
        /// - Có RateLimiter + SingleFlight + Cache 30s
        /// </summary>
        private static string BuildEndpointKey(string method, string url)
        {
            method = method?.ToUpperInvariant() ?? "GET";
            url ??= string.Empty;

            // 1) Cố parse absolute URI
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
            {
                var path = uri.AbsolutePath;
                var i = path.LastIndexOf('/');
                if (i > 0)
                    path = path.Substring(0, i); // bỏ teamId

                return $"{method} {path}";
            }

            // 2) Nếu là relative URI thì dùng raw
            if (Uri.TryCreate(url, UriKind.Relative, out var rel))
            {
                var safe = rel.OriginalString;
                if (string.IsNullOrWhiteSpace(safe))
                    safe = "/unknown";

                return $"{method} {safe}";
            }

            // 3) Cuối cùng fallback
            return $"{method} /unknown";
        }

        public async Task<ApiEnvelopeProfiles> GetProfilesAsync(long teamId, CancellationToken ct = default)
        {
            var url = $"{_cfg.BaseUrl.TrimEnd('/')}/external/profiles/v1/{teamId}";
            var endpointKey = BuildEndpointKey("GET", url);
            var cacheKey = $"profiles:{teamId}";
            var staleKey = cacheKey + ":stale";

            // 0) Fresh cache (30s)
            if (_cache.TryGet<ApiEnvelopeProfiles>(cacheKey, out var cachedFresh))
                return cachedFresh;

#pragma warning disable CS8603 // Possible null reference return.
            return await _singleFlight.DoAsync(cacheKey, async () =>
            {
                // 1) Internal client quota (non-blocking)
                if (!_rateLimiter.TryAcquire(endpointKey, out var retryAfter))
                    throw new TooManyRequestsException(retryAfter);

                // 2) Outer timeout
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                linkedCts.CancelAfter(TimeSpan.FromSeconds(8));

                var http = _httpClientFactory.CreateClient("logtag");

                const int maxAttempts = 3;
                Exception? lastErr = null;

                // giữ token hiện tại, nếu 401 sẽ refresh trong vòng lặp
                var token = await EnsureTokenAsync(linkedCts.Token);

                for (int attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    try
                    {
                        // ❗ Tạo request MỚI cho mỗi attempt
                        using var req = new HttpRequestMessage(HttpMethod.Get, url);
                        req.Headers.TryAddWithoutValidation("Access_token", token);
                        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, linkedCts.Token);

                        if (res.IsSuccessStatusCode)
                        {
                            await using var s = await res.Content.ReadAsStreamAsync(linkedCts.Token);
                            var payload = await JsonSerializer.DeserializeAsync<ApiEnvelopeProfiles>(
                                s, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, linkedCts.Token
                            ) ?? new ApiEnvelopeProfiles(); // safe default

                            // Write both fresh & stale caches
                            _cache.Set(cacheKey, payload, TimeSpan.FromSeconds(30));
                            _cache.Set(staleKey, payload, TimeSpan.FromMinutes(10));
                            return payload;
                        }

                        // 401 → refresh token rồi thử lại (không đợi)
                        if (res.StatusCode == HttpStatusCode.Unauthorized)
                        {
                            _token = null; // buộc refresh
                            token = await EnsureTokenAsync(linkedCts.Token);
                            continue;
                        }

                        // if 304 Not Modified (nếu upstream hỗ trợ ETag)
                        if ((int)res.StatusCode == 304 && _cache.TryGet<ApiEnvelopeProfiles>(staleKey, out var notModified))
                        {
                            _cache.Set(cacheKey, notModified, TimeSpan.FromSeconds(30));
                            return notModified;
                        }

                        // 429/503 → retry with backoff; others → throw
                        if (res.StatusCode == HttpStatusCode.TooManyRequests || (int)res.StatusCode == 503)
                        {
                            var delay = ComputeBackoffWithRetryAfter(res, attempt);
                            await Task.Delay(delay, linkedCts.Token);
                            continue;
                        }

                        // Non-retriable: include short body for diagnostics
                        var shortBody = await SafeReadShortAsync(res, linkedCts.Token);
                        throw new HttpRequestException($"GET {url} failed: {(int)res.StatusCode} {res.ReasonPhrase}. Body: {shortBody}");
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested && attempt < maxAttempts)
                    {
                        // timeout → quick retry
                        lastErr = new TimeoutException("Upstream timeout.");
                        var delay = TimeSpan.FromMilliseconds(200 * attempt);
                        await Task.Delay(delay, ct);
                        continue;
                    }
                    catch (Exception ex) when (attempt < maxAttempts)
                    {
                        lastErr = ex;
                        var delay = TimeSpan.FromMilliseconds(200 * attempt + Random.Shared.Next(0, 120));
                        await Task.Delay(delay, ct);
                        continue;
                    }
                }

                // 4) Stale-on-fail fallback
                if (_cache.TryGet<ApiEnvelopeProfiles>(staleKey, out var cachedStale))
                    return cachedStale;

                // 5) If nothing cached, rethrow last error (or generic)
                throw lastErr ?? new Exception("Failed to fetch profiles and no cache available.");
            });
#pragma warning restore CS8603 // Possible null reference return.
        }


        public async Task<LtgeoReadingsEnvelope> GetLtgeoReadingsFullAsync(
    long teamId,
    string serialNumber,
    DateTime? startDateUtc,
    DateTime? endDateUtc,
    CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(serialNumber))
                throw new ArgumentException("serialNumber is required");

            if (startDateUtc.HasValue && endDateUtc.HasValue &&
                endDateUtc - startDateUtc > TimeSpan.FromDays(31))
                throw new ArgumentException("Date range must be within 1 month.");

            var baseUrl = _cfg.BaseUrl.TrimEnd('/');
            var cacheKey = $"ltgeo_full:{teamId}:{serialNumber}:{startDateUtc}:{endDateUtc}";
            var ttl = TimeSpan.FromSeconds(_cfg.TtlEventsSec);

            return await ExecWithPoliciesAsync(
                limiterKey: "ltgeoreadings",
                cacheKey: cacheKey,
                ttl: ttl,
                makeRequestWithToken: token =>
                {
                    var url = $"{baseUrl}/external/ltgeoreadings/v1/{teamId}";
                    var payload = new
                    {
                        serialNumber = serialNumber.ToUpper(),
                        startDateUtc = startDateUtc?.ToString("o"),
                        endDateUtc = endDateUtc?.ToString("o")
                    };

                    var req = new HttpRequestMessage(HttpMethod.Post, url);
                    req.Headers.Add("Access_token", token);
                    req.Content = JsonContent.Create(payload);
                    return req;
                },
                parseBody: body =>
                {
                    return JsonSerializer.Deserialize<LtgeoReadingsEnvelope>(
                        body,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                    ) ?? new LtgeoReadingsEnvelope(new List<LtgeoReadingDto>(), "Error", DateTime.UtcNow);
                },
                ct: ct
            );
        }


        // ---- local helpers ----
        static TimeSpan ComputeBackoffWithRetryAfter(HttpResponseMessage res, int attempt)
        {
            // honor Retry-After (seconds or date)
            if (res.Headers.RetryAfter != null)
            {
                if (res.Headers.RetryAfter.Delta is TimeSpan d && d > TimeSpan.Zero)
                    return d + TimeSpan.FromMilliseconds(Random.Shared.Next(50, 200));
                if (res.Headers.RetryAfter.Date is DateTimeOffset when)
                {
                    var wait = when - DateTimeOffset.UtcNow;
                    if (wait > TimeSpan.Zero) return wait + TimeSpan.FromMilliseconds(Random.Shared.Next(50, 200));
                }
            }
            // fallback exponential backoff
            var ms = (int)Math.Min(1000, 250 * Math.Pow(2, attempt - 1));
            return TimeSpan.FromMilliseconds(ms + Random.Shared.Next(0, 150));
        }

        static async Task<string> SafeReadShortAsync(HttpResponseMessage res, CancellationToken ct2)
        {
            try
            {
                var txt = await res.Content.ReadAsStringAsync(ct2);
                return txt.Length <= 800 ? txt : txt[..800] + "…";
            }
            catch { return "<no-body>"; }
        }
        public async Task<ApiEnvelopeShipments<Lt5ShipmentDto>> CreateShipmentAsync(long teamId, object body, CancellationToken ct = default)
        {
            var url = $"{_cfg.BaseUrl.TrimEnd('/')}/external/createshipment/v1/{teamId}";
            var endpointKey = BuildEndpointKey("POST", url);

            if (!_rateLimiter.TryAcquire(endpointKey, out var retryAfter))
                throw new TooManyRequestsException(retryAfter);

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linkedCts.CancelAfter(TimeSpan.FromSeconds(10));

            var http = _httpClientFactory.CreateClient("logtag");
            var opt = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

            async Task<ApiEnvelopeShipments<Lt5ShipmentDto>> SendWithTokenAsync(string token)
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, url);
                req.Headers.TryAddWithoutValidation("Access_token", token);
                req.Content = JsonContent.Create(body);

                using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, linkedCts.Token);
                var raw = await res.Content.ReadAsStringAsync(linkedCts.Token);

                if (!res.IsSuccessStatusCode)
                    throw new Exception($"LogTag CreateShipment failed {(int)res.StatusCode} {res.ReasonPhrase}. Body: {raw}");

                // ✅ deserialize RAW envelope (Data=JsonElement)
                var envRaw = JsonSerializer.Deserialize<ApiEnvelopeShipmentsRaw>(raw, opt)
                            ?? throw new Exception($"Cannot parse envelope. Raw={raw}");

                Lt5ShipmentDto? shipment = null;

                if (envRaw.Data.ValueKind == JsonValueKind.Object)
                {
                    shipment = envRaw.Data.Deserialize<Lt5ShipmentDto>(opt);
                }
                else if (envRaw.Data.ValueKind == JsonValueKind.Array)
                {
                    var list = envRaw.Data.Deserialize<List<Lt5ShipmentDto>>(opt);
                    shipment = list?.FirstOrDefault();
                }
                else if (envRaw.Data.ValueKind == JsonValueKind.Null)
                {
                    shipment = null;
                }
                else
                {
                    throw new Exception($"Unexpected $.data kind={envRaw.Data.ValueKind}. Raw={raw}");
                }

                // ✅ return typed envelope (Data=Lt5ShipmentDto)
                return new ApiEnvelopeShipments<Lt5ShipmentDto>
                {
                    Status = envRaw.Status,
                    TimestampUtc = envRaw.TimestampUtc,
                    Data = shipment
                };
            }

            var token = await EnsureTokenAsync(linkedCts.Token);

            // Nếu muốn đúng chuẩn: check 401 bằng res.StatusCode như code cũ.
            // Còn cách đơn giản: nếu token expire thì gọi lại.
            try
            {
                return await SendWithTokenAsync(token);
            }
            catch (Exception ex) when (ex.Message.Contains("401") || ex.Message.Contains("Unauthorized"))
            {
                _token = null;
                token = await EnsureTokenAsync(linkedCts.Token);
                return await SendWithTokenAsync(token);
            }
        }
        // ============================================================
        // READINGS WEBHOOK SUBSCRIPTION MANAGEMENT
        // Sử dụng các method chuẩn đã có:
        // - CreateOrConfirmReadingsWebhookSubscriptionAsync
        // - ListReadingsWebhookSubscriptionsAsync
        // - DeleteReadingsWebhookSubscriptionAsync
        //
        // Không gọi _httpClient trực tiếp vì LogTagApiClient
        // đang quản lý HttpClient qua IHttpClientFactory,
        // token, retry, rate limit và cache.
        // ============================================================

        public async Task<ReadingsWebhookSubscriptionDto?> CreateReadingSubscriptionAsync(
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            return await CreateOrConfirmReadingsWebhookSubscriptionAsync(
                teamId,
                serialNumber,
                ct);
        }


        public async Task<List<ReadingsWebhookSubscriptionDto>> GetReadingSubscriptionsAsync(
            long teamId,
            CancellationToken ct = default)
        {
            return await ListReadingsWebhookSubscriptionsAsync(
                teamId,
                ct);
        }


        public async Task<bool> DeleteReadingSubscriptionAsync(
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            return await DeleteReadingsWebhookSubscriptionAsync(
                teamId,
                serialNumber,
                ct);
        }

    }

}
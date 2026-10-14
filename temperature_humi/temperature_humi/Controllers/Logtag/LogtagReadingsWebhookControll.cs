using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.Buffers;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.DTO;
using temperature_humi.Service;

namespace temperature_humi.Controllers.LogTag
{
    /// <summary>
    /// Receiver cho LogTag Online Readings Webhooks v1.
    ///
    /// Target URL:
    /// https://your-domain/api/logtag/webhooks/readings/{teamId}
    ///
    /// - AllowAnonymous vì LogTag không dùng cookie auth của ứng dụng.
    /// - Xác thực HMAC-SHA256 trên RAW BODY trước khi deserialize.
    /// - teamId nằm trên route vì body webhook v1 không chứa teamId.
    /// - Ghi qua LocationReadingService để tái sử dụng Mongo upsert + SignalR + Alert.
    /// </summary>
    [ApiController]
    [Route("api/logtag/webhooks/readings")]
    [AllowAnonymous]
    [Produces("application/json")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public sealed class LogTagReadingsWebhookController : ControllerBase
    {
        private const string HeaderEvent = "X-LTO-Webhook-Event";
        private const string HeaderDeliveryId = "X-LTO-Webhook-Delivery-Id";
        private const string HeaderTimestamp = "X-LTO-Webhook-Timestamp";
        private const string HeaderSignature = "X-LTO-Webhook-Signature";

        private const int DefaultMaxBodyBytes = 4 * 1024 * 1024;
        private const int DefaultProcessingTimeoutSeconds = 12;
        private const int DefaultMaxParallelDevices = 4;

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        private readonly LocationReadingService _locationReadings;
        private readonly IConfiguration _configuration;
        private readonly ILogger<LogTagReadingsWebhookController> _log;

        public LogTagReadingsWebhookController(
            LocationReadingService locationReadings,
            IConfiguration configuration,
            ILogger<LogTagReadingsWebhookController> log)
        {
            _locationReadings = locationReadings;
            _configuration = configuration;
            _log = log;
        }

        [HttpPost("{teamId:long}")]
        [Consumes("application/json")]
        public async Task<IActionResult> Receive(
            long teamId,
            CancellationToken ct)
        {
            if (teamId <= 0)
                return BadRequest(new { error = "invalid_team_id" });

            var deliveryId = GetHeader(HeaderDeliveryId);
            var webhookTimestamp = GetHeader(HeaderTimestamp);
            var eventName = GetHeader(HeaderEvent);
            var signature = GetHeader(HeaderSignature);

            if (!string.Equals(eventName, "readings", StringComparison.OrdinalIgnoreCase))
            {
                _log.LogWarning(
                    "[LOGTAG-WEBHOOK] Unexpected event. Team={TeamId} Delivery={DeliveryId} Event={Event}",
                    teamId, SafeForLog(deliveryId), SafeForLog(eventName));

                return BadRequest(new { error = "unsupported_webhook_event" });
            }

            var signingSecret = GetSigningSecret(teamId);
            if (string.IsNullOrWhiteSpace(signingSecret))
            {
                _log.LogError(
                    "[LOGTAG-WEBHOOK] Missing signing secret for Team={TeamId}.",
                    teamId);

                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "webhook_not_configured"
                });
            }

            byte[] rawBody;
            try
            {
                rawBody = await ReadRawBodyLimitedAsync(
                    Request,
                    GetMaxBodyBytes(),
                    ct);
            }
            catch (PayloadTooLargeException ex)
            {
                _log.LogWarning(
                    "[LOGTAG-WEBHOOK] Payload too large. Team={TeamId} Delivery={DeliveryId} Max={MaxBytes}",
                    teamId, SafeForLog(deliveryId), ex.MaxBytes);

                return StatusCode(StatusCodes.Status413PayloadTooLarge, new
                {
                    error = "payload_too_large",
                    maxBytes = ex.MaxBytes
                });
            }

            if (rawBody.Length == 0)
                return BadRequest(new { error = "empty_body" });

            // Phải verify HMAC trên raw bytes trước khi parse JSON.
            if (!VerifyHmacSha256(rawBody, signingSecret, signature))
            {
                _log.LogWarning(
                    "[LOGTAG-WEBHOOK] Invalid signature. Team={TeamId} Delivery={DeliveryId}",
                    teamId, SafeForLog(deliveryId));

                return Unauthorized(new { error = "invalid_signature" });
            }

            LogTagReadingsWebhookPayload? payload;
            try
            {
                payload = JsonSerializer.Deserialize<LogTagReadingsWebhookPayload>(
                    rawBody,
                    JsonOptions);
            }
            catch (JsonException ex)
            {
                _log.LogWarning(
                    ex,
                    "[LOGTAG-WEBHOOK] Invalid JSON. Team={TeamId} Delivery={DeliveryId}",
                    teamId, SafeForLog(deliveryId));

                return BadRequest(new { error = "invalid_json" });
            }

            if (payload?.Devices == null || payload.Devices.Count == 0)
            {
                return Ok(new
                {
                    accepted = true,
                    duplicateSafe = true,
                    deliveryId,
                    devices = 0,
                    readings = 0
                });
            }

            var prepared = new List<PreparedDevice>(payload.Devices.Count);
            var totalReadings = 0;
            var invalidSensorValues = 0;
            var ignoredSensorOnlyReadings = 0;
            var unknownSensorFields = 0;

            foreach (var device in payload.Devices)
            {
                var serial = NormalizeSerial(device.Serial);
                if (serial == null)
                {
                    _log.LogWarning(
                        "[LOGTAG-WEBHOOK] Device without serial ignored. Team={TeamId} Delivery={DeliveryId}",
                        teamId, SafeForLog(deliveryId));
                    continue;
                }

                var rows = new List<LocationReadingDTO>();

                foreach (var reading in device.Readings ?? Enumerable.Empty<LogTagWebhookReading>())
                {
                    if (!TryParseUtc(reading.TimestampUtc, out var timestampUtc))
                    {
                        _log.LogWarning(
                            "[LOGTAG-WEBHOOK] Invalid TimestampUtc ignored. Team={TeamId} Serial={Serial} Value={Timestamp}",
                            teamId, serial, SafeForLog(reading.TimestampUtc));
                        continue;
                    }

                    var temperature = ParseSensorValue(
                        reading.TemperatureCelsius,
                        out var tempInvalid);

                    var humidity = ParseSensorValue(
                        reading.HumidityPercentRH,
                        out var humidityInvalid);

                    if (tempInvalid) invalidSensorValues++;
                    if (humidityInvalid) invalidSensorValues++;

                    if (reading.ExtensionData != null)
                        unknownSensorFields += reading.ExtensionData.Count;

                    // Model LocationReadings hiện tại chỉ lưu Temperature/Humidity.
                    // Không tạo record rỗng nếu payload chỉ có sensor khác.
                    if (reading.TemperatureCelsius == null &&
                        reading.HumidityPercentRH == null)
                    {
                        ignoredSensorOnlyReadings++;
                        continue;
                    }

                    rows.Add(new LocationReadingDTO
                    {
                        dateUtc = timestampUtc,
                        temperature = temperature,
                        humidity = humidity
                    });
                }

                if (rows.Count == 0)
                    continue;

                rows = rows
                    .Where(x => x.dateUtc != default)
                    .GroupBy(x => x.dateUtc)
                    .Select(g => g.Last())
                    .OrderBy(x => x.dateUtc)
                    .ToList();

                if (rows.Count == 0)
                    continue;

                totalReadings += rows.Count;

                prepared.Add(new PreparedDevice(
                    serial,
                    device.Model,
                    rows));
            }

            if (prepared.Count == 0)
            {
                _log.LogInformation(
                    "[LOGTAG-WEBHOOK] No Temperature/Humidity rows to persist. Team={TeamId} Delivery={DeliveryId} UnknownSensorFields={UnknownFields}",
                    teamId, SafeForLog(deliveryId), unknownSensorFields);

                return Ok(new
                {
                    accepted = true,
                    duplicateSafe = true,
                    deliveryId,
                    devices = 0,
                    readings = 0,
                    invalidSensorValues,
                    ignoredSensorOnlyReadings,
                    unknownSensorFields
                });
            }

            // LogTag timeout là 15s. Giữ timeout nội bộ thấp hơn để còn thời gian trả response.
            using var processingCts =
                CancellationTokenSource.CreateLinkedTokenSource(ct);

            processingCts.CancelAfter(
                TimeSpan.FromSeconds(GetProcessingTimeoutSeconds()));

            try
            {
                var parallelOptions = new ParallelOptions
                {
                    CancellationToken = processingCts.Token,
                    MaxDegreeOfParallelism = GetMaxParallelDevices()
                };

                await Parallel.ForEachAsync(
                    prepared,
                    parallelOptions,
                    async (device, token) =>
                    {
                        await _locationReadings.UpsertManyAsync(
                            teamId,
                            device.Serial,
                            device.Readings,
                            token);
                    });
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                _log.LogWarning(
                    "[LOGTAG-WEBHOOK] Processing timeout. Team={TeamId} Delivery={DeliveryId} Devices={Devices} Readings={Readings}",
                    teamId, SafeForLog(deliveryId), prepared.Count, totalReadings);

                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "processing_timeout",
                    retryable = true
                });
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // Non-2xx để LogTag retry. Upsert serial+timestamp giúp retry không duplicate.
                _log.LogError(
                    ex,
                    "[LOGTAG-WEBHOOK] Processing failed. Team={TeamId} Delivery={DeliveryId} Devices={Devices} Readings={Readings}",
                    teamId, SafeForLog(deliveryId), prepared.Count, totalReadings);

                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    error = "processing_failed",
                    retryable = true
                });
            }

            _log.LogInformation(
                "[LOGTAG-WEBHOOK] Accepted. Team={TeamId} Delivery={DeliveryId} WebhookTs={WebhookTimestamp} GeneratedUtc={GeneratedUtc} Devices={Devices} Readings={Readings} InvalidSensorValues={InvalidValues} UnknownSensorFields={UnknownFields}",
                teamId,
                SafeForLog(deliveryId),
                SafeForLog(webhookTimestamp),
                SafeForLog(payload.GeneratedUtc),
                prepared.Count,
                totalReadings,
                invalidSensorValues,
                unknownSensorFields);

            return Ok(new
            {
                accepted = true,
                duplicateSafe = true,
                deliveryId,
                devices = prepared.Count,
                readings = totalReadings,
                invalidSensorValues,
                ignoredSensorOnlyReadings,
                unknownSensorFields
            });
        }

        private string? GetSigningSecret(long teamId)
        {
            var teamSecret =
                _configuration[$"LogTagReadingsWebhook:Teams:{teamId}:SigningSecret"];

            if (!string.IsNullOrWhiteSpace(teamSecret))
                return teamSecret;

            return _configuration["LogTagReadingsWebhook:SigningSecret"];
        }

        private int GetMaxBodyBytes()
        {
            var configured =
                _configuration.GetValue<int?>("LogTagReadingsWebhook:MaxBodyBytes");

            return configured is > 0
                ? Math.Clamp(configured.Value, 64 * 1024, 16 * 1024 * 1024)
                : DefaultMaxBodyBytes;
        }

        private int GetProcessingTimeoutSeconds()
        {
            var configured =
                _configuration.GetValue<int?>(
                    "LogTagReadingsWebhook:ProcessingTimeoutSeconds");

            return configured is > 0
                ? Math.Clamp(configured.Value, 2, 13)
                : DefaultProcessingTimeoutSeconds;
        }

        private int GetMaxParallelDevices()
        {
            var configured =
                _configuration.GetValue<int?>(
                    "LogTagReadingsWebhook:MaxParallelDevices");

            return configured is > 0
                ? Math.Clamp(configured.Value, 1, 8)
                : DefaultMaxParallelDevices;
        }

        private string? GetHeader(string name)
        {
            if (!Request.Headers.TryGetValue(name, out var values))
                return null;

            var value = values.FirstOrDefault();
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static bool VerifyHmacSha256(
            ReadOnlySpan<byte> rawBody,
            string signingSecret,
            string? signatureHeader)
        {
            if (string.IsNullOrWhiteSpace(signatureHeader))
                return false;

            var supplied = signatureHeader.Trim();

            const string prefix = "sha256=";
            if (supplied.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                supplied = supplied[prefix.Length..];

            if (supplied.Length != 64)
                return false;

            Span<byte> suppliedBytes = stackalloc byte[32];

            // Không dùng Convert.TryFromHexString để tương thích với target framework
            // hiện tại của project.
            if (!TryDecodeHex64(supplied, suppliedBytes))
                return false;

            var secretBytes = Encoding.UTF8.GetBytes(signingSecret);
            try
            {
                Span<byte> computed = stackalloc byte[32];
                HMACSHA256.HashData(secretBytes, rawBody, computed);

                return CryptographicOperations.FixedTimeEquals(
                    computed,
                    suppliedBytes);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(secretBytes);
            }
        }

        private static bool TryDecodeHex64(
            string hex,
            Span<byte> destination)
        {
            if (hex == null || hex.Length != 64 || destination.Length < 32)
                return false;

            for (var i = 0; i < 32; i++)
            {
                var high = HexToInt(hex[i * 2]);
                var low = HexToInt(hex[i * 2 + 1]);

                if (high < 0 || low < 0)
                    return false;

                destination[i] = (byte)((high << 4) | low);
            }

            return true;
        }

        private static int HexToInt(char c)
        {
            if (c >= '0' && c <= '9')
                return c - '0';

            if (c >= 'a' && c <= 'f')
                return c - 'a' + 10;

            if (c >= 'A' && c <= 'F')
                return c - 'A' + 10;

            return -1;
        }

        private static async Task<byte[]> ReadRawBodyLimitedAsync(
            HttpRequest request,
            int maxBytes,
            CancellationToken ct)
        {
            if (request.ContentLength.HasValue &&
                request.ContentLength.Value > maxBytes)
            {
                throw new PayloadTooLargeException(maxBytes);
            }

            var initialCapacity = request.ContentLength.HasValue
                ? (int)Math.Min(request.ContentLength.Value, maxBytes)
                : 16 * 1024;

            using var output = new MemoryStream(initialCapacity);

            var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
            try
            {
                var total = 0;

                while (true)
                {
                    var read = await request.Body.ReadAsync(
                        buffer.AsMemory(0, buffer.Length),
                        ct);

                    if (read == 0)
                        break;

                    total += read;
                    if (total > maxBytes)
                        throw new PayloadTooLargeException(maxBytes);

                    await output.WriteAsync(
                        buffer.AsMemory(0, read),
                        ct);
                }

                return output.ToArray();
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
            }
        }

        private static double? ParseSensorValue(
            LogTagWebhookSensorValue? sensor,
            out bool invalid)
        {
            invalid = false;

            if (sensor == null)
                return null;

            var value = sensor.Value;

            if (value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            {
                invalid = true;
                return null;
            }

            if (value.ValueKind == JsonValueKind.Number)
            {
                if (value.TryGetDouble(out var numeric) &&
                    double.IsFinite(numeric))
                {
                    return numeric;
                }

                invalid = true;
                return null;
            }

            if (value.ValueKind == JsonValueKind.String)
            {
                var raw = value.GetString()?.Trim();

                if (string.IsNullOrWhiteSpace(raw) ||
                    string.Equals(raw, "--", StringComparison.Ordinal))
                {
                    invalid = true;
                    return null;
                }

                if (double.TryParse(
                        raw,
                        NumberStyles.Float,
                        CultureInfo.InvariantCulture,
                        out var parsed) &&
                    double.IsFinite(parsed))
                {
                    return parsed;
                }

                invalid = true;
                return null;
            }

            invalid = true;
            return null;
        }

        private static bool TryParseUtc(
            string? value,
            out DateTime utc)
        {
            utc = default;

            if (string.IsNullOrWhiteSpace(value))
                return false;

            if (!DateTimeOffset.TryParse(
                    value,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal |
                    DateTimeStyles.AdjustToUniversal,
                    out var dto))
            {
                return false;
            }

            utc = dto.UtcDateTime;
            return true;
        }

        private static string? NormalizeSerial(string? serial)
        {
            if (string.IsNullOrWhiteSpace(serial))
                return null;

            return serial.Trim().ToUpperInvariant();
        }

        private static string? SafeForLog(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            var sanitized = value
                .Replace("\r", string.Empty, StringComparison.Ordinal)
                .Replace("\n", string.Empty, StringComparison.Ordinal);

            return sanitized.Length <= 256
                ? sanitized
                : sanitized[..256];
        }

        private sealed record PreparedDevice(
            string Serial,
            string? Model,
            List<LocationReadingDTO> Readings);

        private sealed class PayloadTooLargeException : Exception
        {
            public int MaxBytes { get; }

            public PayloadTooLargeException(int maxBytes)
                : base($"Webhook payload exceeds {maxBytes} bytes.")
            {
                MaxBytes = maxBytes;
            }
        }
    }

    public sealed class LogTagReadingsWebhookPayload
    {
        public string? GeneratedUtc { get; set; }
        public List<LogTagWebhookDevice> Devices { get; set; } = new();
    }

    public sealed class LogTagWebhookDevice
    {
        public string? Serial { get; set; }
        public string? Model { get; set; }
        public List<LogTagWebhookReading> Readings { get; set; } = new();
    }

    public sealed class LogTagWebhookReading
    {
        public string? TimestampUtc { get; set; }
        public LogTagWebhookSensorValue? TemperatureCelsius { get; set; }
        public LogTagWebhookSensorValue? HumidityPercentRH { get; set; }

        // Forward-compatible: giữ các field sensor mới để không deserialize fail.
        [JsonExtensionData]
        public Dictionary<string, JsonElement>? ExtensionData { get; set; }
    }

    public sealed class LogTagWebhookSensorValue
    {
        // Ví dụ LogTag gửi "4.2"; invalid có thể là "--".
        public JsonElement Value { get; set; }
        public List<string> Flags { get; set; } = new();
    }
}

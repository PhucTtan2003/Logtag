using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Security.Cryptography;
using System.Text;
using temperature_humi.Data;
using temperature_humi.Models.SmsFpt;

namespace temperature_humi.Service
{
    public sealed class SmsDispatchBeginResult
    {
        public bool Created { get; init; }
        public SmsDispatch Dispatch { get; init; } = new();
    }

    public sealed class SmsDispatchService
    {
        private readonly IMongoCollection<SmsDispatch> _col;
        private readonly ILogger<SmsDispatchService> _log;

        public SmsDispatchService(
            IOptions<MongoDBSettings> settings,
            ILogger<SmsDispatchService> log)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _col = db.GetCollection<SmsDispatch>("SmsDispatches");
            _log = log;

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            try
            {
                _col.Indexes.CreateOne(new CreateIndexModel<SmsDispatch>(
                    Builders<SmsDispatch>.IndexKeys.Ascending(x => x.IdempotencyKey),
                    new CreateIndexOptions
                    {
                        Name = "ux_smsdispatch_idempotency",
                        Unique = true
                    }));

                _col.Indexes.CreateOne(new CreateIndexModel<SmsDispatch>(
                    Builders<SmsDispatch>.IndexKeys
                        .Ascending(x => x.UserId)
                        .Descending(x => x.CreatedAtUtc),
                    new CreateIndexOptions { Name = "ix_smsdispatch_user_created" }));

                _col.Indexes.CreateOne(new CreateIndexModel<SmsDispatch>(
                    Builders<SmsDispatch>.IndexKeys
                        .Ascending(x => x.Phone)
                        .Descending(x => x.CreatedAtUtc),
                    new CreateIndexOptions { Name = "ix_smsdispatch_phone_created" }));
            }
            catch (Exception ex)
            {
                var msg = ex.Message ?? string.Empty;
                if (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("exists with different options", StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }

                _log.LogWarning(ex, "[SMS-IDEMPOTENCY] EnsureIndexes failed.");
            }
        }

        public static string BuildIdempotencyKey(
            ObjectId? userId,
            string phone,
            string eventType,
            string? serialNumber,
            DateTime? eventTimeUtc,
            string message,
            string? idempotencySeed = null)
        {
            var normalizedPhone = Normalize(phone);
            var normalizedType = Normalize(eventType).ToLowerInvariant();
            var normalizedSerial = Normalize(serialNumber).ToUpperInvariant();
            var messageHash = Sha256(message ?? string.Empty);

            string identity;
            if (!string.IsNullOrWhiteSpace(idempotencySeed))
            {
                identity = idempotencySeed.Trim();
            }
            else if (eventTimeUtc.HasValue)
            {
                var utc = AsUtc(eventTimeUtc.Value);
                identity = $"{normalizedSerial}|{normalizedType}|{utc:O}";
            }
            else
            {
                // Fallback chỉ dành cho caller cũ chưa truyền event time.
                // Dedupe theo phút để tránh loop ngắn hạn nhưng không chặn SMS hợp lệ lâu dài.
                var now = DateTime.UtcNow;
                var minute = new DateTime(
                    now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, DateTimeKind.Utc);
                identity = $"fallback|{normalizedSerial}|{normalizedType}|{minute:yyyyMMddHHmm}|{messageHash}";
            }

            var canonical = string.Join("|",
                userId?.ToString() ?? "anonymous",
                normalizedPhone,
                normalizedType,
                normalizedSerial,
                identity,
                messageHash);

            return Sha256(canonical);
        }

        public static string BuildSessionId(string idempotencyKey)
        {
            var clean = new string((idempotencyKey ?? string.Empty)
                .Where(char.IsLetterOrDigit)
                .ToArray());

            if (clean.Length < 32)
                clean = Sha256(idempotencyKey ?? string.Empty);

            return clean[..32].ToLowerInvariant();
        }

        public async Task<SmsDispatchBeginResult> TryBeginAsync(
            ObjectId? userId,
            string phone,
            string eventType,
            string? serialNumber,
            DateTime? eventTimeUtc,
            string message,
            string? idempotencySeed,
            CancellationToken ct = default)
        {
            var key = BuildIdempotencyKey(
                userId,
                phone,
                eventType,
                serialNumber,
                eventTimeUtc,
                message,
                idempotencySeed);

            var now = DateTime.UtcNow;
            var doc = new SmsDispatch
            {
                Id = ObjectId.GenerateNewId(),
                IdempotencyKey = key,
                SessionId = BuildSessionId(key),
                UserId = userId is { } uid && uid != ObjectId.Empty ? uid : null,
                Phone = phone,
                EventType = eventType,
                SerialNumber = string.IsNullOrWhiteSpace(serialNumber) ? null : serialNumber.Trim().ToUpperInvariant(),
                EventTimeUtc = eventTimeUtc.HasValue ? AsUtc(eventTimeUtc.Value) : null,
                MessageHash = Sha256(message ?? string.Empty),
                Status = SmsDispatchStatus.Processing,
                Attempts = 0,
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            };

            try
            {
                await _col.InsertOneAsync(doc, cancellationToken: ct);
                return new SmsDispatchBeginResult { Created = true, Dispatch = doc };
            }
            catch (MongoWriteException ex) when (ex.WriteError?.Code == 11000)
            {
                var existing = await _col
                    .Find(x => x.IdempotencyKey == key)
                    .FirstOrDefaultAsync(ct);

                return new SmsDispatchBeginResult
                {
                    Created = false,
                    Dispatch = existing ?? doc
                };
            }
        }

        public Task MarkAttemptAsync(string idempotencyKey, CancellationToken ct = default)
        {
            var update = Builders<SmsDispatch>.Update
                .Inc(x => x.Attempts, 1)
                .Set(x => x.UpdatedAtUtc, DateTime.UtcNow);

            return _col.UpdateOneAsync(
                x => x.IdempotencyKey == idempotencyKey,
                update,
                cancellationToken: ct);
        }

        public Task MarkSentAsync(
            string idempotencyKey,
            object? providerResponse,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;
            var response = providerResponse == null
                ? null
                : Truncate(System.Text.Json.JsonSerializer.Serialize(providerResponse), 4000);

            var update = Builders<SmsDispatch>.Update
                .Set(x => x.Status, SmsDispatchStatus.Sent)
                .Set(x => x.ProviderResponse, response)
                .Set(x => x.LastError, (string?)null)
                .Set(x => x.SentAtUtc, now)
                .Set(x => x.UpdatedAtUtc, now);

            return _col.UpdateOneAsync(
                x => x.IdempotencyKey == idempotencyKey,
                update,
                cancellationToken: ct);
        }

        public Task MarkFailedAsync(
            string idempotencyKey,
            bool ambiguous,
            string? error,
            string? providerResponse = null,
            CancellationToken ct = default)
        {
            var update = Builders<SmsDispatch>.Update
                .Set(x => x.Status, ambiguous ? SmsDispatchStatus.Unknown : SmsDispatchStatus.Failed)
                .Set(x => x.LastError, Truncate(error, 4000))
                .Set(x => x.ProviderResponse, Truncate(providerResponse, 4000))
                .Set(x => x.UpdatedAtUtc, DateTime.UtcNow);

            return _col.UpdateOneAsync(
                x => x.IdempotencyKey == idempotencyKey,
                update,
                cancellationToken: ct);
        }

        /// <summary>
        /// Chỉ dùng khi chưa hề gọi FPT (ví dụ quota không đủ).
        /// Xoá processing dispatch để cùng event có thể gửi lại sau khi user gia hạn quota.
        /// </summary>
        public Task CancelBeforeSendAsync(
            string idempotencyKey,
            CancellationToken ct = default)
        {
            var filter = Builders<SmsDispatch>.Filter.And(
                Builders<SmsDispatch>.Filter.Eq(x => x.IdempotencyKey, idempotencyKey),
                Builders<SmsDispatch>.Filter.Eq(x => x.Status, SmsDispatchStatus.Processing),
                Builders<SmsDispatch>.Filter.Eq(x => x.Attempts, 0));

            return _col.DeleteOneAsync(filter, ct);
        }

        private static string Normalize(string? value)
            => (value ?? string.Empty).Trim();

        private static DateTime AsUtc(DateTime value)
        {
            if (value.Kind == DateTimeKind.Utc)
                return value;
            if (value.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(value, DateTimeKind.Utc);
            return value.ToUniversalTime();
        }

        private static string Sha256(string value)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty));
            return Convert.ToHexString(bytes);
        }

        private static string? Truncate(string? value, int max)
        {
            if (string.IsNullOrEmpty(value))
                return value;
            return value.Length <= max ? value : value[..max];
        }
    }
}

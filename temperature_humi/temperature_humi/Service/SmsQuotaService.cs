using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models.CreateCode;

namespace temperature_humi.Service
{
    public sealed class SmsQuotaState
    {
        public bool HasSubscription { get; set; }
        public bool IsActive { get; set; }
        public bool SmsEnabled { get; set; }
        public bool SmsUnlimited { get; set; }
        public int? SmsQuotaTotal { get; set; }
        public int SmsQuotaUsed { get; set; }
        public int? SmsRemaining { get; set; }
        public int? SmsWarnAtRemaining { get; set; }
        public bool IsLow { get; set; }
        public bool LowQuotaJustReached { get; set; }
        public DateTime? EndsAtUtc { get; set; }
        public string? Reason { get; set; }
    }

    public sealed class SmsQuotaReserveResult
    {
        public bool Allowed { get; set; }
        public string Reason { get; set; } = "unknown";
        public SmsQuotaState State { get; set; } = new();
    }

    public sealed class SmsQuotaService
    {
        private const string FeatureSmsAlert = "sms_alert";

        private readonly IMongoCollection<Subscription> _subscriptions;
        private readonly ILogger<SmsQuotaService> _log;

        public SmsQuotaService(
            IOptions<MongoDBSettings> settings,
            ILogger<SmsQuotaService> log)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _subscriptions = db.GetCollection<Subscription>("Subscriptions");
            _log = log;

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            try
            {
                var idx = Builders<Subscription>.IndexKeys
                    .Ascending(x => x.UserId)
                    .Descending(x => x.EndsAtUtc);

                _subscriptions.Indexes.CreateOne(new CreateIndexModel<Subscription>(
                    idx,
                    new CreateIndexOptions { Name = "ix_smsquota_user_end" }));
            }
            catch (Exception ex)
            {
                var msg = ex.Message ?? string.Empty;
                if (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("exists with different options", StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }

                _log.LogWarning(ex, "[SMS-QUOTA] EnsureIndexes failed.");
            }
        }

        public async Task<SmsQuotaState> GetQuotaAsync(
            ObjectId userId,
            CancellationToken ct = default)
        {
            var sub = await GetActiveSubAsync(userId, ct);
            return BuildState(sub);
        }

        public async Task<SmsQuotaReserveResult> TryReserveAsync(
            ObjectId userId,
            int smsCount,
            string? eventType = null,
            string? serialNumber = null,
            CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty)
                return Deny("invalid_user", null);

            smsCount = Math.Max(0, smsCount);
            if (smsCount == 0)
            {
                return new SmsQuotaReserveResult
                {
                    Allowed = true,
                    Reason = "no_sms_to_send",
                    State = await GetQuotaAsync(userId, ct)
                };
            }

            var sub = await GetActiveSubAsync(userId, ct);
            var stateBefore = BuildState(sub);

            if (sub == null)
                return Deny("no_active_subscription", stateBefore);

            if (!stateBefore.SmsEnabled)
                return Deny("sms_feature_not_enabled", stateBefore);

            // Unlimited: chỉ xác nhận quyền gửi. LastSmsSentAtUtc sẽ cập nhật sau khi gửi thành công.
            if (sub.SmsUnlimited)
            {
                return new SmsQuotaReserveResult
                {
                    Allowed = true,
                    Reason = "unlimited",
                    State = stateBefore
                };
            }

            if (!sub.SmsQuotaTotal.HasValue || sub.SmsQuotaTotal.Value <= 0)
                return Deny("sms_quota_not_configured", stateBefore);

            var remainingBefore = Math.Max(0, sub.SmsQuotaTotal.Value - sub.SmsQuotaUsed);
            if (remainingBefore < smsCount)
                return Deny("sms_quota_exhausted", stateBefore);

            // Atomic reserve để nhiều cảnh báo chạy cùng lúc không vượt quota.
            var filter = new BsonDocument
            {
                { "_id", sub.Id },
                { "features", FeatureSmsAlert },
                { "smsUnlimited", new BsonDocument("$ne", true) },
                { "smsQuotaTotal", new BsonDocument { { "$exists", true }, { "$ne", BsonNull.Value } } },
                {
                    "$expr",
                    new BsonDocument("$lte", new BsonArray
                    {
                        new BsonDocument("$add", new BsonArray
                        {
                            new BsonDocument("$ifNull", new BsonArray { "$smsQuotaUsed", 0 }),
                            smsCount
                        }),
                        "$smsQuotaTotal"
                    })
                }
            };

            var update = Builders<Subscription>.Update
                .Inc(x => x.SmsQuotaUsed, smsCount);

            FilterDefinition<Subscription> atomicFilter = filter;

            var updated = await _subscriptions.FindOneAndUpdateAsync(
                atomicFilter,
                update,
                new FindOneAndUpdateOptions<Subscription>
                {
                    ReturnDocument = ReturnDocument.After
                },
                ct);

            if (updated == null)
            {
                var latest = await GetQuotaAsync(userId, ct);
                return Deny("sms_quota_race_or_exhausted", latest);
            }

            return new SmsQuotaReserveResult
            {
                Allowed = true,
                Reason = "reserved",
                State = BuildState(updated)
            };
        }

        /// <summary>
        /// Chỉ gọi sau khi FPT đã trả thành công rõ ràng.
        /// Cập nhật LastSmsSentAtUtc và low-quota warning đúng thời điểm.
        /// </summary>
        public async Task<SmsQuotaState?> MarkSentAsync(
            ObjectId userId,
            CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty)
                return null;

            var sub = await GetActiveSubAsync(userId, ct);
            if (sub == null)
                return null;

            var now = DateTime.UtcNow;
            await _subscriptions.UpdateOneAsync(
                x => x.Id == sub.Id,
                Builders<Subscription>.Update.Set(x => x.LastSmsSentAtUtc, now),
                cancellationToken: ct);

            // Đọc lại vì quota có thể vừa được reserve bởi request khác.
            sub = await _subscriptions.Find(x => x.Id == sub.Id).FirstOrDefaultAsync(ct);
            if (sub == null)
                return null;

            var state = BuildState(sub);

            if (state.IsLow && !sub.SmsLowQuotaWarned)
            {
                var lowUpdate = Builders<Subscription>.Update
                    .Set(x => x.SmsLowQuotaWarned, true)
                    .Set(x => x.SmsLowQuotaWarnedAtUtc, now);

                var result = await _subscriptions.UpdateOneAsync(
                    Builders<Subscription>.Filter.And(
                        Builders<Subscription>.Filter.Eq(x => x.Id, sub.Id),
                        Builders<Subscription>.Filter.Ne(x => x.SmsLowQuotaWarned, true)),
                    lowUpdate,
                    cancellationToken: ct);

                if (result.ModifiedCount > 0)
                {
                    state.LowQuotaJustReached = true;
                    _log.LogWarning(
                        "[SMS-QUOTA] LOW userId={UserId}, remaining={Remaining}, total={Total}, warnAt={WarnAt}",
                        userId,
                        state.SmsRemaining,
                        state.SmsQuotaTotal,
                        state.SmsWarnAtRemaining);
                }
            }

            return state;
        }

        /// <summary>
        /// Trả quota lại khi đã reserve nhưng FPT thất bại RÕ RÀNG.
        /// Không dùng cho timeout/network ambiguity vì SMS có thể đã được FPT nhận.
        /// CAS loop tránh lost-update khi nhiều request release cùng lúc.
        /// </summary>
        public async Task ReleaseAsync(
            ObjectId userId,
            int smsCount,
            CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty || smsCount <= 0)
                return;

            for (var attempt = 0; attempt < 5; attempt++)
            {
                var sub = await GetActiveSubAsync(userId, ct);
                if (sub == null || sub.SmsUnlimited)
                    return;

                var oldUsed = Math.Max(0, sub.SmsQuotaUsed);
                var newUsed = Math.Max(0, oldUsed - smsCount);

                var filter = Builders<Subscription>.Filter.And(
                    Builders<Subscription>.Filter.Eq(x => x.Id, sub.Id),
                    Builders<Subscription>.Filter.Eq(x => x.SmsQuotaUsed, sub.SmsQuotaUsed));

                var update = Builders<Subscription>.Update
                    .Set(x => x.SmsQuotaUsed, newUsed);

                var result = await _subscriptions.UpdateOneAsync(filter, update, cancellationToken: ct);
                if (result.MatchedCount == 0)
                    continue;

                // Nếu release làm remaining tăng lên trên ngưỡng warning thì reset cờ.
                var refreshed = await _subscriptions.Find(x => x.Id == sub.Id).FirstOrDefaultAsync(ct);
                if (refreshed != null)
                {
                    var state = BuildState(refreshed);
                    if (!state.IsLow && refreshed.SmsLowQuotaWarned)
                    {
                        await _subscriptions.UpdateOneAsync(
                            x => x.Id == refreshed.Id,
                            Builders<Subscription>.Update
                                .Set(x => x.SmsLowQuotaWarned, false)
                                .Set(x => x.SmsLowQuotaWarnedAtUtc, (DateTime?)null),
                            cancellationToken: ct);
                    }
                }

                return;
            }

            _log.LogWarning(
                "[SMS-QUOTA] Release CAS failed after retries. userId={UserId}, count={Count}",
                userId,
                smsCount);
        }

        private async Task<Subscription?> GetActiveSubAsync(
            ObjectId userId,
            CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var today00 = now.Date;

            var filter = Builders<Subscription>.Filter.And(
                Builders<Subscription>.Filter.Eq(x => x.UserId, userId),
                Builders<Subscription>.Filter.Lte(x => x.StartedAtUtc, now),
                Builders<Subscription>.Filter.Gte(x => x.EndsAtUtc, today00));

            return await _subscriptions
                .Find(filter)
                .SortByDescending(x => x.EndsAtUtc)
                .FirstOrDefaultAsync(ct);
        }

        private static SmsQuotaState BuildState(Subscription? sub)
        {
            if (sub == null)
            {
                return new SmsQuotaState
                {
                    HasSubscription = false,
                    IsActive = false,
                    SmsEnabled = false,
                    Reason = "no_active_subscription"
                };
            }

            var smsEnabled = (sub.Features ?? Array.Empty<string>())
                .Contains(FeatureSmsAlert, StringComparer.OrdinalIgnoreCase);

            int? remaining = null;
            if (!sub.SmsUnlimited)
            {
                remaining = sub.SmsQuotaTotal.HasValue
                    ? Math.Max(0, sub.SmsQuotaTotal.Value - sub.SmsQuotaUsed)
                    : 0;
            }

            var isLow = smsEnabled
                && !sub.SmsUnlimited
                && remaining.HasValue
                && sub.SmsWarnAtRemaining.HasValue
                && remaining.Value <= sub.SmsWarnAtRemaining.Value;

            return new SmsQuotaState
            {
                HasSubscription = true,
                IsActive = sub.EndsAtUtc.Date >= DateTime.UtcNow.Date,
                SmsEnabled = smsEnabled,
                SmsUnlimited = sub.SmsUnlimited,
                SmsQuotaTotal = sub.SmsQuotaTotal,
                SmsQuotaUsed = Math.Max(0, sub.SmsQuotaUsed),
                SmsRemaining = remaining,
                SmsWarnAtRemaining = sub.SmsWarnAtRemaining,
                IsLow = isLow,
                EndsAtUtc = sub.EndsAtUtc,
                Reason = "ok"
            };
        }

        private static SmsQuotaReserveResult Deny(
            string reason,
            SmsQuotaState? state)
        {
            return new SmsQuotaReserveResult
            {
                Allowed = false,
                Reason = reason,
                State = state ?? new SmsQuotaState { Reason = reason }
            };
        }
    }
}

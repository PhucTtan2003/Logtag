using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models.CreateCode;
using temperature_humi.Models.SmsFpt;

namespace temperature_humi.Service.Admin
{
    public class SubscriptionService
    {
        private const string FeatureSmsAlert = "sms_alert";
        private const string FeatureSmsSchedule = "sms_schedule";

        private readonly IMongoCollection<LicenseCode> _licenseCodes;
        private readonly IMongoCollection<Subscription> _subscriptions;
        private readonly SmsActivationService _smsActivation;

        public SubscriptionService(
     IOptions<MongoDBSettings> settings,
     SmsActivationService smsActivation)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            _licenseCodes = db.GetCollection<LicenseCode>("LicenseCodes");
            _subscriptions = db.GetCollection<Subscription>("Subscriptions");

            _smsActivation = smsActivation;
        }
        // ==================== Helper trạng thái (theo NGÀY) ====================
        // Active đến hết 23:59:59 của ngày EndsAtUtc
        // daysLeft = (Ends.Date - Now.Date), ví dụ hôm nay 29 và ends 30 → 1
        public static (bool isActive, int daysLeft) ComputeState(
            DateTime startedUtc, DateTime endsUtc, DateTime? nowUtc = null)
        {
            var now = nowUtc ?? DateTime.UtcNow;
            var endExclusive = endsUtc.Date.AddDays(1);  // 00:00 ngày kế tiếp
            var isActive = startedUtc <= now && now < endExclusive;
            var daysLeft = isActive ? Math.Max(0, (endsUtc.Date - now.Date).Days) : 0;
            return (isActive, daysLeft);
        }

        public Task InvalidateUserCacheAsync(ObjectId userId) => Task.CompletedTask;

        #region License issuing helpers

        public async Task<LicenseCode> CreateLicenseCodeAsync(
     string code,
     string plan,
     string[] features,
     int durationDays,
     int maxActivations,
     string? notes,
     ObjectId? createdBy,
     int? smsQuotaTotal = null,
     bool smsUnlimited = false,
     int? smsWarnAtRemaining = null,
     CancellationToken ct = default)
        {
            var lic = new LicenseCode
            {
                Id = ObjectId.GenerateNewId(),
                Code = code,
                Plan = plan,
                Features = features ?? Array.Empty<string>(),
                DurationDays = durationDays <= 0 ? 180 : durationDays,
                MaxActivations = Math.Max(1, maxActivations),
                Notes = notes,
                CreatedAtUtc = DateTime.UtcNow,
                CreatedBy = createdBy,

                // SMS quota
                SmsQuotaTotal = smsUnlimited
                    ? null
                    : NormalizePositiveQuota(smsQuotaTotal),
                SmsUnlimited = smsUnlimited,
                SmsWarnAtRemaining = smsUnlimited
                    ? null
                    : NormalizeWarnAt(
                        smsWarnAtRemaining,
                        NormalizePositiveQuota(smsQuotaTotal))
            };

            await _licenseCodes.InsertOneAsync(lic, cancellationToken: ct);
            return lic;
        }

        public Task UpdateLicenseCodeReservedAsync(
            ObjectId licId,
            ObjectId reservedForUserId,
            ObjectId? adminId,
            CancellationToken ct = default)
        {
            var update = Builders<LicenseCode>.Update
                .Set(x => x.ReservedForUserId, reservedForUserId)
                .Set(x => x.ReservedAtUtc, DateTime.UtcNow)
                .Set(x => x.ReservedByAdminId, adminId);

            return _licenseCodes.UpdateOneAsync(x => x.Id == licId, update, cancellationToken: ct);
        }

        #endregion

        #region Admin list subscriptions (lọc theo NGÀY)

        public async Task<(int total, List<Subscription> items)> AdminListSubsAsync(
            string? status, int skip, int take, CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 200);

            var now = DateTime.UtcNow;
            var today00 = now.Date; // 00:00 UTC hôm nay
            var filter = Builders<Subscription>.Filter.Empty;

            if (!string.IsNullOrWhiteSpace(status))
            {
                var s = status.Trim().ToLowerInvariant();
                if (s == "active")
                {
                    // started <= now  &&  Ends.Date >= today
                    filter = Builders<Subscription>.Filter.And(
                        Builders<Subscription>.Filter.Lte(x => x.StartedAtUtc, now),
                        Builders<Subscription>.Filter.Gte(x => x.EndsAtUtc, today00)
                    );
                }
                else if (s == "expired")
                {
                    // Ends.Date < today
                    filter = Builders<Subscription>.Filter.Lt(x => x.EndsAtUtc, today00);
                }
            }

            var total = (int)await _subscriptions.CountDocumentsAsync(filter, cancellationToken: ct);

            var items = await _subscriptions
                .Find(filter)
                .SortByDescending(x => x.EndsAtUtc)
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            return (total, items);
        }

        #endregion

        #region User helpers (theo NGÀY)

        /// <summary>
        /// Lấy subscription đang còn hiệu lực (tính theo NGÀY) của 1 user.
        /// </summary>
        public async Task<Subscription?> GetActiveAsync(
            ObjectId userId,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;
            var today00 = now.Date;

            var filter = Builders<Subscription>.Filter.And(
                Builders<Subscription>.Filter.Eq(x => x.UserId, userId),
                Builders<Subscription>.Filter.Lte(x => x.StartedAtUtc, now),
                Builders<Subscription>.Filter.Gte(x => x.EndsAtUtc, today00));

            var subscription = await _subscriptions
                .Find(filter)
                .SortByDescending(x => x.EndsAtUtc)
                .FirstOrDefaultAsync(ct);

            if (subscription == null)
                return null;

            // Hỗ trợ các code SMS đã redeem trước khi hệ thống có field quota.
            // Khi /api/subscriptions/me đọc gói active, service tự lấy quota
            // từ LicenseCode gần nhất của user và cập nhật Subscription.
            await TryBackfillSmsQuotaAsync(subscription, ct);

            return subscription;
        }

        #endregion

        #region Redeem

        public async Task<(string plan, string[] features, DateTime startedAt, DateTime endsAt)>
     RedeemCodeAsync(ObjectId userId, string rawCode, CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty)
                throw new ArgumentException("Invalid user id.", nameof(userId));

            if (string.IsNullOrWhiteSpace(rawCode))
                throw new ArgumentException("Code is required.", nameof(rawCode));

            var code = rawCode.Trim().ToUpperInvariant();
            var now = DateTime.UtcNow;

            // 1) Lấy license code
            var codeFilter = Builders<LicenseCode>.Filter.Eq(x => x.Code, code);
            var lic = await _licenseCodes.Find(codeFilter).FirstOrDefaultAsync(ct);
            if (lic == null)
                throw new InvalidOperationException("Code not found.");

            lic.Activations ??= new List<LicenseActivation>();

            if (lic.Activations.Count >= lic.MaxActivations)
                throw new InvalidOperationException("This code has no remaining activation slot.");

            if (lic.ReservedForUserId.HasValue && lic.ReservedForUserId.Value != userId)
                throw new InvalidOperationException("This code is reserved for another user.");

            if (lic.Activations.Any(a => a.UserId == userId))
                throw new InvalidOperationException("You have already redeemed this code.");

            // 2) Ghi activation cho license
            var activation = new LicenseActivation
            {
                UserId = userId,
                RedeemedAtUtc = now
            };

            var pushUpdate = Builders<LicenseCode>.Update.Push(x => x.Activations, activation);
            await _licenseCodes.UpdateOneAsync(codeFilter, pushUpdate, cancellationToken: ct);

            // Thời gian gói từ license
            var newDurationDays = lic.DurationDays <= 0 ? 1 : lic.DurationDays;
            var newEnds = now.AddDays(newDurationDays);

            // 3) Kiểm tra xem user đang có gói active chưa
            var activeSub = await GetActiveAsync(userId, ct);

            if (activeSub != null)
            {
                // --- HỢP NHẤT FEATURES + GIA HẠN GÓI HIỆN TẠI ---
                var existingFeatures = activeSub.Features ?? Array.Empty<string>();
                var licFeatures = lic.Features ?? Array.Empty<string>();

                var featureSet = new HashSet<string>(existingFeatures, StringComparer.OrdinalIgnoreCase);
                foreach (var f in licFeatures)
                {
                    if (!string.IsNullOrWhiteSpace(f))
                        featureSet.Add(f.Trim());
                }

                var mergedFeatures = featureSet.ToArray();

                var plan = lic.Plan ?? activeSub.Plan ?? "basic";
                var startedAt = activeSub.StartedAtUtc;
                var endsAt = newEnds > activeSub.EndsAtUtc ? newEnds : activeSub.EndsAtUtc;

                var update = Builders<Subscription>.Update
                    .Set(x => x.Plan, plan)
                    .Set(x => x.Features, mergedFeatures)
                    .Set(x => x.EndsAtUtc, endsAt);

                if (LicenseGrantsSms(lic))
                {
                    if (activeSub.SmsUnlimited || lic.SmsUnlimited)
                    {
                        // Chỉ cần một trong hai gói là unlimited thì gói hợp nhất
                        // tiếp tục không giới hạn.
                        update = update
                            .Set(x => x.SmsUnlimited, true)
                            .Set(x => x.SmsQuotaTotal, (int?)null)
                            .Set(x => x.SmsWarnAtRemaining, (int?)null)
                            .Set(x => x.SmsLowQuotaWarned, false)
                            .Set(x => x.SmsLowQuotaWarnedAtUtc, (DateTime?)null);
                    }
                    else
                    {
                        // Mã SMS mới được cộng thêm vào tổng quota hiện tại.
                        // Giữ SmsQuotaUsed để không mất lịch sử số tin đã sử dụng.
                        var currentTotal = Math.Max(
                            0,
                            activeSub.SmsQuotaTotal ?? 0);

                        var grantedQuota = Math.Max(
                            0,
                            lic.SmsQuotaTotal ?? 0);

                        var mergedTotal = checked(currentTotal + grantedQuota);

                        update = update
                            .Set(x => x.SmsUnlimited, false)
                            .Set(x => x.SmsQuotaTotal, mergedTotal)
                            .Set(
                                x => x.SmsWarnAtRemaining,
                                NormalizeWarnAt(
                                    lic.SmsWarnAtRemaining
                                        ?? activeSub.SmsWarnAtRemaining,
                                    mergedTotal))
                            .Set(x => x.SmsLowQuotaWarned, false)
                            .Set(x => x.SmsLowQuotaWarnedAtUtc, (DateTime?)null);
                    }
                }

                await _subscriptions.UpdateOneAsync(
                    x => x.Id == activeSub.Id,
                    update,
                    cancellationToken: ct);

                await InvalidateUserCacheAsync(userId);

                return (plan, mergedFeatures, startedAt, endsAt);
            }
            else
            {
                // --- KHÔNG CÓ GÓI NÀO: TẠO MỚI ---
                var plan = lic.Plan ?? "basic";
                var features = lic.Features ?? Array.Empty<string>();
                var startedAt = now;
                var endsAt = newEnds;

                var sub = new Subscription
                {
                    UserId = userId,
                    Plan = plan,
                    Features = features,
                    StartedAtUtc = startedAt,
                    EndsAtUtc = endsAt,
                    CreatedAtUtc = now,

                    SmsQuotaTotal = lic.SmsUnlimited
                        ? null
                        : NormalizePositiveQuota(lic.SmsQuotaTotal),
                    SmsQuotaUsed = 0,
                    SmsUnlimited = lic.SmsUnlimited,
                    SmsWarnAtRemaining = lic.SmsUnlimited
                        ? null
                        : NormalizeWarnAt(
                            lic.SmsWarnAtRemaining,
                            NormalizePositiveQuota(lic.SmsQuotaTotal)),
                    SmsLowQuotaWarned = false,
                    SmsLowQuotaWarnedAtUtc = null,
                    LastSmsSentAtUtc = null
                };

                await _subscriptions.InsertOneAsync(sub, cancellationToken: ct);
                await InvalidateUserCacheAsync(userId);

                return (plan, features, startedAt, endsAt);
            }
        }

        #endregion

        public async Task EnsureIndexesAsync(CancellationToken ct = default)
        {
            var codeIdx = new CreateIndexModel<LicenseCode>(
                Builders<LicenseCode>.IndexKeys.Ascending(x => x.Code),
                new CreateIndexOptions { Unique = true, Name = "UX_LicenseCodes_Code" }
            );
            await _licenseCodes.Indexes.CreateOneAsync(codeIdx, cancellationToken: ct);

            var subIdx = new CreateIndexModel<Subscription>(
                Builders<Subscription>.IndexKeys.Ascending(x => x.UserId).Descending(x => x.EndsAtUtc),
                new CreateIndexOptions { Name = "IX_Subscriptions_User_End" }
            );
            await _subscriptions.Indexes.CreateOneAsync(subIdx, cancellationToken: ct);

            var fixFilter = Builders<LicenseCode>.Filter.Or(
                Builders<LicenseCode>.Filter.Exists("activations", false),
                Builders<LicenseCode>.Filter.Eq("activations", BsonNull.Value)
            );
            var fixUpdate = Builders<LicenseCode>.Update.Set("activations", new BsonArray());
            var result = await _licenseCodes.UpdateManyAsync(fixFilter, fixUpdate, cancellationToken: ct);
            if (result.ModifiedCount > 0)
            {
                Console.WriteLine($"[EnsureIndexes] Fixed {result.ModifiedCount} LicenseCodes (initialized activations).");
            }
        }

        public async Task<bool> HasFeatureAsync(ObjectId userId, string feature, CancellationToken ct = default)
        {
            var sub = await GetActiveAsync(userId, ct);
            if (sub?.Features == null) return false;
            return sub.Features.Contains(feature, StringComparer.OrdinalIgnoreCase);
        }
        public async Task<Subscription?> GetLastAsync(ObjectId userId, CancellationToken ct = default)
        {
            return await _subscriptions
                .Find(x => x.UserId == userId)
                .SortByDescending(x => x.EndsAtUtc)
                .FirstOrDefaultAsync(ct);
        }
        // ==================== Admin helpers ====================
        // ==================== Admin helpers ====================
        public async Task<int> RevokeActiveByLicenseAsync(LicenseCode lic, CancellationToken ct = default)
        {
            if (lic == null) throw new ArgumentNullException(nameof(lic));

            // Nếu code chưa được redeem cho user nào thì thôi
            if (lic.Activations == null || lic.Activations.Count == 0)
                return 0;

            var userIds = lic.Activations
                .Where(a => a.UserId != ObjectId.Empty)
                .Select(a => a.UserId)
                .Distinct()
                .ToArray();

            if (userIds.Length == 0)
                return 0;

            var now = DateTime.UtcNow;

            // Các feature cần gỡ
            var featuresToRemove = (lic.Features ?? Array.Empty<string>())
                .Where(f => !string.IsNullOrWhiteSpace(f))
                .Select(f => f.Trim())
                .ToArray();

            var modified = 0;

            foreach (var uid in userIds)
            {
                // Lấy gói active hiện tại của user
                var sub = await GetActiveAsync(uid, ct);
                if (sub == null) continue;

                var existingFeatures = sub.Features ?? Array.Empty<string>();

                // Nếu license không khai báo features, fallback: expire sub nếu plan trùng
                if (featuresToRemove.Length == 0)
                {
                    if (!string.IsNullOrWhiteSpace(lic.Plan) &&
                        !string.Equals(sub.Plan, lic.Plan, StringComparison.OrdinalIgnoreCase))
                    {
                        // Plan khác → coi như không liên quan
                        continue;
                    }

                    var filterExpire = Builders<Subscription>.Filter.Eq(x => x.Id, sub.Id);
                    var updateExpire = Builders<Subscription>.Update
                        .Set(x => x.EndsAtUtc, now.AddSeconds(-1));


                    var resExpire = await _subscriptions.UpdateOneAsync(filterExpire, updateExpire, cancellationToken: ct);
                    if (resExpire.ModifiedCount > 0) modified++;
                    continue;
                }

                // Gỡ các feature thuộc license này ra khỏi subscription
                var newFeatures = existingFeatures
                    .Where(f => !featuresToRemove.Contains(f, StringComparer.OrdinalIgnoreCase))
                    .ToArray();

                // Không có gì thay đổi
                if (newFeatures.Length == existingFeatures.Length)
                    continue;

                var filterSub = Builders<Subscription>.Filter.Eq(x => x.Id, sub.Id);
                UpdateDefinition<Subscription> updateSub;

                if (newFeatures.Length == 0)
                {
                    // Không còn feature nào → expire sub và xoá quota SMS.
                    updateSub = Builders<Subscription>.Update
                        .Set(x => x.EndsAtUtc, now.AddSeconds(-1))
                        .Set(x => x.Features, Array.Empty<string>())
                        .Set(x => x.SmsQuotaTotal, (int?)null)
                        .Set(x => x.SmsQuotaUsed, 0)
                        .Set(x => x.SmsUnlimited, false)
                        .Set(x => x.SmsWarnAtRemaining, (int?)null)
                        .Set(x => x.SmsLowQuotaWarned, false)
                        .Set(x => x.SmsLowQuotaWarnedAtUtc, (DateTime?)null);
                }
                else
                {
                    // Cập nhật lại danh sách feature, giữ nguyên EndsAtUtc.
                    updateSub = Builders<Subscription>.Update
                        .Set(x => x.Features, newFeatures);

                    if (!HasSmsFeature(newFeatures))
                    {
                        updateSub = updateSub
                            .Set(x => x.SmsQuotaTotal, (int?)null)
                            .Set(x => x.SmsQuotaUsed, 0)
                            .Set(x => x.SmsUnlimited, false)
                            .Set(x => x.SmsWarnAtRemaining, (int?)null)
                            .Set(x => x.SmsLowQuotaWarned, false)
                            .Set(x => x.SmsLowQuotaWarnedAtUtc, (DateTime?)null);
                    }
                }

                var res = await _subscriptions.UpdateOneAsync(filterSub, updateSub, cancellationToken: ct);

                if (res.ModifiedCount > 0)
                {
                    modified++;

                    // 🔥 CHỈ XOÁ SMS NẾU license này có sms_alert
                    if (featuresToRemove.Contains("sms_alert", StringComparer.OrdinalIgnoreCase))
                    {
                        await _smsActivation.DeleteByUserAsync(uid, ct);
                    }
                }
            }

            // Invalidate cache nếu có
            foreach (var uid in userIds)
            {
                await InvalidateUserCacheAsync(uid);

            }

            return modified;
        }


        // Admin: ép hết hạn mọi subscription đang active của 1 user
        public async Task<int> AdminExpireActiveSubsForUserAsync(ObjectId userId, CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;
            var today = now.Date;

            // Giống logic GetActiveAsync nhưng update luôn
            var filter = Builders<Subscription>.Filter.And(
                Builders<Subscription>.Filter.Eq(x => x.UserId, userId),
                Builders<Subscription>.Filter.Lte(x => x.StartedAtUtc, now),
                Builders<Subscription>.Filter.Gte(x => x.EndsAtUtc, today)
            );

            // đặt EndsAtUtc về hôm qua để chắc chắn là hết hạn
            var update = Builders<Subscription>.Update
                .Set(x => x.EndsAtUtc, today.AddDays(-1));

            var res = await _subscriptions.UpdateManyAsync(filter, update, cancellationToken: ct);

            // Nếu bạn sau này có cache thì gọi luôn
            await InvalidateUserCacheAsync(userId);

            return (int)res.ModifiedCount;
        }

        // Admin: tìm code và expire gói của toàn bộ user đã redeem code đó
        // Admin: tìm code và revoke các feature của license đó khỏi subscription của user
        public async Task<int> AdminExpireSubsByLicenseCodeAsync(string rawCode, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(rawCode)) return 0;

            var code = rawCode.Trim().ToUpperInvariant();
            var lic = await _licenseCodes.Find(x => x.Code == code).FirstOrDefaultAsync(ct);
            if (lic == null) return 0;

            // Dùng logic revoke theo features bên dưới
            return await RevokeActiveByLicenseAsync(lic, ct);
        }

        private static bool HasSmsFeature(string[]? features)
        {
            return (features ?? Array.Empty<string>())
                .Any(feature =>
                    string.Equals(
                        feature,
                        FeatureSmsAlert,
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    string.Equals(
                        feature,
                        FeatureSmsSchedule,
                        StringComparison.OrdinalIgnoreCase));
        }

        private static bool LicenseGrantsSms(LicenseCode license)
        {
            return license.SmsUnlimited
                || (license.SmsQuotaTotal ?? 0) > 0
                || HasSmsFeature(license.Features);
        }

        private static int? NormalizePositiveQuota(int? value)
        {
            return value.HasValue && value.Value > 0
                ? value.Value
                : null;
        }

        private static int? NormalizeWarnAt(int? warnAt, int? total)
        {
            if (!total.HasValue || total.Value <= 0)
                return null;

            if (warnAt.HasValue && warnAt.Value >= 0)
                return Math.Min(warnAt.Value, total.Value);

            if (total.Value >= 10_000)
                return 500;

            if (total.Value >= 1_000)
                return 100;

            return Math.Max(
                1,
                (int)Math.Ceiling(total.Value * 0.1));
        }

        /// <summary>
        /// Đồng bộ quota cho subscription cũ chưa có SmsQuotaTotal.
        /// Lấy LicenseCode SMS được user redeem gần nhất và ghi lại vào Subscription.
        /// </summary>
        private async Task TryBackfillSmsQuotaAsync(
            Subscription subscription,
            CancellationToken ct)
        {
            if (subscription == null)
                return;

            if (!HasSmsFeature(subscription.Features))
                return;

            if (subscription.SmsUnlimited)
                return;

            if (subscription.SmsQuotaTotal.HasValue
                && subscription.SmsQuotaTotal.Value > 0)
            {
                return;
            }

            var activationFilter =
                Builders<LicenseCode>.Filter.ElemMatch(
                    x => x.Activations,
                    activation => activation.UserId == subscription.UserId);

            var candidates = await _licenseCodes
                .Find(activationFilter)
                .ToListAsync(ct);

            var latest = candidates
                .Where(LicenseGrantsSms)
                .Select(license => new
                {
                    License = license,
                    RedeemedAtUtc = (license.Activations
                        ?? new List<LicenseActivation>())
                        .Where(a => a.UserId == subscription.UserId)
                        .Select(a => a.RedeemedAtUtc)
                        .DefaultIfEmpty(DateTime.MinValue)
                        .Max()
                })
                .OrderByDescending(x => x.RedeemedAtUtc)
                .ThenByDescending(x => x.License.CreatedAtUtc)
                .FirstOrDefault();

            if (latest == null)
                return;

            var license = latest.License;
            var quotaTotal = license.SmsUnlimited
                ? null
                : NormalizePositiveQuota(license.SmsQuotaTotal);

            var warnAt = license.SmsUnlimited
                ? null
                : NormalizeWarnAt(
                    license.SmsWarnAtRemaining,
                    quotaTotal);

            var update = Builders<Subscription>.Update
                .Set(x => x.SmsQuotaTotal, quotaTotal)
                .Set(x => x.SmsQuotaUsed, Math.Max(0, subscription.SmsQuotaUsed))
                .Set(x => x.SmsUnlimited, license.SmsUnlimited)
                .Set(x => x.SmsWarnAtRemaining, warnAt)
                .Set(x => x.SmsLowQuotaWarned, false)
                .Set(x => x.SmsLowQuotaWarnedAtUtc, (DateTime?)null);

            await _subscriptions.UpdateOneAsync(
                x => x.Id == subscription.Id,
                update,
                cancellationToken: ct);

            // Cập nhật object đang được controller sử dụng ngay trong request hiện tại.
            subscription.SmsQuotaTotal = quotaTotal;
            subscription.SmsQuotaUsed = Math.Max(0, subscription.SmsQuotaUsed);
            subscription.SmsUnlimited = license.SmsUnlimited;
            subscription.SmsWarnAtRemaining = warnAt;
            subscription.SmsLowQuotaWarned = false;
            subscription.SmsLowQuotaWarnedAtUtc = null;
        }

        public async Task<List<(LicenseCode lic, LicenseActivation act)>> GetUserLicenseHistoryAsync(
    ObjectId userId,
    CancellationToken ct = default)
        {
            // Tìm tất cả license có activation cho user này
            var filter = Builders<LicenseCode>.Filter.ElemMatch(
                x => x.Activations,
                a => a.UserId == userId
            );

            var list = await _licenseCodes.Find(filter)
                .SortByDescending(x => x.CreatedAtUtc)
                .ToListAsync(ct);

            var result = new List<(LicenseCode, LicenseActivation)>();

            foreach (var lic in list)
            {
                if (lic.Activations == null) continue;

                var act = lic.Activations
                    .Where(a => a.UserId == userId)
                    .OrderByDescending(a => a.RedeemedAtUtc)
                    .FirstOrDefault();

                if (act != null)
                    result.Add((lic, act));
            }

            return result;
        }

    }
}
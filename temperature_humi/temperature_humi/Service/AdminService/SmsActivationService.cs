using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models.SmsFpt;

namespace temperature_humi.Service.Admin
{
    public class SmsActivationService
    {
        private readonly IMongoCollection<SmsActivation> _col;

        public SmsActivationService(IOptions<MongoDBSettings> settings)
        {
            var cli = new MongoClient(settings.Value.ConnectionString);
            var db = cli.GetDatabase(settings.Value.DatabaseName);
            _col = db.GetCollection<SmsActivation>("SmsActivations");

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            var idxs = _col.Indexes.List().ToList();
            var names = idxs
                .Select(d => d.GetValue("name", "").AsString)
                .Where(n => !string.IsNullOrEmpty(n))
                .ToHashSet();

            var models = new List<CreateIndexModel<SmsActivation>>();

            if (!names.Contains("ix_user"))
            {
                models.Add(new CreateIndexModel<SmsActivation>(
                    Builders<SmsActivation>.IndexKeys
                        .Ascending(x => x.UserId),
                    new CreateIndexOptions { Name = "ix_user" }));
            }

            if (!names.Contains("ix_phone"))
            {
                models.Add(new CreateIndexModel<SmsActivation>(
                    Builders<SmsActivation>.IndexKeys
                        .Ascending(x => x.Phone),
                    new CreateIndexOptions { Name = "ix_phone" }));
            }

            if (!names.Contains("ix_activated_desc"))
            {
                models.Add(new CreateIndexModel<SmsActivation>(
                    Builders<SmsActivation>.IndexKeys
                        .Descending(x => x.ActivatedAtUtc),
                    new CreateIndexOptions { Name = "ix_activated_desc" }));
            }

            if (models.Count > 0)
                _col.Indexes.CreateMany(models);
        }

        public async Task AddActivationAsync(
            ObjectId userId,
            string? phone,
            string? licenseCode,
            string? notes,
            CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty) throw new ArgumentException("Invalid userId", nameof(userId));

            var doc = new SmsActivation
            {
                Id = ObjectId.GenerateNewId(),
                UserId = userId,
                Phone = phone?.Trim() ?? string.Empty,
                LicenseCode = licenseCode?.Trim().ToUpperInvariant(),
                Notes = notes,
                ActivatedAtUtc = DateTime.UtcNow
            };

            await _col.InsertOneAsync(doc, cancellationToken: ct);
        }

        // Dùng cho AdminSmsActivationsController
        public async Task<(long total, List<SmsActivation> items)> AdminListAsync(
            string? search,
            int skip,
            int take,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 200);

            var fb = Builders<SmsActivation>.Filter;
            var filter = fb.Empty;

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim();
                // tìm theo phone hoặc licenseCode (contains)
                filter = fb.Or(
                    fb.Regex(x => x.Phone, new BsonRegularExpression(s, "i")),
                    fb.Regex(x => x.LicenseCode, new BsonRegularExpression(s, "i"))
                );
            }

            var total = await _col.CountDocumentsAsync(filter, cancellationToken: ct);

            var items = await _col.Find(filter)
                .SortByDescending(x => x.ActivatedAtUtc)
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            return (total, items);
        }
        public async Task UpsertForUserAsync(
      ObjectId userId,
      string? phone,
      string? licenseCode,
      string? notes,
      CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty)
                throw new ArgumentException("Invalid userId", nameof(userId));

            var normPhone = phone?.Trim() ?? string.Empty;
            var normCode = licenseCode?.Trim().ToUpperInvariant();

            var filter = Builders<SmsActivation>.Filter.Eq(x => x.UserId, userId);

            var update = Builders<SmsActivation>.Update
                .Set(x => x.Phone, normPhone)
                .Set(x => x.LicenseCode, normCode)
                .Set(x => x.Notes, notes)
                .Set(x => x.ActivatedAtUtc, DateTime.UtcNow);

            await _col.UpdateOneAsync(
                filter,
                update,
                new UpdateOptions { IsUpsert = true },
                ct);
        }
        public async Task<SmsActivation?> GetByUserAsync(
        ObjectId userId,
        CancellationToken ct = default)
        {
            if (userId == ObjectId.Empty)
                throw new ArgumentException("Invalid userId", nameof(userId));

            var filter = Builders<SmsActivation>.Filter.Eq(x => x.UserId, userId);

            return await _col.Find(filter)
                .SortByDescending(x => x.ActivatedAtUtc)
                .FirstOrDefaultAsync(ct);
        }
        public async Task<SmsActivation?> GetLt5ByUserAsync(
           ObjectId userId,
           CancellationToken ct = default)
        {
            var filter = Builders<SmsActivation>.Filter.And(
                Builders<SmsActivation>.Filter.Eq(x => x.UserId, userId),
                Builders<SmsActivation>.Filter.Eq(x => x.Notes, "lt5")
            );

            return await _col.Find(filter)
                             .SortByDescending(x => x.ActivatedAtUtc)
                             .FirstOrDefaultAsync(ct);
        }

        // ================== LT5 – UPSERT ==================
        // Chỉ upsert bản ghi LT5 (notes = "lt5"), KHÔNG đụng tới bản ghi SMS thường
        public async Task<SmsActivation> UpsertLt5PhonesForUserAsync(
            ObjectId userId,
            string phones,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;

            var filter = Builders<SmsActivation>.Filter.And(
                Builders<SmsActivation>.Filter.Eq(x => x.UserId, userId),
                Builders<SmsActivation>.Filter.Eq(x => x.Notes, "lt5")
            );

            var update = Builders<SmsActivation>.Update
                .Set(x => x.Phone, phones)
                .Set(x => x.Notes, "lt5")               
                .SetOnInsert(x => x.UserId, userId)
                .SetOnInsert(x => x.ActivatedAtUtc, now);

            var opts = new FindOneAndUpdateOptions<SmsActivation>
            {
                IsUpsert = true,
                ReturnDocument = ReturnDocument.After
            };

            return await _col.FindOneAndUpdateAsync(filter, update, opts, ct);
        }
        // Upsert phone cho user, dùng chung cho LT5/UTRED (tuỳ bạn dùng Note/LicenseCode)
        public async Task<SmsActivation> UpsertPhonesForUserAsync(
            ObjectId userId,
            string phones,
            string? source,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;

            var filter = Builders<SmsActivation>.Filter.Eq(x => x.UserId, userId);

            var update = Builders<SmsActivation>.Update
                .Set(x => x.Phone, phones)
                .Set(x => x.Notes, source)              
                .SetOnInsert(x => x.UserId, userId)
                .SetOnInsert(x => x.ActivatedAtUtc, now);

            var opts = new FindOneAndUpdateOptions<SmsActivation>
            {
                IsUpsert = true,
                ReturnDocument = ReturnDocument.After
            };

            return await _col.FindOneAndUpdateAsync(filter, update, opts, ct);
        }

        public async Task DeleteByUserAsync(ObjectId userId, CancellationToken ct = default)
        {
            var filter = Builders<SmsActivation>.Filter.Eq(x => x.UserId, userId);
            await _col.DeleteManyAsync(filter, ct);
        }
    }
}

using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Service
{
    public sealed class AlertThresholdService
    {
        // Dùng BsonDocument để đọc/ghi đúng field đang có trong MongoDB Atlas:
        // serialNumber, upperThreshold, lowerThreshold, updatedAtUtc, updatedBy
        private readonly IMongoCollection<BsonDocument> _col;
        private readonly ILogger<AlertThresholdService> _log;

        // cache: SERIAL_UPPER -> (fetchedAt, rule)
        private readonly ConcurrentDictionary<string, (DateTime fetchedUtc, AlertThreshold rule)> _cache = new();
        private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(2);

        public AlertThresholdService(IOptions<MongoDBSettings> settings, ILogger<AlertThresholdService> log)
        {
            var cli = new MongoClient(settings.Value.ConnectionString);
            var db = cli.GetDatabase(settings.Value.DatabaseName);
            _col = db.GetCollection<BsonDocument>("AlertThreshold");
            _log = log;

            EnsureIndexes();
        }

        public static string NormalizeSerial(string? serial)
            => (serial ?? string.Empty).Trim().ToUpperInvariant();

        private static string Key(string? serial) => NormalizeSerial(serial);

        private static FilterDefinition<BsonDocument> SerialFilter(string serial)
        {
            var fb = Builders<BsonDocument>.Filter;
            return fb.Or(
                fb.Eq("serialNumber", serial),
                fb.Eq("SerialNumber", serial)
            );
        }

        private static FilterDefinition<BsonDocument> SerialsFilter(IEnumerable<string> serials)
        {
            var keys = serials
                .Select(Key)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var fb = Builders<BsonDocument>.Filter;
            if (keys.Count == 0) return fb.Where(_ => false);

            return fb.Or(
                fb.In("serialNumber", keys),
                fb.In("SerialNumber", keys)
            );
        }

        private void EnsureIndexes()
        {
            try
            {
                var existing = _col.Indexes.List().ToList();
                var hasCamel = existing.Any(x =>
                    x.TryGetValue("name", out var n)
                    && n.IsString
                    && n.AsString == "ux_serialNumber");

                if (!hasCamel)
                {
                    var idx = Builders<BsonDocument>.IndexKeys.Ascending("serialNumber");
                    var opt = new CreateIndexOptions<BsonDocument>
                    {
                        Name = "ux_serialNumber",
                        Unique = true,
                        PartialFilterExpression = Builders<BsonDocument>.Filter.Type("serialNumber", BsonType.String)
                    };

                    _col.Indexes.CreateOne(new CreateIndexModel<BsonDocument>(idx, opt));
                    _log.LogInformation("[AlertThreshold] Created index ux_serialNumber unique on serialNumber.");
                }
            }
            catch (MongoCommandException ex)
            {
                _log.LogWarning(ex, "[AlertThreshold] EnsureIndexes failed. Check duplicate serialNumber values.");
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "[AlertThreshold] EnsureIndexes failed.");
            }
        }

        private static string? GetString(BsonDocument doc, params string[] names)
        {
            foreach (var name in names)
            {
                if (!doc.TryGetValue(name, out var v) || v.IsBsonNull) continue;
                return v.IsString ? v.AsString : v.ToString();
            }

            return null;
        }

        private static double? GetDouble(BsonDocument doc, params string[] names)
        {
            foreach (var name in names)
            {
                if (!doc.TryGetValue(name, out var v) || v.IsBsonNull) continue;

                if (v.IsDouble) return v.AsDouble;
                if (v.IsInt32) return v.AsInt32;
                if (v.IsInt64) return v.AsInt64;
                if (v.IsDecimal128 && double.TryParse(v.AsDecimal128.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d1)) return d1;
                if (v.IsString && double.TryParse(v.AsString, NumberStyles.Any, CultureInfo.InvariantCulture, out var d2)) return d2;
            }

            return null;
        }

        private static DateTime? GetDateTime(BsonDocument doc, params string[] names)
        {
            foreach (var name in names)
            {
                if (!doc.TryGetValue(name, out var v) || v.IsBsonNull) continue;

                if (v.IsValidDateTime) return v.ToUniversalTime();
                if (v.IsString && DateTime.TryParse(v.AsString, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt))
                    return dt.ToUniversalTime();
            }

            return null;
        }

        private static AlertThreshold? Map(BsonDocument? doc)
        {
            if (doc == null) return null;

            var serial = Key(GetString(doc, "serialNumber", "SerialNumber"));
            if (string.IsNullOrWhiteSpace(serial)) return null;

            return new AlertThreshold
            {
                SerialNumber = serial,
                UpperThreshold = GetDouble(doc, "upperThreshold", "UpperThreshold", "max", "Max"),
                LowerThreshold = GetDouble(doc, "lowerThreshold", "LowerThreshold", "min", "Min"),
                UpdatedAtUtc = GetDateTime(doc, "updatedAtUtc", "UpdatedAtUtc") ?? DateTime.MinValue,
                UpdatedBy = GetString(doc, "updatedBy", "UpdatedBy")
            };
        }

        private async Task<AlertThreshold?> GetBySerialFreshAsync(string serial, CancellationToken ct = default)
        {
            serial = Key(serial);
            if (string.IsNullOrWhiteSpace(serial)) return null;

            var doc = await _col.Find(SerialFilter(serial))
                .Sort(Builders<BsonDocument>.Sort.Descending("updatedAtUtc"))
                .FirstOrDefaultAsync(ct);

            return Map(doc);
        }

        public async Task<AlertThreshold?> GetBySerialAsync(string serial, CancellationToken ct = default)
        {
            serial = Key(serial);
            if (string.IsNullOrWhiteSpace(serial)) return null;

            if (_cache.TryGetValue(serial, out var item) &&
                (DateTime.UtcNow - item.fetchedUtc) <= CacheTtl)
            {
                return item.rule;
            }

            var rule = await GetBySerialFreshAsync(serial, ct);

            if (rule != null)
                _cache[serial] = (DateTime.UtcNow, rule);
            else
                _cache.TryRemove(serial, out _);

            return rule;
        }

        public async Task<List<AlertThreshold>> ListAsync(CancellationToken ct = default)
        {
            var docs = await _col.Find(FilterDefinition<BsonDocument>.Empty)
                .Sort(Builders<BsonDocument>.Sort.Ascending("serialNumber"))
                .ToListAsync(ct);

            return docs
                .Select(Map)
                .Where(x => x != null)
                .Select(x => x!)
                .OrderBy(x => x.SerialNumber)
                .ToList();
        }

        public async Task<List<AlertThreshold>> ListBySerialsAsync(IEnumerable<string> serials, CancellationToken ct = default)
        {
            var keys = (serials ?? Enumerable.Empty<string>())
                .Select(Key)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (keys.Count == 0)
                return new List<AlertThreshold>();

            var docs = await _col.Find(SerialsFilter(keys))
                .Sort(Builders<BsonDocument>.Sort.Ascending("serialNumber"))
                .ToListAsync(ct);

            return docs
                .Select(Map)
                .Where(x => x != null)
                .Select(x => x!)
                .OrderBy(x => x.SerialNumber)
                .ToList();
        }

        public async Task UpsertAsync(AlertThreshold r, string? updatedBy, CancellationToken ct = default)
        {
            var serial = Key(r.SerialNumber);

            if (string.IsNullOrWhiteSpace(serial))
                throw new ArgumentException("SerialNumber không được để trống.");

            var now = DateTime.UtcNow;
            var actor = string.IsNullOrWhiteSpace(updatedBy) ? "system" : updatedBy.Trim();

            var update = Builders<BsonDocument>.Update
                .Set("serialNumber", serial)
                .Set("upperThreshold", r.UpperThreshold.HasValue ? BsonValue.Create(r.UpperThreshold.Value) : BsonNull.Value)
                .Set("lowerThreshold", r.LowerThreshold.HasValue ? BsonValue.Create(r.LowerThreshold.Value) : BsonNull.Value)
                .Set("updatedAtUtc", now)
                .Set("updatedBy", actor)
                .SetOnInsert("_id", ObjectId.GenerateNewId());

            await _col.UpdateOneAsync(
                SerialFilter(serial),
                update,
                new UpdateOptions { IsUpsert = true },
                ct);

            var saved = await GetBySerialFreshAsync(serial, ct) ?? new AlertThreshold
            {
                SerialNumber = serial,
                UpperThreshold = r.UpperThreshold,
                LowerThreshold = r.LowerThreshold,
                UpdatedAtUtc = now,
                UpdatedBy = actor
            };

            _cache[serial] = (DateTime.UtcNow, saved);

            _log.LogInformation(
                "[AlertThreshold] Upsert {serial} U={up} L={lo} By={by}",
                serial,
                saved.UpperThreshold,
                saved.LowerThreshold,
                actor);
        }

        public async Task<bool> DeleteAsync(string serial, CancellationToken ct = default)
        {
            serial = Key(serial);
            if (string.IsNullOrWhiteSpace(serial)) return false;

            var res = await _col.DeleteOneAsync(SerialFilter(serial), ct);
            _cache.TryRemove(serial, out _);

            _log.LogInformation("[AlertThreshold] Delete {serial}, deleted={count}", serial, res.DeletedCount);
            return res.DeletedCount > 0;
        }
    }
}

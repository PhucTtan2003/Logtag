using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Service
{
    /// <summary>
    /// Tổng hợp raw LocationReadings sang Hourly/Daily và duy trì LatestDeviceStatus.
    /// Mục tiêu:
    /// - Raw chỉ cần giữ ngắn hạn bằng TTL.
    /// - Dashboard đọc LatestDeviceStatus cho nhẹ.
    /// - Báo cáo dài ngày đọc Hourly/Daily, không kéo raw hàng triệu dòng.
    /// </summary>
    public class ReadingAggregationService
    {
        private readonly IMongoCollection<LocationReading> _raw;
        private readonly IMongoCollection<LocationReadingHourly> _hourly;
        private readonly IMongoCollection<LocationReadingDaily> _daily;
        private readonly IMongoCollection<LatestDeviceStatus> _latest;
        private readonly ILogger<ReadingAggregationService> _log;

        private const double InvalidTemperature = double.MinValue + 1;

        public ReadingAggregationService(
            IOptions<MongoDBSettings> settings,
            ILogger<ReadingAggregationService> log)
        {
            _log = log;

            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            _raw = db.GetCollection<LocationReading>("LocationReadings");
            _hourly = db.GetCollection<LocationReadingHourly>("LocationReadingHourly");
            _daily = db.GetCollection<LocationReadingDaily>("LocationReadingDaily");
            _latest = db.GetCollection<LatestDeviceStatus>("LatestDeviceStatus");

            EnsureIndexes();
        }

        public record AggregationStats(int HourlyBuckets, int DailyBuckets, int LatestStatuses);

        private sealed class RawPoint
        {
            public string? TeamId { get; set; }
            public string? SerialNumber { get; set; }
            public DateTime DateUtc { get; set; }
            public double? Temperature { get; set; }
            public double? Humidity { get; set; }
        }

        private void EnsureIndexes()
        {
            EnsureIndex(_hourly, new CreateIndexModel<LocationReadingHourly>(
                Builders<LocationReadingHourly>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber)
                    .Ascending(x => x.BucketUtc),
                new CreateIndexOptions { Name = "ux_hourly_team_serial_bucket", Unique = true }));

            EnsureIndex(_hourly, new CreateIndexModel<LocationReadingHourly>(
                Builders<LocationReadingHourly>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber)
                    .Descending(x => x.BucketUtc),
                new CreateIndexOptions { Name = "ix_hourly_team_serial_bucket_desc" }));

            EnsureIndex(_daily, new CreateIndexModel<LocationReadingDaily>(
                Builders<LocationReadingDaily>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber)
                    .Ascending(x => x.BucketUtc),
                new CreateIndexOptions { Name = "ux_daily_team_serial_bucket", Unique = true }));

            EnsureIndex(_daily, new CreateIndexModel<LocationReadingDaily>(
                Builders<LocationReadingDaily>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber)
                    .Descending(x => x.BucketUtc),
                new CreateIndexOptions { Name = "ix_daily_team_serial_bucket_desc" }));

            EnsureIndex(_latest, new CreateIndexModel<LatestDeviceStatus>(
                Builders<LatestDeviceStatus>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber),
                new CreateIndexOptions { Name = "ux_latest_team_serial", Unique = true }));

            EnsureIndex(_latest, new CreateIndexModel<LatestDeviceStatus>(
                Builders<LatestDeviceStatus>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Descending(x => x.LastDateUtc),
                new CreateIndexOptions { Name = "ix_latest_team_lastdate_desc" }));
        }

        private static void EnsureIndex<T>(IMongoCollection<T> collection, CreateIndexModel<T> model)
        {
            var name = model.Options?.Name;
            if (!string.IsNullOrWhiteSpace(name))
            {
                var exists = collection.Indexes.List()
                    .ToEnumerable()
                    .Any(ix => ix.TryGetValue("name", out var v) && v.IsString && v.AsString == name);

                if (exists) return;
            }

            try
            {
                collection.Indexes.CreateOne(model);
            }
            catch (Exception ex)
            {
                var msg = ex.Message ?? string.Empty;
                if (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase) ||
                    msg.Contains("exists with different options", StringComparison.OrdinalIgnoreCase))
                    return;

                throw;
            }
        }

        public async Task<AggregationStats> AggregateRecentAsync(
            TimeSpan lookback,
            TimeSpan latestLookback,
            TimeSpan onlineThreshold,
            CancellationToken ct = default)
        {
            var to = DateTime.UtcNow;
            var from = to.Subtract(lookback);
            var latestFrom = to.Subtract(latestLookback);

            var hourlyCount = await AggregateHourlyAsync(from, to, ct);
            var dailyCount = await AggregateDailyByDayAsync(from.Date, to.Date.AddDays(1), ct);
            var latestCount = await RebuildLatestAsync(latestFrom, onlineThreshold, ct);

            return new AggregationStats(hourlyCount, dailyCount, latestCount);
        }

        /// <summary>
        /// Dùng khi cần chạy bù lịch sử trước khi TTL xoá raw.
        /// Nên gọi qua AdminReadingAggregationController/backfill.
        /// </summary>
        public async Task<AggregationStats> BackfillAsync(
            DateTime fromUtc,
            DateTime toUtc,
            int chunkDays = 7,
            CancellationToken ct = default)
        {
            fromUtc = NormalizeUtc(fromUtc);
            toUtc = NormalizeUtc(toUtc);
            if (fromUtc > toUtc) (fromUtc, toUtc) = (toUtc, fromUtc);

            chunkDays = Math.Clamp(chunkDays, 1, 31);

            int hourly = 0;
            for (var start = fromUtc; start < toUtc; start = start.AddDays(chunkDays))
            {
                ct.ThrowIfCancellationRequested();
                var end = start.AddDays(chunkDays);
                if (end > toUtc) end = toUtc;

                hourly += await AggregateHourlyAsync(start, end, ct);
            }

            // Daily chạy theo từng ngày để tránh ghi sai bucket khi chia chunk.
            var daily = await AggregateDailyByDayAsync(fromUtc.Date, toUtc.Date.AddDays(1), ct);
            var latest = await RebuildLatestAsync(DateTime.UtcNow.AddDays(-7), TimeSpan.FromMinutes(30), ct);

            return new AggregationStats(hourly, daily, latest);
        }

        public async Task<int> AggregateHourlyAsync(DateTime fromUtc, DateTime toUtc, CancellationToken ct = default)
        {
            fromUtc = NormalizeUtc(fromUtc);
            toUtc = NormalizeUtc(toUtc);
            if (fromUtc >= toUtc) return 0;

            var rows = await LoadRawAsync(fromUtc, toUtc, ct);
            if (rows.Count == 0) return 0;

            var now = DateTime.UtcNow;
            var groups = rows
                .Where(x => !string.IsNullOrWhiteSpace(x.SerialNumber))
                .GroupBy(x => new
                {
                    TeamId = x.TeamId ?? string.Empty,
                    SerialNumber = x.SerialNumber!.Trim().ToUpperInvariant(),
                    BucketUtc = HourBucketUtc(x.DateUtc)
                })
                .ToList();

            var writes = new List<WriteModel<LocationReadingHourly>>(groups.Count);
            var fb = Builders<LocationReadingHourly>.Filter;
            var ub = Builders<LocationReadingHourly>.Update;

            foreach (var g in groups)
            {
                var temps = g.Select(x => x.Temperature).Where(x => x.HasValue).Select(x => x!.Value).ToList();
                var hums = g.Select(x => x.Humidity).Where(x => x.HasValue).Select(x => x!.Value).ToList();

                if (temps.Count == 0 && hums.Count == 0) continue;

                var first = g.Min(x => x.DateUtc);
                var last = g.Max(x => x.DateUtc);

                var filter = fb.Eq(x => x.TeamId, g.Key.TeamId)
                           & fb.Eq(x => x.SerialNumber, g.Key.SerialNumber)
                           & fb.Eq(x => x.BucketUtc, g.Key.BucketUtc);

                var update = ub
                    .SetOnInsert(x => x.Id, ObjectId.GenerateNewId())
                    .SetOnInsert(x => x.CreatedAtUtc, now)
                    .Set(x => x.TeamId, g.Key.TeamId)
                    .Set(x => x.SerialNumber, g.Key.SerialNumber)
                    .Set(x => x.BucketUtc, g.Key.BucketUtc)
                    .Set(x => x.Count, g.Count())
                    .Set(x => x.MinTemperature, temps.Count == 0 ? null : Round(temps.Min()))
                    .Set(x => x.MaxTemperature, temps.Count == 0 ? null : Round(temps.Max()))
                    .Set(x => x.AvgTemperature, temps.Count == 0 ? null : Round(temps.Average()))
                    .Set(x => x.MinHumidity, hums.Count == 0 ? null : Round(hums.Min()))
                    .Set(x => x.MaxHumidity, hums.Count == 0 ? null : Round(hums.Max()))
                    .Set(x => x.AvgHumidity, hums.Count == 0 ? null : Round(hums.Average()))
                    .Set(x => x.FirstReadingUtc, first)
                    .Set(x => x.LastReadingUtc, last)
                    .Set(x => x.UpdatedAtUtc, now);

                writes.Add(new UpdateOneModel<LocationReadingHourly>(filter, update) { IsUpsert = true });
            }

            if (writes.Count == 0) return 0;
            await _hourly.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
            return writes.Count;
        }

        public async Task<int> AggregateDailyByDayAsync(DateTime fromUtc, DateTime toUtc, CancellationToken ct = default)
        {
            fromUtc = NormalizeUtc(fromUtc).Date;
            toUtc = NormalizeUtc(toUtc).Date;
            if (toUtc <= fromUtc) toUtc = fromUtc.AddDays(1);

            int total = 0;
            for (var day = fromUtc; day < toUtc; day = day.AddDays(1))
            {
                ct.ThrowIfCancellationRequested();
                total += await AggregateDailyAsync(day, day.AddDays(1), ct);
            }
            return total;
        }

        public async Task<int> AggregateDailyAsync(DateTime fromUtc, DateTime toUtc, CancellationToken ct = default)
        {
            fromUtc = NormalizeUtc(fromUtc);
            toUtc = NormalizeUtc(toUtc);
            if (fromUtc >= toUtc) return 0;

            var rows = await LoadRawAsync(fromUtc, toUtc, ct);
            if (rows.Count == 0) return 0;

            var now = DateTime.UtcNow;
            var groups = rows
                .Where(x => !string.IsNullOrWhiteSpace(x.SerialNumber))
                .GroupBy(x => new
                {
                    TeamId = x.TeamId ?? string.Empty,
                    SerialNumber = x.SerialNumber!.Trim().ToUpperInvariant(),
                    BucketUtc = DayBucketUtc(x.DateUtc)
                })
                .ToList();

            var writes = new List<WriteModel<LocationReadingDaily>>(groups.Count);
            var fb = Builders<LocationReadingDaily>.Filter;
            var ub = Builders<LocationReadingDaily>.Update;

            foreach (var g in groups)
            {
                var temps = g.Select(x => x.Temperature).Where(x => x.HasValue).Select(x => x!.Value).ToList();
                var hums = g.Select(x => x.Humidity).Where(x => x.HasValue).Select(x => x!.Value).ToList();

                if (temps.Count == 0 && hums.Count == 0) continue;

                var first = g.Min(x => x.DateUtc);
                var last = g.Max(x => x.DateUtc);

                var filter = fb.Eq(x => x.TeamId, g.Key.TeamId)
                           & fb.Eq(x => x.SerialNumber, g.Key.SerialNumber)
                           & fb.Eq(x => x.BucketUtc, g.Key.BucketUtc);

                var update = ub
                    .SetOnInsert(x => x.Id, ObjectId.GenerateNewId())
                    .SetOnInsert(x => x.CreatedAtUtc, now)
                    .Set(x => x.TeamId, g.Key.TeamId)
                    .Set(x => x.SerialNumber, g.Key.SerialNumber)
                    .Set(x => x.BucketUtc, g.Key.BucketUtc)
                    .Set(x => x.Count, g.Count())
                    .Set(x => x.MinTemperature, temps.Count == 0 ? null : Round(temps.Min()))
                    .Set(x => x.MaxTemperature, temps.Count == 0 ? null : Round(temps.Max()))
                    .Set(x => x.AvgTemperature, temps.Count == 0 ? null : Round(temps.Average()))
                    .Set(x => x.MinHumidity, hums.Count == 0 ? null : Round(hums.Min()))
                    .Set(x => x.MaxHumidity, hums.Count == 0 ? null : Round(hums.Max()))
                    .Set(x => x.AvgHumidity, hums.Count == 0 ? null : Round(hums.Average()))
                    .Set(x => x.FirstReadingUtc, first)
                    .Set(x => x.LastReadingUtc, last)
                    .Set(x => x.UpdatedAtUtc, now);

                writes.Add(new UpdateOneModel<LocationReadingDaily>(filter, update) { IsUpsert = true });
            }

            if (writes.Count == 0) return 0;
            await _daily.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
            return writes.Count;
        }

        public async Task<int> RebuildLatestAsync(
            DateTime fromUtc,
            TimeSpan onlineThreshold,
            CancellationToken ct = default)
        {
            fromUtc = NormalizeUtc(fromUtc);

            var rows = await LoadRawAsync(fromUtc, DateTime.UtcNow.AddMinutes(1), ct);
            if (rows.Count == 0) return 0;

            var now = DateTime.UtcNow;
            var onlineCutoff = now.Subtract(onlineThreshold);

            var latestRows = rows
                .Where(x => !string.IsNullOrWhiteSpace(x.SerialNumber))
                .GroupBy(x => new
                {
                    TeamId = x.TeamId ?? string.Empty,
                    SerialNumber = x.SerialNumber!.Trim().ToUpperInvariant()
                })
                .Select(g => g.OrderByDescending(x => x.DateUtc).First())
                .ToList();

            var writes = new List<WriteModel<LatestDeviceStatus>>(latestRows.Count);
            var fb = Builders<LatestDeviceStatus>.Filter;
            var ub = Builders<LatestDeviceStatus>.Update;

            foreach (var r in latestRows)
            {
                var teamId = r.TeamId ?? string.Empty;
                var serial = r.SerialNumber!.Trim().ToUpperInvariant();
                var isOnline = r.DateUtc >= onlineCutoff;

                var filter = fb.Eq(x => x.TeamId, teamId)
                           & fb.Eq(x => x.SerialNumber, serial);

                var update = ub
                    .SetOnInsert(x => x.Id, ObjectId.GenerateNewId())
                    .SetOnInsert(x => x.CreatedAtUtc, now)
                    .Set(x => x.TeamId, teamId)
                    .Set(x => x.SerialNumber, serial)
                    .Set(x => x.LastDateUtc, r.DateUtc)
                    .Set(x => x.LastTemperature, r.Temperature)
                    .Set(x => x.LastHumidity, r.Humidity)
                    .Set(x => x.IsOnline, isOnline)
                    .Set(x => x.Status, isOnline ? "online" : "offline")
                    .Set(x => x.UpdatedAtUtc, now);

                writes.Add(new UpdateOneModel<LatestDeviceStatus>(filter, update) { IsUpsert = true });
            }

            if (writes.Count == 0) return 0;
            await _latest.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);

            // Những thiết bị đã có latest nhưng quá ngưỡng online thì đánh dấu offline.
            var offlineFilter = Builders<LatestDeviceStatus>.Filter.Lt(x => x.LastDateUtc, onlineCutoff);
            var offlineUpdate = Builders<LatestDeviceStatus>.Update
                .Set(x => x.IsOnline, false)
                .Set(x => x.Status, "offline")
                .Set(x => x.UpdatedAtUtc, now);
            await _latest.UpdateManyAsync(offlineFilter, offlineUpdate, cancellationToken: ct);

            return writes.Count;
        }

        public async Task<List<LocationReadingHourly>> GetHourlyAsync(
            string teamId,
            IEnumerable<string>? serials,
            DateTime fromUtc,
            DateTime toUtc,
            int limit = 100_000,
            CancellationToken ct = default)
        {
            var fb = Builders<LocationReadingHourly>.Filter;
            var filter = fb.Eq(x => x.TeamId, teamId)
                       & fb.Gte(x => x.BucketUtc, NormalizeUtc(fromUtc))
                       & fb.Lte(x => x.BucketUtc, NormalizeUtc(toUtc));

            var serialList = NormalizeSerials(serials);
            if (serialList.Count > 0)
                filter &= fb.In(x => x.SerialNumber, serialList);

            return await _hourly.Find(filter)
                .SortBy(x => x.SerialNumber)
                .ThenBy(x => x.BucketUtc)
                .Limit(Math.Clamp(limit, 1, 200_000))
                .ToListAsync(ct);
        }

        public async Task<List<LocationReadingDaily>> GetDailyAsync(
            string teamId,
            IEnumerable<string>? serials,
            DateTime fromUtc,
            DateTime toUtc,
            int limit = 100_000,
            CancellationToken ct = default)
        {
            var fb = Builders<LocationReadingDaily>.Filter;
            var filter = fb.Eq(x => x.TeamId, teamId)
                       & fb.Gte(x => x.BucketUtc, NormalizeUtc(fromUtc).Date)
                       & fb.Lte(x => x.BucketUtc, NormalizeUtc(toUtc).Date);

            var serialList = NormalizeSerials(serials);
            if (serialList.Count > 0)
                filter &= fb.In(x => x.SerialNumber, serialList);

            return await _daily.Find(filter)
                .SortBy(x => x.SerialNumber)
                .ThenBy(x => x.BucketUtc)
                .Limit(Math.Clamp(limit, 1, 200_000))
                .ToListAsync(ct);
        }

        public async Task<List<LatestDeviceStatus>> GetLatestAsync(
            string? teamId = null,
            IEnumerable<string>? serials = null,
            CancellationToken ct = default)
        {
            var fb = Builders<LatestDeviceStatus>.Filter;
            var filter = FilterDefinition<LatestDeviceStatus>.Empty;

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId);

            var serialList = NormalizeSerials(serials);
            if (serialList.Count > 0)
                filter &= fb.In(x => x.SerialNumber, serialList);

            return await _latest.Find(filter)
                .SortBy(x => x.SerialNumber)
                .ToListAsync(ct);
        }

        private async Task<List<RawPoint>> LoadRawAsync(DateTime fromUtc, DateTime toUtc, CancellationToken ct)
        {
            var fb = Builders<LocationReading>.Filter;
            var filter = fb.Gte(x => x.DateUtc, fromUtc)
                       & fb.Lt(x => x.DateUtc, toUtc)
                       & fb.Gt(x => x.Temperature, InvalidTemperature);

            return await _raw.Find(filter)
                .Project(x => new RawPoint
                {
                    TeamId = x.TeamId,
                    SerialNumber = x.SerialNumber,
                    DateUtc = x.DateUtc,
                    Temperature = x.Temperature,
                    Humidity = x.Humidity
                })
                .ToListAsync(ct);
        }

        private static DateTime NormalizeUtc(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
            return dt.ToUniversalTime();
        }

        private static DateTime HourBucketUtc(DateTime dt)
        {
            var u = NormalizeUtc(dt);
            return new DateTime(u.Year, u.Month, u.Day, u.Hour, 0, 0, DateTimeKind.Utc);
        }

        private static DateTime DayBucketUtc(DateTime dt)
        {
            var u = NormalizeUtc(dt);
            return new DateTime(u.Year, u.Month, u.Day, 0, 0, 0, DateTimeKind.Utc);
        }

        private static double? Round(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            return Math.Round(value, 4, MidpointRounding.AwayFromZero);
        }

        private static List<string> NormalizeSerials(IEnumerable<string>? serials)
            => (serials ?? Enumerable.Empty<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToUpperInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
    }
}

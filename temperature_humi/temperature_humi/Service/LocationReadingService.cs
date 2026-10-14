using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.DTO;
using temperature_humi.Hubs;
using temperature_humi.Models;
using temperature_humi.Service.LogtagService;
using static temperature_humi.Service.LogtagService.LogTagApiClient;

namespace temperature_humi.Service
{
    public class LocationReadingService
    {
        #region Fields
        private readonly IMongoCollection<LocationReading> _col;
        private readonly IMongoCollection<BsonDocument> _latestCol;
        private readonly LogTagAccountRouter _logtagRouter;
        private readonly IHubContext<LogTagHub> _hub;
        private readonly ILogger<LocationReadingService> _log;
        private readonly EventService _events;
        private readonly AlertThresholdService _thresholds;
        private readonly ConcurrentDictionary<string, long> _noThresholdLogUnix = new(StringComparer.OrdinalIgnoreCase);

        private const int NoThresholdLogGapSeconds = 1800; // 30 phút

        // Cache serial lỗi/không khả dụng với Batch API v2 để tránh làm chết cả batch ở các vòng sau.
        private readonly ConcurrentDictionary<string, DateTimeOffset> _batchInvalidSerialUntil = new(StringComparer.OrdinalIgnoreCase);
        private static readonly TimeSpan BatchInvalidSerialTtl = TimeSpan.FromHours(12);

        // (Giữ để không vỡ DI; hiện chưa dùng trong phiên bản dựa AlertThreshold)
        private readonly DeviceAlarmRuleService _alarmRules;

        // Scheduler: dùng dedicated throttle cho api/external/locationreadings.
        // Với 600 logger, poll 5 phút/lần => khoảng 600 req/5 phút (~2 req/s), nằm dưới mức xin 1.000 req/5 phút.
        private readonly IEndpointScheduler _sched;

        // Giới hạn song song ghi DB để không bão hoà Mongo pool
        private readonly SemaphoreSlim _dbGate = new(4);

        private static readonly ConcurrentDictionary<string, DateTimeOffset> _lastPushed = new();
        private static readonly TimeSpan PushMinSpacing = TimeSpan.FromSeconds(1);
        private const double SENTINEL_TEMP = double.MinValue + 1;

        // ===== Tuning cho Location Readings Batch API v2 =====
        // Batch v2: tối đa 500 serialNumbers / request, date window tối đa 15 phút, 1 request/phút.
        // DB đã chống trùng bằng SerialNumber + DateUtc nên có thể overlap nhẹ khi polling.
        private const string LocationReadingsEndpointKey = "api/external/locationreadings/v2/batch";
        private const int PullLatestLookbackMinutes = 14; // toUtc có cộng buffer vài giây nên để 14 phút cho chắc < 15 phút
        private const int RecentAlertWindowMinutes = 15;
        private const int BatchV2MaxSerialNumbers = 500;
        private static readonly TimeSpan BatchV2Spacing = TimeSpan.FromSeconds(61);

        // Profiles cache (nếu cần fallback sau này)
        private static readonly ConcurrentDictionary<long, (DateTime FetchedAtUtc, List<TeamProfileDto> Data)> _profilesCache = new();
        private static readonly TimeSpan ProfilesTtl = TimeSpan.FromSeconds(30);

        // ===== Trạng thái cảnh báo/nhiệt độ ổn định theo từng TeamID + Serial =====
        // Quy tắc realtime:
        // - Reading MỚI đầu tiên vượt ngưỡng => chuyển sang ALARM và gửi cảnh báo NGAY.
        // - Nếu vẫn tiếp tục vượt cùng hướng HIGH/LOW => giữ trạng thái ALARM, không spam SMS.
        // - Nếu đổi hướng LOW <-> HIGH => gửi cảnh báo mới NGAY.
        // - Reading MỚI đầu tiên quay về trong ngưỡng => chuyển sang STABLE
        //   và gửi SMS "Nhiệt độ đã ổn định" NGAY.
        //
        // LastProcessedReadingUtc bảo đảm reading bị lặp do cửa sổ polling overlap
        // không bị xử lý/gửi SMS lại.
        private const int TemperatureAlarmConsecutiveReadings = 1;
        private const int TemperatureStableConsecutiveReadings = 1;

        private sealed class TemperatureTransitionState
        {
            public int BreachCount { get; set; }
            public int StableCount { get; set; }
            public bool IsAlarmActive { get; set; }
            public string? BreachKind { get; set; }

            // Thời điểm gần nhất hệ thống đã yêu cầu phát SMS cảnh báo.
            // Chỉ dùng để theo dõi/log; không còn dùng để chờ chu kỳ 30 phút.
            public DateTime LastAlarmNotificationUtc { get; set; } = DateTime.MinValue;

            // Chống hai luồng đồng thời phát SMS cho cùng một reading mới.
            public bool AlarmNotificationInFlight { get; set; }

            public DateTime LastProcessedReadingUtc { get; set; } = DateTime.MinValue;
            public DateTime LastTouchedUtc { get; set; } = DateTime.UtcNow;
        }

        private static readonly ConcurrentDictionary<string, TemperatureTransitionState>
            _temperatureTransitionStates = new(StringComparer.OrdinalIgnoreCase);

        private static readonly TimeSpan TemperatureStateRetention = TimeSpan.FromDays(2);
        private static readonly TimeSpan TemperatureStateSweepInterval = TimeSpan.FromMinutes(30);
        private static readonly DateTime minValue = DateTime.MinValue;
        private static DateTime _lastTemperatureStateSweepUtc = minValue;
        private static int _temperatureStateSweeping = 0;

        #endregion

        public LocationReadingService(
            IOptions<MongoDBSettings> settings,
            LogTagAccountRouter logTagRouter,
            IHubContext<LogTagHub> hub,
            ILogger<LocationReadingService> log,
            EventService events,
            DeviceAlarmRuleService alarmRules,
            AlertThresholdService thresholds,
            IEndpointScheduler sched)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            _col = db.GetCollection<LocationReading>("LocationReadings");
            _latestCol = db.GetCollection<BsonDocument>("DeviceLatestStatus");

            _logtagRouter = logTagRouter;
            _hub = hub;
            _log = log;
            _events = events;
            _alarmRules = alarmRules;
            _thresholds = thresholds;
            _sched = sched;

            EnsureIndexes();
        }

        #region Indexes
        private void EnsureIndexes()
        {
            // Multi-account/multi-team safe unique index:
            // cùng serial/date ở 2 TeamID khác nhau vẫn được lưu riêng.
            var idx1 = Builders<LocationReading>.IndexKeys
                .Ascending(x => x.TeamId)
                .Ascending(x => x.SerialNumber)
                .Ascending(x => x.DateUtc);

            EnsureIndex(new CreateIndexModel<LocationReading>(
                idx1, new CreateIndexOptions { Name = "ux_team_serial_date", Unique = true }));

            // Query common: team + serial + date desc
            var idx2 = Builders<LocationReading>.IndexKeys
                .Ascending(x => x.TeamId)
                .Ascending(x => x.SerialNumber)
                .Descending(x => x.DateUtc);

            EnsureIndex(new CreateIndexModel<LocationReading>(
                idx2, new CreateIndexOptions { Name = "ix_team_serial_date_desc" }));


            var ttl = Builders<LocationReading>.IndexKeys.Ascending(x => x.DateUtc);

            EnsureIndex(new CreateIndexModel<LocationReading>(
                ttl,
                new CreateIndexOptions
                {
                    Name = "ttl_locationreadings_61d",
                    ExpireAfter = TimeSpan.FromDays(61)
                }));

            // Latest status: 1 document / team / serial for fast dashboard/user page.
            var latestUx = Builders<BsonDocument>.IndexKeys
                .Ascending("teamId")
                .Ascending("serialNumber");

            EnsureLatestIndex(new CreateIndexModel<BsonDocument>(
                latestUx,
                new CreateIndexOptions { Name = "ux_team_serial_latest", Unique = true }));

            var latestQuery = Builders<BsonDocument>.IndexKeys
                .Ascending("teamId")
                .Descending("updatedAtUtc");

            EnsureLatestIndex(new CreateIndexModel<BsonDocument>(
                latestQuery,
                new CreateIndexOptions { Name = "ix_team_latest_updated_desc" }));
        }

        private void EnsureIndex(CreateIndexModel<LocationReading> model)
        {
            var name = model.Options?.Name;

            // If index with same name exists -> done
            if (!string.IsNullOrWhiteSpace(name))
            {
                var exists = _col.Indexes.List()
                    .ToEnumerable()
                    .Any(ix => ix.TryGetValue("name", out var v) && v.IsString && v.AsString == name);

                if (exists) return;
            }

            try
            {
                _col.Indexes.CreateOne(model);
            }
            catch (MongoCommandException mce)
            {
                // "Index already exists with different options" (thường gặp khi đổi TTL days)
                var msg = mce.Message ?? string.Empty;

                if (!string.IsNullOrWhiteSpace(name) &&
                    (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase) ||
                     msg.Contains("exists with different options", StringComparison.OrdinalIgnoreCase)))
                {
                    // Nếu muốn tự sửa TTL khi khác options:
                    //    - Xoá index cũ theo name
                    //    - Tạo lại index mới
                    // (an toàn vì chỉ drop đúng theo name bạn đặt)
                    try
                    {
                        _col.Indexes.DropOne(name);
                        _col.Indexes.CreateOne(model);
                        return;
                    }
                    catch
                    {
                        // Nếu drop/create fail thì thôi, tránh crash app
                        return;
                    }
                }

                throw;
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

        private void EnsureLatestIndex(CreateIndexModel<BsonDocument> model)
        {
            var name = model.Options?.Name;

            if (!string.IsNullOrWhiteSpace(name))
            {
                var exists = _latestCol.Indexes.List()
                    .ToEnumerable()
                    .Any(ix => ix.TryGetValue("name", out var v) && v.IsString && v.AsString == name);

                if (exists) return;
            }

            try
            {
                _latestCol.Indexes.CreateOne(model);
            }
            catch (MongoCommandException mce)
            {
                var msg = mce.Message ?? string.Empty;

                if (!string.IsNullOrWhiteSpace(name) &&
                    (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase) ||
                     msg.Contains("exists with different options", StringComparison.OrdinalIgnoreCase)))
                {
                    try
                    {
                        _latestCol.Indexes.DropOne(name);
                        _latestCol.Indexes.CreateOne(model);
                        return;
                    }
                    catch
                    {
                        return;
                    }
                }

                throw;
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

        #endregion

        #region Helpers
        private static DateTime ToUtcSecond(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Unspecified)
                dt = DateTime.SpecifyKind(dt, DateTimeKind.Utc);
            else
                dt = dt.ToUniversalTime();

            var ticks = dt.Ticks - (dt.Ticks % TimeSpan.TicksPerSecond);
            return new DateTime(ticks, DateTimeKind.Utc);
        }

        // Chặn giá trị rác/sentinel lọt ra chart/latest.
        // LogTag đôi khi trả reading không có temperature; code cũ lưu SENTINEL_TEMP
        // dạng -1.7976931348623157E+308 làm chart méo hoặc chỉ còn 1 điểm.
        private static bool IsRealTemperature(double? value)
        {
            if (!value.HasValue)
                return false;

            var v = value.Value;

            return !double.IsNaN(v)
                && !double.IsInfinity(v)
                && v > -100
                && v < 100;
        }

        private static FilterDefinition<LocationReading> RealTemperatureFilter(
            FilterDefinitionBuilder<LocationReading> fb)
        {
            return fb.Gt(x => x.Temperature, -100)
                   & fb.Lt(x => x.Temperature, 100);
        }

        private static bool CanPushNow(string serial, DateTimeOffset now)
        {
            var last = _lastPushed.GetOrAdd(serial, DateTimeOffset.MinValue);
            if (now - last >= PushMinSpacing)
            {
                _lastPushed[serial] = now;
                return true;
            }
            return false;
        }

        private static DateTime MinuteBucketUtc(DateTime t)
        {
            var u = t.Kind == DateTimeKind.Utc ? t : t.ToUniversalTime();
            return new DateTime(u.Year, u.Month, u.Day, u.Hour, u.Minute, 0, DateTimeKind.Utc);
        }

        private async Task<List<TeamProfileDto>> GetProfilesCachedAsync(long teamId, CancellationToken ct)
        {
            if (_profilesCache.TryGetValue(teamId, out var entry))
            {
                if ((DateTime.UtcNow - entry.FetchedAtUtc) <= ProfilesTtl)
                    return entry.Data;
            }

            var client = _logtagRouter.GetClientByTeamId(teamId);
            var env = await client.GetProfilesAsync(teamId, ct); // envelope có Data/Status/TimestampUtc
            var list = env.Data ?? new List<TeamProfileDto>();
            _profilesCache[teamId] = (DateTime.UtcNow, list);
            return list;
        }

        //  Sweep nhẹ nhàng, chống chạy song song


        private static void SweepOldTemperatureStatesIfNeeded()
        {
            var now = DateTime.UtcNow;

            if ((now - _lastTemperatureStateSweepUtc) < TemperatureStateSweepInterval)
                return;

            if (Interlocked.CompareExchange(ref _temperatureStateSweeping, 1, 0) != 0)
                return;

            try
            {
                var cutoff = now - TemperatureStateRetention;

                foreach (var item in _temperatureTransitionStates)
                {
                    // Không xoá trạng thái đang ALARM; nếu thiết bị quay lại sau thời gian dài,
                    // hệ thống vẫn có thể xác nhận 2 reading an toàn và gửi thông báo ổn định.
                    if (!item.Value.IsAlarmActive &&
                        item.Value.LastTouchedUtc < cutoff)
                    {
                        _temperatureTransitionStates.TryRemove(item.Key, out _);
                    }
                }

                _lastTemperatureStateSweepUtc = now;
            }
            finally
            {
                Volatile.Write(ref _temperatureStateSweeping, 0);
            }
        }
        private static string? BsonStringOrNull(BsonDocument doc, string field)
        {
            if (!doc.TryGetValue(field, out var value) || value.IsBsonNull)
                return null;

            return value.IsString ? value.AsString : value.ToString();
        }

        private static double? BsonDoubleOrNull(BsonDocument doc, string field)
        {
            if (!doc.TryGetValue(field, out var value) || value.IsBsonNull)
                return null;

            if (value.IsDouble) return value.AsDouble;
            if (value.IsInt32) return value.AsInt32;
            if (value.IsInt64) return value.AsInt64;
            if (value.IsDecimal128 && double.TryParse(value.AsDecimal128.ToString(), out var decimalParsed)) return decimalParsed;
            if (value.IsString && double.TryParse(value.AsString, out var parsed)) return parsed;

            return null;
        }

        private static DateTime? BsonDateTimeOrNull(BsonDocument doc, string field)
        {
            if (!doc.TryGetValue(field, out var value) || value.IsBsonNull)
                return null;

            if (value.IsValidDateTime)
                return value.ToUniversalTime();

            if (value.IsString && DateTime.TryParse(value.AsString, out var parsed))
                return parsed.ToUniversalTime();

            return null;
        }

        private static LocationReading ToLocationReadingFromLatest(BsonDocument doc)
        {
            return new LocationReading
            {
                TeamId = BsonStringOrNull(doc, "teamId") ?? string.Empty,
                SerialNumber = BsonStringOrNull(doc, "serialNumber") ?? string.Empty,
                DateUtc = BsonDateTimeOrNull(doc, "dateUtc") ?? DateTime.MinValue,
                Temperature = BsonDoubleOrNull(doc, "temperature") ?? SENTINEL_TEMP,
                Humidity = BsonDoubleOrNull(doc, "humidity") ?? 0.0
            };
        }

        private async Task UpsertLatestAsync(
            long teamId,
            string serialNumber,
            DateTime dateUtc,
            double? temperature,
            double? humidity,
            CancellationToken ct)
        {
            var teamKey = teamId.ToString();
            var serialKey = (serialNumber ?? string.Empty).Trim();

            if (string.IsNullOrWhiteSpace(serialKey) || dateUtc == default)
                return;

            // Không ghi latest nếu reading không có nhiệt độ thật.
            // Nếu ghi SENTINEL_TEMP vào latest thì dashboard/chart sẽ hiển thị sai.
            if (!IsRealTemperature(temperature))
                return;

            dateUtc = ToUtcSecond(dateUtc);

            var fb = Builders<BsonDocument>.Filter;
            var teamSerialFilter =
                fb.Eq("teamId", teamKey)
                & fb.Eq("serialNumber", serialKey);

            try
            {
                // Không để backfill cũ ghi đè latest mới hơn.
                var existing = await _latestCol
                    .Find(teamSerialFilter)
                    .Project(new BsonDocument { { "dateUtc", 1 } })
                    .FirstOrDefaultAsync(ct);

                var existingDate = existing is null
                    ? null
                    : BsonDateTimeOrNull(existing, "dateUtc");

                if (existingDate.HasValue && existingDate.Value > dateUtc)
                    return;

                var now = DateTime.UtcNow;

                var setDoc = new BsonDocument
                {
                    { "teamId", teamKey },
                    { "teamIdLong", teamId },
                    { "serialNumber", serialKey },
                    { "dateUtc", dateUtc },
                    { "temperature", temperature.HasValue ? BsonValue.Create(temperature.Value) : BsonValue.Create(SENTINEL_TEMP) },
                    { "humidity", humidity.HasValue ? BsonValue.Create(humidity.Value) : BsonNull.Value },
                    { "updatedAtUtc", now }
                };

                var updateDoc = new BsonDocument
                {
                    { "$set", setDoc },
                    { "$setOnInsert", new BsonDocument
                        {
                            { "_id", ObjectId.GenerateNewId() },
                            { "createdAtUtc", now }
                        }
                    }
                };

                await _latestCol.UpdateOneAsync(
                    teamSerialFilter,
                    updateDoc,
                    new UpdateOptions { IsUpsert = true },
                    ct);
            }
            catch (MongoWriteException mwx) when (mwx.WriteError?.Code == 11000)
            {
                // Parallel upsert race: lần poll kế tiếp sẽ cập nhật lại, không cần làm fail sync.
                _log.LogDebug("[Latest] Duplicate latest upsert ignored serial={Serial}, teamId={TeamId}", serialKey, teamId);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "[Latest] Upsert latest failed serial={Serial}, teamId={TeamId}", serialKey, teamId);
            }
        }


        private static string BatchInvalidSerialKey(long teamId, string serial)
            => $"{teamId}|{(serial ?? string.Empty).Trim().ToUpperInvariant()}";

        private bool IsBatchInvalidSerialSuppressed(long teamId, string serial)
        {
            var key = BatchInvalidSerialKey(teamId, serial);
            if (!_batchInvalidSerialUntil.TryGetValue(key, out var untilUtc))
                return false;

            if (DateTimeOffset.UtcNow <= untilUtc)
                return true;

            _batchInvalidSerialUntil.TryRemove(key, out _);
            return false;
        }

        private void MarkBatchInvalidSerial(long teamId, string serial)
        {
            serial = (serial ?? string.Empty).Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(serial)) return;

            var key = BatchInvalidSerialKey(teamId, serial);
            _batchInvalidSerialUntil[key] = DateTimeOffset.UtcNow.Add(BatchInvalidSerialTtl);
        }

        private static string ExceptionMessages(Exception ex)
        {
            var parts = new List<string>();
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (!string.IsNullOrWhiteSpace(e.Message))
                    parts.Add(e.Message);
            }

            return string.Join(" | ", parts);
        }

        private static bool IsInvalidSerialBatchError(Exception ex)
        {
            var msg = ExceptionMessages(ex);

            return msg.Contains("serial numbers are invalid", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("invalid or unavailable", StringComparison.OrdinalIgnoreCase)
                || (msg.Contains("InvalidInput", StringComparison.OrdinalIgnoreCase)
                    && msg.Contains("serial", StringComparison.OrdinalIgnoreCase));
        }

        private static bool IsQuotaLikeError(Exception ex)
        {
            if (IsInvalidSerialBatchError(ex))
                return false;

            var msg = ExceptionMessages(ex);

            return msg.Contains("API requests quota exceeded", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("quota exceeded", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("rate limit", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("too many requests", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("ServiceUnavailable", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("429", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("503", StringComparison.OrdinalIgnoreCase);
        }

        #endregion

        #region Alert evaluation (AlertThreshold-based)
        /// <summary>
        /// Đánh giá reading theo AlertThreshold:
        /// - Reading mới đầu tiên vượt ngưỡng: chuyển sang ALARM và gửi SMS ngay.
        /// - Khi ALARM đang hoạt động và vẫn vượt cùng hướng: không gửi lặp.
        /// - Nếu chuyển LOW <-> HIGH: gửi cảnh báo mới ngay.
        /// - Reading mới đầu tiên quay về trong ngưỡng: chuyển sang STABLE và gửi SMS ngay.
        /// - Chỉ xử lý reading đủ mới; reading backfill không thay đổi state.
        /// </summary>
        private async Task EvaluateAndEmitOncePerMinuteAsync(
            long teamId,
            string serial,
            DateTime tsUtc,
            double? temperature,
            bool persistEventPerMinute = true,
            CancellationToken ct = default)
        {
            if (!IsRealTemperature(temperature))
                return;

            var tempVal = temperature!.Value;
            var serialNorm = (serial ?? string.Empty)
                .Trim()
                .ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(serialNorm))
                return;

            tsUtc = ToUtcSecond(tsUtc);

            // Dữ liệu backfill/lịch sử không được làm thay đổi trạng thái hiện tại.
            var isRecent =
                tsUtc >= DateTime.UtcNow.AddMinutes(-RecentAlertWindowMinutes);

            if (!isRecent)
                return;

            AlertThreshold? rule;

            try
            {
                rule = await _thresholds.GetBySerialAsync(serialNorm, ct);
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "[TemperatureState] Load threshold failed serial={Serial}",
                    serialNorm);

                return;
            }

            if (rule is null)
            {
                if (ShouldLogNoThreshold(serialNorm))
                {
                    _log.LogInformation(
                        "[TemperatureState] No threshold configured for serial={Serial}. This message is throttled.",
                        serialNorm);
                }

                return;
            }

            string? breachKind = null;
            string? alarmEventType = null;
            double? breachedThreshold = null;

            if (rule.UpperThreshold.HasValue &&
                tempVal > rule.UpperThreshold.Value)
            {
                breachKind = "HIGH";
                alarmEventType = "temperature_alarm_high";
                breachedThreshold = rule.UpperThreshold.Value;
            }
            else if (rule.LowerThreshold.HasValue &&
                     tempVal < rule.LowerThreshold.Value)
            {
                breachKind = "LOW";
                alarmEventType = "temperature_alarm_low";
                breachedThreshold = rule.LowerThreshold.Value;
            }

            var stateKey = $"{teamId}|{serialNorm}";

            var state = _temperatureTransitionStates.GetOrAdd(
                stateKey,
                _ => new TemperatureTransitionState());

            var shouldEmitAlarm = false;
            var shouldEmitStable = false;
            var alarmEmissionReason = string.Empty;

            var emittedEventType = alarmEventType;
            var emittedThreshold = breachedThreshold ?? 0.0;

            var breachCountSnapshot = 0;
            var stableCountSnapshot = 0;
            var alarmActiveSnapshot = false;
            var lastAlarmNotificationSnapshot = DateTime.MinValue;

            // Khi quyết định phát SMS, timestamp này được reserve ngay trong lock.
            // Nếu việc tạo/publish event lỗi, timestamp sẽ được trả lại để reading sau retry.
            var alarmNotificationPreviousUtc = DateTime.MinValue;
            var alarmNotificationReservedUtc = DateTime.MinValue;

            var nowUtc = DateTime.UtcNow;

            lock (state)
            {
                // Batch API dùng cửa sổ overlap. Cùng một reading có thể xuất hiện lại
                // ở nhiều vòng polling, vì vậy tuyệt đối không được tính lại.
                if (tsUtc <= state.LastProcessedReadingUtc)
                    return;

                state.LastProcessedReadingUtc = tsUtc;
                state.LastTouchedUtc = nowUtc;

                if (breachKind != null &&
                    breachedThreshold.HasValue &&
                    !string.IsNullOrWhiteSpace(alarmEventType))
                {
                    // Chỉ cần vượt lại một lần thì chuỗi "đã an toàn" bị hủy.
                    state.StableCount = 0;

                    if (!state.IsAlarmActive)
                    {
                        // Đổi từ vượt trên sang vượt dưới hoặc ngược lại thì đếm lại.
                        if (!string.Equals(
                                state.BreachKind,
                                breachKind,
                                StringComparison.OrdinalIgnoreCase))
                        {
                            state.BreachKind = breachKind;
                            state.BreachCount = 1;
                        }
                        else
                        {
                            state.BreachCount++;
                        }

                        if (state.BreachCount >=
                            TemperatureAlarmConsecutiveReadings)
                        {
                            state.BreachCount =
                                TemperatureAlarmConsecutiveReadings;

                            state.IsAlarmActive = true;

                            if (!state.AlarmNotificationInFlight)
                            {
                                shouldEmitAlarm = true;
                                alarmEmissionReason = "initial";

                                alarmNotificationPreviousUtc =
                                    state.LastAlarmNotificationUtc;

                                alarmNotificationReservedUtc = nowUtc;
                                state.LastAlarmNotificationUtc =
                                    alarmNotificationReservedUtc;

                                state.AlarmNotificationInFlight = true;
                            }
                        }
                    }
                    else
                    {
                        state.BreachCount =
                            TemperatureAlarmConsecutiveReadings;

                        var directionChanged =
                            !string.Equals(
                                state.BreachKind,
                                breachKind,
                                StringComparison.OrdinalIgnoreCase);

                        if (directionChanged)
                        {
                            // Ví dụ đang LOW nhưng chuyển thẳng sang HIGH mà chưa có
                            // hai điểm an toàn: phát ngay loại cảnh báo mới.
                            state.BreachKind = breachKind;

                            if (!state.AlarmNotificationInFlight)
                            {
                                shouldEmitAlarm = true;
                                alarmEmissionReason = "direction_changed";

                                alarmNotificationPreviousUtc =
                                    state.LastAlarmNotificationUtc;

                                alarmNotificationReservedUtc = nowUtc;
                                state.LastAlarmNotificationUtc =
                                    alarmNotificationReservedUtc;

                                state.AlarmNotificationInFlight = true;
                            }
                        }
                        else
                        {
                            // Đang ALARM nhưng có READING MỚI vẫn vượt ngưỡng.
                            // Phát cảnh báo ngay cho reading mới.
                            if (!state.AlarmNotificationInFlight)
                            {
                                shouldEmitAlarm = true;
                                alarmEmissionReason = "continued";

                                alarmNotificationPreviousUtc =
                                    state.LastAlarmNotificationUtc;

                                alarmNotificationReservedUtc = nowUtc;

                                state.LastAlarmNotificationUtc =
                                    alarmNotificationReservedUtc;

                                state.AlarmNotificationInFlight = true;
                            }
                        }
                    }
                }
                else
                {
                    // Reading hiện tại nằm trong khoảng an toàn.
                    state.BreachCount = 0;
                    state.BreachKind = null;

                    if (state.IsAlarmActive)
                    {
                        state.StableCount++;

                        if (state.StableCount >=
                            TemperatureStableConsecutiveReadings)
                        {
                            state.StableCount = 0;
                            state.IsAlarmActive = false;
                            state.LastAlarmNotificationUtc =
                                DateTime.MinValue;
                            state.AlarmNotificationInFlight = false;
                            shouldEmitStable = true;
                        }
                    }
                    else
                    {
                        // Chưa từng vào ALARM thì không gửi "đã ổn định".
                        state.StableCount = 0;
                        state.LastAlarmNotificationUtc = DateTime.MinValue;
                        state.AlarmNotificationInFlight = false;
                    }
                }

                breachCountSnapshot = state.BreachCount;
                stableCountSnapshot = state.StableCount;
                alarmActiveSnapshot = state.IsAlarmActive;
                lastAlarmNotificationSnapshot =
                    state.LastAlarmNotificationUtc;
            }

            SweepOldTemperatureStatesIfNeeded();

            if (breachKind != null)
            {
                _log.LogInformation(
                    "[TemperatureState] serial={Serial}, T={Temperature:0.##}°C, kind={Kind}, breach={Count}/{Required}, alarmActive={AlarmActive}, emitAlarm={EmitAlarm}, reason={Reason}, lastAlarmSmsUtc={LastAlarmSmsUtc:o}",
                    serialNorm,
                    tempVal,
                    breachKind,
                    breachCountSnapshot,
                    TemperatureAlarmConsecutiveReadings,
                    alarmActiveSnapshot,
                    shouldEmitAlarm,
                    string.IsNullOrWhiteSpace(alarmEmissionReason)
                        ? "none"
                        : alarmEmissionReason,
                    lastAlarmNotificationSnapshot);
            }
            else
            {
                _log.LogInformation(
                    "[TemperatureState] serial={Serial}, T={Temperature:0.##}°C is safe, stable={Count}/{Required}, recoveredNow={Recovered}",
                    serialNorm,
                    tempVal,
                    stableCountSnapshot,
                    TemperatureStableConsecutiveReadings,
                    shouldEmitStable);
            }

            if (!persistEventPerMinute)
            {
                // Nếu caller chỉ muốn evaluate nhưng không persist, trả reservation
                // để không làm mất lượt gửi ở reading sau.
                if (shouldEmitAlarm)
                {
                    lock (state)
                    {
                        if (state.LastAlarmNotificationUtc ==
                            alarmNotificationReservedUtc)
                        {
                            state.LastAlarmNotificationUtc =
                                alarmNotificationPreviousUtc;
                        }

                        state.AlarmNotificationInFlight = false;
                    }
                }

                return;
            }

            // Reading đầu tiên vượt ngưỡng hoặc đổi hướng HIGH/LOW:
            // tạo Event -> SignalR -> SMS -> trừ quota đúng user NGAY.
            if (shouldEmitAlarm &&
                breachedThreshold.HasValue &&
                !string.IsNullOrWhiteSpace(emittedEventType))
            {
                try
                {
                    await _events.InsertTemperatureAlarmAsync(
                        teamId,
                        serialNorm,
                        emittedThreshold,
                        tempVal,
                        emittedEventType,
                        ct,
                        eventTimeUtc: tsUtc);

                    lock (state)
                    {
                        state.AlarmNotificationInFlight = false;
                    }

                    _log.LogWarning(
                        "[TemperatureState] ALARM SMS requested serial={Serial}, T={Temperature:0.##}°C, kind={Kind}, reason={Reason}, readingUtc={ReadingUtc:o}.",
                        serialNorm,
                        tempVal,
                        breachKind,
                        alarmEmissionReason,
                        tsUtc);
                }
                catch (MongoWriteException mwx)
                    when (mwx.WriteError?.Code == 11000)
                {
                    // Event đã tồn tại. Không gửi SMS lặp lại cho cùng timestamp.
                    lock (state)
                    {
                        state.AlarmNotificationInFlight = false;
                    }

                    _log.LogWarning(
                        "[TemperatureState] Duplicate alarm event serial={Serial}, eventUtc={EventUtc:o}, type={Type}. SMS skipped for this duplicate.",
                        serialNorm,
                        tsUtc,
                        emittedEventType);
                }
                catch (Exception ex)
                {
                    // Hoàn reservation và trả state về chưa ALARM để reading mới
                    // kế tiếp có thể phát lại cảnh báo nếu lần hiện tại lỗi.
                    lock (state)
                    {
                        if (state.LastAlarmNotificationUtc ==
                            alarmNotificationReservedUtc)
                        {
                            state.LastAlarmNotificationUtc =
                                alarmNotificationPreviousUtc;
                        }

                        state.AlarmNotificationInFlight = false;
                        state.IsAlarmActive = false;
                        state.BreachCount = 0;
                        state.BreachKind = null;
                    }

                    _log.LogError(
                        ex,
                        "[TemperatureState] Insert/publish alarm event failed serial={Serial}, reason={Reason}. Next new reading may retry.",
                        serialNorm,
                        alarmEmissionReason);
                }
            }

            // Sau khi đã ALARM, reading an toàn đầu tiên:
            // tạo event temperature_stable và gửi SMS ngay một lần.
            if (shouldEmitStable)
            {
                try
                {
                    await _events.InsertTemperatureStableAsync(
                        teamId,
                        serialNorm,
                        tempVal,
                        ct,
                        eventTimeUtc: tsUtc);

                    _log.LogWarning(
                        "[TemperatureState] RECOVERED serial={Serial}, T={Temperature:0.##}°C. Stable SMS requested.",
                        serialNorm,
                        tempVal);
                }
                catch (MongoWriteException mwx)
                    when (mwx.WriteError?.Code == 11000)
                {
                    _log.LogWarning(
                        "[TemperatureState] Duplicate stable event serial={Serial}, eventUtc={EventUtc:o}. Stable SMS skipped for this duplicate.",
                        serialNorm,
                        tsUtc);
                }
                catch (Exception ex)
                {
                    _log.LogError(
                        ex,
                        "[TemperatureState] Insert stable event failed serial={Serial}",
                        serialNorm);
                }
            }
        }
        #endregion

        #region Query builders / Reads
        public IMongoCollection<LocationReading> GetCollection() => _col;
        public IQueryable<LocationReading> AsQueryable() => _col.AsQueryable();

        public IQueryable<LocationReading> BuildBaseQuery(IEnumerable<string>? serials, int? year, int? month)
        {
            var q = _col.AsQueryable();

            if (serials != null && serials.Any())
                q = q.Where(r => serials.Contains(r.SerialNumber));

            if (year.HasValue) q = q.Where(r => r.DateUtc.Year == year.Value);
            if (month.HasValue) q = q.Where(r => r.DateUtc.Month == month.Value);

            q = q.Where(r => r.Temperature > -100 && r.Temperature < 100);
            return q;
        }

        public async Task<List<LocationReading>> GetRecentAsync(string serial, TimeSpan window, int limit = 5000, string? teamId = null)
        {
            var serialNorm = (serial ?? string.Empty).Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(serialNorm))
                return new List<LocationReading>();

            var from = DateTime.UtcNow - window;
            var fb = Builders<LocationReading>.Filter;

            var filter =
                fb.Eq(x => x.SerialNumber, serialNorm)
                & fb.Gte(x => x.DateUtc, from)
                & RealTemperatureFilter(fb);

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId.Trim());

            return await _col.Find(filter)
                .SortBy(r => r.DateUtc)
                .Project(r => new LocationReading
                {
                    SerialNumber = r.SerialNumber,
                    DateUtc = r.DateUtc,
                    Temperature = r.Temperature,
                    Humidity = r.Humidity
                })
                .Limit(Math.Clamp(limit, 100, 5000))
                .ToListAsync();
        }

        public async Task<List<LocationReading>> GetLatestBySerialsAsync(IEnumerable<string> serials, string? teamId = null)
        {
            var list = (serials ?? Enumerable.Empty<string>())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (list.Count == 0) return new();

            var result = new List<LocationReading>();
            var latestBySerial = new Dictionary<string, LocationReading>(StringComparer.OrdinalIgnoreCase);

            // 1) Ưu tiên đọc bảng latest để dashboard/user page không phải sort raw theo từng serial.
            try
            {
                var fbLatest = Builders<BsonDocument>.Filter;
                var latestFilter = fbLatest.In("serialNumber", list);

                if (!string.IsNullOrWhiteSpace(teamId))
                    latestFilter &= fbLatest.Eq("teamId", teamId.Trim());

                var latestDocs = await _latestCol
                    .Find(latestFilter)
                    .ToListAsync();

                foreach (var row in latestDocs
                    .Select(ToLocationReadingFromLatest)
                    .Where(x =>
                        !string.IsNullOrWhiteSpace(x.SerialNumber)
                        && x.DateUtc != DateTime.MinValue
                        && IsRealTemperature(x.Temperature))
                    .OrderByDescending(x => x.DateUtc))
                {
                    if (!latestBySerial.ContainsKey(row.SerialNumber))
                        latestBySerial[row.SerialNumber] = row;
                }
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "[Latest] Read DeviceLatestStatus failed. Fallback to raw LocationReadings.");
            }

            result.AddRange(latestBySerial.Values);

            var found = latestBySerial.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = list
                .Where(s => !found.Contains(s))
                .ToList();

            if (missing.Count == 0)
                return result;

            // 2) Fallback: nếu latest chưa có dữ liệu thì đọc raw như logic cũ.
            var fb = Builders<LocationReading>.Filter;

            var tasks = missing.Select(async s =>
            {
                var f = fb.Eq(x => x.SerialNumber, s)
                        & RealTemperatureFilter(fb);

                if (!string.IsNullOrWhiteSpace(teamId))
                    f &= fb.Eq(x => x.TeamId, teamId.Trim());

                return await _col.Find(f).SortByDescending(x => x.DateUtc).Limit(1).FirstOrDefaultAsync();
            });

            var arr = await Task.WhenAll(tasks);
            result.AddRange(arr.Where(x => x != null).Select(x => x!));

            return result
                .GroupBy(x => x.SerialNumber, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.OrderByDescending(x => x.DateUtc).First())
                .ToList();
        }

        public async Task<List<LocationReading>> GetHistoryBySerialAsync(string serial, int take, string? teamId = null)
        {
            var fb = Builders<LocationReading>.Filter;
            var serialNorm = (serial ?? string.Empty).Trim().ToUpperInvariant();

            var filter = fb.Eq(x => x.SerialNumber, serialNorm)
                       & RealTemperatureFilter(fb);

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId);

            return await _col.Find(filter)
                .SortByDescending(x => x.DateUtc)
                .Limit(Math.Clamp(take, 1, 1000))
                .ToListAsync();
        }

        public async Task<List<LocationReading>> GetRangeAsync(string serial, DateTime fromUtc, DateTime toUtc, int limit = 100_000, string? teamId = null)
        {
            fromUtc = DateTime.SpecifyKind(fromUtc, DateTimeKind.Utc);
            toUtc = DateTime.SpecifyKind(toUtc, DateTimeKind.Utc);

            var fb = Builders<LocationReading>.Filter;
            var serialNorm = (serial ?? string.Empty).Trim().ToUpperInvariant();

            var filter =
                fb.Eq(x => x.SerialNumber, serialNorm)
                & fb.Gte(x => x.DateUtc, fromUtc)
                & fb.Lte(x => x.DateUtc, toUtc)
                & RealTemperatureFilter(fb);

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId.Trim());

            return await _col.Find(filter)
                .SortBy(x => x.DateUtc)
                .Project(x => new LocationReading
                {
                    SerialNumber = x.SerialNumber,
                    DateUtc = x.DateUtc,
                    Temperature = x.Temperature,
                    Humidity = x.Humidity
                })
                .Limit(limit)
                .ToListAsync();
        }
        #endregion

        #region Writes / Sync
        public record SyncStats(int Fetched, int Inserted, int Updated);

        public interface IEndpointScheduler
        {
            Task<T> Enqueue<T>(string endpointKey, Func<CancellationToken, Task<T>> work, CancellationToken ct = default);
        }

        public async Task<SyncStats> PullAndUpsertWithStatsAsync(
            long teamId,
            IEnumerable<string> serials,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken ct)
        {
            fromUtc = ToUtcSecond(DateTime.SpecifyKind(fromUtc, DateTimeKind.Utc));
            toUtc = ToUtcSecond(DateTime.SpecifyKind(toUtc, DateTimeKind.Utc).AddSeconds(2));

            int fetched = 0;
            int inserted = 0;
            int updated = 0;
            int apiOk = 0;
            int apiFailed = 0;
            int apiNoData = 0;
            int apiQuota = 0;
            int invalidSerials = 0;

            if (teamId <= 0)
            {
                _log.LogWarning("[MAIN-BATCH-V2] Skip sync because invalid teamId={TeamId}", teamId);
                return new SyncStats(0, 0, 0);
            }

            if (toUtc <= fromUtc)
            {
                _log.LogWarning(
                    "[MAIN-BATCH-V2] Skip sync because invalid time window: teamId={TeamId}, from={From:o}, to={To:o}",
                    teamId,
                    fromUtc,
                    toUtc);

                return new SyncStats(0, 0, 0);
            }

            // Batch API v2 không cho window vượt 15 phút.
            // Nếu worker truyền backfill dài, mình lấy 14m59s cuối để realtime không bị fail/quota.
            var maxWindow = TimeSpan.FromMinutes(15).Add(TimeSpan.FromSeconds(-1));
            if (toUtc - fromUtc > maxWindow)
            {
                var oldFrom = fromUtc;
                fromUtc = ToUtcSecond(toUtc - maxWindow);

                _log.LogWarning(
                    "[MAIN-BATCH-V2] Window exceeded 15 minutes, auto-clamped: teamId={TeamId}, oldFrom={OldFrom:o}, newFrom={NewFrom:o}, to={To:o}",
                    teamId,
                    oldFrom,
                    fromUtc,
                    toUtc);
            }

            var rawList = (serials ?? Array.Empty<string>())
                .Select(s => (s ?? string.Empty).Trim().ToUpperInvariant())
                .Where(s => s.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var list = rawList
                .Where(s => !IsBatchInvalidSerialSuppressed(teamId, s))
                .ToList();

            var suppressedCount = rawList.Count - list.Count;
            if (suppressedCount > 0)
            {
                _log.LogWarning(
                    "[MAIN-BATCH-V2] Skipped {Count} cached invalid/unavailable serials for teamId={TeamId}.",
                    suppressedCount,
                    teamId);
            }

            if (list.Count == 0)
            {
                _log.LogWarning("[MAIN-BATCH-V2] No serials to sync for teamId={TeamId}", teamId);
                return new SyncStats(0, 0, 0);
            }

            // Chọn đúng LogTag account/client theo TeamID.
            // Với nhiều account, không dùng cứng Main/LT5 nữa.
            var logtagClient = _logtagRouter.GetClientByTeamId(teamId);

            // Key riêng theo account + team để EndpointScheduler throttle đúng quota từng account/team.
            var endpointKey = _logtagRouter.BuildEndpointKey(teamId, "locationreadings:v2:batch");
            var batchSize = Math.Clamp(BatchV2MaxSerialNumbers, 1, 500);
            var totalBatches = (int)Math.Ceiling(list.Count / (double)batchSize);
            var totalSw = System.Diagnostics.Stopwatch.StartNew();

            _log.LogWarning(
                "[MAIN-BATCH-V2] START sync: teamId={TeamId}, serials={Count}, batches={Batches}, from={From:o}, to={To:o}, endpointKey={EndpointKey}, batchSize={BatchSize}",
                teamId,
                list.Count,
                totalBatches,
                fromUtc,
                toUtc,
                endpointKey,
                batchSize);

            for (int i = 0, batchNo = 1; i < list.Count; i += batchSize, batchNo++)
            {
                ct.ThrowIfCancellationRequested();

                var slice = list.Skip(i).Take(batchSize).ToList();
                await PullOneBatchWithInvalidIsolationAsync(slice, batchNo, totalBatches, depth: 0);

                // Hãng giới hạn 1 request/phút. Nếu còn batch tiếp theo, chờ 61s để tránh 429.
                if (i + batchSize < list.Count)
                {
                    _log.LogInformation(
                        "[MAIN-BATCH-V2] Waiting {Seconds}s before next batch to respect 1 request/minute limit.",
                        BatchV2Spacing.TotalSeconds);

                    await Task.Delay(BatchV2Spacing, ct);
                }
            }

            totalSw.Stop();

            _log.LogWarning(
                "[MAIN-BATCH-V2] DONE teamId={TeamId}, serials={Serials}, batches={Batches}, apiOk={ApiOk}, apiFailed={ApiFailed}, quota={Quota}, invalidSerials={InvalidSerials}, noData={NoData}, fetched={Fetched}, inserted={Inserted}, updated={Updated}, elapsedMs={Elapsed}",
                teamId,
                list.Count,
                totalBatches,
                apiOk,
                apiFailed,
                apiQuota,
                invalidSerials,
                apiNoData,
                fetched,
                inserted,
                updated,
                totalSw.ElapsedMilliseconds);

            return new SyncStats(fetched, inserted, updated);

            async Task PullOneBatchWithInvalidIsolationAsync(
                List<string> slice,
                int batchNo,
                int totalBatchCount,
                int depth)
            {
                if (slice.Count == 0)
                    return;

                ct.ThrowIfCancellationRequested();

                var sw = System.Diagnostics.Stopwatch.StartNew();

                _log.LogWarning(
                    "[MAIN-BATCH-V2] Request batch {BatchNo}/{TotalBatches}: teamId={TeamId}, serials={Count}, from={From:o}, to={To:o}, depth={Depth}",
                    batchNo,
                    totalBatchCount,
                    teamId,
                    slice.Count,
                    fromUtc,
                    toUtc,
                    depth);

                var req = new LocationReadingsBatchV2Request
                {
                    serialNumbers = slice,
                    startDateUtc = fromUtc,
                    endDateUtc = toUtc
                };

                LocationReadingsBatchV2Response? resp = null;

                try
                {
                    resp = await _sched.Enqueue(endpointKey, async c =>
                    {
                        return await logtagClient.GetLocationReadingsBatchV2Async(teamId, req, c);
                    }, ct);

                    Interlocked.Increment(ref apiOk);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex) when (IsInvalidSerialBatchError(ex))
                {
                    Interlocked.Increment(ref apiFailed);

                    if (slice.Count == 1)
                    {
                        var badSerial = slice[0];
                        Interlocked.Increment(ref invalidSerials);
                        MarkBatchInvalidSerial(teamId, badSerial);

                        _log.LogError(
                            ex,
                            "[MAIN-BATCH-V2] Invalid/unavailable serial isolated and cached. teamId={TeamId}, serial={Serial}, cacheHours={CacheHours}",
                            teamId,
                            badSerial,
                            BatchInvalidSerialTtl.TotalHours);

                        return;
                    }

                    var mid = Math.Max(1, slice.Count / 2);
                    var left = slice.Take(mid).ToList();
                    var right = slice.Skip(mid).ToList();

                    _log.LogWarning(
                        ex,
                        "[MAIN-BATCH-V2] Batch rejected because one or more serials are invalid/unavailable. Splitting batch. teamId={TeamId}, count={Count}, left={Left}, right={Right}, depth={Depth}",
                        teamId,
                        slice.Count,
                        left.Count,
                        right.Count,
                        depth);

                    await PullOneBatchWithInvalidIsolationAsync(left, batchNo, totalBatchCount, depth + 1);

                    if (right.Count > 0)
                    {
                        _log.LogInformation(
                            "[MAIN-BATCH-V2] Waiting {Seconds}s before testing next split to respect 1 request/minute limit.",
                            BatchV2Spacing.TotalSeconds);

                        await Task.Delay(BatchV2Spacing, ct);
                        await PullOneBatchWithInvalidIsolationAsync(right, batchNo, totalBatchCount, depth + 1);
                    }

                    return;
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref apiFailed);

                    var quotaLike = IsQuotaLikeError(ex);
                    if (quotaLike)
                        Interlocked.Increment(ref apiQuota);

                    _log.LogError(
                        ex,
                        "[MAIN-BATCH-V2] API error batch={BatchNo}/{TotalBatches}, teamId={TeamId}, serials={Count}, endpointKey={EndpointKey}, quotaLike={QuotaLike}, elapsedMs={Elapsed}",
                        batchNo,
                        totalBatchCount,
                        teamId,
                        slice.Count,
                        endpointKey,
                        quotaLike,
                        sw.ElapsedMilliseconds);

                    return;
                }

                await ProcessBatchResponseAsync(slice, resp, sw, batchNo, totalBatchCount, depth);
            }

            async Task ProcessBatchResponseAsync(
                List<string> requestedSerials,
                LocationReadingsBatchV2Response? resp,
                System.Diagnostics.Stopwatch sw,
                int batchNo,
                int totalBatchCount,
                int depth)
            {
                var groups = resp?.data ?? new List<LocationReadingsBatchV2Group>();
                if (groups.Count == 0)
                {
                    Interlocked.Add(ref apiNoData, requestedSerials.Count);

                    _log.LogWarning(
                        "[MAIN-BATCH-V2] NO-DATA batch={BatchNo}/{TotalBatches}, teamId={TeamId}, requestedSerials={Count}, elapsedMs={Elapsed}",
                        batchNo,
                        totalBatchCount,
                        teamId,
                        requestedSerials.Count,
                        sw.ElapsedMilliseconds);
                }

                var returnedSerials = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (var group in groups)
                {
                    ct.ThrowIfCancellationRequested();

                    var serial = (group.serialNumber ?? string.Empty).Trim().ToUpperInvariant();
                    if (string.IsNullOrWhiteSpace(serial))
                        continue;

                    returnedSerials.Add(serial);

                    var apiRows = group.readings ?? new List<LocationReadingDto>();
                    if (apiRows.Count == 0)
                    {
                        Interlocked.Increment(ref apiNoData);

                        _log.LogDebug(
                            "[MAIN-BATCH-V2] NO-DATA serial={Serial}, teamId={TeamId}",
                            serial,
                            teamId);

                        continue;
                    }

                    var uniqueRows = apiRows
                        .Where(r => r.dateUtc != default)
                        .Select(r => new LocationReadingDTO
                        {
                            temperature = r.temperature,
                            humidity = r.humidity,
                            dateUtc = ToUtcSecond(r.dateUtc)
                        })
                        .GroupBy(r => r.dateUtc)
                        .Select(g => g.Last())
                        .OrderBy(r => r.dateUtc)
                        .ToList();

                    if (uniqueRows.Count == 0)
                    {
                        _log.LogDebug(
                            "[MAIN-BATCH-V2] NO-VALID-ROWS serial={Serial}, teamId={TeamId}",
                            serial,
                            teamId);

                        continue;
                    }

                    // Chỉ lưu/đẩy chart những row có temperature thật.
                    // Row thiếu temperature sẽ tạo SENTINEL_TEMP làm chart sai, nên bỏ qua.
                    var rowsToStore = uniqueRows
                        .Where(r => IsRealTemperature(r.temperature))
                        .ToList();

                    if (rowsToStore.Count == 0)
                    {
                        _log.LogWarning(
                            "[MAIN-BATCH-V2] NO-TEMP-ROWS serial={Serial}, teamId={TeamId}, rawRows={RawRows}. Skip storing sentinel temperature.",
                            serial,
                            teamId,
                            uniqueRows.Count);

                        continue;
                    }

                    Interlocked.Add(ref fetched, rowsToStore.Count);

                    var latest = rowsToStore[^1];
                    var minTs = rowsToStore[0].dateUtc;
                    var maxTs = latest.dateUtc;
                    var latestAgeSec = (DateTime.UtcNow - latest.dateUtc).TotalSeconds;

                    _log.LogInformation(
                        "[MAIN-BATCH-V2] rows serial={Serial}, teamId={TeamId}, rows={Rows}, min={Min:o}, max={Max:o}, latestAgeSec={AgeSec:0}, temp={Temp}, hum={Hum}",
                        serial,
                        teamId,
                        uniqueRows.Count,
                        minTs,
                        maxTs,
                        latestAgeSec,
                        latest.temperature,
                        latest.humidity);

                    await _dbGate.WaitAsync(ct);

                    try
                    {
                        var fb = Builders<LocationReading>.Filter;
                        var ub = Builders<LocationReading>.Update;

                        const int MAX_BULK = 1000;

                        for (int j = 0; j < rowsToStore.Count; j += MAX_BULK)
                        {
                            var chunk = rowsToStore.Skip(j).Take(MAX_BULK).ToList();
                            var writes = new List<WriteModel<LocationReading>>(chunk.Count);

                            foreach (var r in chunk)
                            {
                                var filter =
                                    fb.Eq(x => x.TeamId, teamId.ToString())
                                    & fb.Eq(x => x.SerialNumber, serial)
                                    & fb.Eq(x => x.DateUtc, r.dateUtc);

                                var update = ub
                                    .Set(x => x.TeamId, teamId.ToString())
                                    .Set(x => x.SerialNumber, serial)
                                    .Set(x => x.DateUtc, r.dateUtc)
                                    .Set(x => x.Temperature, r.temperature ?? SENTINEL_TEMP)
                                    .Set(x => x.Humidity, r.humidity)
                                    .SetOnInsert(x => x.Id, ObjectId.GenerateNewId());

                                writes.Add(new UpdateOneModel<LocationReading>(filter, update)
                                {
                                    IsUpsert = true
                                });
                            }

                            if (writes.Count == 0)
                                continue;

                            try
                            {
                                var result = await _col.BulkWriteAsync(
                                    writes,
                                    new BulkWriteOptions { IsOrdered = false },
                                    ct);

                                var upsertedCount = result.Upserts?.Count ?? 0;
                                var modifiedCount = (int)result.ModifiedCount;

                                Interlocked.Add(ref inserted, upsertedCount);
                                Interlocked.Add(ref updated, modifiedCount);

                                _log.LogInformation(
                                    "[MAIN-BATCH-V2][Upsert] serial={Serial}, teamId={TeamId}, unique={Unique}, inserted={Inserted}, updated={Updated}, chunk={Offset}+{Take}",
                                    serial,
                                    teamId,
                                    rowsToStore.Count,
                                    upsertedCount,
                                    modifiedCount,
                                    j,
                                    writes.Count);
                            }
                            catch (MongoBulkWriteException ex)
                            {
                                _log.LogError(
                                    ex,
                                    "[MAIN-BATCH-V2][Upsert] BulkWrite failed serial={Serial}, teamId={TeamId}, chunk={Offset}",
                                    serial,
                                    teamId,
                                    j);
                            }
                        }
                    }
                    finally
                    {
                        _dbGate.Release();
                    }

                    await UpsertLatestAsync(
                        teamId,
                        serial,
                        latest.dateUtc,
                        latest.temperature,
                        latest.humidity,
                        ct);

                    if (CanPushNow(serial, DateTimeOffset.UtcNow))
                    {
                        await _hub.Clients.Group($"serial:{serial}")
                            .SendAsync(LogTagHub.Events.ReadingUpdate, new
                            {
                                SerialNumber = serial,
                                DateUtc = latest.dateUtc,
                                Temperature = latest.temperature ?? 0.0,
                                Humidity = latest.humidity ?? 0.0
                            }, ct);

                        _log.LogDebug(
                            "[MAIN-BATCH-V2][SignalR] Pushed serial={Serial}, teamId={TeamId}, date={Date:o}",
                            serial,
                            teamId,
                            latest.dateUtc);
                    }

                    // Đánh giá toàn bộ reading mới theo thứ tự thời gian.
                    // LastProcessedReadingUtc trong state machine sẽ bỏ qua các reading
                    // bị lặp lại do cửa sổ polling overlap.
                    var alertRows = rowsToStore
                        .GroupBy(x => MinuteBucketUtc(x.dateUtc))
                        .Select(g => g.OrderBy(x => x.dateUtc).Last())
                        .OrderBy(x => x.dateUtc)
                        .ToList();

                    foreach (var alertRow in alertRows)
                    {
                        await EvaluateAndEmitOncePerMinuteAsync(
                            teamId,
                            serial,
                            alertRow.dateUtc,
                            alertRow.temperature,
                            true,
                            ct);
                    }
                }

                var notReturned = requestedSerials
                    .Where(s => !returnedSerials.Contains(s))
                    .ToList();

                if (notReturned.Count > 0)
                {
                    Interlocked.Add(ref apiNoData, notReturned.Count);

                    _log.LogDebug(
                        "[MAIN-BATCH-V2] Response did not include {MissingCount} requested serials for teamId={TeamId}. Example={Example}",
                        notReturned.Count,
                        teamId,
                        notReturned.FirstOrDefault());
                }

                sw.Stop();

                _log.LogWarning(
                    "[MAIN-BATCH-V2] DONE batch {BatchNo}/{TotalBatches}: teamId={TeamId}, requested={Requested}, returnedGroups={Returned}, depth={Depth}, elapsedMs={Elapsed}",
                    batchNo,
                    totalBatchCount,
                    teamId,
                    requestedSerials.Count,
                    groups.Count,
                    depth,
                    sw.ElapsedMilliseconds);
            }
        }

        public Task<SyncStats> PullLatestTickAsync(
      long teamId,
      IEnumerable<string> serials,
      CancellationToken ct)
        {
            var now = DateTime.UtcNow;

            // Logger có thể ghi/upload chậm hơn chu kỳ poll.
            // Ví dụ logger ghi 10 phút/lần, app poll 5 phút/lần:
            // - Nếu lookback chỉ 5 phút sẽ dễ NO-DATA.
            // - Lookback 15 phút giúp lấy được latest gần nhất.
            // - Dữ liệu trùng không sao vì PullAndUpsertWithStatsAsync đã upsert unique theo SerialNumber + DateUtc.
            var lookbackMinutes = Math.Clamp(PullLatestLookbackMinutes, 5, 60);

            var fromUtc = now.AddMinutes(-lookbackMinutes);
            var toUtc = now.AddSeconds(5);

            _log.LogInformation(
                "[MAIN-REALTIME] PullLatestTick teamId={TeamId}, lookback={LookbackMinutes}m, from={From:o}, to={To:o}",
                teamId,
                lookbackMinutes,
                fromUtc,
                toUtc);

            return PullAndUpsertWithStatsAsync(teamId, serials, fromUtc, toUtc, ct);
        }

        public async Task<int> PullAndUpsertAsync(
            long teamId,
            IEnumerable<string> serials,
            DateTime startDate,
            DateTime endDate,
            CancellationToken ct)
        {
            startDate = DateTime.SpecifyKind(startDate, DateTimeKind.Utc);
            endDate = DateTime.SpecifyKind(endDate, DateTimeKind.Utc);
            var stats = await PullAndUpsertWithStatsAsync(teamId, serials, startDate, endDate, ct);
            return stats.Fetched;
        }

        [Obsolete("Use overload with teamId. This version uses teamId=0 and can cause data to be invisible by team filters.")]
        public Task<int> PullAndUpsertAsync(IEnumerable<string> serials, DateTime startDate, DateTime endDate, CancellationToken ct)
            => PullAndUpsertAsync(0L, serials, startDate, endDate, ct);

        public Task<List<string>> GetKnownSerialsAsync(CancellationToken ct = default)
            => _col.Distinct<string>(nameof(LocationReading.SerialNumber), FilterDefinition<LocationReading>.Empty)
                   .ToListAsync(ct);

        // ===== UpsertMany overloads using your DTO =====
        public Task UpsertManyAsync(long teamId, string serialNumber, List<LocationReadingDTO> data)
            => UpsertManyAsync(teamId, serialNumber, (IEnumerable<LocationReadingDTO>)data, CancellationToken.None);

        public async Task UpsertManyAsync(
      long teamId,
      string serialNumber,
      IEnumerable<LocationReadingDTO> data,
      CancellationToken ct)
        {
            if (data == null) return;
            if (teamId <= 0) return;
            if (string.IsNullOrWhiteSpace(serialNumber)) return;

            var teamIdString = teamId.ToString();
            var serial = serialNumber.Trim().ToUpperInvariant();

            var rows = data
                .Where(d => d.dateUtc != default && IsRealTemperature(d.temperature))
                .Select(d => new
                {
                    dt = ToUtcSecond(d.dateUtc),
                    d.temperature,
                    d.humidity
                })
                .GroupBy(x => x.dt)
                .Select(g => g.Last())
                .OrderBy(x => x.dt)
                .ToList();

            if (rows.Count == 0) return;

            var fb = Builders<LocationReading>.Filter;
            var ub = Builders<LocationReading>.Update;

            var writes = new List<WriteModel<LocationReading>>(rows.Count);

            foreach (var r in rows)
            {
                var filter =
                    fb.Eq(x => x.TeamId, teamIdString) &
                    fb.Eq(x => x.SerialNumber, serial) &
                    fb.Eq(x => x.DateUtc, r.dt);

                var update = ub
                    .Set(x => x.TeamId, teamIdString)
                    .Set(x => x.SerialNumber, serial)
                    .Set(x => x.DateUtc, r.dt)
                    .Set(x => x.Temperature, r.temperature ?? SENTINEL_TEMP)
                    .Set(x => x.Humidity, r.humidity)
                    .SetOnInsert(x => x.Id, ObjectId.GenerateNewId());

                writes.Add(
                    new UpdateOneModel<LocationReading>(filter, update)
                    {
                        IsUpsert = true
                    });
            }

            await _col.BulkWriteAsync(
                writes,
                new BulkWriteOptions
                {
                    IsOrdered = false
                },
                ct);

            var last = rows[^1];

            await UpsertLatestAsync(
                teamId,
                serial,
                last.dt,
                last.temperature,
                last.humidity,
                ct);

            if (CanPushNow(serial, DateTimeOffset.UtcNow))
            {
                await _hub.Clients
                    .Group($"serial:{serial}")
                    .SendAsync(
                        LogTagHub.Events.ReadingUpdate,
                        new
                        {
                            SerialNumber = serial,
                            DateUtc = last.dt,
                            Temperature = last.temperature ?? 0.0,
                            Humidity = last.humidity ?? 0.0
                        },
                        ct);
            }

            var perMinuteGroups = rows
                .GroupBy(x => new DateTime(
                    x.dt.Year,
                    x.dt.Month,
                    x.dt.Day,
                    x.dt.Hour,
                    x.dt.Minute,
                    0,
                    DateTimeKind.Utc))
                .ToList();

            foreach (var g in perMinuteGroups)
            {
                var bucket = g.Key;
                var lastRow = g.Last();

                await EvaluateAndEmitOncePerMinuteAsync(
                    teamId,
                    serial,
                    bucket,
                    lastRow.temperature,
                    true,
                    ct);
            }
        }
        #endregion
        private bool ShouldLogNoThreshold(string serial)
        {
            serial = (serial ?? string.Empty).Trim().ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(serial))
                return false;

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            if (_noThresholdLogUnix.TryGetValue(serial, out var last))
            {
                if (now - last < NoThresholdLogGapSeconds)
                    return false;
            }

            _noThresholdLogUnix[serial] = now;
            return true;
        }
        public async Task<List<string>> DebugFindInvalidBatchV2SerialsAsync(
    long teamId,
    IEnumerable<string> serials,
    CancellationToken ct)
        {
            var list = (serials ?? Enumerable.Empty<string>())
                .Select(s => (s ?? string.Empty).Trim().ToUpperInvariant())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var invalid = new List<string>();

            if (teamId <= 0 || list.Count == 0)
                return invalid;

            var toUtc = ToUtcSecond(DateTime.UtcNow);
            var fromUtc = ToUtcSecond(toUtc.AddMinutes(-10));

            var logtagClient = _logtagRouter.GetClientByTeamId(teamId);
            var endpointKey = _logtagRouter.BuildEndpointKey(teamId, "locationreadings:v2:batch");

            async Task<bool> TryBatchAsync(List<string> batch)
            {
                var req = new LocationReadingsBatchV2Request
                {
                    serialNumbers = batch,
                    startDateUtc = fromUtc,
                    endDateUtc = toUtc
                };

                try
                {
                    await _sched.Enqueue(endpointKey, async c =>
                    {
                        await logtagClient.GetLocationReadingsBatchV2Async(teamId, req, c);
                        return true;
                    }, ct);

                    return true;
                }
                catch (Exception ex)
                {
                    var msg = ex.ToString();

                    if (msg.Contains("One or more serial numbers are invalid or unavailable", StringComparison.OrdinalIgnoreCase)
                        || msg.Contains("The provided serial number is not valid", StringComparison.OrdinalIgnoreCase)
                        || msg.Contains("The provided device model is not supported", StringComparison.OrdinalIgnoreCase)
                        || msg.Contains("InvalidInput", StringComparison.OrdinalIgnoreCase))
                    {
                        return false;
                    }



                    // Lỗi khác thì throw để biết thật sự có vấn đề khác
                    throw;
                }
            }

            async Task SplitFindAsync(List<string> batch)
            {
                ct.ThrowIfCancellationRequested();

                if (batch.Count == 0) return;

                var ok = await TryBatchAsync(batch);
                if (ok) return;

                if (batch.Count == 1)
                {
                    invalid.Add(batch[0]);
                    _log.LogWarning(
                        "[BATCH-V2-TEST][INVALID] teamId={TeamId}, serial={Serial}",
                        teamId,
                        batch[0]);
                    return;
                }

                var mid = batch.Count / 2;
                var left = batch.Take(mid).ToList();
                var right = batch.Skip(mid).ToList();

                await SplitFindAsync(left);
                await SplitFindAsync(right);
            }

            _log.LogWarning(
                "[BATCH-V2-TEST] Start finding invalid serials. teamId={TeamId}, count={Count}, from={From:o}, to={To:o}",
                teamId,
                list.Count,
                fromUtc,
                toUtc);

            await SplitFindAsync(list);

            _log.LogWarning(
                "[BATCH-V2-TEST] Done. teamId={TeamId}, invalidCount={Count}, invalid={Invalid}",
                teamId,
                invalid.Count,
                string.Join(",", invalid));

            return invalid;
        }
    }

}
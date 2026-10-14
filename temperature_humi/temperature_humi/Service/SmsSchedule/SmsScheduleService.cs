using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models;
using temperature_humi.Models.SmsFpt;
using temperature_humi.Models.SmsSchedule;
using temperature_humi.Service.Admin;

namespace temperature_humi.Service.SmsSchedule
{
    public class SmsScheduleService
    {
        private const string SmsScheduleFeature = "sms_schedule";

        private readonly IMongoCollection<SmsScheduleConfig> _configs;
        private readonly IMongoCollection<SmsScheduleJob> _jobs;
        private readonly IMongoCollection<SmsScheduleHistory> _history;
        private readonly IMongoCollection<LocationReading> _readings;
        private readonly SmsActivationService _smsActs;
        private readonly SubscriptionService _subs;
        private readonly ISmsEventNotifier _smsNotifier;
        private readonly IOptions<FptSmsOptions> _fptOpt;
        private readonly SmsScheduleOptions _opt;
        private readonly ILogger<SmsScheduleService> _log;

        public SmsScheduleService(
            IOptions<MongoDBSettings> mongo,
            IOptions<SmsScheduleOptions> opt,
            SmsActivationService smsActs,
            SubscriptionService subs,
            ISmsEventNotifier smsNotifier,
            IOptions<FptSmsOptions> fptOpt,
            ILogger<SmsScheduleService> log)
        {
            var client = new MongoClient(mongo.Value.ConnectionString);
            var db = client.GetDatabase(mongo.Value.DatabaseName);

            _configs = db.GetCollection<SmsScheduleConfig>("SmsScheduleConfigs");
            _jobs = db.GetCollection<SmsScheduleJob>("SmsScheduleJobs");
            _history = db.GetCollection<SmsScheduleHistory>("SmsScheduleHistory");
            _readings = db.GetCollection<LocationReading>("LocationReadings");

            _smsActs = smsActs;
            _subs = subs;
            _smsNotifier = smsNotifier;
            _fptOpt = fptOpt;
            _opt = opt.Value;
            _log = log;

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            try
            {
                _configs.Indexes.CreateOne(new CreateIndexModel<SmsScheduleConfig>(
                    Builders<SmsScheduleConfig>.IndexKeys
                        .Ascending(x => x.UserId)
                        .Ascending(x => x.SerialNumber),
                    new CreateIndexOptions { Unique = true, Name = "uq_user_serial" }));

                _configs.Indexes.CreateOne(new CreateIndexModel<SmsScheduleConfig>(
                    Builders<SmsScheduleConfig>.IndexKeys
                        .Ascending(x => x.Enabled)
                        .Ascending(x => x.ScheduleTimes),
                    new CreateIndexOptions { Name = "ix_enabled_times" }));

                _jobs.Indexes.CreateOne(new CreateIndexModel<SmsScheduleJob>(
                    Builders<SmsScheduleJob>.IndexKeys.Ascending(x => x.RunKey),
                    new CreateIndexOptions { Unique = true, Name = "uq_run_key" }));

                _jobs.Indexes.CreateOne(new CreateIndexModel<SmsScheduleJob>(
                    Builders<SmsScheduleJob>.IndexKeys
                        .Ascending(x => x.Status)
                        .Ascending(x => x.RunAtUtc)
                        .Ascending(x => x.RetryCount),
                    new CreateIndexOptions { Name = "ix_status_run_retry" }));

                _history.Indexes.CreateOne(new CreateIndexModel<SmsScheduleHistory>(
                    Builders<SmsScheduleHistory>.IndexKeys.Descending(x => x.CreatedAtUtc),
                    new CreateIndexOptions { Name = "ix_created_desc" }));
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "[SmsSchedule] EnsureIndexes warning");
            }
        }

        public TimeZoneInfo GetAppTimeZone()
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(_opt.TimeZoneId);
            }
            catch
            {
                return TimeZoneInfo.CreateCustomTimeZone(
                    "Asia/Ho_Chi_Minh_Fallback",
                    TimeSpan.FromHours(7),
                    "Vietnam",
                    "Vietnam");
            }
        }

        public DateTime GetLocalNow()
            => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, GetAppTimeZone());

        public async Task<SmsScheduleConfig?> GetMyConfigAsync(ObjectId userId, string serial, CancellationToken ct)
        {
            serial = NormSerial(serial);
            return await _configs.Find(x => x.UserId == userId && x.SerialNumber == serial).FirstOrDefaultAsync(ct);
        }

        public async Task<List<SmsScheduleConfig>> GetMyConfigsAsync(ObjectId userId, CancellationToken ct)
        {
            return await _configs.Find(x => x.UserId == userId)
                .SortBy(x => x.SerialNumber)
                .ToListAsync(ct);
        }

        public async Task<(bool ok, string? message, SmsScheduleConfig? config)> UpsertConfigAsync(
            ObjectId userId,
            string serial,
            IEnumerable<string> times,
            bool enabled,
            CancellationToken ct)
        {
            serial = NormSerial(serial);

            if (string.IsNullOrWhiteSpace(serial))
                return (false, "Thiếu serialNumber.", null);

            if (!await HasSmsScheduleFeatureAsync(userId, ct))
                return (false, "Bạn chưa có quyền sử dụng SMS định kỳ hoặc gói đã hết hạn.", null);

            var cleanTimes = NormalizeTimes(times).ToList();

            if (enabled && cleanTimes.Count == 0)
                return (false, "Vui lòng chọn ít nhất 1 khung giờ.", null);

            if (cleanTimes.Count > Math.Max(1, _opt.MaxTimesPerDay))
                return (false, $"Tối đa {_opt.MaxTimesPerDay} khung giờ mỗi ngày.", null);

            var localToday = GetLocalNow().ToString("yyyy-MM-dd");
            var nowUtc = DateTime.UtcNow;

            var existing = await GetMyConfigAsync(userId, serial, ct);

            if (existing != null && existing.LastChangedLocalDate == localToday)
                return (false, "Bạn chỉ được thay đổi khung giờ SMS 1 lần trong ngày.", existing);

            if (existing == null)
            {
                var doc = new SmsScheduleConfig
                {
                    Id = ObjectId.GenerateNewId(),
                    UserId = userId,
                    SerialNumber = serial,
                    ScheduleTimes = cleanTimes,
                    Enabled = enabled,
                    LastChangedLocalDate = localToday,
                    LastChangedAtUtc = nowUtc,
                    CreatedAtUtc = nowUtc,
                    UpdatedAtUtc = nowUtc
                };

                try
                {
                    await _configs.InsertOneAsync(doc, cancellationToken: ct);
                }
                catch (MongoWriteException ex) when (ex.WriteError?.Code == 11000)
                {
                    return (false, "Cấu hình đã tồn tại, vui lòng tải lại trang.", null);
                }

                return (true, "Đã lưu khung giờ SMS.", doc);
            }

            var update = Builders<SmsScheduleConfig>.Update
                .Set(x => x.ScheduleTimes, cleanTimes)
                .Set(x => x.Enabled, enabled)
                .Set(x => x.LastChangedLocalDate, localToday)
                .Set(x => x.LastChangedAtUtc, nowUtc)
                .Set(x => x.UpdatedAtUtc, nowUtc);

            await _configs.UpdateOneAsync(x => x.Id == existing.Id, update, cancellationToken: ct);

            existing.ScheduleTimes = cleanTimes;
            existing.Enabled = enabled;
            existing.LastChangedLocalDate = localToday;
            existing.LastChangedAtUtc = nowUtc;
            existing.UpdatedAtUtc = nowUtc;

            return (true, "Đã cập nhật khung giờ SMS.", existing);
        }

        public async Task<int> EnqueueDueJobsAsync(CancellationToken ct)
        {
            var localNow = GetLocalNow();
            var hhmm = localNow.ToString("HH:mm");
            var localDate = localNow.ToString("yyyyMMdd");
            var runAtUtc = DateTime.UtcNow;

            var dueConfigs = await _configs
                .Find(x => x.Enabled && x.ScheduleTimes.Contains(hhmm))
                .ToListAsync(ct);

            if (dueConfigs.Count == 0)
                return 0;

            var inserted = 0;

            foreach (var cfg in dueConfigs)
            {
                ct.ThrowIfCancellationRequested();

                // Chặn từ gốc: nếu gói hết hạn / bị xoá code thì không enqueue job nữa.
                if (!await HasSmsScheduleFeatureAsync(cfg.UserId, ct))
                {
                    await DisableConfigBecauseFeatureInactiveAsync(cfg, ct);
                    continue;
                }

                var runKey = $"{cfg.UserId}|{cfg.SerialNumber}|{localDate}|{hhmm.Replace(":", "")}";

                var job = new SmsScheduleJob
                {
                    Id = ObjectId.GenerateNewId(),
                    RunKey = runKey,
                    ConfigId = cfg.Id,
                    UserId = cfg.UserId,
                    SerialNumber = cfg.SerialNumber,
                    ScheduleTime = hhmm,
                    RunAtUtc = runAtUtc,
                    Status = "pending",
                    CreatedAtUtc = runAtUtc
                };

                try
                {
                    await _jobs.InsertOneAsync(job, cancellationToken: ct);
                    inserted++;
                }
                catch (MongoWriteException ex) when (ex.WriteError?.Code == 11000)
                {
                    // Đã enqueue cho khung giờ này rồi.
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[SmsSchedule] Enqueue job failed {RunKey}", runKey);
                }
            }

            if (inserted > 0)
                _log.LogInformation("[SmsSchedule] Enqueued {Count}/{Total} jobs for {Time}", inserted, dueConfigs.Count, hhmm);

            return inserted;
        }

        public async Task ResetStuckProcessingJobsAsync(CancellationToken ct)
        {
            var cutoff = DateTime.UtcNow.AddMinutes(-Math.Max(1, _opt.ProcessingTimeoutMinutes));

            var filter = Builders<SmsScheduleJob>.Filter.And(
                Builders<SmsScheduleJob>.Filter.Eq(x => x.Status, "processing"),
                Builders<SmsScheduleJob>.Filter.Lte(x => x.ProcessingAtUtc, cutoff));

            var update = Builders<SmsScheduleJob>.Update
                .Set(x => x.Status, "pending")
                .Set(x => x.LastError, "Reset processing timeout")
                .Set(x => x.ProcessingAtUtc, (DateTime?)null);

            await _jobs.UpdateManyAsync(filter, update, cancellationToken: ct);
        }

        public async Task<SmsScheduleJob?> TakeNextJobAsync(CancellationToken ct)
        {
            var now = DateTime.UtcNow;

            var filter = Builders<SmsScheduleJob>.Filter.And(
                Builders<SmsScheduleJob>.Filter.Eq(x => x.Status, "pending"),
                Builders<SmsScheduleJob>.Filter.Lte(x => x.RunAtUtc, now),
                Builders<SmsScheduleJob>.Filter.Lt(x => x.RetryCount, Math.Max(1, _opt.MaxRetry)));

            var update = Builders<SmsScheduleJob>.Update
                .Set(x => x.Status, "processing")
                .Set(x => x.ProcessingAtUtc, now);

            return await _jobs.FindOneAndUpdateAsync(
                filter,
                update,
                new FindOneAndUpdateOptions<SmsScheduleJob>
                {
                    Sort = Builders<SmsScheduleJob>.Sort.Ascending(x => x.RunAtUtc),
                    ReturnDocument = ReturnDocument.After
                },
                ct);
        }

        public async Task ProcessJobAsync(SmsScheduleJob job, CancellationToken ct)
        {
            try
            {
                // Chặn lần 2 ngay trước khi gửi SMS.
                // Nếu admin vừa xoá code sau khi job đã pending, job sẽ bị skipped và không gửi.
                if (!await HasSmsScheduleFeatureAsync(job.UserId, ct))
                {
                    await MarkJobSkippedBecauseFeatureInactiveAsync(job, ct);
                    return;
                }

                var smsAct = await _smsActs.GetByUserAsync(job.UserId, ct);
                var phones = ParsePhones(smsAct?.Phone).ToList();

                if (phones.Count == 0)
                    throw new InvalidOperationException("User chưa kích hoạt SMS hoặc không có số điện thoại hợp lệ.");

                var latest = await _readings.Find(x => x.SerialNumber == job.SerialNumber)
                    .SortByDescending(x => x.DateUtc)
                    .Limit(1)
                    .FirstOrDefaultAsync(ct);

                if (latest == null)
                    throw new InvalidOperationException("Chưa có dữ liệu nhiệt độ gần nhất trong Mongo.");

                double? temp = latest.Temperature <= double.MinValue + 10 ? null : latest.Temperature;
                double? humi = latest.Humidity;

                var latestUtc = latest.DateUtc.Kind == DateTimeKind.Utc
                    ? latest.DateUtc
                    : DateTime.SpecifyKind(latest.DateUtc, DateTimeKind.Utc);

                var localReadingTime = TimeZoneInfo.ConvertTimeFromUtc(latestUtc, GetAppTimeZone());

                var tempText = temp.HasValue ? $"{temp.Value:0.##}C" : "N/A";
                var humiText = humi.HasValue ? $", RH {humi.Value:0.##}%" : "";

                var message = $"SMARTTECH [{job.SerialNumber}] {job.ScheduleTime}: Nhiet do gan nhat {tempText}{humiText}. Luc {localReadingTime:dd/MM HH:mm}.";
                var brand = _fptOpt.Value.DefaultBrandName;

                await _smsNotifier.NotifyAsync(phones, message, "scheduled_temperature", brand, ct);

                var sentAt = DateTime.UtcNow;

                await _jobs.UpdateOneAsync(
                    x => x.Id == job.Id,
                    Builders<SmsScheduleJob>.Update
                        .Set(x => x.Status, "sent")
                        .Set(x => x.SentAtUtc, sentAt)
                        .Set(x => x.LastError, (string?)null)
                        .Set(x => x.ProcessingAtUtc, (DateTime?)null),
                    cancellationToken: ct);

                await _history.InsertOneAsync(new SmsScheduleHistory
                {
                    Id = ObjectId.GenerateNewId(),
                    JobId = job.Id,
                    RunKey = job.RunKey,
                    UserId = job.UserId,
                    SerialNumber = job.SerialNumber,
                    ScheduleTime = job.ScheduleTime,
                    Phones = phones,
                    Message = message,
                    Temperature = temp,
                    Humidity = humi,
                    ReadingAtUtc = latest.DateUtc,
                    Sent = true,
                    CreatedAtUtc = sentAt,
                    SentAtUtc = sentAt
                }, cancellationToken: ct);

                _log.LogInformation("[SmsSchedule] Sent job {RunKey} to {PhoneCount} phones", job.RunKey, phones.Count);
            }
            catch (Exception ex)
            {
                var retry = job.RetryCount + 1;
                var failed = retry >= Math.Max(1, _opt.MaxRetry);
                var now = DateTime.UtcNow;

                await _jobs.UpdateOneAsync(
                    x => x.Id == job.Id,
                    Builders<SmsScheduleJob>.Update
                        .Set(x => x.Status, failed ? "failed" : "pending")
                        .Set(x => x.RetryCount, retry)
                        .Set(x => x.LastError, ex.Message)
                        .Set(x => x.FailedAtUtc, failed ? (DateTime?)now : null)
                        .Set(x => x.ProcessingAtUtc, (DateTime?)null),
                    cancellationToken: ct);

                await _history.InsertOneAsync(new SmsScheduleHistory
                {
                    Id = ObjectId.GenerateNewId(),
                    JobId = job.Id,
                    RunKey = job.RunKey,
                    UserId = job.UserId,
                    SerialNumber = job.SerialNumber,
                    ScheduleTime = job.ScheduleTime,
                    Sent = false,
                    Error = ex.Message,
                    CreatedAtUtc = now
                }, cancellationToken: ct);

                _log.LogError(ex, "[SmsSchedule] Process job failed {RunKey}, retry={Retry}, failed={Failed}", job.RunKey, retry, failed);
            }
        }

        public async Task<List<SmsScheduleJob>> AdminListJobsAsync(string? status, int take, CancellationToken ct)
        {
            take = Math.Clamp(take, 1, 500);

            var filter = string.IsNullOrWhiteSpace(status)
                ? Builders<SmsScheduleJob>.Filter.Empty
                : Builders<SmsScheduleJob>.Filter.Eq(x => x.Status, status.Trim().ToLowerInvariant());

            return await _jobs.Find(filter)
                .SortByDescending(x => x.CreatedAtUtc)
                .Limit(take)
                .ToListAsync(ct);
        }

        public async Task<List<SmsScheduleHistory>> AdminListHistoryAsync(string? serial, int take, CancellationToken ct)
        {
            take = Math.Clamp(take, 1, 500);

            var filter = string.IsNullOrWhiteSpace(serial)
                ? Builders<SmsScheduleHistory>.Filter.Empty
                : Builders<SmsScheduleHistory>.Filter.Eq(x => x.SerialNumber, NormSerial(serial));

            return await _history.Find(filter)
                .SortByDescending(x => x.CreatedAtUtc)
                .Limit(take)
                .ToListAsync(ct);
        }

        private async Task<bool> HasSmsScheduleFeatureAsync(ObjectId userId, CancellationToken ct)
        {
            try
            {
                var sub = await _subs.GetActiveAsync(userId, ct);

                return sub?.Features?.Any(f =>
                    string.Equals(f, SmsScheduleFeature, StringComparison.OrdinalIgnoreCase)
                ) == true;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "[SmsSchedule] Check subscription failed UserId={UserId}", userId);
                return false;
            }
        }

        private async Task DisableConfigBecauseFeatureInactiveAsync(SmsScheduleConfig cfg, CancellationToken ct)
        {
            var now = DateTime.UtcNow;

            await _configs.UpdateOneAsync(
                x => x.Id == cfg.Id,
                Builders<SmsScheduleConfig>.Update
                    .Set(x => x.Enabled, false)
                    .Set(x => x.UpdatedAtUtc, now),
                cancellationToken: ct);

            _log.LogWarning(
                "[SmsSchedule] Disabled config because sms_schedule feature is inactive. User={UserId}, Serial={Serial}",
                cfg.UserId,
                cfg.SerialNumber);
        }

        private async Task MarkJobSkippedBecauseFeatureInactiveAsync(SmsScheduleJob job, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var error = "SMS định kỳ đã hết hạn hoặc đã bị thu hồi.";

            await _jobs.UpdateOneAsync(
                x => x.Id == job.Id,
                Builders<SmsScheduleJob>.Update
                    .Set(x => x.Status, "skipped")
                    .Set(x => x.LastError, error)
                    .Set(x => x.FailedAtUtc, now)
                    .Set(x => x.ProcessingAtUtc, (DateTime?)null),
                cancellationToken: ct);

            await _history.InsertOneAsync(new SmsScheduleHistory
            {
                Id = ObjectId.GenerateNewId(),
                JobId = job.Id,
                RunKey = job.RunKey,
                UserId = job.UserId,
                SerialNumber = job.SerialNumber,
                ScheduleTime = job.ScheduleTime,
                Sent = false,
                Error = error,
                CreatedAtUtc = now
            }, cancellationToken: ct);

            _log.LogWarning(
                "[SmsSchedule] Skipped job because sms_schedule feature is inactive. RunKey={RunKey}",
                job.RunKey);
        }

        private static string NormSerial(string? s)
            => (s ?? string.Empty).Trim().ToUpperInvariant();

        private static IEnumerable<string> NormalizeTimes(IEnumerable<string> times)
        {
            var result = new SortedSet<string>();

            foreach (var raw in times ?? Array.Empty<string>())
            {
                var s = (raw ?? string.Empty).Trim();
                if (!Regex.IsMatch(s, @"^([01]\d|2[0-3]):[0-5]\d$"))
                    continue;

                result.Add(s);
            }

            return result;
        }

        private static IEnumerable<string> ParsePhones(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
                yield break;

            foreach (var part in raw.Split(new[] { ',', ';', ' ', '|', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var p = NormalizePhone(part);
                if (IsValidVnPhone(p))
                    yield return p;
            }
        }

        private static string NormalizePhone(string raw)
        {
            raw = (raw ?? string.Empty).Trim();

            if (raw.StartsWith("+84"))
                raw = "84" + raw[3..];

            var digits = new string(raw.Where(char.IsDigit).ToArray());

            if (digits.StartsWith("0") && digits.Length >= 10)
                digits = "84" + digits[1..];

            return digits;
        }

        private static bool IsValidVnPhone(string digits)
            => Regex.IsMatch(digits ?? string.Empty, @"^84\d{9,10}$");
    }
}

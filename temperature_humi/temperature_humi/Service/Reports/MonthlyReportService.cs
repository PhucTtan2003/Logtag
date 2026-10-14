using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models.Reports;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Service.Reports
{
    public class MonthlyReportCreateDto
    {
        public long TeamId { get; set; }
        public List<string> SerialNumbers { get; set; } = new();
        public List<string> Recipients { get; set; } = new();
        public List<string> Cc { get; set; } = new();
        public int SendDayOfMonth { get; set; } = 1;
        public string SendTimeLocal { get; set; } = "08:00";
        public string TimeZoneId { get; set; } = "Asia/Ho_Chi_Minh";
        public string Format { get; set; } = "csv";
        public bool IsEnabled { get; set; } = true;
        public string? Notes { get; set; }
    }

    public class MonthlyReportUpdateDto : MonthlyReportCreateDto
    {
    }

    public class MonthlyReportService
    {
        private readonly IMongoCollection<MonthlyReportSchedule> _schedules;
        private readonly IMongoCollection<MonthlyReportRun> _runs;
        private readonly LocationReadingService _readings;
        private readonly AccountDeviceService _accountDevices;
        private readonly AccountService _accounts;
        private readonly ReportEmailSender _email;
        private readonly MonthlyReportCsvBuilder _csv;
        private readonly MonthlyReportOptions _opt;
        private readonly ILogger<MonthlyReportService> _log;

        public MonthlyReportService(
            IOptions<MongoDBSettings> settings,
            LocationReadingService readings,
            AccountDeviceService accountDevices,
            AccountService accounts,
            ReportEmailSender email,
            MonthlyReportCsvBuilder csv,
            IOptions<MonthlyReportOptions> opt,
            ILogger<MonthlyReportService> log)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            _schedules = db.GetCollection<MonthlyReportSchedule>("MonthlyReportSchedules");
            _runs = db.GetCollection<MonthlyReportRun>("MonthlyReportRuns");

            _readings = readings;
            _accountDevices = accountDevices;
            _accounts = accounts;
            _email = email;
            _csv = csv;
            _opt = opt.Value;
            _log = log;

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            try
            {
                _schedules.Indexes.CreateOne(new CreateIndexModel<MonthlyReportSchedule>(
                    Builders<MonthlyReportSchedule>.IndexKeys
                        .Ascending(x => x.UserId)
                        .Ascending(x => x.IsEnabled),
                    new CreateIndexOptions { Name = "ix_user_enabled" }));

                _schedules.Indexes.CreateOne(new CreateIndexModel<MonthlyReportSchedule>(
                    Builders<MonthlyReportSchedule>.IndexKeys
                        .Ascending(x => x.TeamId),
                    new CreateIndexOptions { Name = "ix_team" }));

                _runs.Indexes.CreateOne(new CreateIndexModel<MonthlyReportRun>(
                    Builders<MonthlyReportRun>.IndexKeys
                        .Ascending(x => x.ScheduleId)
                        .Ascending(x => x.PeriodKey),
                    new CreateIndexOptions { Name = "ux_schedule_period", Unique = true }));

                _runs.Indexes.CreateOne(new CreateIndexModel<MonthlyReportRun>(
                    Builders<MonthlyReportRun>.IndexKeys
                        .Descending(x => x.StartedAtUtc),
                    new CreateIndexOptions { Name = "ix_started_desc" }));
            }
            catch (MongoCommandException ex) when (ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
            {
                // ignore
            }
        }

        // ======================== Query ========================
        public async Task<List<MonthlyReportSchedule>> ListForUserAsync(ObjectId userId, CancellationToken ct = default)
        {
            return await _schedules.Find(x => x.UserId == userId)
                .SortByDescending(x => x.CreatedAtUtc)
                .ToListAsync(ct);
        }

        public async Task<(long total, List<MonthlyReportSchedule> items)> AdminListSchedulesAsync(
            string? search,
            int skip,
            int take,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 200);

            var filter = Builders<MonthlyReportSchedule>.Filter.Empty;
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim();
                filter &= Builders<MonthlyReportSchedule>.Filter.Or(
                    Builders<MonthlyReportSchedule>.Filter.AnyEq(x => x.SerialNumbers, s.ToUpperInvariant()),
                    Builders<MonthlyReportSchedule>.Filter.AnyEq(x => x.Recipients, s),
                    Builders<MonthlyReportSchedule>.Filter.Regex(x => x.Notes, new BsonRegularExpression(s, "i"))
                );
            }

            var total = await _schedules.CountDocumentsAsync(filter, cancellationToken: ct);
            var items = await _schedules.Find(filter)
                .SortByDescending(x => x.CreatedAtUtc)
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            return (total, items);
        }

        public async Task<List<MonthlyReportRun>> ListRunsAsync(ObjectId? userId, int skip, int take, CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 200);

            var filter = userId.HasValue
                ? Builders<MonthlyReportRun>.Filter.Eq(x => x.UserId, userId.Value)
                : Builders<MonthlyReportRun>.Filter.Empty;

            return await _runs.Find(filter)
                .SortByDescending(x => x.StartedAtUtc)
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);
        }

        // ======================== CRUD ========================
        public async Task<MonthlyReportSchedule> CreateForUserAsync(
            ObjectId userId,
            MonthlyReportCreateDto dto,
            CancellationToken ct = default)
        {
            await ValidateSerialAccessAsync(userId, dto.TeamId, dto.SerialNumbers, ct);

            var recipients = CleanList(dto.Recipients);
            if (recipients.Count == 0)
            {
                var acc = await _accounts.GetByIdAsync(userId);
                if (!string.IsNullOrWhiteSpace(acc?.Email)) recipients.Add(acc.Email.Trim());
            }

            var model = new MonthlyReportSchedule
            {
                Id = ObjectId.GenerateNewId(),
                UserId = userId,
                TeamId = dto.TeamId,
                SerialNumbers = CleanSerials(dto.SerialNumbers),
                Recipients = recipients,
                Cc = CleanList(dto.Cc),
                SendDayOfMonth = Math.Clamp(dto.SendDayOfMonth, 1, 31),
                SendTimeLocal = NormalizeTime(dto.SendTimeLocal),
                TimeZoneId = string.IsNullOrWhiteSpace(dto.TimeZoneId) ? "Asia/Ho_Chi_Minh" : dto.TimeZoneId.Trim(),
                Format = string.IsNullOrWhiteSpace(dto.Format) ? "csv" : dto.Format.Trim().ToLowerInvariant(),
                IsEnabled = dto.IsEnabled,
                Notes = dto.Notes,
                CreatedAtUtc = DateTime.UtcNow
            };

            if (model.Recipients.Count == 0)
                throw new InvalidOperationException("Cần ít nhất 1 email người nhận.");

            await _schedules.InsertOneAsync(model, cancellationToken: ct);
            return model;
        }

        public async Task<MonthlyReportSchedule?> UpdateForUserAsync(
            ObjectId userId,
            ObjectId scheduleId,
            MonthlyReportUpdateDto dto,
            bool isAdmin = false,
            CancellationToken ct = default)
        {
            var filter = isAdmin
                ? Builders<MonthlyReportSchedule>.Filter.Eq(x => x.Id, scheduleId)
                : Builders<MonthlyReportSchedule>.Filter.Eq(x => x.Id, scheduleId) &
                  Builders<MonthlyReportSchedule>.Filter.Eq(x => x.UserId, userId);

            var current = await _schedules.Find(filter).FirstOrDefaultAsync(ct);
            if (current == null) return null;

            if (!isAdmin)
                await ValidateSerialAccessAsync(userId, dto.TeamId, dto.SerialNumbers, ct);

            current.TeamId = dto.TeamId;
            current.SerialNumbers = CleanSerials(dto.SerialNumbers);
            current.Recipients = CleanList(dto.Recipients);
            current.Cc = CleanList(dto.Cc);
            current.SendDayOfMonth = Math.Clamp(dto.SendDayOfMonth, 1, 31);
            current.SendTimeLocal = NormalizeTime(dto.SendTimeLocal);
            current.TimeZoneId = string.IsNullOrWhiteSpace(dto.TimeZoneId) ? "Asia/Ho_Chi_Minh" : dto.TimeZoneId.Trim();
            current.Format = string.IsNullOrWhiteSpace(dto.Format) ? "csv" : dto.Format.Trim().ToLowerInvariant();
            current.IsEnabled = dto.IsEnabled;
            current.Notes = dto.Notes;
            current.UpdatedAtUtc = DateTime.UtcNow;

            if (current.SerialNumbers.Count == 0)
                throw new InvalidOperationException("Cần chọn ít nhất 1 thiết bị.");
            if (current.Recipients.Count == 0)
                throw new InvalidOperationException("Cần ít nhất 1 email người nhận.");

            await _schedules.ReplaceOneAsync(x => x.Id == current.Id, current, cancellationToken: ct);
            return current;
        }

        public async Task<bool> DeleteForUserAsync(ObjectId userId, ObjectId scheduleId, bool isAdmin = false, CancellationToken ct = default)
        {
            var filter = isAdmin
                ? Builders<MonthlyReportSchedule>.Filter.Eq(x => x.Id, scheduleId)
                : Builders<MonthlyReportSchedule>.Filter.Eq(x => x.Id, scheduleId) &
                  Builders<MonthlyReportSchedule>.Filter.Eq(x => x.UserId, userId);

            var res = await _schedules.DeleteOneAsync(filter, ct);
            return res.DeletedCount > 0;
        }

        public async Task<MonthlyReportSchedule?> ToggleAsync(ObjectId scheduleId, bool enabled, CancellationToken ct = default)
        {
            var update = Builders<MonthlyReportSchedule>.Update
                .Set(x => x.IsEnabled, enabled)
                .Set(x => x.UpdatedAtUtc, DateTime.UtcNow);

            return await _schedules.FindOneAndUpdateAsync(
                x => x.Id == scheduleId,
                update,
                new FindOneAndUpdateOptions<MonthlyReportSchedule> { ReturnDocument = ReturnDocument.After },
                ct);
        }

        // ======================== Worker ========================
        public async Task ProcessDueReportsAsync(CancellationToken ct = default)
        {
            if (!_opt.Enabled)
            {
                _log.LogDebug("[MonthlyReport] Disabled");
                return;
            }

            var schedules = await _schedules.Find(x => x.IsEnabled).ToListAsync(ct);
            foreach (var s in schedules)
            {
                ct.ThrowIfCancellationRequested();

                try
                {
                    var due = CalculateCurrentDue(s, DateTime.UtcNow);
                    if (!due.IsDue) continue;

                    // Nếu lịch mới được tạo sau thời điểm tới hạn của tháng này, không gửi ngược tháng cũ.
                    if (s.CreatedAtUtc > due.DueAtUtc) continue;

                    await SendScheduleForPeriodAsync(s, due.PeriodKey, due.FromUtc, due.ToUtc, due.Tz, false, ct);
                }
                catch (MongoWriteException ex) when (ex.WriteError?.Code == 11000)
                {
                    // Đã có run schedule + period => tránh gửi trùng.
                    _log.LogDebug("[MonthlyReport] Skip duplicate run schedule={ScheduleId}", s.Id);
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[MonthlyReport] Process schedule failed {ScheduleId}", s.Id);
                }
            }
        }

        public async Task<MonthlyReportRun> SendTestAsync(ObjectId userId, ObjectId scheduleId, bool isAdmin = false, CancellationToken ct = default)
        {
            var filter = isAdmin
                ? Builders<MonthlyReportSchedule>.Filter.Eq(x => x.Id, scheduleId)
                : Builders<MonthlyReportSchedule>.Filter.Eq(x => x.Id, scheduleId) &
                  Builders<MonthlyReportSchedule>.Filter.Eq(x => x.UserId, userId);

            var s = await _schedules.Find(filter).FirstOrDefaultAsync(ct)
                ?? throw new InvalidOperationException("Không tìm thấy lịch gửi báo cáo.");

            var due = CalculatePreviousMonth(s, DateTime.UtcNow);
            // test/manual cho phép gửi lại, periodKey thêm suffix thời gian để không đụng unique.
            var manualPeriodKey = due.PeriodKey + "-test-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            return await SendScheduleForPeriodAsync(s, manualPeriodKey, due.FromUtc, due.ToUtc, due.Tz, true, ct);
        }

        public async Task<MonthlyReportRun> SendNowByAdminAsync(ObjectId scheduleId, CancellationToken ct = default)
        {
            var s = await _schedules.Find(x => x.Id == scheduleId).FirstOrDefaultAsync(ct)
                ?? throw new InvalidOperationException("Không tìm thấy lịch gửi báo cáo.");

            var due = CalculatePreviousMonth(s, DateTime.UtcNow);
            var manualPeriodKey = due.PeriodKey + "-manual-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            return await SendScheduleForPeriodAsync(s, manualPeriodKey, due.FromUtc, due.ToUtc, due.Tz, true, ct);
        }

        private async Task<MonthlyReportRun> SendScheduleForPeriodAsync(
            MonthlyReportSchedule s,
            string periodKey,
            DateTime fromUtc,
            DateTime toUtcExclusive,
            TimeZoneInfo tz,
            bool manual,
            CancellationToken ct)
        {
            if (s.SerialNumbers.Count == 0)
                throw new InvalidOperationException("Schedule chưa có serial.");
            if (s.Recipients.Count == 0)
                throw new InvalidOperationException("Schedule chưa có email người nhận.");

            var run = new MonthlyReportRun
            {
                Id = ObjectId.GenerateNewId(),
                ScheduleId = s.Id,
                UserId = s.UserId,
                PeriodKey = periodKey,
                FromUtc = fromUtc,
                ToUtc = toUtcExclusive,
                Status = "pending",
                Recipients = s.Recipients,
                Cc = s.Cc,
                StartedAtUtc = DateTime.UtcNow
            };

            await _runs.InsertOneAsync(run, cancellationToken: ct);

            try
            {
                var attachments = new List<ReportAttachment>();
                var totalRows = 0;

                var fromLocal = TimeZoneInfo.ConvertTimeFromUtc(fromUtc, tz);
                var toLocal = TimeZoneInfo.ConvertTimeFromUtc(toUtcExclusive, tz);

                foreach (var serial in s.SerialNumbers)
                {
                    var rows = await _readings.GetRangeAsync(
                        serial,
                        fromUtc,
                        toUtcExclusive.AddMilliseconds(-1),
                        _opt.MaxRowsPerSerial);

                    totalRows += rows.Count;

                    var safeSerial = MakeSafeFileName(serial);
                    var filePeriod = periodKey.Split('-').Length >= 2
                        ? string.Join("-", periodKey.Split('-').Take(2))
                        : periodKey;
                    var fileName = $"LogTag_{safeSerial}_{filePeriod}.csv";

                    var bytes = _csv.BuildCsv(filePeriod, serial, fromLocal, toLocal, tz, rows);
                    attachments.Add(new ReportAttachment(fileName, "text/csv", bytes));
                }

                var periodTitle = periodKey.Split('-').Length >= 2
                    ? string.Join("/", periodKey.Split('-').Take(2).Reverse())
                    : periodKey;

                var subject = manual
                    ? $"[Gửi thử] Báo cáo LogTag tháng {periodTitle}"
                    : $"Báo cáo LogTag tháng {periodTitle}";

                var body = BuildEmailBody(s, periodTitle, fromLocal, toLocal, totalRows);

                await _email.SendAsync(s.Recipients, s.Cc, subject, body, attachments, ct);

                var update = Builders<MonthlyReportRun>.Update
                    .Set(x => x.Status, "success")
                    .Set(x => x.TotalReadings, totalRows)
                    .Set(x => x.AttachmentNames, attachments.Select(a => a.FileName).ToList())
                    .Set(x => x.SentAtUtc, DateTime.UtcNow)
                    .Set(x => x.FinishedAtUtc, DateTime.UtcNow)
                    .Unset(x => x.Error);

                await _runs.UpdateOneAsync(x => x.Id == run.Id, update, cancellationToken: ct);

                run.Status = "success";
                run.TotalReadings = totalRows;
                run.AttachmentNames = attachments.Select(a => a.FileName).ToList();
                run.SentAtUtc = DateTime.UtcNow;
                run.FinishedAtUtc = DateTime.UtcNow;

                _log.LogInformation("[MonthlyReport] Sent schedule={ScheduleId} period={Period} rows={Rows}",
                    s.Id, periodKey, totalRows);

                return run;
            }
            catch (Exception ex)
            {
                var update = Builders<MonthlyReportRun>.Update
                    .Set(x => x.Status, "failed")
                    .Set(x => x.Error, ex.Message)
                    .Set(x => x.FinishedAtUtc, DateTime.UtcNow);

                await _runs.UpdateOneAsync(x => x.Id == run.Id, update, cancellationToken: CancellationToken.None);

                run.Status = "failed";
                run.Error = ex.Message;
                run.FinishedAtUtc = DateTime.UtcNow;

                _log.LogError(ex, "[MonthlyReport] Send failed schedule={ScheduleId} period={Period}", s.Id, periodKey);
                throw;
            }
        }

        // ======================== Helpers ========================
        private async Task ValidateSerialAccessAsync(ObjectId userId, long teamId, List<string> serials, CancellationToken ct)
        {
            var cleaned = CleanSerials(serials);
            if (cleaned.Count == 0)
                throw new InvalidOperationException("Cần chọn ít nhất 1 thiết bị.");

            var maps = await _accountDevices.GetMapsByAccountAsync(userId);
            var allowed = maps
                .Where(x => teamId <= 0 || x.TeamId == teamId)
                .Select(x => x.SerialNumber)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var denied = cleaned.Where(s => !allowed.Contains(s)).ToList();
            if (denied.Count > 0)
                throw new UnauthorizedAccessException("Bạn không có quyền tạo báo cáo cho serial: " + string.Join(", ", denied));
        }

        public static ObjectId GetUserObjectId(ClaimsPrincipal user)
        {
            var candidates = new[]
            {
                ClaimTypes.NameIdentifier,
                "sub",
                "id",
                "userId",
                "uid",
                "AccountId"
            };

            foreach (var c in candidates)
            {
                var val = user.FindFirst(c)?.Value;
                if (ObjectId.TryParse(val, out var oid)) return oid;
            }

            if (ObjectId.TryParse(user.Identity?.Name, out var nameOid)) return nameOid;

            throw new UnauthorizedAccessException("Không đọc được userId từ token/cookie đăng nhập.");
        }

        private static List<string> CleanSerials(IEnumerable<string>? serials)
        {
            return (serials ?? Array.Empty<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToUpperInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static List<string> CleanList(IEnumerable<string>? values)
        {
            return (values ?? Array.Empty<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static string NormalizeTime(string? value)
        {
            if (TimeSpan.TryParse(value, out var t))
                return $"{t.Hours:00}:{t.Minutes:00}";
            return "08:00";
        }

        private static TimeZoneInfo ResolveTimeZone(string? id)
        {
            id = string.IsNullOrWhiteSpace(id) ? "Asia/Ho_Chi_Minh" : id.Trim();

            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch { /* ignore */ }

            // Windows fallback cho Việt Nam.
            try { return TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time"); }
            catch { /* ignore */ }

            return TimeZoneInfo.CreateCustomTimeZone("Asia/Ho_Chi_Minh", TimeSpan.FromHours(7), "Vietnam Time", "Vietnam Time");
        }

        private static (bool IsDue, string PeriodKey, DateTime FromUtc, DateTime ToUtc, DateTime DueAtUtc, TimeZoneInfo Tz)
            CalculateCurrentDue(MonthlyReportSchedule s, DateTime utcNow)
        {
            var tz = ResolveTimeZone(s.TimeZoneId);
            var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), tz);

            var time = TimeSpan.TryParse(s.SendTimeLocal, out var parsed) ? parsed : new TimeSpan(8, 0, 0);
            var day = Math.Min(Math.Clamp(s.SendDayOfMonth, 1, 31), DateTime.DaysInMonth(localNow.Year, localNow.Month));
            var dueLocal = new DateTime(localNow.Year, localNow.Month, day, time.Hours, time.Minutes, 0, DateTimeKind.Unspecified);
            var dueUtc = TimeZoneInfo.ConvertTimeToUtc(dueLocal, tz);

            if (localNow < dueLocal)
                return (false, string.Empty, default, default, dueUtc, tz);

            var reportMonth = new DateTime(localNow.Year, localNow.Month, 1).AddMonths(-1);
            var fromLocal = new DateTime(reportMonth.Year, reportMonth.Month, 1, 0, 0, 0, DateTimeKind.Unspecified);
            var toLocal = fromLocal.AddMonths(1);
            var fromUtc = TimeZoneInfo.ConvertTimeToUtc(fromLocal, tz);
            var toUtc = TimeZoneInfo.ConvertTimeToUtc(toLocal, tz);
            var periodKey = reportMonth.ToString("yyyy-MM");

            return (true, periodKey, fromUtc, toUtc, dueUtc, tz);
        }

        private static (string PeriodKey, DateTime FromUtc, DateTime ToUtc, TimeZoneInfo Tz)
            CalculatePreviousMonth(MonthlyReportSchedule s, DateTime utcNow)
        {
            var tz = ResolveTimeZone(s.TimeZoneId);
            var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), tz);
            var reportMonth = new DateTime(localNow.Year, localNow.Month, 1).AddMonths(-1);
            var fromLocal = new DateTime(reportMonth.Year, reportMonth.Month, 1, 0, 0, 0, DateTimeKind.Unspecified);
            var toLocal = fromLocal.AddMonths(1);
            var fromUtc = TimeZoneInfo.ConvertTimeToUtc(fromLocal, tz);
            var toUtc = TimeZoneInfo.ConvertTimeToUtc(toLocal, tz);
            return (reportMonth.ToString("yyyy-MM"), fromUtc, toUtc, tz);
        }

        private static string MakeSafeFileName(string value)
        {
            var invalid = System.IO.Path.GetInvalidFileNameChars().ToHashSet();
            var sb = new StringBuilder();
            foreach (var ch in value)
                sb.Append(invalid.Contains(ch) ? '_' : ch);
            return sb.ToString();
        }

        private static string BuildEmailBody(
            MonthlyReportSchedule s,
            string periodTitle,
            DateTime fromLocal,
            DateTime toLocalExclusive,
            int totalRows)
        {
            var serials = string.Join(", ", s.SerialNumbers);
            return $@"
<div style='font-family:Arial,sans-serif;font-size:14px;color:#222'>
  <p>Xin chào,</p>
  <p>SmartTech gửi bạn báo cáo dữ liệu LogTag tháng <b>{periodTitle}</b>.</p>
  <table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;border-color:#ddd'>
    <tr><td><b>Khoảng thời gian</b></td><td>{fromLocal:dd/MM/yyyy HH:mm} - {toLocalExclusive.AddSeconds(-1):dd/MM/yyyy HH:mm}</td></tr>
    <tr><td><b>Thiết bị</b></td><td>{serials}</td></tr>
    <tr><td><b>Tổng bản ghi</b></td><td>{totalRows:N0}</td></tr>
  </table>
  <p>File dữ liệu được đính kèm trong email này.</p>
  <p>Trân trọng,<br/>SmartTech</p>
</div>";
        }
    }
}

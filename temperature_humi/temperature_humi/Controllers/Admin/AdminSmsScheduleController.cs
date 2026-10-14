using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using MongoDB.Driver.Linq;
using temperature_humi.Data;
using temperature_humi.Service;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/sms-schedule")]
    [Authorize(Roles = "Admin")]
    public class AdminSmsScheduleController : ControllerBase
    {
        private readonly IMongoCollection<BsonDocument> _configs;
        private readonly IMongoCollection<BsonDocument> _jobs;
        private readonly IMongoCollection<BsonDocument> _history;
        private readonly AccountService _accounts;

        public AdminSmsScheduleController(
            IOptions<MongoDBSettings> settings,
            AccountService accounts)
        {
            _accounts = accounts;

            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            // Nếu service của bạn đặt tên collection khác thì đổi 3 tên bên dưới.
            _configs = db.GetCollection<BsonDocument>("SmsScheduleConfigs");
            _jobs = db.GetCollection<BsonDocument>("SmsScheduleJobs");
            _history = db.GetCollection<BsonDocument>("SmsScheduleHistories");
        }

        // GET /api/admin/sms-schedule/configs?search=A0A&enabled=true&take=100
        [HttpGet("configs")]
        public async Task<IActionResult> Configs(
            [FromQuery] string? search = null,
            [FromQuery] bool? enabled = null,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 300);

            var fb = Builders<BsonDocument>.Filter;
            var filter = fb.Empty;

            if (enabled.HasValue)
            {
                filter &= fb.Or(
                    fb.Eq("Enabled", enabled.Value),
                    fb.Eq("enabled", enabled.Value)
                );
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var key = search.Trim();
                filter &= fb.Or(
                    fb.Regex("SerialNumber", new BsonRegularExpression(key, "i")),
                    fb.Regex("serialNumber", new BsonRegularExpression(key, "i")),
                    fb.Regex("Username", new BsonRegularExpression(key, "i")),
                    fb.Regex("username", new BsonRegularExpression(key, "i"))
                );
            }

            var total = await _configs.CountDocumentsAsync(filter, cancellationToken: ct);

            var docs = await _configs.Find(filter)
                .Sort(Builders<BsonDocument>.Sort.Descending("UpdatedAtUtc").Descending("updatedAtUtc"))
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            var userIds = docs
    .Select(d => S(d, "UserId", "userId"))
    .Where(x => !string.IsNullOrWhiteSpace(x))
    .Select(x =>
    {
        return ObjectId.TryParse(x, out var oid)
            ? oid
            : ObjectId.Empty;
    })
    .Where(x => x != ObjectId.Empty)
    .Distinct()
    .ToList();

            var accounts = userIds.Count == 0
                ? new()
                : await _accounts.GetByIdsAsync(userIds, ct);

            var accMap = accounts
                .Where(a => a != null)
                .ToDictionary(a => a.Id.ToString(), a => a.Email);

            var items = docs.Select(d =>
            {
                var userId = S(d, "UserId", "userId");
                accMap.TryGetValue(userId, out var email);

                return new
                {
                    id = S(d, "_id", "Id", "id"),
                    userId,
                    email,
                    username = S(d, "Username", "username"),
                    serialNumber = S(d, "SerialNumber", "serialNumber"),
                    scheduleTimes = Arr(d, "ScheduleTimes", "scheduleTimes"),
                    enabled = Bool(d, true, "Enabled", "enabled"),
                    lastChangedLocalDate = S(d, "LastChangedLocalDate", "lastChangedLocalDate"),
                    lastChangedAtUtc = Dt(d, "LastChangedAtUtc", "lastChangedAtUtc"),
                    createdAtUtc = Dt(d, "CreatedAtUtc", "createdAtUtc"),
                    updatedAtUtc = Dt(d, "UpdatedAtUtc", "updatedAtUtc")
                };
            });

            return Ok(new { total, items });
        }

        // PATCH /api/admin/sms-schedule/configs/{id}/toggle?enabled=false
        [HttpPatch("configs/{id}/toggle")]
        public async Task<IActionResult> ToggleConfig(
            string id,
            [FromQuery] bool? enabled = null,
            CancellationToken ct = default)
        {
            var filter = IdFilter(id);
            var doc = await _configs.Find(filter).FirstOrDefaultAsync(ct);

            if (doc == null)
                return NotFound(new { message = "Không tìm thấy cấu hình SMS định kỳ." });

            var current = Bool(doc, true, "Enabled", "enabled");
            var next = enabled ?? !current;

            var enabledField = doc.Contains("enabled") ? "enabled" : "Enabled";
            var updatedField = doc.Contains("updatedAtUtc") ? "updatedAtUtc" : "UpdatedAtUtc";

            var update = Builders<BsonDocument>.Update
                .Set(enabledField, next)
                .Set(updatedField, DateTime.UtcNow);

            await _configs.UpdateOneAsync(filter, update, cancellationToken: ct);

            return Ok(new
            {
                ok = true,
                id,
                enabled = next,
                message = next
                    ? "Đã bật quyền SMS định kỳ."
                    : "Đã tắt quyền SMS định kỳ."
            });
        }

        // GET /api/admin/sms-schedule/jobs?status=pending&serial=A0A&take=100
        [HttpGet("jobs")]
        public async Task<IActionResult> Jobs(
            [FromQuery] string? status = "pending",
            [FromQuery] string? serial = null,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 300);

            var fb = Builders<BsonDocument>.Filter;
            var filter = fb.Empty;

            if (!string.IsNullOrWhiteSpace(status) &&
                !string.Equals(status, "all", StringComparison.OrdinalIgnoreCase))
            {
                var s = status.Trim().ToLowerInvariant();
                filter &= fb.Or(fb.Eq("Status", s), fb.Eq("status", s));
            }

            if (!string.IsNullOrWhiteSpace(serial))
            {
                var key = serial.Trim().ToUpperInvariant();
                filter &= fb.Or(
                    fb.Regex("SerialNumber", new BsonRegularExpression(key, "i")),
                    fb.Regex("serialNumber", new BsonRegularExpression(key, "i"))
                );
            }

            var total = await _jobs.CountDocumentsAsync(filter, cancellationToken: ct);

            var docs = await _jobs.Find(filter)
                .Sort(Builders<BsonDocument>.Sort.Descending("RunAtUtc").Descending("runAtUtc"))
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            var items = docs.Select(d => new
            {
                id = S(d, "_id", "Id", "id"),
                jobKey = S(d, "JobKey", "jobKey"),
                userId = S(d, "UserId", "userId"),
                serialNumber = S(d, "SerialNumber", "serialNumber"),
                phone = S(d, "Phone", "phone"),
                scheduleTime = S(d, "ScheduleTime", "scheduleTime"),
                runAtUtc = Dt(d, "RunAtUtc", "runAtUtc", "DueAtUtc", "dueAtUtc"),
                status = S(d, "Status", "status"),
                retryCount = Int(d, 0, "RetryCount", "retryCount"),
                lastError = S(d, "LastError", "lastError"),
                createdAtUtc = Dt(d, "CreatedAtUtc", "createdAtUtc"),
                sentAtUtc = Dt(d, "SentAtUtc", "sentAtUtc")
            });

            return Ok(new { total, items });
        }

        // GET /api/admin/sms-schedule/history?serial=A0A&success=true&take=100
        [HttpGet("history")]
        public async Task<IActionResult> History(
            [FromQuery] string? serial = null,
            [FromQuery] bool? success = null,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 300);

            var fb = Builders<BsonDocument>.Filter;
            var filter = fb.Empty;

            if (!string.IsNullOrWhiteSpace(serial))
            {
                var key = serial.Trim().ToUpperInvariant();
                filter &= fb.Or(
                    fb.Regex("SerialNumber", new BsonRegularExpression(key, "i")),
                    fb.Regex("serialNumber", new BsonRegularExpression(key, "i"))
                );
            }

            if (success.HasValue)
            {
                filter &= fb.Or(
                    fb.Eq("Success", success.Value),
                    fb.Eq("success", success.Value)
                );
            }

            var total = await _history.CountDocumentsAsync(filter, cancellationToken: ct);

            var docs = await _history.Find(filter)
                .Sort(Builders<BsonDocument>.Sort.Descending("SentAtUtc").Descending("createdAtUtc"))
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            var items = docs.Select(d => new
            {
                id = S(d, "_id", "Id", "id"),
                jobId = S(d, "JobId", "jobId"),
                userId = S(d, "UserId", "userId"),
                serialNumber = S(d, "SerialNumber", "serialNumber"),
                phone = S(d, "Phone", "phone"),
                scheduleTime = S(d, "ScheduleTime", "scheduleTime"),
                temperature = DoubleN(d, "Temperature", "temperature"),
                humidity = DoubleN(d, "Humidity", "humidity"),
                readingAtUtc = Dt(d, "ReadingAtUtc", "readingAtUtc"),
                provider = S(d, "Provider", "provider"),
                success = Bool(d, false, "Success", "success"),
                error = S(d, "Error", "error"),
                createdAtUtc = Dt(d, "CreatedAtUtc", "createdAtUtc"),
                sentAtUtc = Dt(d, "SentAtUtc", "sentAtUtc")
            });

            return Ok(new { total, items });
        }

        private static FilterDefinition<BsonDocument> IdFilter(string id)
        {
            var fb = Builders<BsonDocument>.Filter;

            if (ObjectId.TryParse(id, out var oid))
            {
                return fb.Or(
                    fb.Eq("_id", oid),
                    fb.Eq("Id", oid),
                    fb.Eq("id", id)
                );
            }

            return fb.Or(
                fb.Eq("_id", id),
                fb.Eq("Id", id),
                fb.Eq("id", id)
            );
        }

        private static string S(BsonDocument d, params string[] names)
        {
            foreach (var name in names)
            {
                if (!d.TryGetValue(name, out var v) || v == null || v.IsBsonNull)
                    continue;

                if (v.IsObjectId) return v.AsObjectId.ToString();
                if (v.IsString) return v.AsString;
                if (v.IsBsonDateTime) return v.ToUniversalTime().ToString("O");
                return v.ToString();
            }

            return string.Empty;
        }

        private static string[] Arr(BsonDocument d, params string[] names)
        {
            foreach (var name in names)
            {
                if (!d.TryGetValue(name, out var v) || v == null || v.IsBsonNull)
                    continue;

                if (v.IsBsonArray)
                    return v.AsBsonArray.Select(x => x.ToString()).ToArray();

                if (v.IsString && !string.IsNullOrWhiteSpace(v.AsString))
                    return v.AsString.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            }

            return Array.Empty<string>();
        }

        private static bool Bool(BsonDocument d, bool fallback, params string[] names)
        {
            foreach (var name in names)
            {
                if (!d.TryGetValue(name, out var v) || v == null || v.IsBsonNull)
                    continue;

                if (v.IsBoolean) return v.AsBoolean;
                if (v.IsString && bool.TryParse(v.AsString, out var b)) return b;
            }

            return fallback;
        }

        private static int Int(BsonDocument d, int fallback, params string[] names)
        {
            foreach (var name in names)
            {
                if (!d.TryGetValue(name, out var v) || v == null || v.IsBsonNull)
                    continue;

                if (v.IsInt32) return v.AsInt32;
                if (v.IsInt64) return (int)v.AsInt64;
                if (v.IsString && int.TryParse(v.AsString, out var n)) return n;
            }

            return fallback;
        }

        private static double? DoubleN(BsonDocument d, params string[] names)
        {
            foreach (var name in names)
            {
                if (!d.TryGetValue(name, out var v) || v == null || v.IsBsonNull)
                    continue;

                if (v.IsDouble) return v.AsDouble;
                if (v.IsInt32) return v.AsInt32;
                if (v.IsInt64) return v.AsInt64;
                if (v.IsString && double.TryParse(v.AsString, out var n)) return n;
            }

            return null;
        }

        private static DateTime? Dt(BsonDocument d, params string[] names)
        {
            foreach (var name in names)
            {
                if (!d.TryGetValue(name, out var v) || v == null || v.IsBsonNull)
                    continue;

                if (v.IsValidDateTime) return v.ToUniversalTime();
                if (v.IsString && DateTime.TryParse(v.AsString, out var dt))
                    return dt.ToUniversalTime();
            }

            return null;
        }
    }
}
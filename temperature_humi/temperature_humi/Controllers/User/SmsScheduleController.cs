using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models.SmsSchedule;
using temperature_humi.Service;
using temperature_humi.Service.Admin;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/sms-schedule")]
    [Authorize]
    public class SmsScheduleController : ControllerBase
    {
        private const int MaxTimesPerDevice = 2;
        private const int MaxChangesPerDay = 3;
        private const string SmsScheduleFeature = "sms_schedule";

        private readonly IMongoCollection<SmsScheduleConfig> _col;
        private readonly AccountService _accounts;
        private readonly SubscriptionService _subs;

        public SmsScheduleController(
            IOptions<MongoDBSettings> settings,
            AccountService accounts,
            SubscriptionService subs)
        {
            _accounts = accounts;
            _subs = subs;

            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            _col = db.GetCollection<SmsScheduleConfig>("SmsScheduleConfigs");

            EnsureIndexes();
        }

        public class UpdateSmsScheduleDto
        {
            public string? SerialNumber { get; set; }
            public List<string>? Times { get; set; }
            public bool Enabled { get; set; } = true;
        }

        // GET /api/sms-schedule/my
        [HttpGet("my")]
        public async Task<IActionResult> My(CancellationToken ct = default)
        {
            var userId = await ResolveCurrentUserIdAsync(ct);

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    ok = false,
                    message = "Chưa đăng nhập hoặc không xác định được UserId."
                });
            }

            if (!await HasSmsScheduleFeatureAsync(userId, ct))
            {
                return StatusCode(403, new
                {
                    ok = false,
                    locked = true,
                    feature = SmsScheduleFeature,
                    maxTimesPerDevice = MaxTimesPerDevice,
                    maxChangesPerDay = MaxChangesPerDay,
                    items = Array.Empty<object>(),
                    message = "Tính năng SMS định kỳ chưa được kích hoạt hoặc đã hết hạn."
                });
            }

            var items = await _col
                .Find(x => x.UserId == userId)
                .SortByDescending(x => x.UpdatedAtUtc)
                .ToListAsync(ct);

            return Ok(new
            {
                ok = true,
                locked = false,
                feature = SmsScheduleFeature,
                maxTimesPerDevice = MaxTimesPerDevice,
                maxChangesPerDay = MaxChangesPerDay,
                items = items.Select(MapConfig)
            });
        }

        // POST /api/sms-schedule/update
        [HttpPost("update")]
        public async Task<IActionResult> Update(
            [FromBody] UpdateSmsScheduleDto dto,
            CancellationToken ct = default)
        {
            var userId = await ResolveCurrentUserIdAsync(ct);

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    ok = false,
                    message = "Chưa đăng nhập hoặc không xác định được UserId."
                });
            }

            if (!await HasSmsScheduleFeatureAsync(userId, ct))
            {
                return StatusCode(403, new
                {
                    ok = false,
                    locked = true,
                    feature = SmsScheduleFeature,
                    message = "Bạn chưa có quyền sử dụng SMS định kỳ hoặc gói đã hết hạn."
                });
            }

            var serial = (dto.SerialNumber ?? string.Empty)
                .Trim()
                .ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(serial))
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "Vui lòng nhập Serial thiết bị."
                });
            }

            var rawTimes = (dto.Times ?? new List<string>())
                .Select(x => (x ?? string.Empty).Trim())
                .Where(IsHHmm)
                .Distinct()
                .OrderBy(x => x)
                .ToList();

            if (rawTimes.Count > MaxTimesPerDevice)
            {
                return BadRequest(new
                {
                    ok = false,
                    maxTimesPerDevice = MaxTimesPerDevice,
                    message = $"Mỗi thiết bị/kênh chỉ được cài tối đa {MaxTimesPerDevice} khung giờ SMS."
                });
            }

            var times = rawTimes;

            if (dto.Enabled && times.Count == 0)
            {
                return BadRequest(new
                {
                    ok = false,
                    message = "Vui lòng chọn ít nhất 1 khung giờ gửi SMS."
                });
            }

            var nowUtc = DateTime.UtcNow;
            var todayVn = GetVietnamTodayString(nowUtc);

            var username =
                User?.Identity?.Name
                ?? User.FindFirstValue(ClaimTypes.Email)
                ?? string.Empty;

            var filter =
                Builders<SmsScheduleConfig>.Filter.Eq(x => x.UserId, userId)
                &
                Builders<SmsScheduleConfig>.Filter.Eq(x => x.SerialNumber, serial);

            var existing = await _col
                .Find(filter)
                .FirstOrDefaultAsync(ct);

            if (existing != null)
            {
                var oldTimes = (existing.ScheduleTimes ?? new List<string>())
                    .Where(IsHHmm)
                    .Distinct()
                    .OrderBy(x => x)
                    .ToList();

                var sameTimes = oldTimes.SequenceEqual(times);
                var sameEnabled = existing.Enabled == dto.Enabled;

                if (sameTimes && sameEnabled)
                {
                    return Ok(new
                    {
                        ok = true,
                        message = "Lịch SMS không thay đổi.",
                        maxTimesPerDevice = MaxTimesPerDevice,
                        maxChangesPerDay = MaxChangesPerDay,
                        remainingChanges = Math.Max(0, MaxChangesPerDay - existing.ChangeCountToday),
                        config = MapConfig(existing)
                    });
                }

                if (existing.LastChangedLocalDate != todayVn)
                {
                    existing.LastChangedLocalDate = todayVn;
                    existing.ChangeCountToday = 0;
                }

                if (existing.ChangeCountToday >= MaxChangesPerDay)
                {
                    return BadRequest(new
                    {
                        ok = false,
                        remainingChanges = 0,
                        maxChangesPerDay = MaxChangesPerDay,
                        message = $"Bạn đã dùng hết {MaxChangesPerDay} lần thay đổi lịch SMS hôm nay cho thiết bị/kênh này."
                    });
                }

                existing.ChangeCountToday++;
                existing.ScheduleTimes = times;
                existing.Enabled = dto.Enabled;
                existing.Username = username;
                existing.LastChangedAtUtc = nowUtc;
                existing.UpdatedAtUtc = nowUtc;

                await _col.ReplaceOneAsync(
                    x => x.Id == existing.Id,
                    existing,
                    cancellationToken: ct);

                return Ok(new
                {
                    ok = true,
                    message = "Cập nhật lịch SMS thành công.",
                    maxTimesPerDevice = MaxTimesPerDevice,
                    maxChangesPerDay = MaxChangesPerDay,
                    remainingChanges = Math.Max(0, MaxChangesPerDay - existing.ChangeCountToday),
                    config = MapConfig(existing)
                });
            }

            var newConfig = new SmsScheduleConfig
            {
                Id = ObjectId.GenerateNewId(),
                UserId = userId,
                Username = username,
                SerialNumber = serial,
                ScheduleTimes = times,
                Enabled = dto.Enabled,
                ChangeCountToday = 1,
                LastChangedLocalDate = todayVn,
                LastChangedAtUtc = nowUtc,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            await _col.InsertOneAsync(newConfig, null, ct);

            return Ok(new
            {
                ok = true,
                message = "Đã tạo lịch SMS thành công.",
                maxTimesPerDevice = MaxTimesPerDevice,
                maxChangesPerDay = MaxChangesPerDay,
                remainingChanges = MaxChangesPerDay - 1,
                config = MapConfig(newConfig)
            });
        }

        // DELETE /api/sms-schedule/{serial}
        [HttpDelete("{serial}")]
        public async Task<IActionResult> Delete(
            string serial,
            CancellationToken ct = default)
        {
            var userId = await ResolveCurrentUserIdAsync(ct);

            if (userId == ObjectId.Empty)
            {
                return Unauthorized(new
                {
                    ok = false,
                    message = "Chưa đăng nhập hoặc không xác định được UserId."
                });
            }

            if (!await HasSmsScheduleFeatureAsync(userId, ct))
            {
                return StatusCode(403, new
                {
                    ok = false,
                    locked = true,
                    feature = SmsScheduleFeature,
                    message = "Bạn chưa có quyền sử dụng SMS định kỳ hoặc gói đã hết hạn."
                });
            }

            serial = (serial ?? string.Empty)
                .Trim()
                .ToUpperInvariant();

            await _col.DeleteOneAsync(
                x =>
                    x.UserId == userId
                    && x.SerialNumber == serial,
                ct);

            return Ok(new
            {
                ok = true,
                message = "Đã xóa lịch SMS."
            });
        }

        private async Task<bool> HasSmsScheduleFeatureAsync(ObjectId userId, CancellationToken ct)
        {
            var sub = await _subs.GetActiveAsync(userId, ct);

            return sub?.Features?.Any(f =>
                string.Equals(f, SmsScheduleFeature, StringComparison.OrdinalIgnoreCase)
            ) == true;
        }

        private static object? MapConfig(SmsScheduleConfig? x)
        {
            if (x == null)
                return null;

            var changeCountToday = x.ChangeCountToday;

            return new
            {
                id = x.Id.ToString(),
                userId = x.UserId.ToString(),
                username = x.Username,
                serialNumber = x.SerialNumber,
                scheduleTimes = x.ScheduleTimes ?? new List<string>(),
                enabled = x.Enabled,
                maxTimesPerDevice = MaxTimesPerDevice,
                maxChangesPerDay = MaxChangesPerDay,
                changeCountToday,
                remainingChanges = Math.Max(0, MaxChangesPerDay - changeCountToday),
                lastChangedLocalDate = x.LastChangedLocalDate,
                lastChangedAtUtc = x.LastChangedAtUtc,
                createdAtUtc = x.CreatedAtUtc,
                updatedAtUtc = x.UpdatedAtUtc
            };
        }

        private async Task<ObjectId> ResolveCurrentUserIdAsync(CancellationToken ct)
        {
            var claimCandidates = new[]
            {
                User.FindFirstValue(ClaimTypes.NameIdentifier),
                User.FindFirstValue("sub"),
                User.FindFirstValue("id"),
                User.FindFirstValue("userId"),
                User.FindFirstValue("UserId"),
                User.FindFirstValue("_id")
            };

            foreach (var value in claimCandidates)
            {
                if (ObjectId.TryParse(value, out var oid))
                    return oid;
            }

            var email =
                User.FindFirstValue(ClaimTypes.Email)
                ?? User.FindFirstValue("email")
                ?? User.Identity?.Name;

            if (!string.IsNullOrWhiteSpace(email))
            {
                var account = await _accounts.FindByEmailAsync(email);

                if (account != null)
                    return account.Id;
            }

            return ObjectId.Empty;
        }

        private static bool IsHHmm(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return false;

            return Regex.IsMatch(
                value,
                @"^([01]\d|2[0-3]):[0-5]\d$"
            );
        }

        private static string GetVietnamTodayString(DateTime nowUtc)
        {
            TimeZoneInfo? tz = null;

            try
            {
                tz = TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time");
            }
            catch
            {
                try
                {
                    tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
                }
                catch
                {
                    tz = null;
                }
            }

            var vnNow = tz == null
                ? nowUtc.AddHours(7)
                : TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);

            return vnNow.ToString("yyyy-MM-dd");
        }

        private void EnsureIndexes()
        {
            try
            {
                var keys =
                    Builders<SmsScheduleConfig>.IndexKeys
                        .Ascending(x => x.UserId)
                        .Ascending(x => x.SerialNumber);

                var model =
                    new CreateIndexModel<SmsScheduleConfig>(
                        keys,
                        new CreateIndexOptions
                        {
                            Name = "ux_sms_schedule_user_serial",
                            Unique = true
                        });

                _col.Indexes.CreateOne(model);
            }
            catch
            {
                // Ignore index creation conflict on startup.
            }
        }
    }
}

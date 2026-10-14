using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models.CreateCode;
using temperature_humi.Service.Admin;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/license-codes")]
    [Authorize(Roles = "Admin")]
    public class AdminLicenseCodesController : ControllerBase
    {
        private const string FeatureSmsAlert = "sms_alert";
        private const string FeatureSmsSchedule = "sms_schedule";
        private const string FeatureAdvancedDevices = "advanced_devices";
        private const string FeatureAlertHistory90d = "alert_history_90d";
        private const string FeaturePriorityAlerts = "priority_alerts";
        private const string FeatureAdvancedExport = "advanced_export";

        private readonly SubscriptionService _subs;
        private readonly IMongoCollection<LicenseCode> _codes;

        public AdminLicenseCodesController(SubscriptionService subs, IOptions<MongoDBSettings> settings)
        {
            _subs = subs;

            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _codes = db.GetCollection<LicenseCode>("LicenseCodes");
        }

        public class IssueDto
        {
            public string? Code { get; set; }
            public string Plan { get; set; } = "sms_custom_year";
            public string[]? Features { get; set; }
            public int DurationDays { get; set; } = 180;
            public int MaxActivations { get; set; } = 1;

            // SMS quota tùy chỉnh theo từng code.
            // Ví dụ: 500, 2500, 7500, 15000...
            // Nếu SmsUnlimited=true thì SmsQuotaTotal được bỏ qua.
            public int? SmsQuotaTotal { get; set; }
            public bool? SmsUnlimited { get; set; }
            public int? SmsWarnAtRemaining { get; set; }

            public string? Notes { get; set; }
            public string? ReservedForUserId { get; set; }
        }

        // POST /api/admin/license-codes/issue
        [HttpPost("issue")]
        public async Task<IActionResult> Issue([FromBody] IssueDto dto, CancellationToken ct = default)
        {
            if (dto == null)
                return BadRequest(new { message = "Body không hợp lệ." });

            var code = string.IsNullOrWhiteSpace(dto.Code)
                ? GenerateCode()
                : dto.Code.Trim().ToUpperInvariant();

            var displayPlan = string.IsNullOrWhiteSpace(dto.Plan)
                ? "custom"
                : dto.Plan.Trim();

            // =========================================================
            // FEATURE LÀ QUYỀN THẬT, PLAN CHỈ ĐỂ HIỂN THỊ / GỢI Ý
            // - Nếu FE gửi Features rõ ràng: dùng Features đó.
            // - Nếu FE không gửi Features: backend tự map theo Plan.
            // - Premium được phép có nhiều feature, gồm SMS cảnh báo + SMS định kỳ.
            // =========================================================
            var features = ResolveFeatures(displayPlan, dto.Features);

            if (features.Length == 0)
            {
                return BadRequest(new
                {
                    message = "Code phải có ít nhất 1 feature hợp lệ.",
                    plan = displayPlan
                });
            }

            var hasSmsFeature = features.Any(x =>
                string.Equals(x, FeatureSmsAlert, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(x, FeatureSmsSchedule, StringComparison.OrdinalIgnoreCase));

            if (hasSmsFeature
                && dto.SmsUnlimited != true
                && (!dto.SmsQuotaTotal.HasValue || dto.SmsQuotaTotal.Value <= 0))
            {
                return BadRequest(new
                {
                    message = "Vui lòng nhập số lượng tin SMS lớn hơn 0 hoặc chọn không giới hạn.",
                    field = "smsQuotaTotal"
                });
            }

            if (dto.SmsQuotaTotal.HasValue && dto.SmsQuotaTotal.Value > 10_000_000)
            {
                return BadRequest(new
                {
                    message = "Số lượng tin SMS tối đa cho một code là 10.000.000.",
                    field = "smsQuotaTotal"
                });
            }

            var quota = ResolveSmsQuota(
                displayPlan,
                dto.SmsQuotaTotal,
                dto.SmsUnlimited,
                dto.SmsWarnAtRemaining);

            var created = await _subs.CreateLicenseCodeAsync(
                code,
                displayPlan,
                features,
                dto.DurationDays,
                dto.MaxActivations,
                dto.Notes,
                createdBy: null,
                smsQuotaTotal: quota.Total,
                smsUnlimited: quota.Unlimited,
                smsWarnAtRemaining: quota.WarnAtRemaining,
                ct: ct);

            if (!string.IsNullOrWhiteSpace(dto.ReservedForUserId)
                && ObjectId.TryParse(dto.ReservedForUserId, out var uid))
            {
                await _subs.UpdateLicenseCodeReservedAsync(created.Id, uid, adminId: null, ct);
            }

            return Ok(new
            {
                message = "issued",
                code = created.Code,
                plan = created.Plan,
                features = created.Features,
                durationDays = created.DurationDays,
                remaining = created.MaxActivations,
                smsQuotaTotal = created.SmsQuotaTotal,
                smsUnlimited = created.SmsUnlimited,
                smsWarnAtRemaining = created.SmsWarnAtRemaining,
                notes = created.Notes,
                reservedForUserId = dto.ReservedForUserId
            });
        }

        // GET /api/admin/license-codes?onlyUnused=false&skip=0&take=50
        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] bool onlyUnused = false,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 50,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 200);

            // 1) AddFields: tính used = số activation đã dùng
            var addFields = new BsonDocument("$addFields", new BsonDocument
            {
                {
                    "actCount",
                    new BsonDocument("$size",
                        new BsonDocument("$ifNull", new BsonArray { "$activations", new BsonArray() }))
                }
            });

            // 2) Match filter
            var match = onlyUnused
                ? new BsonDocument("$match", new BsonDocument("$expr",
                    new BsonDocument("$lt", new BsonArray
                    {
                        "$actCount",
                        new BsonDocument("$ifNull", new BsonArray { "$MaxActivations", "$maxActivations", 1 })
                    })))
                : new BsonDocument("$match", new BsonDocument());

            var sort = new BsonDocument("$sort", new BsonDocument("CreatedAtUtc", -1));

            // 3) Project: ưu tiên PascalCase, fallback camelCase
            var project = new BsonDocument("$project", new BsonDocument
            {
                { "_id", 0 },
                { "code", new BsonDocument("$ifNull", new BsonArray { "$Code", "$code", "(no-code)" }) },
                { "plan", new BsonDocument("$ifNull", new BsonArray { "$Plan", "$plan", "basic" }) },
                { "features", new BsonDocument("$ifNull", new BsonArray { "$Features", "$features", new BsonArray() }) },
                { "durationDays", new BsonDocument("$ifNull", new BsonArray { "$DurationDays", "$durationDays", 0 }) },
                { "maxActivations", new BsonDocument("$ifNull", new BsonArray { "$MaxActivations", "$maxActivations", 1 }) },
                { "smsQuotaTotal", new BsonDocument("$ifNull", new BsonArray { "$SmsQuotaTotal", "$smsQuotaTotal", BsonNull.Value }) },
                { "smsUnlimited", new BsonDocument("$ifNull", new BsonArray { "$SmsUnlimited", "$smsUnlimited", false }) },
                { "smsWarnAtRemaining", new BsonDocument("$ifNull", new BsonArray { "$SmsWarnAtRemaining", "$smsWarnAtRemaining", BsonNull.Value }) },
                { "used", "$actCount" },
                {
                    "remaining",
                    new BsonDocument("$max", new BsonArray
                    {
                        0,
                        new BsonDocument("$subtract", new BsonArray
                        {
                            new BsonDocument("$ifNull", new BsonArray { "$MaxActivations", "$maxActivations", 1 }),
                            "$actCount"
                        })
                    })
                },
                {
                    "hasSlots",
                    new BsonDocument("$gt", new BsonArray
                    {
                        new BsonDocument("$subtract", new BsonArray
                        {
                            new BsonDocument("$ifNull", new BsonArray { "$MaxActivations", "$maxActivations", 1 }),
                            "$actCount"
                        }),
                        0
                    })
                },
                { "notes", new BsonDocument("$ifNull", new BsonArray { "$Notes", "$notes", BsonNull.Value }) },
                { "createdAtUtc", new BsonDocument("$ifNull", new BsonArray { "$CreatedAtUtc", "$createdAtUtc", BsonNull.Value }) }
            });

            // 4) Facet
            var facet = new BsonDocument("$facet", new BsonDocument
            {
                { "total", new BsonArray { new BsonDocument("$count", "value") } },
                {
                    "items",
                    new BsonArray
                    {
                        new BsonDocument("$skip", skip),
                        new BsonDocument("$limit", take),
                        project
                    }
                }
            });

            var pipeline = new[] { addFields, match, sort, facet };
            var result = await _codes.Aggregate<BsonDocument>(pipeline).FirstOrDefaultAsync(ct);

            var total = 0;
            var rawItems = Array.Empty<BsonDocument>();

            if (result != null)
            {
                var totalArr = result.GetValue("total", new BsonArray()).AsBsonArray;
                if (totalArr.Count > 0)
                    total = totalArr[0]["value"].ToInt32();

                rawItems = result.GetValue("items", new BsonArray()).AsBsonArray
                    .Select(x => x.AsBsonDocument)
                    .ToArray();
            }

            var items = rawItems.Select(d =>
            {
                var code = d.GetValue("code", "(no-code)").AsString;
                var plan = d.GetValue("plan", "basic").AsString;

                var features = Array.Empty<string>();
                if (d.TryGetValue("features", out var fval) && fval.IsBsonArray)
                {
                    features = fval.AsBsonArray
                        .Select(v => v.ToString())
                        .Where(x => !string.IsNullOrWhiteSpace(x))
                        .ToArray();
                }

                var durationDays = d.GetValue("durationDays", 0).ToInt32();
                var maxActivations = d.GetValue("maxActivations", 1).ToInt32();
                var used = d.GetValue("used", 0).ToInt32();
                var remaining = d.GetValue("remaining", 0).ToInt32();
                var hasSlots = d.GetValue("hasSlots", false).ToBoolean();

                int? smsQuotaTotal = null;
                if (d.TryGetValue("smsQuotaTotal", out var qVal) && !qVal.IsBsonNull)
                    smsQuotaTotal = qVal.ToInt32();

                var smsUnlimited = d.TryGetValue("smsUnlimited", out var uVal) && !uVal.IsBsonNull && uVal.ToBoolean();

                int? smsWarnAtRemaining = null;
                if (d.TryGetValue("smsWarnAtRemaining", out var wVal) && !wVal.IsBsonNull)
                    smsWarnAtRemaining = wVal.ToInt32();

                string? notes = null;
                if (d.TryGetValue("notes", out var nval) && !nval.IsBsonNull)
                    notes = nval.ToString();

                DateTime? createdAtUtc = null;
                if (d.TryGetValue("createdAtUtc", out var cval) && cval.IsValidDateTime)
                    createdAtUtc = cval.ToUniversalTime();

                return new
                {
                    code,
                    plan,
                    features,
                    durationDays,
                    maxActivations,
                    smsQuotaTotal,
                    smsUnlimited,
                    smsWarnAtRemaining,
                    used,
                    remaining,
                    hasSlots,
                    notes,
                    createdAtUtc
                };
            });

            return Ok(new { total, items });
        }

        // DELETE /api/admin/license-codes/{code}
        [HttpDelete("{code}")]
        public async Task<IActionResult> Delete(string code, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(code))
                return BadRequest(new { message = "Code không hợp lệ." });

            var norm = code.Trim().ToUpperInvariant();

            var lic = await _codes.Find(x => x.Code == norm).FirstOrDefaultAsync(ct);
            if (lic == null)
                return NotFound(new { message = "Code không tồn tại." });

            // Khi xoá code: expire subscription đang active của user đã redeem code này.
            // Sau đó /api/subscriptions/me sẽ mất sms_schedule, FE khoá nút,
            // SmsScheduleService cũng sẽ skip job nếu còn lịch cũ.
            var expiredCount = await _subs.AdminExpireSubsByLicenseCodeAsync(norm, ct);

            var res = await _codes.DeleteOneAsync(x => x.Code == norm, ct);
            if (res.DeletedCount == 0)
                return BadRequest(new { message = "Xoá code thất bại. Vui lòng thử lại." });

            return Ok(new
            {
                message = "deleted",
                code = norm,
                expiredSubs = expiredCount
            });
        }

        // POST /api/admin/license-codes/{code}/delete
        [HttpPost("{code}/delete")]
        public async Task<IActionResult> DeleteCode(string code, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(code))
                return BadRequest(new { message = "Code is required." });

            var norm = code.Trim().ToUpperInvariant();

            var lic = await _codes
                .Find(x => x.Code == norm)
                .FirstOrDefaultAsync(ct);

            if (lic == null)
                return NotFound(new { message = "Code không tồn tại hoặc đã bị xoá." });

            // Khi xoá code: revoke subscription đang active của user đã redeem code này.
            var revokedCount = await _subs.RevokeActiveByLicenseAsync(lic, ct);

            var filter = Builders<LicenseCode>.Filter.Eq(x => x.Id, lic.Id);
            await _codes.DeleteOneAsync(filter, ct);

            return Ok(new
            {
                message = "deleted",
                code = norm,
                revokedSubscriptions = revokedCount
            });
        }

        // ================= HELPERS ==================
        private sealed record SmsQuotaPreset(int? Total, bool Unlimited, int? WarnAtRemaining);

        private static SmsQuotaPreset ResolveSmsQuota(
            string? plan,
            int? inputTotal,
            bool? inputUnlimited,
            int? inputWarnAtRemaining)
        {
            var p = NormalizePlan(plan);

            if (inputUnlimited == true)
                return new SmsQuotaPreset(null, true, null);

            // Ưu tiên số lượng admin nhập.
            // Hỗ trợ mọi giá trị hợp lệ: 1, 500, 2500, 15000...
            if (inputTotal.HasValue && inputTotal.Value > 0)
            {
                var total = inputTotal.Value;

                return new SmsQuotaPreset(
                    total,
                    false,
                    NormalizeWarn(inputWarnAtRemaining, total));
            }

            // Giữ tương thích với các plan cũ đã tồn tại.
            if (p.Contains("unlimited")
                || p.Contains("khonggioihan")
                || p.Contains("khong_gioi_han"))
            {
                return new SmsQuotaPreset(null, true, null);
            }

            if (p.Contains("10000") || p.Contains("10k"))
            {
                return new SmsQuotaPreset(
                    10000,
                    false,
                    NormalizeWarn(inputWarnAtRemaining, 10000));
            }

            if (p.Contains("1000") || p.Contains("1k"))
            {
                return new SmsQuotaPreset(
                    1000,
                    false,
                    NormalizeWarn(inputWarnAtRemaining, 1000));
            }

            // Không còn tự mặc định 1000 tin cho plan SMS.
            // Validation phía trên sẽ yêu cầu admin nhập quota cụ thể.
            return new SmsQuotaPreset(null, false, null);
        }

        private static int? NormalizeWarn(int? inputWarnAtRemaining, int total)
        {
            if (inputWarnAtRemaining.HasValue && inputWarnAtRemaining.Value > 0)
                return Math.Min(inputWarnAtRemaining.Value, total);

            if (total >= 10000) return 500;
            if (total >= 1000) return 100;
            return Math.Max(1, (int)Math.Ceiling(total * 0.1));
        }

        private static string[] ResolveFeatures(string? plan, string[]? inputFeatures)
        {
            var features = (inputFeatures ?? Array.Empty<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToLowerInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (features.Length > 0)
                return features;

            return ResolveFeaturesByPlan(plan);
        }

        private static string[] ResolveFeaturesByPlan(string? plan)
        {
            var p = NormalizePlan(plan);

            return p switch
            {
                "sms" => new[]
                {
                    FeatureSmsAlert,
                    FeatureSmsSchedule
                },

                "sms_schedule" or "smsschedule" or "smsdinhky" or "smsdinhki" => new[]
                {
                    FeatureSmsAlert,
                    FeatureSmsSchedule
                },

                "ltgeo" or "proltgeo" or "advanceddevices" => new[]
                {
                    FeatureAdvancedDevices
                },

                "pro" => new[]
                {
                    FeatureAdvancedDevices,
                    FeatureAlertHistory90d,
                    FeaturePriorityAlerts
                },

                "premium" => new[]
                {
                    FeatureAdvancedDevices,
                    FeatureAlertHistory90d,
                    FeaturePriorityAlerts,
                    FeatureAdvancedExport,
                    FeatureSmsAlert,
                    FeatureSmsSchedule
                },

                _ when p.Contains("sms") && (p.Contains("schedule") || p.Contains("dinhky") || p.Contains("dinhki")) => new[]
                {
                    FeatureSmsAlert,
                    FeatureSmsSchedule
                },

                _ when p.Contains("sms") => new[]
                {
                    FeatureSmsAlert
                },

                _ when p.Contains("ltgeo") => new[]
                {
                    FeatureAdvancedDevices
                },

                _ => Array.Empty<string>()
            };
        }

        private static string NormalizePlan(string? plan)
        {
            return (plan ?? "basic")
                .Trim()
                .ToLowerInvariant()
                .Replace(" ", "")
                .Replace("-", "_")
                .Replace("/", "_");
        }

        private static string GenerateCode()
        {
            string Block() => Convert.ToBase64String(Guid.NewGuid().ToByteArray())
                .Replace("=", "")
                .Replace("+", "")
                .Replace("/", "")
                .ToUpperInvariant()
                .Substring(0, 4);

            return $"{Block()}-{Block()}-{Block()}";
        }
    }
}
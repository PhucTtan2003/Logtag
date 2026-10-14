using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;
using System.Net;
using temperature_humi.Models;
using temperature_humi.Service.LogtagService;
using static temperature_humi.Service.LogtagService.LogTagApiClient;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/logtag-test")]
    [Authorize(Roles = "Admin")]
    public class LogTagQuotaTestController : ControllerBase
    {
        private readonly LogTagApiClientMain _api;
        private readonly ILogger<LogTagQuotaTestController> _log;

        public LogTagQuotaTestController(
            LogTagApiClientMain api,
            ILogger<LogTagQuotaTestController> log)
        {
            _api = api;
            _log = log;
        }

        public class QuotaTestRequest
        {
            public long TeamId { get; set; } = 13524;
            public List<string>? Serials { get; set; }
            public DateTime? StartDateUtc { get; set; }
            public DateTime? EndDateUtc { get; set; }

            // 0 = bắn liên tục để test quota thật
            // 1000 = mỗi request cách nhau 1 giây
            public int DelayMs { get; set; } = 0;

            // true = gặp quota thì dừng luôn
            public bool StopOnQuota { get; set; } = false;
        }

        [HttpPost("readings-quota")]
        public async Task<IActionResult> TestReadingsQuota(
            [FromBody] QuotaTestRequest? req,
            CancellationToken ct)
        {
            req ??= new QuotaTestRequest();

            var teamId = req.TeamId > 0 ? req.TeamId : 13524;

            var serials = (req.Serials != null && req.Serials.Count > 0
                    ? req.Serials
                    : DefaultSerials.ToList())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToUpperInvariant())
                .ToList();

            var uniqueSerials = serials
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var endUtc = req.EndDateUtc?.ToUniversalTime() ?? DateTime.UtcNow;
            var startUtc = req.StartDateUtc?.ToUniversalTime() ?? endUtc.AddMinutes(-15);

            var delayMs = Math.Clamp(req.DelayMs, 0, 300000);

            var results = new List<object>();
            var totalSw = Stopwatch.StartNew();

            var ok = 0;
            var failed = 0;
            var quota = 0;

            _log.LogWarning(
                "[QUOTA-TEST] START teamId={TeamId}, requests={Requests}, uniqueSerials={Unique}, from={From:o}, to={To:o}, delayMs={DelayMs}",
                teamId,
                serials.Count,
                uniqueSerials.Count,
                startUtc,
                endUtc,
                delayMs);

            foreach (var serial in serials)
            {
                ct.ThrowIfCancellationRequested();

                var sw = Stopwatch.StartNew();

                try
                {
                    var apiReq = new LocationReadingsRequest
                    {
                        serialNumber = serial,
                        startDateUtc = startUtc,
                        endDateUtc = endUtc
                    };

                    var resp = await _api.GetLocationReadingsAsync(teamId, apiReq, ct);

                    var rows = resp?.Data ?? new List<LocationReadingDto>();
                    ok++;

                    results.Add(new
                    {
                        serial,
                        status = "ok",
                        httpStatus = 200,
                        rows = rows.Count,
                        minDateUtc = rows.Count > 0 ? rows.Min(x => x.dateUtc) : (DateTime?)null,
                        maxDateUtc = rows.Count > 0 ? rows.Max(x => x.dateUtc) : (DateTime?)null,
                        elapsedMs = sw.ElapsedMilliseconds
                    });

                    _log.LogWarning(
                        "[QUOTA-TEST] OK {Serial}, rows={Rows}, elapsedMs={Elapsed}",
                        serial,
                        rows.Count,
                        sw.ElapsedMilliseconds);
                }
                catch (Exception ex)
                {
                    failed++;

                    var msg = ex.ToString();
                    var isQuota = IsQuotaError(msg);

                    if (isQuota)
                        quota++;

                    var httpStatus = GetHttpStatusCode(ex);

                    results.Add(new
                    {
                        serial,
                        status = isQuota ? "quota_or_rate_limit" : "error",
                        httpStatus,
                        error = ex.Message,
                        elapsedMs = sw.ElapsedMilliseconds
                    });

                    _log.LogWarning(
                        ex,
                        "[QUOTA-TEST] FAIL {Serial}, quota={Quota}, http={HttpStatus}, elapsedMs={Elapsed}",
                        serial,
                        isQuota,
                        httpStatus,
                        sw.ElapsedMilliseconds);

                    if (isQuota && req.StopOnQuota)
                        break;
                }

                if (delayMs > 0)
                    await Task.Delay(delayMs, ct);
            }

            totalSw.Stop();

            return Ok(new
            {
                teamId,
                startDateUtc = startUtc,
                endDateUtc = endUtc,
                delayMs,
                requestedCount = serials.Count,
                uniqueSerialCount = uniqueSerials.Count,
                duplicateWarning = serials.Count != uniqueSerials.Count
                    ? "Danh sách có serial trùng. Nếu muốn test số thiết bị thật, hãy dùng serial unique."
                    : null,
                summary = new
                {
                    ok,
                    failed,
                    quota,
                    totalElapsedMs = totalSw.ElapsedMilliseconds
                },
                results
            });
        }

        private static int? GetHttpStatusCode(Exception ex)
        {
            if (ex is HttpRequestException hre && hre.StatusCode.HasValue)
                return (int)hre.StatusCode.Value;

            return null;
        }

        private static bool IsQuotaError(string msg)
        {
            return msg.Contains("quota", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("rate limit", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("too many requests", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("429", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("503", StringComparison.OrdinalIgnoreCase);
        }

        private static readonly string[] DefaultSerials =
        {
            "A0A5003395C5",
            "A0A5003592YH",
            "A0A1005471WT",
            "A0A10054948O",
            "A0A5003099SH",
            "A0A500337200",
            "A0A5003132KT",
            "A0A5003626JH",
            "A0A50035695O",
            "A0A5003254U5",
            "A0A5003375U5"

            // King thêm serial thứ 12 vào đây nếu muốn test đúng 12 thiết bị.
            // "SERIAL_THU_12"
        };
    }
}
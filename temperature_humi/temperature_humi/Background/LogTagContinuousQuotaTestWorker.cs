using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Diagnostics;
using System.Net.Http;
using temperature_humi.Models;
using temperature_humi.Service.LogtagService;
using static temperature_humi.Service.LogtagService.LogTagApiClient;

namespace temperature_humi.Background
{
    public class LogTagContinuousQuotaTestOptions
    {
        public bool Enabled { get; set; } = false;
        public long TeamId { get; set; } = 13524;

        // Delay giữa mỗi thiết bị. 1000 = mỗi request cách nhau 1 giây.
        public int DelayMs { get; set; } = 1000;

        // Delay sau khi chạy xong 1 vòng toàn bộ serial.
        public int RoundDelayMs { get; set; } = 0;

        // Query dữ liệu trong X phút gần nhất.
        // Để lấy realtime/latest nên để 3-5 phút.
        public int LookbackMinutes { get; set; } = 5;

        // Nếu latest data cũ hơn số phút này thì log STALE.
        public int FreshMaxAgeMinutes { get; set; } = 10;

        public bool StopOnQuota { get; set; } = false;

        // 0 = chạy liên tục vô hạn
        public int MaxRounds { get; set; } = 0;

        public List<string> Serials { get; set; } = new();
    }

    public class LogTagContinuousQuotaTestWorker : BackgroundService
    {
        private readonly ILogger<LogTagContinuousQuotaTestWorker> _log;
        private readonly IOptionsMonitor<LogTagContinuousQuotaTestOptions> _opt;
        private readonly LogTagApiClientMain _api;

        public LogTagContinuousQuotaTestWorker(
            ILogger<LogTagContinuousQuotaTestWorker> log,
            IOptionsMonitor<LogTagContinuousQuotaTestOptions> opt,
            LogTagApiClientMain api)
        {
            _log = log;
            _opt = opt;
            _api = api;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var first = _opt.CurrentValue;

            if (!first.Enabled)
            {
                _log.LogWarning("[REALTIME-LOOP] Disabled");
                return;
            }

            var round = 0;

            _log.LogWarning("[REALTIME-LOOP] Worker started.");

            while (!stoppingToken.IsCancellationRequested)
            {
                var opt = _opt.CurrentValue;

                if (!opt.Enabled)
                {
                    _log.LogWarning("[REALTIME-LOOP] Disabled by config. Stop loop.");
                    return;
                }

                round++;

                if (opt.MaxRounds > 0 && round > opt.MaxRounds)
                {
                    _log.LogWarning(
                        "[REALTIME-LOOP] Reached MaxRounds={MaxRounds}. Stop loop.",
                        opt.MaxRounds);

                    return;
                }

                var serials = (opt.Serials ?? new List<string>())
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Select(x => x.Trim().ToUpperInvariant())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (opt.TeamId <= 0 || serials.Count == 0)
                {
                    _log.LogError(
                        "[REALTIME-LOOP] Invalid config. TeamId={TeamId}, Serials={Count}",
                        opt.TeamId,
                        serials.Count);

                    await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                    continue;
                }

                var lookbackMinutes = Math.Clamp(opt.LookbackMinutes, 1, 1440);
                var freshMaxAgeMinutes = Math.Clamp(opt.FreshMaxAgeMinutes, 1, 1440);
                var delayMs = Math.Clamp(opt.DelayMs, 0, 300000);
                var roundDelayMs = Math.Clamp(opt.RoundDelayMs, 0, 3600000);

                var endUtc = DateTime.UtcNow;
                var startUtc = endUtc.AddMinutes(-lookbackMinutes);

                var ok = 0;
                var failed = 0;
                var quota = 0;
                var noData = 0;
                var stale = 0;

                var roundSw = Stopwatch.StartNew();

                _log.LogWarning(
                    "[REALTIME-LOOP] ROUND {Round} START teamId={TeamId}, serials={Count}, from={From:o}, to={To:o}, delayMs={DelayMs}, lookback={LookbackMinutes}m",
                    round,
                    opt.TeamId,
                    serials.Count,
                    startUtc,
                    endUtc,
                    delayMs,
                    lookbackMinutes);

                foreach (var serial in serials)
                {
                    stoppingToken.ThrowIfCancellationRequested();

                    var sw = Stopwatch.StartNew();

                    try
                    {
                        var req = new LocationReadingsRequest
                        {
                            serialNumber = serial,
                            startDateUtc = startUtc,
                            endDateUtc = endUtc
                        };

                        var resp = await _api.GetLocationReadingsAsync(
                            opt.TeamId,
                            req,
                            stoppingToken);

                        var rows = resp?.Data ?? new List<LocationReadingDto>();

                        ok++;

                        var latest = rows
                            .Where(x => x.dateUtc != default)
                            .OrderByDescending(x => NormalizeUtc(x.dateUtc))
                            .FirstOrDefault();

                        if (latest == null)
                        {
                            noData++;

                            _log.LogWarning(
                                "[REALTIME-LOOP] ROUND {Round} NO-DATA serial={Serial}, rows=0, elapsedMs={Elapsed}",
                                round,
                                serial,
                                sw.ElapsedMilliseconds);
                        }
                        else
                        {
                            var latestUtc = NormalizeUtc(latest.dateUtc);
                            var age = DateTime.UtcNow - latestUtc;
                            var isStale = age > TimeSpan.FromMinutes(freshMaxAgeMinutes);

                            if (isStale)
                                stale++;

                            var state = isStale ? "STALE" : "FRESH";

                            // temperature/humidity trong DTO của bạn là double, không phải double?
                            var tempText = $"{latest.temperature:0.##}";
                            var humText = $"{latest.humidity:0.##}";

                            _log.LogWarning(
                                "[REALTIME-LOOP] ROUND {Round} {State} serial={Serial}, latestTime={LatestTime:o}, ageSec={AgeSec:0}, temp={Temp}, hum={Hum}, rows={Rows}, elapsedMs={Elapsed}",
                                round,
                                state,
                                serial,
                                latestUtc,
                                age.TotalSeconds,
                                tempText,
                                humText,
                                rows.Count,
                                sw.ElapsedMilliseconds);
                        }
                    }
                    catch (Exception ex)
                    {
                        failed++;

                        var msg = ex.ToString();
                        var isQuota = IsQuotaError(msg);

                        if (isQuota)
                            quota++;

                        var httpStatus = GetHttpStatusCode(ex);

                        _log.LogError(
                            ex,
                            "[REALTIME-LOOP] ROUND {Round} FAIL serial={Serial}, quota={Quota}, http={HttpStatus}, elapsedMs={Elapsed}",
                            round,
                            serial,
                            isQuota,
                            httpStatus,
                            sw.ElapsedMilliseconds);

                        if (isQuota && opt.StopOnQuota)
                        {
                            _log.LogError("[REALTIME-LOOP] StopOnQuota=true. Stop worker.");
                            return;
                        }
                    }

                    if (delayMs > 0)
                        await Task.Delay(delayMs, stoppingToken);
                }

                roundSw.Stop();

                _log.LogWarning(
                    "[REALTIME-LOOP] ROUND {Round} DONE ok={Ok}, failed={Failed}, quota={Quota}, noData={NoData}, stale={Stale}, elapsedMs={Elapsed}",
                    round,
                    ok,
                    failed,
                    quota,
                    noData,
                    stale,
                    roundSw.ElapsedMilliseconds);

                if (roundDelayMs > 0)
                    await Task.Delay(roundDelayMs, stoppingToken);
            }
        }

        private static DateTime NormalizeUtc(DateTime dt)
        {
            if (dt.Kind == DateTimeKind.Utc)
                return dt;

            if (dt.Kind == DateTimeKind.Local)
                return dt.ToUniversalTime();

            return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
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
    }
}
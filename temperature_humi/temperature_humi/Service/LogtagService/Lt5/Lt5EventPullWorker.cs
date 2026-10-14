using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Service.LogtagService.Lt5
{
    public class Lt5EventsOptions
    {
        public bool Enabled { get; set; } = true;

        // Chu kỳ chạy worker. Nên để 60s trở lên nếu có nhiều team/serial.
        public int IntervalSeconds { get; set; } = 60;

        // Khoảng thời gian lùi lại để lấy event gần đây.
        public int LookbackMinutes { get; set; } = 60;

        // Tuỳ chọn: nếu khai báo thì worker chỉ kéo các LT5 team này.
        // Nếu bỏ trống, worker sẽ lấy TeamID LT5 từ LogTagAccounts/LogTagTeamRouting qua LogTagAccountRouter.
        public List<long> TeamIds { get; set; } = new();

        // Tuỳ chọn giới hạn số serial mỗi team trong 1 vòng. 0 = không giới hạn.
        public int MaxSerialsPerTeamPerTick { get; set; } = 0;

        // Nghỉ nhẹ giữa các serial để tránh dồn request lên LogTag.
        public int DelayBetweenSerialsMs { get; set; } = 150;
    }

    /// <summary>
    /// Pull event LT5 theo mô hình nhiều LogTag account -> nhiều LT5 TeamID.
    /// Mỗi team sẽ được router chọn đúng LogTag client/account trước khi gọi API.
    /// </summary>
    public class Lt5EventPullWorker : BackgroundService
    {
        private readonly ILogger<Lt5EventPullWorker> _log;
        private readonly LogTagAccountRouter _router;
        private readonly AccountDeviceService _accDev;
        private readonly EventService _events;
        private readonly IOptionsMonitor<Lt5EventsOptions> _opt;

        public Lt5EventPullWorker(
            ILogger<Lt5EventPullWorker> log,
            LogTagAccountRouter router,
            AccountDeviceService accDev,
            EventService events,
            IOptionsMonitor<Lt5EventsOptions> opt)
        {
            _log = log;
            _router = router;
            _accDev = accDev;
            _events = events;
            _opt = opt;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var firstOpt = _opt.CurrentValue;
            if (!firstOpt.Enabled)
            {
                _log.LogWarning("[LT5-EVENT] Disabled");
                return;
            }

            _log.LogInformation("[LT5-EVENT] Worker started. Multi-account/multi-team mode enabled.");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await PullAllLt5Events(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[LT5-EVENT] Loop error");
                }

                var opt = _opt.CurrentValue;
                var delaySeconds = Math.Max(10, opt.IntervalSeconds);
                await Task.Delay(TimeSpan.FromSeconds(delaySeconds), stoppingToken);
            }

            _log.LogInformation("[LT5-EVENT] Worker stopped.");
        }

        private async Task PullAllLt5Events(CancellationToken ct)
        {
            var opt = _opt.CurrentValue;
            if (!opt.Enabled)
            {
                _log.LogDebug("[LT5-EVENT] Skip tick because worker is disabled by config.");
                return;
            }

            var teamIds = ResolveLt5TeamIds(opt);
            if (teamIds.Count == 0)
            {
                _log.LogWarning("[LT5-EVENT] No LT5 TeamIds configured. Add Lt5Events:TeamIds or LogTagAccounts with Kind=LT5.");
                return;
            }

            _log.LogInformation(
                "[LT5-EVENT] Tick start. teams={Teams}, lookbackMinutes={Lookback}",
                string.Join(",", teamIds),
                Math.Max(1, opt.LookbackMinutes));

            foreach (var teamId in teamIds)
            {
                ct.ThrowIfCancellationRequested();

                try
                {
                    await PullTeamLt5Events(teamId, opt, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[LT5-EVENT] Team pull error. teamId={TeamId}", teamId);
                }
            }
        }

        private IReadOnlyList<long> ResolveLt5TeamIds(Lt5EventsOptions opt)
        {
            var explicitTeams = (opt.TeamIds ?? new List<long>())
                .Where(x => x > 0)
                .Distinct()
                .ToList();

            if (explicitTeams.Count > 0)
                return explicitTeams;

            return _router
                .GetEnabledTeamIds("LT5")
                .Where(x => x > 0)
                .Distinct()
                .ToList();
        }

        private async Task PullTeamLt5Events(long teamId, Lt5EventsOptions opt, CancellationToken ct)
        {
            if (teamId <= 0)
            {
                _log.LogWarning("[LT5-EVENT] Skip invalid teamId={TeamId}", teamId);
                return;
            }

            var accountKey = _router.GetAccountKeyByTeamId(teamId);

            // Lấy toàn bộ serial LT5 đã phân quyền/gán trong AccountDevices theo team.
            var maps = await _accDev.GetMapsByTeamAsync(teamId, ct);
            var serials = maps == null
                ? new List<string>()
                : maps
                    .Select(x => (x.SerialNumber ?? string.Empty).Trim().ToUpperInvariant())
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

            if (opt.MaxSerialsPerTeamPerTick > 0)
                serials = serials.Take(opt.MaxSerialsPerTeamPerTick).ToList();

            if (serials.Count == 0)
            {
                _log.LogWarning(
                    "[LT5-EVENT] No serials found. teamId={TeamId}, account={AccountKey}",
                    teamId,
                    accountKey);
                return;
            }

            _log.LogInformation(
                "[LT5-EVENT] Pull team. teamId={TeamId}, account={AccountKey}, serials={Count}",
                teamId,
                accountKey,
                serials.Count);

            var insertedTotal = 0;
            var failed = 0;

            foreach (var serial in serials)
            {
                ct.ThrowIfCancellationRequested();

                try
                {
                    var inserted = await PullOne(teamId, accountKey, serial, opt, ct);
                    insertedTotal += inserted;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    failed++;
                    _log.LogError(
                        ex,
                        "[LT5-EVENT] Error pulling serial. teamId={TeamId}, account={AccountKey}, serial={Serial}",
                        teamId,
                        accountKey,
                        serial);
                }

                var delayMs = Math.Max(0, opt.DelayBetweenSerialsMs);
                if (delayMs > 0)
                    await Task.Delay(delayMs, ct);
            }

            _log.LogInformation(
                "[LT5-EVENT] Team done. teamId={TeamId}, account={AccountKey}, serials={Serials}, inserted={Inserted}, failed={Failed}",
                teamId,
                accountKey,
                serials.Count,
                insertedTotal,
                failed);
        }

        private async Task<int> PullOne(
            long teamId,
            string accountKey,
            string serial,
            Lt5EventsOptions opt,
            CancellationToken ct)
        {
            var client = _router.GetClientByTeamId(teamId);

            var now = DateTime.UtcNow;
            var lookback = Math.Max(1, opt.LookbackMinutes);
            var from = now.AddMinutes(-lookback);

            var resp = await client.GetEventsAsync(serial, from, now, ct);
            var inserted = await _events.SaveNewEventsAsync(serial, resp, ct);

            _log.LogInformation(
                "[LT5-EVENT] serial done. teamId={TeamId}, account={AccountKey}, serial={Serial}, inserted={Inserted}, from={From:o}, to={To:o}",
                teamId,
                accountKey,
                serial,
                inserted,
                from,
                now);

            return inserted;
        }
    }
}

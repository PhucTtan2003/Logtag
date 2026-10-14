// Background/LatestStatusSyncService.cs
using System;
using System.Linq;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using temperature_humi.Service;          // LogTagApiClient, DeviceService, StatusService
using temperature_humi.Helpers.Config;
using temperature_humi.Service.LogtagService;   // LogTagApiSettings

namespace temperature_humi.Background
{
    public class LatestStatusSyncOptions
    {
        public int PeriodSeconds { get; set; } = 60;
        public int LookbackHours { get; set; } = 24;
        public int BatchSize { get; set; } = 25;
        public int PushEveryNDevices { get; set; } = 5;
        public int OnlineThresholdMinutes { get; set; } = 30;
    }

    public class LatestStatusSyncService : BackgroundService
    {
        private readonly ILogger<LatestStatusSyncService> _logger;
        private readonly LogTagApiClient _api;
        private readonly DeviceService _deviceService;
        private readonly StatusService _status;
        private readonly LogTagApiSettings _cfg;
        private readonly LatestStatusSyncOptions _opt;

        private long TeamId => _cfg.TeamId;

        public LatestStatusSyncService(
            ILogger<LatestStatusSyncService> logger,
            LogTagApiClient api,
            DeviceService deviceService,
            StatusService status,
            IOptions<LogTagApiSettings> cfg,
            IOptions<LatestStatusSyncOptions> opt
        )
        {
            _logger = logger;
            _api = api;
            _deviceService = deviceService;
            _status = status;
            _cfg = cfg.Value;
            _opt = opt.Value;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation(
                "LatestStatusSyncService started. Period={Period}s, Lookback={Lookback}h, BatchSize={Batch}, Threshold={Thr}m",
                _opt.PeriodSeconds, _opt.LookbackHours, _opt.BatchSize, _opt.OnlineThresholdMinutes);

            var period = TimeSpan.FromSeconds(Math.Max(10, _opt.PeriodSeconds));

            while (!stoppingToken.IsCancellationRequested)
            {
                try { await RunOnce(stoppingToken); }
                catch (Exception ex) { _logger.LogError(ex, "LatestStatusSyncService failed."); }

                try { await Task.Delay(period, stoppingToken); } catch { }
            }
        }

        private async Task<(double? temp, double? humi, DateTime? ts)> TryFetchAsync(
            Func<Task<(double? temp, double? humi, DateTime? ts)>> fn,
            CancellationToken ct)
        {
            var delay = 500;
            for (int i = 0; i < 4; i++)
            {
                try { return await fn(); }
                catch (Exception ex)
                {
                    var msg = ex.Message ?? "";
                    if (msg.Contains("quota", StringComparison.OrdinalIgnoreCase) || msg.Contains("503"))
                    {
                        await Task.Delay(delay + Random.Shared.Next(0, 300), ct);
                        delay *= 2;
                        continue;
                    }
                    throw;
                }
            }
            return (null, null, null);
        }

        public async Task RunOnce(CancellationToken ct)
        {
            var devices = await _deviceService.GetAllAsync();
            if (devices.Count == 0) return;

            var fromUtc = DateTime.UtcNow.AddHours(-Math.Abs(_opt.LookbackHours));
            var toUtc = DateTime.UtcNow;

            int done = 0, ok = 0, fail = 0, quotaFails = 0;

            foreach (var dev in devices)
            {
                if (ct.IsCancellationRequested) return;

                try
                {
                    var isLtgeo = (dev.model ?? "").IndexOf("LTGEO", StringComparison.OrdinalIgnoreCase) >= 0;

                    var (temp, humi, ts) = await TryFetchAsync(async () =>
                    {
                        if (isLtgeo)
                        {
                            // LTGEO readings (DTO uses PascalCase)
                            var list = await _api.GetLtgeoReadingsAsync(TeamId, dev.serialNumber, fromUtc, toUtc);
                            var last = list?.OrderBy(x => x.DateUtc).LastOrDefault();
                            return (last?.Temperature, last?.Humidity, last?.DateUtc);
                        }
                        else
                        {
                            // LOCATION readings (also PascalCase)
                            var list = await _api.GetLtgeoReadingsAsync(TeamId, dev.serialNumber, fromUtc, toUtc);
                            var last = list?.OrderBy(x => x.DateUtc).LastOrDefault();
                            return (last?.Temperature, last?.Humidity, last?.DateUtc);
                        }
                    }, ct);

                    if (ts != null || temp != null || humi != null)
                    {
                        var now = DateTime.UtcNow;
                        var threshold = TimeSpan.FromMinutes(Math.Max(1, _opt.OnlineThresholdMinutes));

                        DateTime? lastConnUtc = dev.lastConnectionDateUtc == default
                            ? (DateTime?)null
                            : DateTime.SpecifyKind((DateTime)dev.lastConnectionDateUtc, DateTimeKind.Utc);

                        bool onlineByReading = ts.HasValue && (now - ts.Value) <= threshold;
                        bool onlineByLastConn = lastConnUtc.HasValue && (now - lastConnUtc.Value) <= threshold;

                        var statusText = (onlineByReading || onlineByLastConn) ? "Online" : "Offline";

                        await _status.UpsertLatestAsync(
                            dev.Id,
                            temp,
                            humi,
                            ts ?? now,
                            statusText,
                            dev.description
                        );

                        ok++;
                    }

                    done++;
                }
                catch (Exception ex)
                {
                    fail++; done++;
                    if (ex.Message.Contains("quota", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("503"))
                    {
                        quotaFails++;
                        _logger.LogWarning("Quota fail for {Serial}", dev.serialNumber);
                        if (quotaFails >= 3)
                        {
                            _logger.LogWarning("Too many quota fails — break this round early.");
                            break;
                        }
                    }
                    else
                    {
                        _logger.LogWarning(ex, "Ingest latest failed for {Serial}", dev.serialNumber);
                    }
                }

                await Task.Delay(200 + Random.Shared.Next(0, 200), ct);
            }

            _logger.LogInformation("LatestStatusSyncService: done={Done} ok={Ok} fail={Fail}", done, ok, fail);
        }
    }
}
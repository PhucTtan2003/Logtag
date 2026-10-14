using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace temperature_humi.Service.Reports
{
    public class MonthlyReportWorker : BackgroundService
    {
        private readonly MonthlyReportService _service;
        private readonly MonthlyReportOptions _opt;
        private readonly ILogger<MonthlyReportWorker> _log;

        public MonthlyReportWorker(
            MonthlyReportService service,
            IOptions<MonthlyReportOptions> opt,
            ILogger<MonthlyReportWorker> log)
        {
            _service = service;
            _opt = opt.Value;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_opt.Enabled)
            {
                _log.LogWarning("[MonthlyReport] Worker disabled");
                return;
            }

            var minutes = Math.Clamp(_opt.CheckEveryMinutes, 1, 1440);
            _log.LogInformation("[MonthlyReport] Worker started. CheckEveryMinutes={Minutes}", minutes);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await _service.ProcessDueReportsAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[MonthlyReport] Worker loop error");
                }

                await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken);
            }
        }
    }
}

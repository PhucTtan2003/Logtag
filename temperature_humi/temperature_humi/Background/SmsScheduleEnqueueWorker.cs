using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using temperature_humi.Service.SmsSchedule;

namespace temperature_humi.Background
{
    public class SmsScheduleEnqueueWorker : BackgroundService
    {
        private readonly SmsScheduleService _svc;
        private readonly SmsScheduleOptions _opt;
        private readonly ILogger<SmsScheduleEnqueueWorker> _log;

        public SmsScheduleEnqueueWorker(
            SmsScheduleService svc,
            IOptions<SmsScheduleOptions> opt,
            ILogger<SmsScheduleEnqueueWorker> log)
        {
            _svc = svc;
            _opt = opt.Value;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_opt.Enabled)
            {
                _log.LogWarning("[SmsScheduleEnqueue] Disabled");
                return;
            }

            _log.LogInformation("[SmsScheduleEnqueue] Started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await _svc.EnqueueDueJobsAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[SmsScheduleEnqueue] Loop error");
                }

                await Task.Delay(TimeSpan.FromSeconds(Math.Max(10, _opt.SchedulerIntervalSeconds)), stoppingToken);
            }
        }
    }
}

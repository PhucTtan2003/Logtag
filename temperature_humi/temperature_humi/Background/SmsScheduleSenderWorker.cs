using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using temperature_humi.Service.SmsSchedule;

namespace temperature_humi.Background
{
    public class SmsScheduleSenderWorker : BackgroundService
    {
        private readonly SmsScheduleService _svc;
        private readonly SmsScheduleOptions _opt;
        private readonly ILogger<SmsScheduleSenderWorker> _log;

        public SmsScheduleSenderWorker(
            SmsScheduleService svc,
            IOptions<SmsScheduleOptions> opt,
            ILogger<SmsScheduleSenderWorker> log)
        {
            _svc = svc;
            _opt = opt.Value;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_opt.Enabled)
            {
                _log.LogWarning("[SmsScheduleSender] Disabled");
                return;
            }

            _log.LogInformation("[SmsScheduleSender] Started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await _svc.ResetStuckProcessingJobsAsync(stoppingToken);

                    var batch = Math.Clamp(_opt.SenderBatchSize, 1, 50);
                    for (var i = 0; i < batch; i++)
                    {
                        var job = await _svc.TakeNextJobAsync(stoppingToken);
                        if (job == null) break;

                        await _svc.ProcessJobAsync(job, stoppingToken);

                        // giãn nhẹ từng SMS, tránh dồn request lên FPT
                        await Task.Delay(TimeSpan.FromMilliseconds(250), stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[SmsScheduleSender] Loop error");
                }

                await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, _opt.SenderIntervalSeconds)), stoppingToken);
            }
        }
    }
}

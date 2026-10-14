using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using temperature_humi.Infrastructure;

namespace temperature_humi.Background
{
    public sealed class EventIngestCacheWorker : BackgroundService
    {
        private readonly ILogger<EventIngestCacheWorker> _log;
        private readonly EventIngestProcessingCache _cache;

        public EventIngestCacheWorker(
            ILogger<EventIngestCacheWorker> log,
            EventIngestProcessingCache cache)
        {
            _log = log;
            _cache = cache;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _log.LogInformation("[EventIngestCacheWorker] started");
            await _cache.RunAsync(stoppingToken);
        }
    }
}

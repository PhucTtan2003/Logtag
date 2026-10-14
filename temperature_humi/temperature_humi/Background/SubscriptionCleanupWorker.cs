using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using System;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Models.CreateCode;
using Microsoft.Extensions.Options;
using temperature_humi.Data;
using temperature_humi.Helpers.Config;

public class SubscriptionCleanupWorker : BackgroundService
{
    private readonly ILogger<SubscriptionCleanupWorker> _logger;
    private readonly IMongoCollection<Subscription> _subs;
    private readonly int _deleteAfterDays;

    public SubscriptionCleanupWorker(
        ILogger<SubscriptionCleanupWorker> logger,
        IOptions<MongoDBSettings> mongo,
        IOptions<SubscriptionCleanupOptions> cleanupOptions)
    {
        _logger = logger;

        var client = new MongoClient(mongo.Value.ConnectionString);
        var db = client.GetDatabase(mongo.Value.DatabaseName);
        _subs = db.GetCollection<Subscription>("Subscriptions");

        // 🔥 Đọc số ngày từ appsettings.json
        _deleteAfterDays = cleanupOptions.Value.DeleteAfterDays <= 0
            ? 30
            : cleanupOptions.Value.DeleteAfterDays;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "SubscriptionCleanupWorker started. Cleanup after {days} days.",
            _deleteAfterDays);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var today = DateTime.UtcNow.Date;
                var threshold = today.AddDays(-_deleteAfterDays);

                var filter = Builders<Subscription>.Filter.Lte(x => x.EndsAtUtc, threshold);

                var result = await _subs.DeleteManyAsync(filter, cancellationToken: stoppingToken);

                if (result.DeletedCount > 0)
                {
                    _logger.LogWarning(
                        "Deleted {count} expired subscriptions older than {days} days.",
                        result.DeletedCount,
                        _deleteAfterDays
                    );
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SubscriptionCleanupWorker error");
            }

            await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
        }
    }
}

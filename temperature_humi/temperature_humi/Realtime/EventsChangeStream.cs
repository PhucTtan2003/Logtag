// Realtime/EventsChangeStream.cs
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Hubs;

public sealed class EventsChangeStream : BackgroundService
{
    private readonly IMongoCollection<Event> _col;
    private readonly IHubContext<LogTagHub> _hub;

    public EventsChangeStream(IOptions<MongoDBSettings> mongo, IHubContext<LogTagHub> hub)
    {
        var cli = new MongoClient(mongo.Value.ConnectionString);
        var db = cli.GetDatabase(mongo.Value.DatabaseName);
        _col = db.GetCollection<Event>("Events");
        _hub = hub;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            var pipeline = new EmptyPipelineDefinition<ChangeStreamDocument<Event>>()
                .Match(x => x.OperationType == ChangeStreamOperationType.Insert);

            var opt = new ChangeStreamOptions
            {
                FullDocument = ChangeStreamFullDocumentOption.WhenAvailable,
                BatchSize = 100,
                MaxAwaitTime = TimeSpan.FromSeconds(5)
            };

            using var cursor = await _col.WatchAsync(pipeline, opt, ct);

            while (!ct.IsCancellationRequested && await cursor.MoveNextAsync(ct))
            {
                foreach (var change in cursor.Current)
                {
                    var e = change.FullDocument;
                    if (e is null) continue;

                    await _hub.Clients.Group("Admin").SendAsync("event", e, ct);

                    // Nếu có phân nhóm theo serial/user, add ở đây
                    var serial = (e.serialNumber ?? "").Trim().ToUpperInvariant();
                    if (!string.IsNullOrEmpty(serial))
                        await _hub.Clients.Group($"serial:{serial}").SendAsync("event", e, ct);
                }
            }
        }
        catch
        {
            
            await PollingFallback(ct);
        }
    }

    private async Task PollingFallback(CancellationToken ct)
    {
        DateTime last = DateTime.UtcNow.AddMinutes(-5);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var list = await _col.Find(Builders<Event>.Filter.Gt(x => x.ingestedAtUtc, last))
                                     .SortBy(x => x.ingestedAtUtc)
                                     .Limit(500)
                                     .ToListAsync(ct);

                foreach (var e in list)
                {
                    await _hub.Clients.Group("Admin").SendAsync("event", e, ct);
                    var serial = (e.serialNumber ?? "").Trim().ToUpperInvariant();
                    if (!string.IsNullOrEmpty(serial))
                        await _hub.Clients.Group($"serial:{serial}").SendAsync("event", e, ct);

                    if (e.ingestedAtUtc > last) last = e.ingestedAtUtc;
                }
            }
            catch { /* bỏ qua tạm */ }

            try { await Task.Delay(3000, ct); } catch { }
        }
    }
}
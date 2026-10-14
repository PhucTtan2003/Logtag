using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Service
{
    public class AlertService
    {
        private readonly IMongoCollection<AlertModel> _alerts;

        #region Ctor
        public AlertService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var database = client.GetDatabase(settings.Value.DatabaseName);
            _alerts = database.GetCollection<AlertModel>("Alerts");
        }
        #endregion

        #region GetAlerts
        public async Task<List<AlertModel>> GetAlerts(List<ObjectId> deviceIds)
        {
            return await _alerts.Find(a => deviceIds.Contains(a.DeviceId))
                                .SortByDescending(a => a.Time)
                                .Limit(50)
                                .ToListAsync();
        }
        #endregion
    }
}
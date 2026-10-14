using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class LatestDeviceStatus
    {
        [BsonId]
        public ObjectId Id { get; set; }

        public string TeamId { get; set; } = string.Empty;
        public string SerialNumber { get; set; } = string.Empty;

        public DateTime LastDateUtc { get; set; }
        public double? LastTemperature { get; set; }
        public double? LastHumidity { get; set; }

        public bool IsOnline { get; set; }
        public string Status { get; set; } = "offline"; // online/offline

        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }
}

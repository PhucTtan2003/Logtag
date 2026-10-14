using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class LocationReadingHourly
    {
        [BsonId]
        public ObjectId Id { get; set; }

        public string TeamId { get; set; } = string.Empty;
        public string SerialNumber { get; set; } = string.Empty;

        /// <summary>
        /// Giờ bắt đầu theo UTC, ví dụ 2026-05-13T08:00:00Z.
        /// </summary>
        public DateTime BucketUtc { get; set; }

        public int Count { get; set; }

        public double? MinTemperature { get; set; }
        public double? MaxTemperature { get; set; }
        public double? AvgTemperature { get; set; }

        public double? MinHumidity { get; set; }
        public double? MaxHumidity { get; set; }
        public double? AvgHumidity { get; set; }

        public DateTime? FirstReadingUtc { get; set; }
        public DateTime? LastReadingUtc { get; set; }

        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }
}

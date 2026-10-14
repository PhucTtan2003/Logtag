using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Models
{
    [BsonIgnoreExtraElements] // ✅ Bỏ qua field không tồn tại trong model
    public class LocationReading
    {
        [BsonId]
        public ObjectId Id { get; set; }

        // 🔑 theo LogTag
        [BsonElement("serialNumber")]
        public string SerialNumber { get; set; } = "";

        [BsonElement("temperature")]
        public double Temperature { get; set; }

        // Có thể null tuỳ thiết bị/location
        [BsonElement("humidity")]
        [BsonIgnoreIfNull]
        public double? Humidity { get; set; }

        // Thời điểm đọc (UTC)
        [BsonElement("dateUtc")]
        public DateTime DateUtc { get; set; }

        // (tuỳ chọn) nếu bạn muốn lọc thêm sau này
        [BsonElement("teamId")]
        [BsonIgnoreIfNull]
        public string? TeamId { get; set; }

        // (tuỳ chọn) mở đường cho LTGEO readings
        [BsonElement("latitude")]
        [BsonIgnoreIfNull]
        public double? Latitude { get; set; }

        [BsonElement("longitude")]
        [BsonIgnoreIfNull]
        public double? Longitude { get; set; }

        [BsonElement("lux")]
        [BsonIgnoreIfNull]
        public double? Lux { get; set; }

        [BsonElement("shock")]
        [BsonIgnoreIfNull]
        public double? Shock { get; set; }
    }
}

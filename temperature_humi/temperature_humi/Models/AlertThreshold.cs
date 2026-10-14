using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public sealed class AlertThreshold
    {
        [BsonId] public ObjectId Id { get; set; }

        // Lưu đúng chuỗi serialNumber (ví dụ "A0A2001951U5-CH1")
        [BsonElement("serialNumber")]
        public string SerialNumber { get; set; } = "";

        [BsonElement("upperThreshold")]
        public double? UpperThreshold { get; set; }

        [BsonElement("lowerThreshold")]
        public double? LowerThreshold { get; set; }

        [BsonElement("updatedAtUtc")]
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

        // Optional
        [BsonElement("updatedBy")]
        public string? UpdatedBy { get; set; }
    }
}

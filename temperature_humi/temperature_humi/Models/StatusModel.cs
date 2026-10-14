using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Models
{
    public class StatusModel
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; }

        [BsonElement("deviceId")]
        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId DeviceId { get; set; }

        [BsonElement("status")]
        public string? Status { get; set; }

        [BsonElement("temperature")]
        public double? Temperature { get; set; }

        [BsonElement("humidity")]
        public double? Humidity { get; set; }

        [BsonElement("battery")]
        public string? Battery { get; set; }

        [BsonElement("timestamp")]
        public DateTime Timestamp { get; set; }

        [BsonElement("notes")]
        public string? Notes { get; set; } // ← cũng nên có luôn
    }
}
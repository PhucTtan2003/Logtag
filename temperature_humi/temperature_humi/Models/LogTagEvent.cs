using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class LogTagEvent
    {
        [BsonId] public ObjectId Id { get; set; }

        [BsonElement("teamId")] public long TeamId { get; set; }
        [BsonElement("serialNumber")] public string SerialNumber { get; set; } = "";

        [BsonElement("eventType")] public string EventType { get; set; } = "";   // vd: "Alarm", "Info", ...
        [BsonElement("eventMessage")] public string? EventMessage { get; set; }
        [BsonElement("eventValue")] public double? EventValue { get; set; }

        [BsonElement("eventTimeUtc")] public DateTime EventTimeUtc { get; set; }
        [BsonElement("createdAtUtc")] public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    }
}

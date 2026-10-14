// Domain/Event.cs
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

public class Event
{
    [BsonId] public ObjectId Id { get; set; }

    public string serialNumber { get; set; } = "";
    public string eventType { get; set; } = "";
    public DateTime eventTimeUtc { get; set; }

    // các trường tuỳ theo schema bạn đang có trong Events
    public double? alarmThreshold { get; set; }
    public double? alarmValue { get; set; }
    public int? alarmCount { get; set; }
    public string? batteryType { get; set; }

    public string source { get; set; } = "logtag";
    public DateTime ingestedAtUtc { get; set; } = DateTime.UtcNow;
}

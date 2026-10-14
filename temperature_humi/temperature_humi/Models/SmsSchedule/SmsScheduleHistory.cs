using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models.SmsSchedule
{
    public class SmsScheduleHistory
    {
        [BsonId]
        public ObjectId Id { get; set; }

        public ObjectId JobId { get; set; }
        public string RunKey { get; set; } = string.Empty;

        public ObjectId UserId { get; set; }
        public string SerialNumber { get; set; } = string.Empty;
        public string ScheduleTime { get; set; } = string.Empty;

        public List<string> Phones { get; set; } = new();
        public string Message { get; set; } = string.Empty;

        public double? Temperature { get; set; }
        public double? Humidity { get; set; }
        public DateTime? ReadingAtUtc { get; set; }

        public bool Sent { get; set; }
        public string? Error { get; set; }

        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime? SentAtUtc { get; set; }
    }
}

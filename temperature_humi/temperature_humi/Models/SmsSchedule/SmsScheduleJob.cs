using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models.SmsSchedule
{
    public class SmsScheduleJob
    {
        [BsonId]
        public ObjectId Id { get; set; }

        // Unique key chống tạo job trùng khi app restart / nhiều worker
        // Format: userId|serial|yyyyMMdd|HHmm
        public string RunKey { get; set; } = string.Empty;

        public ObjectId ConfigId { get; set; }
        public ObjectId UserId { get; set; }
        public string SerialNumber { get; set; } = string.Empty;
        public string ScheduleTime { get; set; } = string.Empty; // HH:mm

        public DateTime RunAtUtc { get; set; }

        // pending | processing | sent | failed
        public string Status { get; set; } = "pending";

        public int RetryCount { get; set; } = 0;
        public string? LastError { get; set; }

        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime? ProcessingAtUtc { get; set; }
        public DateTime? SentAtUtc { get; set; }
        public DateTime? FailedAtUtc { get; set; }
    }
}

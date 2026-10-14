using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models.SmsSchedule
{
    [BsonIgnoreExtraElements]
    public class SmsScheduleConfig
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId Id { get; set; }

        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId UserId { get; set; }

        // Giữ lại để đọc được document cũ trong MongoDB có field Username
        public string? Username { get; set; }

        public string SerialNumber { get; set; } = string.Empty;

        // VD: ["09:00", "16:00"] theo giờ Việt Nam/local app
        public List<string> ScheduleTimes { get; set; } = new();

        public bool Enabled { get; set; } = true;

        // Dùng để khóa: 1 ngày chỉ đổi 1 lần
        public string? LastChangedLocalDate { get; set; }
        public int ChangeCountToday { get; set; }
        public DateTime? LastChangedAtUtc { get; set; }

        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    }
}
// Models/EmployeeAccountDevice.cs
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class EmployeeAccountDevice
    {
        [BsonId] public ObjectId Id { get; set; }

        [BsonElement("userId")]
        public ObjectId UserId { get; set; }

        [BsonElement("teamId")]
        public long TeamId { get; set; }              // đã đổi sang long

        [BsonElement("serialNumber")]
        public string SerialNumber { get; set; } = default!;

        [BsonElement("notes")]
        public string? Notes { get; set; }

        [BsonElement("model")]
        public string? Model { get; set; }            // ← THÊM THUỘC TÍNH NÀY

        [BsonElement("assignedAtUtc")]
        public DateTime AssignedAtUtc { get; set; }
    }
}
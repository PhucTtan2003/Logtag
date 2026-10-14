// Models/AccountDevice.cs
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Models
{
    public class AccountDevice
    {
        [BsonId] public ObjectId Id { get; set; }

        [BsonElement("userId")] public ObjectId UserId { get; set; }
        [BsonElement("teamId")] public long TeamId { get; set; } = 0;
        [BsonElement("serialNumber")] public string SerialNumber { get; set; } = "";
        [BsonElement("notes")] public string? Notes { get; set; }
        [BsonElement("assignedAtUtc")] public DateTime AssignedAtUtc { get; set; } = DateTime.UtcNow;
    }
}

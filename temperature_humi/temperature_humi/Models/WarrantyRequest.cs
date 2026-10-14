using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Models
{
    public class WarrantyRequest
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; }
        public string DeviceId { get; set; } // ❌ bỏ BsonRepresentation(ObjectId)

        public string Title { get; set; }

        public string Content { get; set; }

        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId AssignedEmployeeId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        [BsonElement("isSeen")]
        public bool IsSeen { get; set; } 
    }
}

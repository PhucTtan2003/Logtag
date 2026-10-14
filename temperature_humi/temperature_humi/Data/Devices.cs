using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class Devices
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId Id { get; set; }

        [BsonElement("accountId")]
        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId AccountId { get; set; }

        [BsonElement("isActive")]
        public bool IsActive { get; set; }

        [BsonElement("notes")]
        public string Notes { get; set; }
    }
}

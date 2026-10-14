using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class AlertModel
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public ObjectId Id { get; set; }

        [BsonElement("deviceId")]
        public ObjectId DeviceId { get; set; }

        [BsonElement("message")]
        public string Message { get; set; }

        [BsonElement("time")]
        public DateTime Time { get; set; }

        [BsonElement("notes")]
        public string Notes { get; set; }  // hoặc name thiết bị
    }
}
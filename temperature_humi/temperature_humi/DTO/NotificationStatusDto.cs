using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.DTO
{
    public class NotificationStatusDto
    {
        [BsonElement("status")]
        public string Status { get; set; } = string.Empty;
    }
}

using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Data
{
    public class Parameter
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("deviceId")]
        public ObjectId DeviceId { get; set; }

        [BsonElement("temperature")]
        public double Temperature { get; set; }

        [BsonElement("humidity")]
        public double Humidity { get; set; }

        [BsonElement("createAt")]
        public DateTime CreateAt { get; set; }

        [BsonElement("modelId")]
        public int ModelId { get; set; }
    }
}

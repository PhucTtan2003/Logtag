using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Collections.Generic;

namespace temperature_humi.Data
{
    public class Conversation
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string? Id { get; set; }

        [BsonElement("customerId")]
        [BsonRepresentation(BsonType.ObjectId)]
        public string? CustomerId { get; set; }

        [BsonElement("title")]
        public string? Title { get; set; }

        [BsonElement("participants")]
        public List<string>? Participants { get; set; }

        [BsonElement("messages")]
        public List<string>? Messages { get; set; }
    }
}

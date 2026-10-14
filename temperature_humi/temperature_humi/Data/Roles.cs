using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models
{
    public class Role
    {
        [BsonId]
        public ObjectId Id { get; set; }
        [BsonElement("roleName")]
        public string RoleName { get; set; }
    }

}
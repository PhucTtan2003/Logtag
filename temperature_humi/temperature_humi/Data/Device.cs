using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Data
{
    public class Device
    {
        [BsonId]
        public ObjectId Id { get; set; }

        public long teamId { get; set; }
        public string serialNumber { get; set; }
        public string model { get; set; }
        public string description { get; set; }
        public string deviceState { get; set; }
        public DateTime? registrationDateUtc { get; set; }
        public DateTime? lastConnectionDateUtc { get; set; }
        public DateTime updatedAtUtc { get; set; }
    }
}

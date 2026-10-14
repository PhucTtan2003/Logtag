using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Models.SmsFpt
{
    public class SmsActivation
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("userId")]
        public ObjectId UserId { get; set; }

        [BsonElement("phone")]
        public string Phone { get; set; } = string.Empty;

        [BsonElement("licenseCode")]
        public string? LicenseCode { get; set; }

        [BsonElement("notes")]
        public string? Notes { get; set; }

        [BsonElement("activatedAtUtc")]
        public DateTime ActivatedAtUtc { get; set; }
    }
}

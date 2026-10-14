using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;

namespace temperature_humi.Models.CreateCode
{
    [BsonIgnoreExtraElements]
    public class Subscription
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonRepresentation(BsonType.ObjectId)]
        [BsonElement("userId")]
        public ObjectId UserId { get; set; }

        [BsonElement("plan")]
        public string Plan { get; set; } = "basic";

        [BsonElement("features")]
        public string[] Features { get; set; } = Array.Empty<string>();

        [BsonElement("startedAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime StartedAtUtc { get; set; }

        [BsonElement("endsAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime EndsAtUtc { get; set; }

        [BsonElement("source")]
        public SubscriptionSource? Source { get; set; }

        [BsonElement("createdAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime CreatedAtUtc { get; set; }

        // =========================
        // SMS QUOTA THEO ACCOUNT
        // =========================
        [BsonElement("smsQuotaTotal")]
        public int? SmsQuotaTotal { get; set; }

        [BsonElement("smsQuotaUsed")]
        public int SmsQuotaUsed { get; set; } = 0;

        [BsonElement("smsUnlimited")]
        public bool SmsUnlimited { get; set; } = false;

        [BsonElement("smsWarnAtRemaining")]
        public int? SmsWarnAtRemaining { get; set; }

        [BsonElement("smsLowQuotaWarned")]
        public bool SmsLowQuotaWarned { get; set; } = false;

        [BsonElement("smsLowQuotaWarnedAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime? SmsLowQuotaWarnedAtUtc { get; set; }

        [BsonElement("lastSmsSentAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime? LastSmsSentAtUtc { get; set; }

        [BsonIgnore]
        public bool IsActive => EndsAtUtc.Date >= DateTime.UtcNow.Date;

        [BsonIgnore]
        public int DaysLeft => Math.Max(0, (EndsAtUtc.Date - DateTime.UtcNow.Date).Days);

        [BsonIgnore]
        public int? SmsRemaining
        {
            get
            {
                if (SmsUnlimited) return null;
                if (!SmsQuotaTotal.HasValue) return 0;
                return Math.Max(0, SmsQuotaTotal.Value - SmsQuotaUsed);
            }
        }
    }

    [BsonIgnoreExtraElements]
    public class SubscriptionSource
    {
        [BsonElement("Type")]
        public string Type { get; set; } = "license_code";

        [BsonElement("Code")]
        public string? Code { get; set; }

        [BsonElement("Note")]
        public string? Note { get; set; }
    }
}

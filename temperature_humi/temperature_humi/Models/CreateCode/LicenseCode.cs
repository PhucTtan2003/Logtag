using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;
using System.Collections.Generic;

namespace temperature_humi.Models.CreateCode
{
    // 1 lần kích hoạt của 1 code
    public class LicenseActivation
    {
        [BsonElement("userId")]
        public ObjectId UserId { get; set; }

        [BsonElement("redeemedAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime RedeemedAtUtc { get; set; }
    }

    [BsonIgnoreExtraElements]
    public sealed class LicenseCode
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("code")]
        public string Code { get; set; } = default!;

        [BsonElement("plan")]
        public string Plan { get; set; } = "pro";

        private string[] _features = Array.Empty<string>();
        [BsonElement("features")]
        public string[] Features
        {
            get => _features;
            set => _features = value ?? Array.Empty<string>();
        }

        [BsonElement("durationDays")]
        public int DurationDays { get; set; } = 180;

        // Số lần code được kích hoạt, KHÔNG phải số lượng SMS
        [BsonElement("maxActivations")]
        public int MaxActivations { get; set; } = 1;

        // =========================
        // SMS QUOTA THEO CODE
        // =========================
        // Ví dụ: 1000, 10000. Nếu smsUnlimited=true thì để null.
        [BsonElement("smsQuotaTotal")]
        public int? SmsQuotaTotal { get; set; }

        [BsonElement("smsUnlimited")]
        public bool SmsUnlimited { get; set; } = false;

        // Cảnh báo khi còn <= số này. Ví dụ gói 1000 cảnh báo 100, gói 10000 cảnh báo 500.
        [BsonElement("smsWarnAtRemaining")]
        public int? SmsWarnAtRemaining { get; set; }

        [BsonElement("notes")]
        public string? Notes { get; set; }

        [BsonElement("createdAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

        [BsonElement("createdBy")]
        public ObjectId? CreatedBy { get; set; }

        [BsonElement("reservedForUserId")]
        public ObjectId? ReservedForUserId { get; set; }

        [BsonElement("reservedAtUtc")]
        [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
        public DateTime? ReservedAtUtc { get; set; }

        [BsonElement("reservedByAdminId")]
        public ObjectId? ReservedByAdminId { get; set; }

        private List<LicenseActivation> _activations = new();
        [BsonElement("activations")]
        public List<LicenseActivation> Activations
        {
            get => _activations;
            set => _activations = value ?? new List<LicenseActivation>();
        }

        [BsonIgnore]
        public int Used => Activations.Count;

        [BsonIgnore]
        public int Remaining => Math.Max(0, MaxActivations - Used);

        [BsonIgnore]
        public bool HasSlots => Remaining > 0;
    }
}

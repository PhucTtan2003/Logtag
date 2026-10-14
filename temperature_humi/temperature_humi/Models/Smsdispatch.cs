using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models.SmsFpt
{
    public static class SmsDispatchStatus
    {
        public const string Processing = "processing";
        public const string Sent = "sent";
        public const string Failed = "failed";
        public const string Unknown = "unknown";
    }

    /// <summary>
    /// Một bản ghi tương ứng với đúng một lần gửi SMS logic tới một số điện thoại.
    /// Unique IdempotencyKey chặn gửi trùng ngay cả khi VPS restart.
    /// </summary>
    public sealed class SmsDispatch
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("idempotencyKey")]
        public string IdempotencyKey { get; set; } = string.Empty;

        [BsonElement("sessionId")]
        public string SessionId { get; set; } = string.Empty;

        [BsonElement("userId")]
        [BsonIgnoreIfNull]
        public ObjectId? UserId { get; set; }

        [BsonElement("phone")]
        public string Phone { get; set; } = string.Empty;

        [BsonElement("eventType")]
        public string EventType { get; set; } = string.Empty;

        [BsonElement("serialNumber")]
        [BsonIgnoreIfNull]
        public string? SerialNumber { get; set; }

        [BsonElement("eventTimeUtc")]
        [BsonIgnoreIfNull]
        public DateTime? EventTimeUtc { get; set; }

        [BsonElement("messageHash")]
        public string MessageHash { get; set; } = string.Empty;

        [BsonElement("status")]
        public string Status { get; set; } = SmsDispatchStatus.Processing;

        [BsonElement("attempts")]
        public int Attempts { get; set; }

        [BsonElement("providerResponse")]
        [BsonIgnoreIfNull]
        public string? ProviderResponse { get; set; }

        [BsonElement("lastError")]
        [BsonIgnoreIfNull]
        public string? LastError { get; set; }

        [BsonElement("createdAtUtc")]
        public DateTime CreatedAtUtc { get; set; }

        [BsonElement("updatedAtUtc")]
        public DateTime UpdatedAtUtc { get; set; }

        [BsonElement("sentAtUtc")]
        [BsonIgnoreIfNull]
        public DateTime? SentAtUtc { get; set; }
    }
}

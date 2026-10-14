using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

public class DeviceRegistration
{
    [BsonId]
    public ObjectId Id { get; set; }

    public long TeamId { get; set; }
    public string SerialNumber { get; set; } = "";
    public string? Description { get; set; }

    public string? RequestedBy { get; set; }  // có thể là email hoặc ObjectId string

    public string Status { get; set; } = "Pending"; // Success | Failed
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }

    public BsonDocument? RawResponse { get; set; }  // giữ JSON gốc từ API

    public int Attempts { get; set; } = 1;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }
}
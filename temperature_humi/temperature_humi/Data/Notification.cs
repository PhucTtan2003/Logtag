using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

public class Notification
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;
    [BsonElement("message")]
    public string Message { get; set; } = string.Empty;

    [BsonElement("sentBy")]
    public ObjectId SentBy { get; set; }  // Tham chiếu tới _id của tài khoản gửi

    [BsonElement("sentTo")]
    public ObjectId? SentTo { get; set; } // null = gửi broadcast

    [BsonElement("sentAt")]
    public DateTime SentAt { get; set; }

    [BsonElement("isRead")]
    public bool IsRead { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = "Đang xử lý";  // Mặc định ban đầu
    [BsonExtraElements]
    public BsonDocument? ExtraElements { get; set; }
}

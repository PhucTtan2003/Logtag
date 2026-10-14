using MongoDB.Bson;

namespace temperature_humi.DTO
{
    public class NotificationDto
    {
        public string Title { get; set; }
        public string Message { get; set; }

        // Người gửi (Admin) -> có thể là ObjectId
        public string SentBy { get; set; }

        // Có thể null (gửi tất cả nhân viên)
        public List<string>? SentTo { get; set; }
    }
}

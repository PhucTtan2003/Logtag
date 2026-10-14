using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;
using System.Collections.Generic;

namespace temperature_humi.Models.Reports
{
    public class MonthlyReportSchedule
    {
        [BsonId]
        public ObjectId Id { get; set; }

        public ObjectId UserId { get; set; }

        // TeamId để quản trị/lọc theo team nếu sau này cần.
        public long TeamId { get; set; }

        public List<string> SerialNumbers { get; set; } = new();
        public List<string> Recipients { get; set; } = new();
        public List<string> Cc { get; set; } = new();

        public bool IsEnabled { get; set; } = true;

        // Hiện tại MVP chỉ monthly.
        public string Frequency { get; set; } = "monthly";

        // Gửi ngày mấy hàng tháng. Khuyến nghị: 1 để gửi báo cáo tháng trước.
        public int SendDayOfMonth { get; set; } = 1;

        // HH:mm theo TimeZoneId.
        public string SendTimeLocal { get; set; } = "08:00";

        // Linux dùng Asia/Ho_Chi_Minh. Windows fallback trong service.
        public string TimeZoneId { get; set; } = "Asia/Ho_Chi_Minh";

        // MVP dùng CSV. Sau này mở rộng: xlsx/pdf.
        public string Format { get; set; } = "csv";

        public bool IncludeSummary { get; set; } = true;
        public bool IncludeRawData { get; set; } = true;
        public bool IncludeAlerts { get; set; } = false;

        public string? Notes { get; set; }

        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAtUtc { get; set; }
    }
}

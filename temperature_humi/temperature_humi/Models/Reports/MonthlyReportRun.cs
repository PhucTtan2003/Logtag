using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;
using System.Collections.Generic;

namespace temperature_humi.Models.Reports
{
    public class MonthlyReportRun
    {
        [BsonId]
        public ObjectId Id { get; set; }

        public ObjectId ScheduleId { get; set; }
        public ObjectId UserId { get; set; }

        // Ví dụ: 2026-06
        public string PeriodKey { get; set; } = string.Empty;

        public DateTime FromUtc { get; set; }
        public DateTime ToUtc { get; set; }

        // pending | success | failed
        public string Status { get; set; } = "pending";

        public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime? FinishedAtUtc { get; set; }
        public DateTime? SentAtUtc { get; set; }

        public List<string> Recipients { get; set; } = new();
        public List<string> Cc { get; set; } = new();
        public List<string> AttachmentNames { get; set; } = new();

        public int TotalReadings { get; set; }
        public string? Error { get; set; }
    }
}

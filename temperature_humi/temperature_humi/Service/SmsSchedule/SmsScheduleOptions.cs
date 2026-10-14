namespace temperature_humi.Service.SmsSchedule
{
    public class SmsScheduleOptions
    {
        public bool Enabled { get; set; } = true;

        public string TimeZoneId { get; set; } = "Asia/Ho_Chi_Minh";

        public int SchedulerIntervalSeconds { get; set; } = 30;
        public int SenderIntervalSeconds { get; set; } = 1;

        // Số SMS report tối đa xử lý mỗi vòng, tránh dồn dập.
        public int SenderBatchSize { get; set; } = 5;

        public int MaxRetry { get; set; } = 3;

        // Nếu job processing bị treo quá số phút này thì reset lại pending.
        public int ProcessingTimeoutMinutes { get; set; } = 10;

        public int MaxTimesPerDay { get; set; } = 8;
    }
}

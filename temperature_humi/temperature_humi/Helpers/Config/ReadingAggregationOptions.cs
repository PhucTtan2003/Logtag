namespace temperature_humi.Helpers.Config
{
    public class ReadingAggregationOptions
    {
        public bool Enabled { get; set; } = true;

        /// <summary>
        /// Worker chạy lại sau bao nhiêu phút. 30 phút là đủ vì raw đã được poll mỗi 5 phút.
        /// </summary>
        public int IntervalMinutes { get; set; } = 30;

        /// <summary>
        /// Mỗi lần aggregate lại dữ liệu gần đây để bù trường hợp thiết bị/API upload trễ.
        /// </summary>
        public int LookbackHours { get; set; } = 48;

        /// <summary>
        /// Dùng để rebuild LatestDeviceStatus từ raw gần đây.
        /// </summary>
        public int LatestLookbackHours { get; set; } = 72;

        /// <summary>
        /// Thiết bị xem là online nếu reading cuối nằm trong khoảng này.
        /// </summary>
        public int OnlineThresholdMinutes { get; set; } = 30;
    }
}

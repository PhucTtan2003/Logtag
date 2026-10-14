namespace temperature_humi.Helpers.Config
{
    public class SmsEventOptions
    {
        public bool Enable { get; set; } = true;
        public int MinGapSeconds { get; set; } = 0;   // khoảng cách tối thiểu
        public int MaxPerHour { get; set; } = 5;
        public int MaxPerDay { get; set; } = 20;
        public string[] AllowedTypes { get; set; } = Array.Empty<string>();
        public string[] FallbackRecipients { get; set; } = Array.Empty<string>(); // dùng cho background
    }
}

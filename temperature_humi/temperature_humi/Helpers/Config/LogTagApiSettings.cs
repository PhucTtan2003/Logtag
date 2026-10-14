namespace temperature_humi.Helpers.Config
{
    public class LogTagApiSettings
    {
        public string BaseUrl { get; set; } = "";
        public string Email { get; set; } = "";
        public string Password { get; set; } = "";
        public long TeamId { get; set; }

        public bool EnableRegister { get; set; } = true;
        public bool SimulateRegister { get; set; } = false;

        // Các block sau KHÔNG bắt buộc có trong appsettings.
        // Nếu thiếu -> dùng default an toàn.
        public CacheTtlSettings? CacheTtlSeconds { get; set; }
        public RetrySettings? Retry { get; set; }

        // Helpers trả về default khi thiếu config
        public int TtlDevicesSec => CacheTtlSeconds?.Devices ?? 30;
        public int TtlTeamsSec => CacheTtlSeconds?.Teams ?? 120;
        public int TtlEventsSec => CacheTtlSeconds?.Events ?? 10;

        public int RetryMaxAttempts => Retry?.MaxAttempts ?? 3;
        public int RetryDefaultDelaySecs => Retry?.DefaultDelaySeconds ?? 2;
    }

    public class CacheTtlSettings
    {
        public int Devices { get; set; } = 30;
        public int Teams { get; set; } = 120;
        public int Events { get; set; } = 10;
    }

    public class RetrySettings
    {
        public int MaxAttempts { get; set; } = 3;
        public int DefaultDelaySeconds { get; set; } = 2;
    }
    public class LogTagApiSettingsMain : LogTagApiSettings { }
    public class LogTagApiSettingsLt5 : LogTagApiSettings { }
}

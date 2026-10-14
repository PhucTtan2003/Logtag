namespace temperature_humi.Service.Reports
{
    public class MonthlyReportOptions
    {
        public bool Enabled { get; set; } = true;

        // Worker kiểm tra lịch mỗi N phút.
        public int CheckEveryMinutes { get; set; } = 15;

        // Giới hạn số dòng mỗi serial trong một báo cáo để tránh file quá nặng.
        public int MaxRowsPerSerial { get; set; } = 200_000;
    }

    public class SmtpReportOptions
    {
        public bool Enabled { get; set; } = false;
        public string Host { get; set; } = string.Empty;
        public int Port { get; set; } = 587;
        public bool EnableSsl { get; set; } = true;
        public string UserName { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string FromEmail { get; set; } = string.Empty;
        public string FromName { get; set; } = "SmartTech LogTag";
    }
}

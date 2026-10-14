namespace temperature_humi.Models.SmsFpt
{
    public class FptSmsOptions
    {
        public string BaseUrl { get; set; } = "http://sandbox.sms.fpt.net";
        public string ClientId { get; set; } = "";
        public string ClientSecret { get; set; } = "";
        public string Scope { get; set; } = "send_brandname_otp send_brandname";
        public string DefaultBrandName { get; set; } = "";
        public bool UseSandbox { get; set; } = true;
        public int SendMaxAttempts { get; set; } = 3;
        public int RetryBaseDelaySeconds { get; set; } = 2;
        public int RetryMaxDelaySeconds { get; set; } = 10;

        // Retry có kiểm soát cho SmsEventNotifier.
        // Chỉ các lỗi được phân loại là retryable mới thử lại.
       
    }
}

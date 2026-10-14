namespace temperature_humi.Helpers.Config
{
    public class SubscriptionCleanupOptions
    {
        // Số ngày sau khi subscription hết hạn thì tự xoá
        public int DeleteAfterDays { get; set; } = 30; // default
    }
}

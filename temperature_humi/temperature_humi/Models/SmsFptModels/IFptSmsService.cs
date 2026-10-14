namespace temperature_humi.Models.SmsFpt
{
    public interface IFptSmsService
    {
        Task<string> GetTokenAsync(
            CancellationToken ct = default);

        // =============================================
        // CSKH - Domestic
        // =============================================

        // Hàm cũ - giữ để không làm vỡ các chỗ đang gọi hiện tại
        Task<object> SendDomesticAsync(
            string brandName,
            string phone,
            string plainTextMessage,
            CancellationToken ct = default);

        // Hàm mới - dùng cho idempotency
        // Cho phép truyền sessionId cố định từ SmsDispatch
        Task<object> SendDomesticAsync(
            string brandName,
            string phone,
            string plainTextMessage,
            string sessionId,
            CancellationToken ct = default);

        // =============================================
        // CSKH - International
        // =============================================
        Task<object> SendInternationalAsync(
            string brandName,
            string phoneIntl,
            string plainTextMessage,
            CancellationToken ct = default);

        // =============================================
        // Ads
        // =============================================
        Task<string> CreateCampaignAsync(
            string campaignName,
            string brandName,
            string message,
            DateTime scheduleTime,
            int quota,
            CancellationToken ct = default);

        Task<object> PushAdsAsync(
            string campaignCode,
            IEnumerable<string> phoneList,
            CancellationToken ct = default);

        Task<object> GetCampaignDetailAsync(
            string campaignCode,
            CancellationToken ct = default);

        Task<byte[]> GetAdsDlrCsvAsync(
            string campaignCode,
            CancellationToken ct = default);

        Task<object> GetAdsRecheckAsync(
            DateOnly from,
            DateOnly to,
            CancellationToken ct = default);
    }
}
// Models/ProfilesPollingSettings.cs
namespace temperature_humi.Helpers.Config
{
    public sealed class ProfilesPollingSettings
    {
        /// <summary> Bật/tắt worker </summary>
        public bool Enabled { get; set; } = true;

        /// <summary> Khoảng lặp (phút) — mặc định 15p </summary>
        public int PollIntervalMinutes { get; set; } = 15;

        /// <summary> TTL của cache "stale" (phút) để Controller dùng stale-on-fail </summary>
        public int StaleMinutes { get; set; } = 60;
        public List<long>? TeamIds { get; set; }
    }
}

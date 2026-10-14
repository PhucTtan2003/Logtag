using System;
using System.Collections.Generic;
using System.Linq;

namespace temperature_humi.Helpers.Config
{
    /// <summary>
    /// Cấu hình nhiều tài khoản LogTag.
    /// 1 account LogTag có thể quản lý nhiều TeamID.
    /// Backend dùng TeamID để chọn đúng account/token khi gọi LogTag API.
    /// </summary>
    public class LogTagAccountsOptions
    {
        public List<LogTagAccountItem> Accounts { get; set; } = new();

        public IEnumerable<LogTagAccountItem> EnabledAccounts()
            => Accounts.Where(x => x.Enabled);
    }

    public class LogTagAccountItem
    {
        /// <summary>
        /// Khóa nội bộ, ví dụ: main-smarttech, lt5-smarttech, customer-a.
        /// Không dùng dấu cách để tiện làm endpoint scheduler key.
        /// </summary>
        public string Key { get; set; } = string.Empty;

        public string Kind { get; set; } = "Main"; // Main | LT5 | Other
        public string BaseUrl { get; set; } = "https://logtagonline.com/api";
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public bool Enabled { get; set; } = true;
        public List<long> TeamIds { get; set; } = new();

        public bool EnableRegister { get; set; } = true;
        public bool SimulateRegister { get; set; } = false;
        public int TtlTeamsSec { get; set; } = 60;
        public int TtlDevicesSec { get; set; } = 60;
        public int TtlEventsSec { get; set; } = 60;
        public int RetryDefaultDelaySecs { get; set; } = 2;
        public int RetryMaxAttempts { get; set; } = 3;

        public bool HasTeam(long teamId)
            => TeamIds?.Contains(teamId) == true;
    }
}

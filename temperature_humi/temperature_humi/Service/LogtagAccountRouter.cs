using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using temperature_humi.Helpers.Config;

namespace temperature_humi.Service.LogtagService
{
    /// <summary>
    /// Router chọn đúng LogTag API client theo TeamID.
    /// Hỗ trợ mô hình: nhiều LogTag account -> mỗi account có nhiều TeamID.
    ///
    /// Mục tiêu:
    /// - Không gọi nhầm TeamID bằng sai tài khoản LogTag.
    /// - Vẫn tương thích LogTagApiMain / LogTagApiLt5 cũ.
    /// - Với account mới trong LogTagAccounts, tự tạo LogTagApiClient riêng và cache lại.
    /// </summary>
    public sealed class LogTagAccountRouter : IDisposable
    {
        private readonly IServiceProvider _sp;
        private readonly ILogger<LogTagAccountRouter> _log;
        private readonly IOptionsMonitor<LogTagAccountsOptions> _accounts;
        private readonly IOptionsMonitor<LogTagTeamRoutingOptions> _legacyRouting;
        private readonly LogTagApiClientMain _mainClient;
        private readonly LogTagApiClientLt5 _lt5Client;

        // key = account key đã normalize, value = LogTagApiClient riêng cho account đó.
        private readonly ConcurrentDictionary<string, LogTagApiClient> _dynamicClients = new(StringComparer.OrdinalIgnoreCase);
        private readonly IDisposable? _reloadSubscription;

        public LogTagAccountRouter(
            IServiceProvider sp,
            ILogger<LogTagAccountRouter> log,
            IOptionsMonitor<LogTagAccountsOptions> accounts,
            IOptionsMonitor<LogTagTeamRoutingOptions> legacyRouting,
            LogTagApiClientMain mainClient,
            LogTagApiClientLt5 lt5Client)
        {
            _sp = sp;
            _log = log;
            _accounts = accounts;
            _legacyRouting = legacyRouting;
            _mainClient = mainClient;
            _lt5Client = lt5Client;

            // Nếu appsettings reload, clear dynamic client để lần sau tạo lại bằng credential mới.
            _reloadSubscription = _accounts.OnChange(_ =>
            {
                _dynamicClients.Clear();
                _log.LogWarning("[LogTagRouter] LogTagAccounts config changed. Dynamic clients cache cleared.");
            });
        }

        /// <summary>
        /// Lấy client LogTag đúng theo TeamID.
        /// Nếu TeamID chưa được cấu hình ở LogTagAccounts/LogTagTeamRouting thì throw để tránh gọi nhầm Main account.
        /// </summary>
        public LogTagApiClient GetClientByTeamId(long teamId)
        {
            var route = Resolve(teamId);

            if (route.UseLegacyMain)
                return _mainClient;

            if (route.UseLegacyLt5)
                return _lt5Client;

            if (route.Account == null)
                throw new InvalidOperationException(
                    $"TeamId={teamId} chưa được khai báo trong LogTagAccounts hoặc LogTagTeamRouting.");

            var account = route.Account;
            var key = route.AccountKey;

            // Tương thích ngược: nếu account key là main/lt5 thì dùng client cũ đã đăng ký DI.
            if (IsMainKey(key)) return _mainClient;
            if (IsLt5Key(key)) return _lt5Client;

            return _dynamicClients.GetOrAdd(key, _ => CreateDynamicClient(account, key));
        }

        /// <summary>
        /// Lấy account key theo TeamID. Dùng để tạo endpoint scheduler key riêng theo account/team.
        /// </summary>
        public string GetAccountKeyByTeamId(long teamId)
        {
            var route = Resolve(teamId);

            if (!string.IsNullOrWhiteSpace(route.AccountKey))
                return route.AccountKey;

            if (route.UseLegacyMain) return "main";
            if (route.UseLegacyLt5) return "lt5";

            throw new InvalidOperationException(
                $"TeamId={teamId} chưa được khai báo trong LogTagAccounts hoặc LogTagTeamRouting.");
        }

        /// <summary>
        /// Build key cho EndpointScheduler.
        /// Ví dụ: logtag:account:customer-a:team:18001:locationreadings:v2:batch
        /// </summary>
        public string BuildEndpointKey(long teamId, string endpointName)
        {
            var accountKey = GetAccountKeyByTeamId(teamId);
            var endpoint = NormalizeEndpoint(endpointName);
            return $"logtag:account:{accountKey}:team:{teamId}:{endpoint}";
        }

        /// <summary>
        /// Lấy danh sách TeamID đang enabled.
        /// kind có thể là Main, LT5, Other. Nếu null thì lấy tất cả.
        /// Có merge cả LogTagAccounts mới và LogTagTeamRouting cũ để giai đoạn chuyển đổi không mất team.
        /// </summary>
        public IReadOnlyList<long> GetEnabledTeamIds(string? kind = null)
        {
            var result = new List<long>();

            var accounts = GetEnabledAccounts();
            foreach (var acc in accounts)
            {
                if (!KindMatches(acc.Kind, kind))
                    continue;

                foreach (var teamId in SafeTeams(acc.TeamIds))
                {
                    if (teamId > 0 && !result.Contains(teamId))
                        result.Add(teamId);
                }
            }

            // Fallback/merge từ config cũ.
            var legacy = _legacyRouting.CurrentValue;

            if (kind == null || string.Equals(kind, "Main", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var teamId in SafeTeams(legacy.MainTeams))
                {
                    if (teamId > 0 && !result.Contains(teamId))
                        result.Add(teamId);
                }
            }

            if (kind == null || string.Equals(kind, "LT5", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var teamId in SafeTeams(legacy.Lt5Teams))
                {
                    if (teamId > 0 && !result.Contains(teamId))
                        result.Add(teamId);
                }
            }

            return result;
        }

        public long? GetDefaultTeamId(string? kind = null)
        {
            var teams = GetEnabledTeamIds(kind);
            return teams.Count > 0 ? teams[0] : null;
        }

        /// <summary>
        /// Kiểm tra nhanh TeamID có nằm trong cấu hình không.
        /// </summary>
        public bool HasTeam(long teamId)
        {
            if (teamId <= 0) return false;
            try
            {
                Resolve(teamId);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private RouteResult Resolve(long teamId)
        {
            if (teamId <= 0)
                throw new ArgumentOutOfRangeException(nameof(teamId), "teamId phải lớn hơn 0.");

            var matchedAccounts = GetEnabledAccounts()
                .Where(a => a.HasTeam(teamId))
                .ToList();

            if (matchedAccounts.Count > 1)
            {
                _log.LogError(
                    "[LogTagRouter] TeamId={TeamId} bị khai báo trùng ở nhiều LogTagAccounts: {Accounts}",
                    teamId,
                    string.Join(",", matchedAccounts.Select(a => NormalizeAccountKey(a))));

                throw new InvalidOperationException(
                    $"TeamId={teamId} bị khai báo trùng ở nhiều LogTagAccounts. Vui lòng kiểm tra appsettings.json.");
            }

            if (matchedAccounts.Count == 1)
            {
                var account = matchedAccounts[0];
                var key = NormalizeAccountKey(account);

                if (string.IsNullOrWhiteSpace(key))
                    throw new InvalidOperationException(
                        $"LogTag account chứa TeamId={teamId} chưa có Key/Email hợp lệ.");

                return new RouteResult
                {
                    Account = account,
                    AccountKey = key
                };
            }

            // Fallback cho cấu hình cũ LogTagTeamRouting.
            var legacy = _legacyRouting.CurrentValue;
            if (SafeTeams(legacy.MainTeams).Contains(teamId))
            {
                return new RouteResult
                {
                    AccountKey = "main",
                    UseLegacyMain = true
                };
            }

            if (SafeTeams(legacy.Lt5Teams).Contains(teamId))
            {
                return new RouteResult
                {
                    AccountKey = "lt5",
                    UseLegacyLt5 = true
                };
            }

            _log.LogError(
                "[LogTagRouter] TeamId={TeamId} chưa có trong LogTagAccounts hoặc LogTagTeamRouting.",
                teamId);

            throw new InvalidOperationException(
                $"TeamId={teamId} chưa được cấu hình trong LogTagAccounts hoặc LogTagTeamRouting.");
        }

        private LogTagApiClient CreateDynamicClient(LogTagAccountItem account, string normalizedKey)
        {
            ValidateAccount(account, normalizedKey);

            var apiSettings = new LogTagApiSettings
            {
                BaseUrl = string.IsNullOrWhiteSpace(account.BaseUrl)
                    ? "https://logtagonline.com/api"
                    : account.BaseUrl.Trim(),
                Email = account.Email?.Trim() ?? string.Empty,
                Password = account.Password ?? string.Empty,
                TeamId = SafeTeams(account.TeamIds).First(x => x > 0),
                EnableRegister = account.EnableRegister,
                SimulateRegister = account.SimulateRegister,
                CacheTtlSeconds = new CacheTtlSettings
                {
                    Teams = account.TtlTeamsSec > 0 ? account.TtlTeamsSec : 120,
                    Devices = account.TtlDevicesSec > 0 ? account.TtlDevicesSec : 30,
                    Events = account.TtlEventsSec > 0 ? account.TtlEventsSec : 10
                },
                Retry = new RetrySettings
                {
                    MaxAttempts = account.RetryMaxAttempts > 0 ? account.RetryMaxAttempts : 3,
                    DefaultDelaySeconds = account.RetryDefaultDelaySecs > 0 ? account.RetryDefaultDelaySecs : 2
                }
            };

            _log.LogWarning(
                "[LogTagRouter] Creating dynamic LogTag client account={AccountKey}, kind={Kind}, teams={Teams}",
                normalizedKey,
                account.Kind,
                string.Join(",", SafeTeams(account.TeamIds)));

            try
            {
                // Yêu cầu LogTagApiClient base constructor nhận IOptions<LogTagApiSettings>
                // và các dependency khác có sẵn trong DI container.
                return ActivatorUtilities.CreateInstance<LogTagApiClient>(
                    _sp,
                    Options.Create(apiSettings));
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "[LogTagRouter] Không tạo được dynamic LogTagApiClient cho account={AccountKey}. " +
                    "Nếu LogTagApiClient constructor đang custom, hãy tạo subclass/register riêng cho account này.",
                    normalizedKey);

                throw;
            }
        }

        private static void ValidateAccount(LogTagAccountItem account, string normalizedKey)
        {
            if (account == null)
                throw new ArgumentNullException(nameof(account));

            if (string.IsNullOrWhiteSpace(normalizedKey))
                throw new InvalidOperationException("LogTagAccounts.Accounts[].Key không được để trống.");

            if (SafeTeams(account.TeamIds).All(x => x <= 0))
                throw new InvalidOperationException($"LogTag account '{normalizedKey}' chưa có TeamIds hợp lệ.");

            if (string.IsNullOrWhiteSpace(account.Email))
                throw new InvalidOperationException($"LogTag account '{normalizedKey}' chưa có Email.");

            if (string.IsNullOrWhiteSpace(account.Password))
                throw new InvalidOperationException($"LogTag account '{normalizedKey}' chưa có Password.");
        }

        private IEnumerable<LogTagAccountItem> GetEnabledAccounts()
            => _accounts.CurrentValue?.EnabledAccounts() ?? Enumerable.Empty<LogTagAccountItem>();

        private static bool KindMatches(string? accountKind, string? requestedKind)
        {
            if (string.IsNullOrWhiteSpace(requestedKind))
                return true;

            return string.Equals(
                (accountKind ?? string.Empty).Trim(),
                requestedKind.Trim(),
                StringComparison.OrdinalIgnoreCase);
        }

        private static IEnumerable<long> SafeTeams(IEnumerable<long>? teams)
            => teams ?? Enumerable.Empty<long>();

        private static string NormalizeAccountKey(LogTagAccountItem account)
        {
            var key = NormalizeKey(account.Key);
            if (!string.IsNullOrWhiteSpace(key)) return key;

            // Fallback để tránh key rỗng nếu admin quên khai báo Key.
            var emailKey = NormalizeKey(account.Email);
            if (!string.IsNullOrWhiteSpace(emailKey)) return emailKey;

            return string.Empty;
        }

        private static string NormalizeKey(string? key)
        {
            key = (key ?? string.Empty).Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(key)) return string.Empty;
            return Regex.Replace(key, "[^a-z0-9_-]+", "-").Trim('-');
        }

        private static string NormalizeEndpoint(string? endpointName)
        {
            endpointName = (endpointName ?? string.Empty).Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(endpointName)) return "unknown";

            // Giữ dấu ':' để match đúng rule như locationreadings:v2:batch.
            endpointName = endpointName.Replace("/", ":").Replace("\\", ":");
            endpointName = Regex.Replace(endpointName, "[^a-z0-9:_-]+", "-").Trim('-', ':');
            return string.IsNullOrWhiteSpace(endpointName) ? "unknown" : endpointName;
        }

        private static bool IsMainKey(string key)
            => key is "main" or "main-smarttech" or "logtag-main";

        private static bool IsLt5Key(string key)
            => key is "lt5" or "lt5-smarttech" or "logtag-lt5";

        public void Dispose()
        {
            _reloadSubscription?.Dispose();
        }

        private sealed class RouteResult
        {
            public LogTagAccountItem? Account { get; set; }
            public string AccountKey { get; set; } = string.Empty;
            public bool UseLegacyMain { get; set; }
            public bool UseLegacyLt5 { get; set; }
        }
    }
}

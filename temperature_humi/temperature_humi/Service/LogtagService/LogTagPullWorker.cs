// Services/LogTagPullWorker.cs
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace temperature_humi.Service.LogtagService
{
    /// <summary>
    /// Kéo Events API v1 theo từng serial của các tài khoản LogTag loại Main.
    ///
    /// Quan trọng:
    /// - Dùng LogTagAccountRouter để chọn đúng account theo TeamId.
    /// - Không dùng LogTagClientRouter legacy vì router cũ chỉ phù hợp cấu hình Main/LT5 đơn.
    /// - Không xử lý team LT5 tại đây; LT5EventPullWorker phụ trách riêng.
    /// </summary>
    public sealed class LogTagPullWorker : BackgroundService
    {
        private readonly LogTagAccountRouter _router;
        private readonly AccountDeviceService _accountDevices;
        private readonly EventService _events;
        private readonly IOptionsMonitor<LogTagTeamRoutingOptions> _routing;
        private readonly ILogger<LogTagPullWorker> _log;

        // Events API chỉ cho phép khoảng thời gian tối đa khoảng một tháng.
        private static readonly TimeSpan MaxApiWindow =
            TimeSpan.FromDays(29).Add(TimeSpan.FromHours(23));

        private static readonly TimeSpan InitialBackfill = TimeSpan.FromDays(29);
        private static readonly TimeSpan Overlap = TimeSpan.FromMinutes(1);

        // Không chạy sát thời điểm các worker khác vừa khởi động.
        private static readonly TimeSpan StartupJitterMin = TimeSpan.FromSeconds(3);
        private static readonly TimeSpan StartupJitterMax = TimeSpan.FromSeconds(8);

        private static readonly TimeSpan LoopInterval = TimeSpan.FromSeconds(10);

        // Giảm số request đồng thời để tránh nhiều serial cùng xin token/call Events API.
        private const int MaxParallelism = 2;
        private const int MaxSerialsPerLoop = 8;

        private static readonly TimeSpan HitSpacing = TimeSpan.FromMinutes(1);
        private static readonly TimeSpan IdleSpacing = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan QuotaBackoff = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan AuthBackoff = TimeSpan.FromHours(6);

        private const int MaxErrorFactor = 6;

        // key = "{teamId}|{SERIAL}"
        private readonly ConcurrentDictionary<string, DateTime> _nextAllowedUtc =
            new(StringComparer.Ordinal);

        private readonly ConcurrentDictionary<string, int> _consecutiveErrors =
            new(StringComparer.Ordinal);

        public LogTagPullWorker(
            LogTagAccountRouter router,
            AccountDeviceService accountDevices,
            EventService events,
            IOptionsMonitor<LogTagTeamRoutingOptions> routing,
            ILogger<LogTagPullWorker> log)
        {
            _router = router;
            _accountDevices = accountDevices;
            _events = events;
            _routing = routing;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            var jitter = TimeSpan.FromMilliseconds(Random.Shared.Next(
                (int)StartupJitterMin.TotalMilliseconds,
                (int)StartupJitterMax.TotalMilliseconds));

            await DelaySafe(jitter, ct);

            _log.LogInformation(
                "[PULL] LogTagPullWorker started. Router=LogTagAccountRouter, MainTeams=[{Teams}]",
                string.Join(",", GetMainTeamIds()));

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var pairs = await LoadTeamSerialPairsAsync(ct);

                    if (pairs.Count == 0)
                    {
                        _log.LogDebug(
                            "[PULL] No AccountDevice serial mappings for enabled Main teams.");
                    }
                    else
                    {
                        var now = DateTime.UtcNow;

                        var eligible = pairs
                            .Where(p =>
                            {
                                var key = MakeKey(p.TeamId, p.Serial);
                                return !_nextAllowedUtc.TryGetValue(key, out var next)
                                    || now >= next;
                            })
                            .OrderBy(p =>
                                _nextAllowedUtc.TryGetValue(
                                    MakeKey(p.TeamId, p.Serial),
                                    out var next)
                                    ? next
                                    : DateTime.MinValue)
                            .Take(MaxSerialsPerLoop)
                            .ToList();

                        if (eligible.Count > 0)
                        {
                            using var gate = new SemaphoreSlim(MaxParallelism);

                            var tasks = eligible
                                .Select(p => WorkOneAsync(
                                    p.TeamId,
                                    p.Serial,
                                    gate,
                                    ct))
                                .ToList();

                            await Task.WhenAll(tasks);
                        }
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[PULL] Worker loop failed.");
                }

                await DelaySafe(LoopInterval, ct);
            }

            _log.LogInformation("[PULL] LogTagPullWorker stopped.");
        }

        private async Task<List<(long TeamId, string Serial)>> LoadTeamSerialPairsAsync(
            CancellationToken ct)
        {
            var result = new List<(long TeamId, string Serial)>();

            foreach (var teamId in GetMainTeamIds())
            {
                ct.ThrowIfCancellationRequested();

                try
                {
                    // Validate account mapping trước khi lấy serial.
                    _ = _router.GetClientByTeamId(teamId);

                    var maps = await _accountDevices.GetMapsByTeamAsync(teamId, ct);

                    var serials = maps
                        .Select(x => NormalizeSerial(x.SerialNumber))
                        .Where(x => !string.IsNullOrWhiteSpace(x))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    foreach (var serial in serials)
                        result.Add((teamId, serial));
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _log.LogError(
                        ex,
                        "[PULL] Cannot load mappings/client for Team={TeamId}.",
                        teamId);
                }
            }

            return result
                .Distinct(new TeamSerialComparer())
                .ToList();
        }

        private async Task WorkOneAsync(
            long teamId,
            string serial,
            SemaphoreSlim gate,
            CancellationToken ct)
        {
            await gate.WaitAsync(ct);

            var stateKey = MakeKey(teamId, serial);
            var accountKey = GetAccountKeySafe(teamId);

            try
            {
                // Điểm sửa chính: lấy client multi-account đúng theo TeamId.
                var client = _router.GetClientByTeamId(teamId);

                var lastEventUtc = await _events.GetLastEventTimeUtcAsync(serial, ct);
                var endUtc = ToUtcSecond(DateTime.UtcNow);
                var startUtc = CalculateSafeStart(lastEventUtc, endUtc);

                if (startUtc >= endUtc)
                    startUtc = endUtc.AddMinutes(-5);

                var response = await client.GetEventsAsync(
                    serial,
                    startUtc,
                    endUtc,
                    ct);

                var apiCount = response.data?.Count ?? 0;
                var inserted = await _events.SaveNewEventsAsync(serial, response, ct);

                _consecutiveErrors[stateKey] = 0;

                var spacing = inserted > 0
                    ? HitSpacing
                    : IdleSpacing;

                _nextAllowedUtc[stateKey] =
                    DateTime.UtcNow + spacing + Jitter();

                _log.LogDebug(
                    "[PULL] Team={TeamId}, Account={AccountKey}, Serial={Serial}, Api={ApiCount}, Inserted={Inserted}, Next={Next:o}",
                    teamId,
                    accountKey,
                    serial,
                    apiCount,
                    inserted,
                    _nextAllowedUtc[stateKey]);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Application shutdown.
            }
            catch (Exception ex) when (IsQuotaError(ex))
            {
                _consecutiveErrors[stateKey] = MaxErrorFactor;
                _nextAllowedUtc[stateKey] =
                    DateTime.UtcNow + QuotaBackoff + Jitter();

                _log.LogWarning(
                    ex,
                    "[PULL] QUOTA. Team={TeamId}, Account={AccountKey}, Serial={Serial}. Backoff until {Next:o}",
                    teamId,
                    accountKey,
                    serial,
                    _nextAllowedUtc[stateKey]);
            }
            catch (Exception ex) when (IsAuthorizationError(ex))
            {
                _consecutiveErrors[stateKey] = MaxErrorFactor;
                _nextAllowedUtc[stateKey] =
                    DateTime.UtcNow + AuthBackoff + Jitter();

                _log.LogWarning(
                    ex,
                    "[PULL] AUTH/UNAVAILABLE. Team={TeamId}, Account={AccountKey}, Serial={Serial}. Backoff until {Next:o}",
                    teamId,
                    accountKey,
                    serial,
                    _nextAllowedUtc[stateKey]);
            }
            catch (Exception ex) when (IsDateRangeError(ex))
            {
                _nextAllowedUtc[stateKey] =
                    DateTime.UtcNow + MaxBackoff + Jitter();

                _log.LogWarning(
                    ex,
                    "[PULL] DATE-RANGE rejected after clamp. Team={TeamId}, Account={AccountKey}, Serial={Serial}. Backoff until {Next:o}",
                    teamId,
                    accountKey,
                    serial,
                    _nextAllowedUtc[stateKey]);
            }
            catch (Exception ex)
            {
                var errorCount = _consecutiveErrors.AddOrUpdate(
                    stateKey,
                    1,
                    (_, current) => Math.Min(current + 1, MaxErrorFactor));

                var backoffSeconds = Math.Min(
                    5 * Math.Pow(2, errorCount - 1),
                    MaxBackoff.TotalSeconds);

                _nextAllowedUtc[stateKey] =
                    DateTime.UtcNow
                    + TimeSpan.FromSeconds(backoffSeconds)
                    + Jitter();

                _log.LogError(
                    ex,
                    "[PULL] ERROR({ErrorCount}). Team={TeamId}, Account={AccountKey}, Serial={Serial}. Backoff until {Next:o}",
                    errorCount,
                    teamId,
                    accountKey,
                    serial,
                    _nextAllowedUtc[stateKey]);
            }
            finally
            {
                gate.Release();
            }
        }

        private IReadOnlyList<long> GetMainTeamIds()
        {
            var ids = new List<long>();

            // Nguồn chuẩn: các account Enabled có Kind=Main trong LogTagAccounts.
            try
            {
                ids.AddRange(_router.GetEnabledTeamIds("Main"));
            }
            catch (Exception ex)
            {
                _log.LogWarning(
                    ex,
                    "[PULL] Cannot read Main teams from LogTagAccounts. Falling back to LogTagTeamRouting.MainTeams.");
            }

            // Chỉ fallback khi LogTagAccounts chưa có team Main.
            if (ids.Count == 0)
            {
                var routing = _routing.CurrentValue;

                if (routing?.MainTeams != null)
                    ids.AddRange(routing.MainTeams);
            }

            // Không thêm Lt5Teams tại đây.
            return ids
                .Where(x => x > 0)
                .Distinct()
                .OrderBy(x => x)
                .ToList();
        }

        private string GetAccountKeySafe(long teamId)
        {
            try
            {
                return _router.GetAccountKeyByTeamId(teamId);
            }
            catch
            {
                return "unknown";
            }
        }

        private static DateTime CalculateSafeStart(
            DateTime? lastEventUtc,
            DateTime endUtc)
        {
            DateTime startUtc;

            if (lastEventUtc.HasValue)
            {
                var last = ToUtcSecond(lastEventUtc.Value);

                startUtc = last > endUtc
                    ? endUtc.AddMinutes(-5)
                    : last - Overlap;
            }
            else
            {
                startUtc = endUtc - InitialBackfill;
            }

            var minimumStart = endUtc - MaxApiWindow;

            if (startUtc < minimumStart)
                startUtc = minimumStart;

            startUtc = ToUtcSecond(startUtc);

            if (startUtc >= endUtc)
                startUtc = ToUtcSecond(endUtc.AddMinutes(-5));

            return startUtc;
        }

        private static DateTime ToUtcSecond(DateTime value)
        {
            if (value.Kind == DateTimeKind.Unspecified)
                value = DateTime.SpecifyKind(value, DateTimeKind.Utc);
            else
                value = value.ToUniversalTime();

            var ticks = value.Ticks -
                        value.Ticks % TimeSpan.TicksPerSecond;

            return new DateTime(ticks, DateTimeKind.Utc);
        }

        private static string NormalizeSerial(string? serial)
            => (serial ?? string.Empty)
                .Trim()
                .ToUpperInvariant();

        private static string MakeKey(long teamId, string serial)
            => $"{teamId}|{serial}";

        private static TimeSpan Jitter()
            => TimeSpan.FromMilliseconds(Random.Shared.Next(250, 1250));

        private static bool IsQuotaError(Exception ex)
        {
            var text = ex.ToString();

            return text.Contains("TooManyRequests", StringComparison.OrdinalIgnoreCase)
                || text.Contains("too many requests", StringComparison.OrdinalIgnoreCase)
                || text.Contains("quota exceeded", StringComparison.OrdinalIgnoreCase)
                || text.Contains("ServiceUnavailable", StringComparison.OrdinalIgnoreCase)
                || text.Contains("503", StringComparison.OrdinalIgnoreCase)
                || text.Contains("429", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsDateRangeError(Exception ex)
        {
            var text = ex.ToString();

            return text.Contains(
                       "Date range must be within 1 month",
                       StringComparison.OrdinalIgnoreCase)
                || text.Contains(
                       "within 1 month",
                       StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsAuthorizationError(Exception ex)
        {
            var text = ex.ToString();

            return text.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Forbidden", StringComparison.OrdinalIgnoreCase)
                || text.Contains("not authorized", StringComparison.OrdinalIgnoreCase)
                || text.Contains("does not have permissions", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Authorization", StringComparison.OrdinalIgnoreCase)
                || text.Contains("invalid or unavailable", StringComparison.OrdinalIgnoreCase)
                || text.Contains("401", StringComparison.OrdinalIgnoreCase)
                || text.Contains("403", StringComparison.OrdinalIgnoreCase);
        }

        private static async Task DelaySafe(
            TimeSpan delay,
            CancellationToken ct)
        {
            if (delay <= TimeSpan.Zero)
                return;

            try
            {
                await Task.Delay(delay, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Application shutdown.
            }
        }

        private sealed class TeamSerialComparer
            : IEqualityComparer<(long TeamId, string Serial)>
        {
            public bool Equals(
                (long TeamId, string Serial) x,
                (long TeamId, string Serial) y)
            {
                return x.TeamId == y.TeamId
                    && string.Equals(
                        x.Serial,
                        y.Serial,
                        StringComparison.OrdinalIgnoreCase);
            }

            public int GetHashCode((long TeamId, string Serial) value)
            {
                return HashCode.Combine(
                    value.TeamId,
                    value.Serial?.ToUpperInvariant());
            }
        }
    }
}
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using temperature_humi.Data;
using temperature_humi.Helpers.Config;
using temperature_humi.Models;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Background
{
    public sealed class ExternalDeviceDto
    {
        [JsonPropertyName("serialNumber")]
        public string SerialNumber { get; set; } = "";

        [JsonPropertyName("model")]
        public string? Model { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("deviceState")]
        public string? DeviceState { get; set; }

        [JsonPropertyName("registrationDateUtc")]
        public DateTime? RegistrationDateUtc { get; set; }

        [JsonPropertyName("lastConnectionDateUtc")]
        public DateTime? LastConnectionDateUtc { get; set; }

        [JsonPropertyName("teamId")]
        public long? TeamId { get; set; }
    }

    /// <summary>
    /// Đồng bộ danh sách thiết bị từ từng LogTag account/team vào collection Devices.
    ///
    /// Các nguyên tắc:
    /// - Chọn đúng LogTag client theo TeamId bằng LogTagAccountRouter.
    /// - Ép thiết bị lưu đúng TeamId đang đồng bộ.
    /// - Đọc được cả response array trực tiếp và response envelope lồng data/items/devices/result.
    /// - Backoff riêng từng team khi gặp 403 hoặc quota để tránh làm ảnh hưởng account khác.
    /// </summary>
    public sealed class DevicesSyncWorker : BackgroundService
    {
        private readonly ILogger<DevicesSyncWorker> _log;
        private readonly DeviceService _devices;
        private readonly LogTagAccountRouter _logtagRouter;
        private readonly IOptionsMonitor<DeviceSyncOptions> _options;

        private readonly ConcurrentDictionary<long, SemaphoreSlim> _teamLocks = new();
        private readonly ConcurrentDictionary<long, DateTime> _blockedUntilUtc = new();

        private static readonly TimeSpan InterTeamDelay = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan QuotaBackoff = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan ForbiddenBackoff = TimeSpan.FromHours(6);
        private static readonly TimeSpan GeneralErrorBackoff = TimeSpan.FromMinutes(2);

        public DevicesSyncWorker(
            ILogger<DevicesSyncWorker> log,
            DeviceService devices,
            LogTagAccountRouter logtagRouter,
            IOptionsMonitor<DeviceSyncOptions> options)
        {
            _log = log;
            _devices = devices;
            _logtagRouter = logtagRouter;
            _options = options;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var config = _options.CurrentValue;

            if (!config.Enabled)
            {
                _log.LogInformation(
                    "[DeviceSync] Disabled. Set DeviceSync:Enabled=true to synchronize team devices.");
                return;
            }

            var teams = ResolveTeamIds();

            if (teams.Count == 0)
            {
                _log.LogWarning(
                    "[DeviceSync] No TeamIds found in DeviceSync or LogTagAccounts.");
                return;
            }

            var interval = TimeSpan.FromMinutes(
                Math.Max(1, config.IntervalMinutes));

            _log.LogInformation(
                "[DeviceSync] Started. Interval={IntervalMinutes}m, Teams=[{Teams}]",
                interval.TotalMinutes,
                string.Join(",", teams));

            // Tránh khởi động đúng lúc ProfilesPolling và ReadingsPolling cùng xin token.
            await DelaySafe(
                TimeSpan.FromSeconds(Random.Shared.Next(4, 9)),
                stoppingToken);

            await RunOnceForAllTeams(stoppingToken);

            using var timer = new PeriodicTimer(interval);

            try
            {
                while (await timer.WaitForNextTickAsync(stoppingToken))
                {
                    await RunOnceForAllTeams(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Application shutdown.
            }

            _log.LogInformation("[DeviceSync] Stopped.");
        }

        private async Task RunOnceForAllTeams(CancellationToken ct)
        {
            var teams = ResolveTeamIds();

            foreach (var teamId in teams)
            {
                ct.ThrowIfCancellationRequested();

                if (_blockedUntilUtc.TryGetValue(teamId, out var blockedUntil)
                    && DateTime.UtcNow < blockedUntil)
                {
                    _log.LogDebug(
                        "[DeviceSync] Skip Team={TeamId}; blocked until {BlockedUntil:o}.",
                        teamId,
                        blockedUntil);
                    continue;
                }

                await SyncTeamAsync(teamId, ct);
                await DelaySafe(InterTeamDelay, ct);
            }
        }

        private List<long> ResolveTeamIds()
        {
            var ids = new List<long>();
            var configuredTeams = _options.CurrentValue.TeamIds;

            if (configuredTeams is { Count: > 0 })
            {
                ids.AddRange(configuredTeams.Where(x => x > 0));
            }
            else
            {
                try
                {
                    ids.AddRange(_logtagRouter.GetEnabledTeamIds());
                }
                catch (Exception ex)
                {
                    _log.LogWarning(
                        ex,
                        "[DeviceSync] Cannot load enabled teams from LogTagAccounts.");
                }
            }

            return ids
                .Where(x => x > 0)
                .Distinct()
                .OrderBy(x => x)
                .ToList();
        }

        /// <summary>
        /// Cho phép controller/admin gọi đồng bộ một team ngay lập tức nếu cần.
        /// </summary>
        public async Task<(int upserts, int total)> SyncTeamAsync(
            long teamId,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                return (0, 0);

            var gate = _teamLocks.GetOrAdd(
                teamId,
                _ => new SemaphoreSlim(1, 1));

            await gate.WaitAsync(ct);

            try
            {
                var accountKey = GetAccountKeySafe(teamId);
                var client = _logtagRouter.GetClientByTeamId(teamId);

                _log.LogInformation(
                    "[DeviceSync] Sync Team={TeamId}, Account={AccountKey}.",
                    teamId,
                    accountKey);

                var raw = await client.GetDevicesRawAsync(teamId, ct);
                var apiDevices = ParseDevices(raw);

                if (apiDevices.Count == 0)
                {
                    _log.LogWarning(
                        "[DeviceSync] Team={TeamId}, Account={AccountKey}: API returned/parsing produced 0 devices. Raw={Raw}",
                        teamId,
                        accountKey,
                        Shorten(raw, 500));

                    return (0, 0);
                }

                var normalizedDevices = apiDevices
                    .Where(x => !string.IsNullOrWhiteSpace(x.SerialNumber))
                    .Select(x => new ExternalDeviceDto
                    {
                        SerialNumber = NormalizeSerial(x.SerialNumber),
                        Model = NullIfWhiteSpace(x.Model),
                        Description = NullIfWhiteSpace(x.Description),
                        DeviceState = NormalizeState(x.DeviceState),
                        RegistrationDateUtc = ToUtcNullable(x.RegistrationDateUtc),
                        LastConnectionDateUtc = ToUtcNullable(x.LastConnectionDateUtc),

                        // Endpoint đã được gọi theo teamId cụ thể.
                        // Không tin teamId=0/sai trong payload upstream.
                        TeamId = teamId
                    })
                    .GroupBy(
                        x => x.SerialNumber,
                        StringComparer.OrdinalIgnoreCase)
                    .Select(g => g.First())
                    .ToList();

                var upserts = 0;

                foreach (var item in normalizedDevices)
                {
                    ct.ThrowIfCancellationRequested();

                    var model = new Device
                    {
                        serialNumber = item.SerialNumber,
                        model = item.Model,
                        description = item.Description,
                        deviceState = item.DeviceState,
                        registrationDateUtc = item.RegistrationDateUtc,
                        lastConnectionDateUtc = item.LastConnectionDateUtc,
                        teamId = teamId,
                        updatedAtUtc = DateTime.UtcNow
                    };

                    await _devices.UpsertBySerialAsync(model);
                    upserts++;
                }

                _blockedUntilUtc.TryRemove(teamId, out _);

                _log.LogInformation(
                    "[DeviceSync] DONE Team={TeamId}, Account={AccountKey}, Api={ApiCount}, Upserted={Upserts}.",
                    teamId,
                    accountKey,
                    apiDevices.Count,
                    upserts);

                return (upserts, apiDevices.Count);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                var accountKey = GetAccountKeySafe(teamId);
                var backoff = ResolveBackoff(ex);

                _blockedUntilUtc[teamId] =
                    DateTime.UtcNow + backoff;

                _log.LogError(
                    ex,
                    "[DeviceSync] FAILED Team={TeamId}, Account={AccountKey}. Backoff={BackoffMinutes}m, RetryAfter={RetryAfter:o}.",
                    teamId,
                    accountKey,
                    backoff.TotalMinutes,
                    _blockedUntilUtc[teamId]);

                return (0, 0);
            }
            finally
            {
                gate.Release();
            }
        }

        private List<ExternalDeviceDto> ParseDevices(string? raw)
        {
            var result = new List<ExternalDeviceDto>();

            if (string.IsNullOrWhiteSpace(raw)
                || string.Equals(
                    raw.Trim(),
                    "null",
                    StringComparison.OrdinalIgnoreCase))
            {
                return result;
            }

            try
            {
                using var document = JsonDocument.Parse(raw);
                CollectDeviceObjects(document.RootElement, result, depth: 0);
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "[DeviceSync] Device JSON parsing failed. Raw={Raw}",
                    Shorten(raw, 500));
            }

            return result
                .Where(x => !string.IsNullOrWhiteSpace(x.SerialNumber))
                .GroupBy(
                    x => NormalizeSerial(x.SerialNumber),
                    StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .ToList();
        }

        private static void CollectDeviceObjects(
            JsonElement element,
            List<ExternalDeviceDto> output,
            int depth)
        {
            if (depth > 8)
                return;

            if (element.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in element.EnumerateArray())
                {
                    CollectDeviceObjects(item, output, depth + 1);
                }

                return;
            }

            if (element.ValueKind != JsonValueKind.Object)
                return;

            if (TryReadDevice(element, out var device))
            {
                output.Add(device);
                return;
            }

            // LogTag/API gateway có thể bọc danh sách qua nhiều tầng:
            // data -> devices, result -> items, v.v.
            foreach (var property in element.EnumerateObject())
            {
                if (property.Value.ValueKind is JsonValueKind.Array
                    or JsonValueKind.Object)
                {
                    CollectDeviceObjects(
                        property.Value,
                        output,
                        depth + 1);
                }
            }
        }

        private static bool TryReadDevice(
            JsonElement element,
            out ExternalDeviceDto device)
        {
            device = new ExternalDeviceDto();

            var serial = ReadString(
                element,
                "serialNumber",
                "serial",
                "deviceSerialNumber",
                "SerialNumber");

            if (string.IsNullOrWhiteSpace(serial))
                return false;

            device.SerialNumber = serial;
            device.Model = ReadString(
                element,
                "model",
                "modelName",
                "deviceModel",
                "productName");

            device.Description = ReadString(
                element,
                "description",
                "name",
                "deviceName");

            device.DeviceState = ReadString(
                element,
                "deviceState",
                "state",
                "status");

            device.TeamId = ReadLong(
                element,
                "teamId",
                "TeamId");

            device.RegistrationDateUtc = ReadDateTime(
                element,
                "registrationDateUtc",
                "registeredAtUtc",
                "registrationDate");

            device.LastConnectionDateUtc = ReadDateTime(
                element,
                "lastConnectionDateUtc",
                "lastConnectedAtUtc",
                "lastConnectionDate",
                "lastSeenUtc");

            return true;
        }

        private static string? ReadString(
            JsonElement element,
            params string[] names)
        {
            foreach (var name in names)
            {
                if (!TryGetPropertyIgnoreCase(
                        element,
                        name,
                        out var value))
                {
                    continue;
                }

                if (value.ValueKind == JsonValueKind.String)
                    return value.GetString();

                if (value.ValueKind is JsonValueKind.Number
                    or JsonValueKind.True
                    or JsonValueKind.False)
                {
                    return value.ToString();
                }
            }

            return null;
        }

        private static long? ReadLong(
            JsonElement element,
            params string[] names)
        {
            foreach (var name in names)
            {
                if (!TryGetPropertyIgnoreCase(
                        element,
                        name,
                        out var value))
                {
                    continue;
                }

                if (value.ValueKind == JsonValueKind.Number
                    && value.TryGetInt64(out var number))
                {
                    return number;
                }

                if (value.ValueKind == JsonValueKind.String
                    && long.TryParse(value.GetString(), out number))
                {
                    return number;
                }
            }

            return null;
        }

        private static DateTime? ReadDateTime(
            JsonElement element,
            params string[] names)
        {
            foreach (var name in names)
            {
                if (!TryGetPropertyIgnoreCase(
                        element,
                        name,
                        out var value))
                {
                    continue;
                }

                if (value.ValueKind == JsonValueKind.String
                    && DateTime.TryParse(
                        value.GetString(),
                        out var parsed))
                {
                    return parsed.Kind == DateTimeKind.Utc
                        ? parsed
                        : parsed.ToUniversalTime();
                }
            }

            return null;
        }

        private static bool TryGetPropertyIgnoreCase(
            JsonElement element,
            string name,
            out JsonElement value)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (string.Equals(
                    property.Name,
                    name,
                    StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }

            value = default;
            return false;
        }

        private static string NormalizeSerial(string? serial)
            => (serial ?? string.Empty)
                .Trim()
                .ToUpperInvariant();

        private static string NormalizeState(string? state)
        {
            var normalized = (state ?? string.Empty).Trim();

            if (string.IsNullOrWhiteSpace(normalized))
                return "AttachedToLocation";

            return normalized.Equals(
                "Active",
                StringComparison.OrdinalIgnoreCase)
                ? "AttachedToLocation"
                : normalized;
        }

        private static DateTime? ToUtcNullable(DateTime? value)
        {
            if (!value.HasValue)
                return null;

            return value.Value.Kind == DateTimeKind.Utc
                ? value.Value
                : value.Value.ToUniversalTime();
        }

        private static string? NullIfWhiteSpace(string? value)
            => string.IsNullOrWhiteSpace(value)
                ? null
                : value.Trim();

        private static TimeSpan ResolveBackoff(Exception ex)
        {
            var text = ex.ToString();

            if (text.Contains(
                    "Purchase activation code",
                    StringComparison.OrdinalIgnoreCase)
                || text.Contains(
                    "Forbidden",
                    StringComparison.OrdinalIgnoreCase)
                || text.Contains(
                    "403",
                    StringComparison.OrdinalIgnoreCase))
            {
                return ForbiddenBackoff;
            }

            if (text.Contains(
                    "quota exceeded",
                    StringComparison.OrdinalIgnoreCase)
                || text.Contains(
                    "TooManyRequests",
                    StringComparison.OrdinalIgnoreCase)
                || text.Contains(
                    "429",
                    StringComparison.OrdinalIgnoreCase)
                || text.Contains(
                    "503",
                    StringComparison.OrdinalIgnoreCase))
            {
                return QuotaBackoff;
            }

            return GeneralErrorBackoff;
        }

        private string GetAccountKeySafe(long teamId)
        {
            try
            {
                return _logtagRouter.GetAccountKeyByTeamId(teamId);
            }
            catch
            {
                return "unknown";
            }
        }

        private static string Shorten(string? value, int maxLength)
        {
            if (string.IsNullOrWhiteSpace(value))
                return "<empty>";

            var normalized = value
                .Replace("\r", " ")
                .Replace("\n", " ")
                .Trim();

            return normalized.Length <= maxLength
                ? normalized
                : normalized[..maxLength] + "...";
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
    }
}
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Text.Json;
using temperature_humi.DTO;
using temperature_humi.Helpers.Config;
using temperature_humi.Hubs;
using temperature_humi.Infrastructure;
using temperature_humi.Models;
using temperature_humi.Service.LogtagService;

public sealed class ProfilesPollingStream : BackgroundService
{
    private readonly LogTagAccountRouter _logtagRouter;
    private readonly SimpleMemoryCache _cache;
    private readonly DeviceAlarmRuleService _rules;
    private readonly ILogger<ProfilesPollingStream> _log;
    private readonly IOptionsMonitor<ProfilesPollingSettings> _opt;
    private readonly IHubContext<LogTagHub> _hub;

    public ProfilesPollingStream(
        LogTagAccountRouter logtagRouter,
        SimpleMemoryCache cache,
        DeviceAlarmRuleService rules,
        ILogger<ProfilesPollingStream> log,
        IOptionsMonitor<ProfilesPollingSettings> opt,
        IHubContext<LogTagHub> hub)
    {
        _logtagRouter = logtagRouter;
        _cache = cache;
        _rules = rules;
        _log = log;
        _opt = opt;
        _hub = hub;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var teams = ResolveTeamIds();
        if (teams.Count == 0)
        {
            _log.LogWarning("[ProfilesPolling] No TeamIds provided in configuration or LogTagAccounts.");
            return;
        }

        _log.LogInformation("[ProfilesPolling] Polling teams: {Teams}", string.Join(",", teams));

        try { await Task.Delay(Random.Shared.Next(250, 1250), ct); } catch { }

        while (!ct.IsCancellationRequested)
        {
            var cfg = _opt.CurrentValue;
            if (!cfg.Enabled)
            {
                await DelaySafe(TimeSpan.FromSeconds(5), ct);
                continue;
            }

            var pollInterval = TimeSpan.FromMinutes(Math.Clamp(cfg.PollIntervalMinutes, 1, 1440));
            var staleTtl = TimeSpan.FromMinutes(Math.Clamp(cfg.StaleMinutes, 5, 1440));

            // Reload mỗi vòng để appsettings reload có tác dụng.
            teams = ResolveTeamIds();

            foreach (var teamId in teams)
            {
                try
                {
                    await PollTeamAsync(teamId, pollInterval, staleTtl, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "[ProfilesPolling] Error polling team {TeamId}. Check LogTagAccounts account mapping/permission.", teamId);
                }

                await DelaySafe(TimeSpan.FromMilliseconds(350), ct);
            }

            try { await Task.Delay(pollInterval, ct); } catch { }
        }
    }

    private List<long> ResolveTeamIds()
    {
        var ids = new List<long>();
        var cfgTeams = _opt.CurrentValue.TeamIds;

        if (cfgTeams != null && cfgTeams.Count > 0)
        {
            ids.AddRange(cfgTeams.Where(x => x > 0));
        }
        else
        {
            try
            {
                ids.AddRange(_logtagRouter.GetEnabledTeamIds());
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "[ProfilesPolling] Cannot load teams from LogTagAccounts.");
            }
        }

        return ids.Where(x => x > 0).Distinct().OrderBy(x => x).ToList();
    }

    private async Task PollTeamAsync(long teamId, TimeSpan pollInterval, TimeSpan staleTtl, CancellationToken ct)
    {
        var client = _logtagRouter.GetClientByTeamId(teamId);
        var accountKey = GetAccountKeySafe(teamId);

        _log.LogInformation("[ProfilesPolling] Polling team={TeamId}, account={AccountKey}", teamId, accountKey);

        var env = await client.GetProfilesAsync(teamId, ct);
        var profiles = env.Data ?? new List<TeamProfileDto>();

        var profileMap = new Dictionary<string, AlarmRule>(StringComparer.OrdinalIgnoreCase);

        foreach (var p in profiles)
        {
            var up = p.Alarms?.FirstOrDefault(a =>
                string.Equals(a.Sensor ?? "Temperature", "Temperature", StringComparison.OrdinalIgnoreCase) && a.IsUpper == true);

            var lo = p.Alarms?.FirstOrDefault(a =>
                string.Equals(a.Sensor ?? "Temperature", "Temperature", StringComparison.OrdinalIgnoreCase) && a.IsUpper == false);

            var key = p.Name ?? p.Model ?? $"profile:{p.Id}";
            profileMap[key] = new AlarmRule
            {
                UpperC = up?.ThresholdValue,
                LowerC = lo?.ThresholdValue,
                TriggerType = up?.AlarmTriggerType ?? lo?.AlarmTriggerType,
                RequiredReadings = up?.NumberOfReadingsBeforeAlert ?? lo?.NumberOfReadingsBeforeAlert,
                Source = "profile",
                ProfileName = p.Name
            };
        }

        var bySerial = new Dictionary<string, AlarmRule>(StringComparer.OrdinalIgnoreCase);
        var raw = await client.GetDevicesRawAsync(teamId, ct);

        using (var doc = JsonDocument.Parse(raw))
        {
            var root = doc.RootElement;
            var arr =
                (root.TryGetProperty("data", out var dataEl) && dataEl.ValueKind == JsonValueKind.Array)
                    ? dataEl
                    : (root.ValueKind == JsonValueKind.Array ? root : default);

            if (arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var d in arr.EnumerateArray())
                {
                    var serial = (TryGetString(d, "serialNumber") ?? "").Trim().ToUpperInvariant();
                    if (string.IsNullOrWhiteSpace(serial)) continue;

                    double? up = TryGetDouble(d, "upperAlarm") ?? TryGetDouble(d, "upperTemp");
                    double? lo = TryGetDouble(d, "lowerAlarm") ?? TryGetDouble(d, "lowerTemp");
                    string? trigger = TryGetString(d, "triggerType") ?? TryGetString(d, "alarmTriggerType");
                    int? req = TryGetInt(d, "requiredReadings") ?? TryGetInt(d, "numberOfReadingsBeforeAlert");
                    string? profileName = TryGetString(d, "profileName") ??
                                          TryGetString(d, "deviceConfigurationProfile");

                    if ((!up.HasValue && !lo.HasValue) &&
                        !string.IsNullOrWhiteSpace(profileName) &&
                        profileMap.TryGetValue(profileName!, out var pr))
                    {
                        bySerial[serial] = new AlarmRule
                        {
                            UpperC = pr.UpperC,
                            LowerC = pr.LowerC,
                            TriggerType = pr.TriggerType,
                            RequiredReadings = pr.RequiredReadings,
                            Source = "profile",
                            ProfileName = profileName
                        };
                    }
                    else
                    {
                        bySerial[serial] = new AlarmRule
                        {
                            UpperC = up,
                            LowerC = lo,
                            TriggerType = trigger,
                            RequiredReadings = req,
                            Source = (up.HasValue || lo.HasValue) ? "device" : "profile",
                            ProfileName = profileName
                        };
                    }
                }
            }
        }

        var cacheKey = $"external:profiles:{teamId}";
        _cache.Set(cacheKey, env, pollInterval);
        _cache.Set(cacheKey + ":stale", env, staleTtl);

        _rules.SetMany(bySerial);

        _log.LogInformation("[ProfilesPolling] Team={TeamId} Account={AccountKey} Profiles={P} Rules={R}",
            teamId, accountKey, profiles.Count, bySerial.Count);

        await _hub.Clients.Group($"team:{teamId}")
            .SendAsync("ProfilesUpdated", new { TeamId = teamId }, ct);

        await _hub.Clients.Group("Admin")
            .SendAsync("ProfilesUpdated", new { TeamId = teamId }, ct);
    }

    private string GetAccountKeySafe(long teamId)
    {
        try { return _logtagRouter.GetAccountKeyByTeamId(teamId); }
        catch { return "unknown"; }
    }

    private static double? TryGetDouble(JsonElement o, string name)
        => o.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetDouble() : (double?)null;

    private static int? TryGetInt(JsonElement o, string name)
        => o.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetInt32() : (int?)null;

    private static string? TryGetString(JsonElement o, string name)
        => o.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static async Task DelaySafe(TimeSpan ts, CancellationToken ct)
    {
        try { await Task.Delay(ts, ct); } catch { }
    }
}

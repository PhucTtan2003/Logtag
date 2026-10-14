using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Helpers.Config;
using temperature_humi.Hubs;
using temperature_humi.Infrastructure;
using temperature_humi.Models.SmsFpt; // LogTagApiClient.LogTagEventsResponse
using temperature_humi.Service;
using temperature_humi.Service.Admin;
using temperature_humi.Service.LogtagService;
using static temperature_humi.Service.LogtagService.LogTagApiClient;

public class EventService
{
    private readonly IMongoCollection<Event> _col;
    private readonly IHubContext<LogTagHub> _hub;
    private readonly AlertRealtimeOptions _opt;
    private readonly ILogger<EventService>? _log;
    private readonly ISmsEventNotifier _smsNotifier;
    private readonly IDeviceOwnerPhoneProvider _owner;
    private readonly IOptions<FptSmsOptions> _fptOpt;
    private readonly AccountDeviceService _accDev;
    private readonly AccountService _accountSvc;
    private readonly SmsActivationService _smsActs;
    private readonly SubscriptionService _subs;   // dùng để check feature

    // Dedupe theo phút: key = "{SERIAL}|{TYPE}|yyyyMMddHHmm"
    private static readonly ConcurrentDictionary<string, DateTime> _alertOncePerMinute = new();
    private readonly EventIngestProcessingCache _ingestCache;

    // TTL & sweep cho dedupe
    private static readonly TimeSpan DedupeTtl = TimeSpan.FromHours(6);
    private static DateTime _lastSweepUtc = DateTime.UtcNow;

    private static void SweepDedupeIfNeeded()
    {
        var now = DateTime.UtcNow;
        if ((now - _lastSweepUtc) < TimeSpan.FromMinutes(10)) return;
        _lastSweepUtc = now;

        var cutoff = now - DedupeTtl;
        foreach (var kv in _alertOncePerMinute)
        {
            if (kv.Value < cutoff)
                _alertOncePerMinute.TryRemove(kv.Key, out _);
        }
    }


#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
    public EventService(
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
        IOptions<MongoDBSettings> mongo,
        IHubContext<LogTagHub> hub,
        IOptions<AlertRealtimeOptions> opt,
        IOptions<FptSmsOptions> fptOpt,
        ISmsEventNotifier smsNotifier,
        IDeviceOwnerPhoneProvider owner,
        AccountDeviceService accDev,
        AccountService accountSvc,
        SmsActivationService smsActs,
        SubscriptionService subs,
        EventIngestProcessingCache ingestCache,
        ILogger<EventService>? log = null)
    {
        var cli = new MongoClient(mongo.Value.ConnectionString);
        var db = cli.GetDatabase(mongo.Value.DatabaseName);
        _col = db.GetCollection<Event>("Events");
        _log = log;
        _hub = hub;
        _opt = opt.Value;
        _smsNotifier = smsNotifier;
        _owner = owner;
        _fptOpt = fptOpt;
        _accDev = accDev;
        _accountSvc = accountSvc;
        _smsActs = smsActs;
        _subs = subs;
        _ingestCache = ingestCache;

        // EnsureIndexes() đã quản lý đủ unique, sort và TTL index.
        // Không tạo lại index lần hai trong constructor.
        EnsureIndexes();
    }

    private static string Norm(string s) => (s ?? "").Trim().ToUpperInvariant();

    private static DateTime AsUtc(DateTime dt) => EnsureUtc(dt);

    private static string GroupName(string s) => $"serial:{Norm(s)}";

    private static DateTime MinuteBucketUtc(DateTime t)
    {
        var u = t.Kind == DateTimeKind.Utc ? t : t.ToUniversalTime();
        return new DateTime(u.Year, u.Month, u.Day, u.Hour, u.Minute, 0, DateTimeKind.Utc);
    }

    // ---- Chuẩn hoá eventType (bắt rộng các biến thể Power Loss/Restore & Battery) ----
    private static string NormalizeEventType(string? raw)
    {
        var t = (raw ?? "").Trim();
        var tl = t.ToLowerInvariant();


        // TEMPERATURE STABLE / RECOVERED
        // Phải kiểm tra trước generic temperature alarm để giữ đúng loại event.
        if ((tl.Contains("temperature") || tl.Contains("nhiệt độ")) &&
            (tl.Contains("stable") ||
             tl.Contains("recovered") ||
             tl.Contains("recovery") ||
             tl.Contains("normal") ||
             tl.Contains("ổn định") ||
             tl.Contains("an toàn")))
        {
            return "temperature_stable";
        }

        // TEMPERATURE ALARMS
        // HIGH / LOW specifically
        if (tl.Contains("temperature") && tl.Contains("alarm") && tl.Contains("high"))
            return "temperature_alarm_high";

        if (tl.Contains("temperature") && tl.Contains("alarm") && tl.Contains("low"))
            return "temperature_alarm_low";

        // ⭐ GENERIC TEMPERATURE ALARM (không có high/low)
        if (tl.Contains("temperature") && tl.Contains("alarm"))
            return "temperature_alarm";

        // =======================
        // CONNECTION
        // =======================
        // LogTag thường trả:
        // - "lost connection event"
        // - "connection restored event"
        //
        // Đây là sự kiện kết nối, không phải sự kiện nguồn.
        bool isConnectionLost =
            tl.Contains("lost connection") ||
            tl.Contains("connection lost") ||
            tl.Contains("connection loss") ||
            tl.Contains("disconnected") ||
            tl.Contains("offline") ||
            tl.Contains("mất kết nối") ||
            tl.Contains("mất liên lạc") ||
            tl.Contains("không liên lạc");

        bool isConnectionRestored =
            tl.Contains("connection restored") ||
            tl.Contains("restored connection") ||
            tl.Contains("connection recovered") ||
            tl.Contains("reconnected") ||
            tl.Contains("back online") ||
            tl.Contains("khôi phục kết nối") ||
            tl.Contains("kết nối lại") ||
            tl.Contains("đã kết nối lại");

        if (isConnectionLost)
            return "connection_lost";

        if (isConnectionRestored)
            return "connection_restored";

        // =======================
        // POWER
        // =======================
        bool hasPower = tl.Contains("power") || tl.Contains("nguồn") || tl.Contains("điện");

        bool isLoss =
            tl.Contains("power loss") || tl.Contains("power lost") ||
            tl.Contains("power failure") || tl.Contains("power outage") ||
            tl.Contains("power cut") || tl.Contains("power down") ||
            tl.Contains("mất nguồn") || tl.Contains("mất điện") ||
            (hasPower && tl.Contains("mất"));

        bool isRestore =
            tl.Contains("power restore") || tl.Contains("power restored") || tl.Contains("power recovered") ||
            tl.Contains("power back") || tl.Contains("nguồn trở lại") ||
            (tl.Contains("khôi phục") && hasPower) || tl.Contains("có nguồn");

        if (hasPower && isLoss) return "power_loss";
        if (hasPower && isRestore) return "power_restore";

        // =======================
        // BATTERY
        // =======================
        if (tl.Contains("battery") &&
            (tl.Contains("low") || tl.Contains("flat") || tl.Contains("yếu") || tl.Contains("thấp")))
            return "battery_low";

        // Other
        return tl;
    }

    private static string? NormalizeDeviceName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var name = string.Join(" ", raw
            .Trim()
            .Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));

        return name.Length <= 80 ? name : name[..80];
    }

    private static string BuildDeviceLabel(string serial, string? deviceName)
    {
        var normalizedSerial = Norm(serial);
        var normalizedName = NormalizeDeviceName(deviceName);

        return string.IsNullOrWhiteSpace(normalizedName)
            ? normalizedSerial
            : $"{normalizedSerial} - {normalizedName}";
    }

    private static string NormalizePhone(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        raw = raw.Trim();
        if (raw.StartsWith("+84")) raw = "84" + raw[3..];
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        return digits;
    }

    private static bool IsValidVnPhone(string digits)
    {
        if (string.IsNullOrWhiteSpace(digits)) return false;
        return System.Text.RegularExpressions.Regex.IsMatch(digits, @"^(0\d{9,10}|84\d{9,10})$");
    }

    // Event nào coi là ALERT để push
    private static bool IsAlertType(string? normalized)
    {
        var t = normalized ?? string.Empty;

        return t.Contains("temperature_alarm")
            || t.Equals("temperature_stable", StringComparison.OrdinalIgnoreCase)
            || t.Equals("power_loss", StringComparison.OrdinalIgnoreCase)
            || t.Equals("power_restore", StringComparison.OrdinalIgnoreCase)
            || t.Equals("connection_lost", StringComparison.OrdinalIgnoreCase)
            || t.Equals("connection_restored", StringComparison.OrdinalIgnoreCase)
            || t.Equals("battery_low", StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildMessage(Event ev)
    {
        var typ = NormalizeEventType(ev.eventType);

        // =======================
        // TEMPERATURE STABLE
        // =======================
        if (typ == "temperature_stable")
            return "Nhiệt độ đã ổn định";

        // =======================
        // TEMPERATURE ALARMS
        // =======================
        if (typ.StartsWith("temperature_alarm"))
        {
            var v = ev.alarmValue?.ToString("0.##") ?? "?";
            var thr = ev.alarmThreshold?.ToString("0.##") ?? "?";

            string dir = typ switch
            {
                "temperature_alarm_high" => "HIGH",
                "temperature_alarm_low" => "LOW",
                _ => ""   // generic
            };

            if (!string.IsNullOrEmpty(dir))
                return $"Temperature {dir} Alarm: {v}°C (threshold {thr}°C)";

            // Generic: không có HIGH/LOW
            return $"Temperature Alarm: {v}°C (threshold {thr}°C)";
        }

        // =======================
        // POWER
        // =======================
        if (typ == "power_loss")
            return "Power Loss detected (external power lost).";

        if (typ == "power_restore")
            return "Power Restored (external power back).";

        // =======================
        // CONNECTION
        // =======================
        if (typ == "connection_lost")
            return "Thiết bị đã mất kết nối với hệ thống.";

        if (typ == "connection_restored")
            return "Thiết bị đã khôi phục kết nối thành công.";

        // =======================
        // BATTERY
        // =======================
        if (typ == "battery_low")
            return $"Battery Low{(string.IsNullOrWhiteSpace(ev.batteryType) ? "" : $" ({ev.batteryType})")}.";

        return ev.eventType ?? "Event";
    }

    private async Task PublishRecentAlertsAsync(
    List<Event> insertedDocs,
    CancellationToken ct,
    long? teamId = null)
    {
        _log?.LogInformation(
            "[Events->Alert] PublishRecentAlertsAsync BEGIN teamId={TeamId}, count={Count}.",
            teamId,
            insertedDocs?.Count ?? 0);

        if (insertedDocs == null || insertedDocs.Count == 0)
        {
            _log?.LogDebug(
                "[Events->Alert] PublishRecentAlertsAsync END: no inserted documents.");
            return;
        }

        // ============================================================
        // QUAN TRỌNG:
        // Không GroupBy serial + type nữa.
        //
        // Lý do:
        // Nếu trong cùng một batch có:
        // 09:00 -> vượt ngưỡng
        // 09:10 -> vượt ngưỡng
        // 09:20 -> vượt ngưỡng
        //
        // thì cả 3 reading mới đều phải được xử lý và có thể gửi SMS.
        //
        // Chỉ xử lý các event thực sự vừa insert vào Mongo.
        // Sắp xếp tăng dần theo thời gian để state/log dễ theo dõi.
        // ============================================================
        var eventsToProcess = insertedDocs
            .Where(ev => ev != null)
            .OrderBy(ev => AsUtc(ev.eventTimeUtc))
            .ToList();

        foreach (var ev in eventsToProcess)
        {
            ct.ThrowIfCancellationRequested();

            var evUtc = AsUtc(ev.eventTimeUtc);
            var normType = NormalizeEventType(ev.eventType);

            if (!IsAlertType(normType))
            {
                _log?.LogDebug(
                    "[Events->Alert] SKIP non-alert event teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                    teamId,
                    Norm(ev.serialNumber),
                    normType,
                    evUtc);

                continue;
            }

            var bucket = MinuteBucketUtc(evUtc);
            var serial = Norm(ev.serialNumber);
            var teamKey = teamId?.ToString() ?? "unknown";

            var dedupeKey =
                $"{teamKey}|{serial}|{normType}|{bucket:yyyyMMddHHmm}";

            SweepDedupeIfNeeded();

            // ============================================================
            // TEMPERATURE MANUAL EVENT
            //
            // Event nhiệt độ manual do LocationReadingService tạo khi có
            // CHUYỂN TRẠNG THÁI thực sự:
            // - reading đầu tiên vượt ngưỡng -> alarm ngay
            // - đổi hướng LOW <-> HIGH -> alarm ngay
            // - reading đầu tiên quay về an toàn -> temperature_stable ngay
            //
            // Không để dedupe theo phút chặn các transition hợp lệ.
            // ============================================================
            var isManualTemperatureTransition =
                string.Equals(
                    ev.source,
                    "manual",
                    StringComparison.OrdinalIgnoreCase)
                &&
                (
                    normType.Equals(
                        "temperature_alarm",
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    normType.Equals(
                        "temperature_alarm_high",
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    normType.Equals(
                        "temperature_alarm_low",
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    normType.Equals(
                        "temperature_stable",
                        StringComparison.OrdinalIgnoreCase)
                );

            if (!isManualTemperatureTransition)
            {
                if (_alertOncePerMinute.TryGetValue(
                        dedupeKey,
                        out var seen)
                    &&
                    seen == bucket)
                {
                    _log?.LogWarning(
                        "[Events->Alert] DEDUPE-SKIP teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}, bucket={Bucket:o}, source={Source}.",
                        teamId,
                        serial,
                        normType,
                        evUtc,
                        bucket,
                        ev.source ?? "(null)");

                    continue;
                }

                _alertOncePerMinute[dedupeKey] = bucket;
            }
            else
            {
                _log?.LogInformation(
                    "[Events->Alert] DEDUPE-BYPASS manual temperature event teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                    teamId,
                    serial,
                    normType,
                    evUtc);
            }

            // ============================================================
            // LẤY USER / DEVICE MAPPING
            // ============================================================
            var maps =
                await _accDev.GetMapsBySerialAsync(
                    serial,
                    ct);

            var map = teamId.HasValue
                ? maps.FirstOrDefault(
                    x => x.TeamId == teamId.Value)
                : maps
                    .OrderByDescending(
                        x => x.AssignedAtUtc)
                    .FirstOrDefault();

            var deviceName =
                NormalizeDeviceName(map?.Notes);

            var deviceLabel =
                BuildDeviceLabel(
                    serial,
                    deviceName);

            // Message mặc định theo event.
            var message = BuildMessage(ev);

            // ============================================================
            // TEMPERATURE STABLE
            //
            // Khi temperature_stable xuất hiện:
            // tìm lần temperature_alarm gần nhất TRƯỚC thời điểm stable.
            //
            // Không lưu mốc này chỉ trong RAM vì nếu backend restart,
            // MongoDB vẫn có thể tìm lại được alarm gần nhất.
            // ============================================================
            if (normType.Equals(
                    "temperature_stable",
                    StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var fb = Builders<Event>.Filter;

                    var alarmTypes = new[]
                    {
                    "temperature_alarm",
                    "temperature_alarm_high",
                    "temperature_alarm_low"
                };

                    var alarmFilter =
                        fb.Eq(
                            x => x.serialNumber,
                            serial)
                        &
                        fb.Lt(
                            x => x.eventTimeUtc,
                            evUtc)
                        &
                        fb.In(
                            x => x.eventType,
                            alarmTypes);

                    var lastAlarmUtc =
                        await _col
                            .Find(alarmFilter)
                            .SortByDescending(
                                x => x.eventTimeUtc)
                            .Project(
                                x => (DateTime?)x.eventTimeUtc)
                            .FirstOrDefaultAsync(ct);

                    if (lastAlarmUtc.HasValue)
                    {
                        var normalizedAlarmUtc =
                            EnsureUtc(
                                lastAlarmUtc.Value);

                        var lastAlarmVn =
                            TimeZoneInfo.ConvertTimeFromUtc(
                                normalizedAlarmUtc,
                                VietnamTimeZone);

                        message =
                            $"Nhiệt độ đã ổn định. " +
                            $"Vượt ngưỡng gần nhất của bạn là lúc " +
                            $"{lastAlarmVn:HH:mm} ngày " +
                            $"{lastAlarmVn:dd/MM/yyyy}.";

                        _log?.LogInformation(
                            "[Events->Stable] Last alarm found serial={Serial}, alarmUtc={AlarmUtc:o}, alarmVn={AlarmVn:dd/MM/yyyy HH:mm}, stableUtc={StableUtc:o}.",
                            serial,
                            normalizedAlarmUtc,
                            lastAlarmVn,
                            evUtc);
                    }
                    else
                    {
                        message =
                            "Nhiệt độ đã ổn định.";

                        _log?.LogWarning(
                            "[Events->Stable] No previous temperature alarm found serial={Serial}, stableUtc={StableUtc:o}.",
                            serial,
                            evUtc);
                    }
                }
                catch (OperationCanceledException)
                    when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    // Nếu query alarm cũ lỗi,
                    // vẫn cho gửi SMS stable bình thường.
                    _log?.LogError(
                        ex,
                        "[Events->Stable] Failed to find previous alarm serial={Serial}. Stable SMS will continue.",
                        serial);

                    message =
                        "Nhiệt độ đã ổn định.";
                }
            }

            // ============================================================
            // SIGNALR
            // ============================================================
            var dto =
                new LogTagHub.LiveAlertDto(
                    SerialNumber: serial,
                    Notes: deviceName,
                    Message: message,
                    TimeUtc: evUtc
                );

            _log?.LogInformation(
                "[Events->Alert] PUBLISH inserted event teamId={TeamId}, serial={Serial}, deviceName={DeviceName}, type={Type}, eventUtc={EventUtc:o}, message='{Message}'.",
                teamId,
                serial,
                deviceName ?? "(none)",
                normType,
                evUtc,
                message);

            try
            {
                await _hub.Clients
                    .Group(GroupName(serial))
                    .SendAsync(
                        LogTagHub.Events.ReceiveAlert,
                        dto,
                        ct);
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                // SignalR lỗi không được phép chặn SMS.
                _log?.LogError(
                    ex,
                    "[Events->Alert] SignalR FAILED but SMS will continue teamId={TeamId}, serial={Serial}, type={Type}.",
                    teamId,
                    serial,
                    normType);
            }

            // ============================================================
            // CHỈ GỬI SMS CHO EVENT THUỘC NGÀY HIỆN TẠI Ở VIỆT NAM
            // ============================================================
            if (!IsEventInCurrentVietnamDay(evUtc))
            {
                var eventVn =
                    TimeZoneInfo.ConvertTimeFromUtc(
                        evUtc,
                        VietnamTimeZone);

                var nowVn =
                    TimeZoneInfo.ConvertTimeFromUtc(
                        DateTime.UtcNow,
                        VietnamTimeZone);

                _log?.LogInformation(
                    "[Events->SMS] SKIP old event serial={Serial}, type={Type}, eventUtc={EventUtc:o}, eventVn={EventVn:yyyy-MM-dd HH:mm:ss}, todayVn={TodayVn:yyyy-MM-dd}.",
                    serial,
                    normType,
                    evUtc,
                    eventVn,
                    nowVn.Date);

                continue;
            }

            // ============================================================
            // DEVICE PHẢI ĐƯỢC GÁN USER
            // ============================================================
            if (map == null)
            {
                _log?.LogWarning(
                    "[Events->SMS] No AccountDevice mapping for teamId={TeamId}, serial={Serial}. Skip SMS.",
                    teamId,
                    serial);

                continue;
            }

            if (!teamId.HasValue &&
                maps.Count > 1)
            {
                _log?.LogWarning(
                    "[Events->SMS] Multiple AccountDevice mappings found for serial={Serial}, but event has no teamId. Using first mapping userId={UserId}, teamId={MappedTeamId}.",
                    serial,
                    map.UserId,
                    map.TeamId);
            }

            // ============================================================
            // USER PHẢI KÍCH HOẠT SMS
            // ============================================================
            var smsAct =
                await _smsActs.GetByUserAsync(
                    map.UserId,
                    ct);

            if (smsAct == null)
            {
                _log?.LogWarning(
                    "[Events->SMS] UserId={UserId}, teamId={TeamId}, serial={Serial} chưa kích hoạt SMS.",
                    map.UserId,
                    map.TeamId,
                    serial);

                continue;
            }

            // ============================================================
            // CHUẨN HÓA PHONE
            // ============================================================
            var phones =
                new List<string>();

            if (!string.IsNullOrWhiteSpace(
                    smsAct.Phone))
            {
                var parts =
                    smsAct.Phone.Split(
                        new[]
                        {
                        ',',
                        ';',
                        ' ',
                        '|'
                        },
                        StringSplitOptions.RemoveEmptyEntries);

                foreach (var part in parts)
                {
                    var phone =
                        NormalizePhone(part);

                    if (IsValidVnPhone(phone)
                        &&
                        !phones.Contains(
                            phone,
                            StringComparer.OrdinalIgnoreCase))
                    {
                        phones.Add(phone);
                    }
                }
            }

            if (phones.Count == 0)
            {
                _log?.LogWarning(
                    "[Events->SMS] Không tìm thấy số điện thoại hợp lệ cho UserId={UserId}, teamId={TeamId}, serial={Serial}. raw='{Raw}'.",
                    map.UserId,
                    map.TeamId,
                    serial,
                    smsAct.Phone);

                continue;
            }

            // ============================================================
            // SEND SMS
            // ============================================================
            var brand =
                _fptOpt.Value.DefaultBrandName;

            try
            {
                // Format:
                //
                // [SERIAL - TÊN THIẾT BỊ]
                // Nhiệt độ đã ổn định.
                // Vượt ngưỡng gần nhất...
                //
                var smsContent =
                    $"[{deviceLabel}] {message}";

                _log?.LogInformation(
                    "[Events->SMS] Sending TODAY event: brand={Brand}, teamId={TeamId}, serial={Serial}, deviceName={DeviceName}, type={Type}, eventUtc={EventUtc:o}, phones=[{Phones}], msg='{Msg}'.",
                    brand,
                    map.TeamId,
                    serial,
                    deviceName ?? "(none)",
                    normType,
                    evUtc,
                    string.Join(", ", phones),
                    smsContent);

                await _smsNotifier.NotifyEventAsync(
                    map.UserId,
                    phones,
                    smsContent,
                    normType,
                    brand,
                    serial,
                    evUtc,
                    ct);

                _log?.LogInformation(
                    "[Events->SMS] NotifyEventAsync DONE teamId={TeamId}, serial={Serial}, type={Type}.",
                    map.TeamId,
                    serial,
                    normType);
            }
            catch (Exception ex)
            {
                _log?.LogError(
                    ex,
                    "[Events->SMS] NotifyEventAsync FAILED teamId={TeamId}, serial={Serial}, type={Type}.",
                    map.TeamId,
                    serial,
                    normType);
            }
        }

        _log?.LogInformation(
            "[Events->Alert] PublishRecentAlertsAsync END teamId={TeamId}, processed={Count}.",
            teamId,
            eventsToProcess.Count);
    }
    // ---------- SAVE ----------

    public async Task<int> SaveNewEventsAsync(
    string serialNumber,
    LogTagEventsResponse resp,
    CancellationToken ct = default)
    {
        var serial = Norm(serialNumber);


        if (resp == null)
        {
            _log?.LogWarning("[Events] SaveNewEventsAsync got NULL resp for serial={serial}", serial);
            return 0;
        }

        if (resp.data == null || resp.data.Count == 0)
        {
            _log?.LogDebug("[Events] No events for serial={serial}. resp.data is null/empty", serial);
            return 0;
        }

        // Map + normalize trước khi lưu.
        // Event thiếu thời gian không được đổi thành DateTime.UtcNow vì có thể làm
        // một event cũ bị hiểu nhầm là event hôm nay và gửi SMS sai.
        var ingestedAtUtc = DateTime.UtcNow;

        var docs = resp.data
            .Where(e => e != null && e.eventTimeUtc != default)
            .Select(e => new Event
            {
                serialNumber = serial,
                eventType = NormalizeEventType(e.eventType),
                eventTimeUtc = AsUtc(e.eventTimeUtc),
                alarmThreshold = e.alarmThreshold,
                alarmValue = e.alarmValue,
                alarmCount = e.alarmCount,
                batteryType = e.batteryType,
                source = "logtag",
                ingestedAtUtc = ingestedAtUtc
            })
            .GroupBy(e => new
            {
                e.serialNumber,
                e.eventTimeUtc,
                e.eventType
            })
            .Select(g => g.First())
            .ToList();

        if (docs.Count == 0) return 0;

        // Nếu bạn đã chuyển sang cache:
        // var accepted = _ingestCache.TryEnqueue(serial, docs);
        // return accepted;

        return await InsertManySkipDuplicatesAsync(docs, ct);
    }



    internal async Task<int> InsertManySkipDuplicatesAsync(
        List<Event> docs,
        CancellationToken ct)
    {
        if (docs == null || docs.Count == 0)
            return 0;

        try
        {
            await _col.InsertManyAsync(
                docs,
                new InsertManyOptions { IsOrdered = false },
                ct);

            _log?.LogInformation(
                "[Events] Bulk insert OK: {Inserted}/{Total}.",
                docs.Count,
                docs.Count);

            // Chỉ event vừa insert mới được xét SignalR/SMS.
            await PublishRecentAlertsAsync(docs, ct);
            return docs.Count;
        }
        catch (MongoBulkWriteException ex)
        {
            var allErrors = (ex.WriteErrors ?? Enumerable.Empty<BulkWriteError>())
                .ToList();

            var failedIndexes = new HashSet<int>(
                allErrors.Select(w => w.Index));

            var duplicateIndexes = new HashSet<int>(
                allErrors
                    .Where(w => w.Code == 11000)
                    .Select(w => w.Index));

            // Với IsOrdered=false, những phần tử không có trong WriteErrors
            // đã được MongoDB insert thành công.
            var insertedDocs = docs
                .Where((_, index) => !failedIndexes.Contains(index))
                .ToList();

            var sampleKeys = duplicateIndexes
                .Take(5)
                .Where(index => index >= 0 && index < docs.Count)
                .Select(index =>
                    $"{docs[index].serialNumber}|{docs[index].eventTimeUtc:O}|{docs[index].eventType}")
                .ToArray();

            _log?.LogWarning(
                "[Events] Bulk insert partial. attempted={Attempted}, inserted={Inserted}, duplicates={Duplicates}, otherErrors={OtherErrors}. Samples: {Samples}",
                docs.Count,
                insertedDocs.Count,
                duplicateIndexes.Count,
                allErrors.Count - duplicateIndexes.Count,
                string.Join(", ", sampleKeys));

            var otherErrors = allErrors
                .Where(w => w.Code != 11000)
                .ToList();

            if (otherErrors.Count > 0)
            {
                _log?.LogError(
                    "[Events] Bulk insert had non-duplicate errors: {Count}. First: {FirstCode} {FirstMessage}",
                    otherErrors.Count,
                    otherErrors[0].Code,
                    otherErrors[0].Message);
            }

            // QUAN TRỌNG:
            // Batch toàn duplicate thì insertedDocs.Count == 0 và tuyệt đối không
            // publish/gửi SMS lại. Đây là chỗ trước đây làm event cũ bị gửi lại.
            if (insertedDocs.Count > 0)
            {
                await PublishRecentAlertsAsync(insertedDocs, ct);
            }
            else
            {
                _log?.LogDebug(
                    "[Events] No newly inserted event. Skip SignalR/SMS for duplicate batch.");
            }

            return insertedDocs.Count;
        }
    }

    // ---------- QUERY ----------
    public async Task<List<Event>> QueryAsync(
        string serialNumber,
        DateTime? startUtc,
        DateTime? endUtc,
        int? limit = null,
        string? eventType = null,
        CancellationToken ct = default)
    {
        var serial = Norm(serialNumber);

        var fb = Builders<Event>.Filter;
        var filter = fb.Eq(x => x.serialNumber, serial);
        if (startUtc.HasValue) filter &= fb.Gte(x => x.eventTimeUtc, AsUtc(startUtc.Value));
        if (endUtc.HasValue) filter &= fb.Lte(x => x.eventTimeUtc, AsUtc(endUtc.Value));
        if (!string.IsNullOrWhiteSpace(eventType))
            filter &= fb.Eq(x => x.eventType, NormalizeEventType(eventType));

        IFindFluent<Event, Event> q = _col.Find(filter);
        q = q.SortByDescending(x => x.eventTimeUtc);
        if (limit.HasValue) q = q.Limit(limit.Value);

        return await q.ToListAsync(ct);
    }

    public async Task<List<Event>> QueryAllAsync(
        DateTime? startUtc,
        DateTime? endUtc,
        string? eventType = null,
        int? limit = null,
        CancellationToken ct = default)
    {
        var fb = Builders<Event>.Filter;

        var filter = fb.Empty;
        if (startUtc.HasValue) filter &= fb.Gte(x => x.eventTimeUtc, AsUtc(startUtc.Value));
        if (endUtc.HasValue) filter &= fb.Lte(x => x.eventTimeUtc, AsUtc(endUtc.Value));
        if (!string.IsNullOrWhiteSpace(eventType))
            filter &= fb.Eq(x => x.eventType, NormalizeEventType(eventType));

        IFindFluent<Event, Event> q = _col.Find(filter);
        q = q.SortByDescending(x => x.eventTimeUtc);
        if (limit.HasValue) q = q.Limit(limit.Value);

        return await q.ToListAsync(ct);
    }

    public async Task<DateTime?> GetLastEventTimeUtcAsync(string serialNumber, CancellationToken ct = default)
    {
        var serial = Norm(serialNumber);
        var f = Builders<Event>.Filter.Eq(x => x.serialNumber, serial);
        return await _col.Find(f)
                         .SortByDescending(x => x.eventTimeUtc)
                         .Project(x => (DateTime?)x.eventTimeUtc)
                         .FirstOrDefaultAsync(ct);
    }

    // ====== Manual helpers ======
    private async Task PublishManualEventWithRetryAsync(
        Event ev,
        long teamId,
        CancellationToken ct)
    {
        const int maxAttempts = 3;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                _log?.LogInformation(
                    "[Events->Alert] MANUAL PUBLISH attempt={Attempt}/{MaxAttempts}, teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                    attempt,
                    maxAttempts,
                    teamId,
                    ev.serialNumber,
                    ev.eventType,
                    AsUtc(ev.eventTimeUtc));

                await PublishRecentAlertsAsync(
                    new List<Event> { ev },
                    ct,
                    teamId);

                _log?.LogInformation(
                    "[Events->Alert] MANUAL PUBLISH DONE teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                    teamId,
                    ev.serialNumber,
                    ev.eventType,
                    AsUtc(ev.eventTimeUtc));

                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _log?.LogError(
                    ex,
                    "[Events->Alert] MANUAL PUBLISH FAILED attempt={Attempt}/{MaxAttempts}, teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                    attempt,
                    maxAttempts,
                    teamId,
                    ev.serialNumber,
                    ev.eventType,
                    AsUtc(ev.eventTimeUtc));

                if (attempt >= maxAttempts)
                    throw;

                await Task.Delay(
                    TimeSpan.FromMilliseconds(500 * attempt),
                    ct);
            }
        }
    }

    internal async Task InsertTemperatureAlarmAsync(
        long teamId,
        string serialNumber,
        double threshold,
        double temperature,
        string eventType = "temperature_alarm_high",
        CancellationToken ct = default,
        DateTime? eventTimeUtc = null)
    {

        var normalizedType = NormalizeEventType(eventType);

        if (normalizedType != "temperature_alarm_high" &&
            normalizedType != "temperature_alarm_low")
        {
            normalizedType = "temperature_alarm_high";
        }

        var normalizedEventTimeUtc = AsUtc(eventTimeUtc ?? DateTime.UtcNow);

        var ev = new Event
        {
            serialNumber = Norm(serialNumber),
            eventType = normalizedType,
            eventTimeUtc = normalizedEventTimeUtc,
            alarmThreshold = threshold,
            alarmValue = temperature,
            alarmCount = 1,
            source = "manual",
            ingestedAtUtc = DateTime.UtcNow
        };

        try
        {
            await _col.InsertOneAsync(
                ev,
                cancellationToken: ct);

            _log?.LogInformation(
                "[Events->Alert] MANUAL INSERT OK teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}, value={Value}, threshold={Threshold}.",
                teamId,
                ev.serialNumber,
                ev.eventType,
                ev.eventTimeUtc,
                ev.alarmValue,
                ev.alarmThreshold);

            await PublishManualEventWithRetryAsync(
                ev,
                teamId,
                ct);
        }
        catch (MongoWriteException mwx)
            when (mwx.WriteError?.Code == 11000)
        {
            _log?.LogWarning(
                "[Events->Alert] DUPLICATE manual alarm event teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}. Existing event is kept; SMS is not sent again.",
                teamId,
                ev.serialNumber,
                ev.eventType,
                ev.eventTimeUtc);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log?.LogError(
                ex,
                "[Events->Alert] MANUAL INSERT/PUBLISH FAILED teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                teamId,
                ev.serialNumber,
                ev.eventType,
                ev.eventTimeUtc);

            throw;
        }
    }

    internal async Task InsertTemperatureStableAsync(
        long teamId,
        string serialNumber,
        double temperature,
        CancellationToken ct = default,
        DateTime? eventTimeUtc = null)
    {
        var normalizedEventTimeUtc = AsUtc(eventTimeUtc ?? DateTime.UtcNow);

        var ev = new Event
        {
            serialNumber = Norm(serialNumber),
            eventType = "temperature_stable",
            eventTimeUtc = normalizedEventTimeUtc,
            alarmValue = temperature,
            alarmCount = 1,
            source = "manual",
            ingestedAtUtc = DateTime.UtcNow
        };

        try
        {
            await _col.InsertOneAsync(
                ev,
                cancellationToken: ct);

            _log?.LogInformation(
                "[Events->Alert] STABLE INSERT OK teamId={TeamId}, serial={Serial}, eventUtc={EventUtc:o}, value={Value}.",
                teamId,
                ev.serialNumber,
                ev.eventTimeUtc,
                ev.alarmValue);

            await PublishManualEventWithRetryAsync(
                ev,
                teamId,
                ct);
        }
        catch (MongoWriteException mwx)
            when (mwx.WriteError?.Code == 11000)
        {
            _log?.LogWarning(
                "[Events->Alert] DUPLICATE stable event teamId={TeamId}, serial={Serial}, eventUtc={EventUtc:o}. Existing event is kept; SMS is not sent again.",
                teamId,
                ev.serialNumber,
                ev.eventTimeUtc);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log?.LogError(
                ex,
                "[Events->Alert] STABLE INSERT/PUBLISH FAILED teamId={TeamId}, serial={Serial}, eventUtc={EventUtc:o}.",
                teamId,
                ev.serialNumber,
                ev.eventTimeUtc);

            throw;
        }
    }

    internal async Task InsertPowerLossEventAsync(
        long teamId,
        string serialNumber,
        string? batteryType = null)
    {
        var ev = new Event
        {
            serialNumber = Norm(serialNumber),
            eventType = "power_loss",
            eventTimeUtc = DateTime.UtcNow,
            batteryType = batteryType ?? "unknown",
            source = "manual",
            ingestedAtUtc = DateTime.UtcNow
        };

        try
        {
            await _col.InsertOneAsync(ev);

            _log?.LogInformation(
                "[Events->Alert] POWER INSERT OK teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                teamId,
                ev.serialNumber,
                ev.eventType,
                ev.eventTimeUtc);

            await PublishManualEventWithRetryAsync(
                ev,
                teamId,
                CancellationToken.None);
        }
        catch (MongoWriteException mwx)
            when (mwx.WriteError?.Code == 11000)
        {
            _log?.LogWarning(
                "[Events->Alert] DUPLICATE power event teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}. Existing event is kept; SMS is not sent again.",
                teamId,
                ev.serialNumber,
                ev.eventType,
                ev.eventTimeUtc);
        }
        catch (Exception ex)
        {
            _log?.LogError(
                ex,
                "[Events->Alert] POWER INSERT/PUBLISH FAILED teamId={TeamId}, serial={Serial}, type={Type}, eventUtc={EventUtc:o}.",
                teamId,
                ev.serialNumber,
                ev.eventType,
                ev.eventTimeUtc);

            throw;
        }
    }

    private void EnsureIndexes()
    {
        // UNIQUE: serial + time + type
        var uxKeys = Builders<Event>.IndexKeys
            .Ascending(x => x.serialNumber)
            .Ascending(x => x.eventTimeUtc)
            .Ascending(x => x.eventType);

        EnsureIndex(new CreateIndexModel<Event>(
            uxKeys,
            new CreateIndexOptions { Unique = true, Name = "uq_serial_time_type" }));

        // sort theo thời gian
        EnsureIndex(new CreateIndexModel<Event>(
            Builders<Event>.IndexKeys.Descending(x => x.eventTimeUtc),
            new CreateIndexOptions { Name = "ix_time_desc" }));

        // serial + time desc
        EnsureIndex(new CreateIndexModel<Event>(
            Builders<Event>.IndexKeys.Ascending(x => x.serialNumber).Descending(x => x.eventTimeUtc),
            new CreateIndexOptions { Name = "ix_serial_time_desc" }));

        // ✅ TTL: tự xoá events cũ hơn 61 ngày dựa trên eventTimeUtc
        EnsureIndex(new CreateIndexModel<Event>(
            Builders<Event>.IndexKeys.Ascending(x => x.eventTimeUtc),
            new CreateIndexOptions
            {
                Name = "ttl_events_61d",            // test: ttl_events_10d
                ExpireAfter = TimeSpan.FromDays(61) // test: 10
            }));
    }

    private void EnsureIndex(CreateIndexModel<Event> model)
    {
        var name = model.Options?.Name;
        var isTtl = model.Options?.ExpireAfter != null;

        var indexes = _col.Indexes.List().ToList();

        // 1️⃣ Nếu index có name và đã tồn tại
        if (!string.IsNullOrWhiteSpace(name))
        {
            var existing = indexes.FirstOrDefault(ix =>
                ix.TryGetValue("name", out var v) && v.AsString == name);

            if (existing != null)
            {
                // Nếu là TTL → kiểm tra expireAfterSeconds
                if (isTtl)
                {
                    var want = (long)model.Options!.ExpireAfter!.Value.TotalSeconds;
                    var has = existing.TryGetValue("expireAfterSeconds", out var e)
                        ? e.ToInt64()
                        : (long?)null;

                    if (has != want)
                    {
                        _col.Indexes.DropOne(name);
                        _col.Indexes.CreateOne(model);
                    }
                }

                return; // index OK
            }
        }

        // 2️⃣ Chưa có theo name → thử tạo
        try
        {
            _col.Indexes.CreateOne(model);
        }
        catch (MongoCommandException ex)
        {
            var msg = ex.Message ?? "";

            // 3️⃣ Bị kẹt do index khác cùng key (eventTimeUtc_1)
            if (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase) ||
                msg.Contains("different options", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var ix in indexes)
                {
                    if (!ix.TryGetValue("key", out var key)) continue;
                    if (!key.IsBsonDocument) continue;

                    if (key.AsBsonDocument.Contains("eventTimeUtc"))
                    {
                        var oldName = ix["name"].AsString;
                        _col.Indexes.DropOne(oldName);
                        break;
                    }
                }

                // tạo lại TTL index
                _col.Indexes.CreateOne(model);
                return;
            }

            throw;
        }
    }
    private static readonly TimeZoneInfo VietnamTimeZone =
    ResolveVietnamTimeZone();

    private static TimeZoneInfo ResolveVietnamTimeZone()
    {
        try
        {
            // Windows
            return TimeZoneInfo.FindSystemTimeZoneById(
                "SE Asia Standard Time");
        }
        catch (TimeZoneNotFoundException)
        {
            // thử IANA bên dưới
        }
        catch (InvalidTimeZoneException)
        {
            // thử IANA bên dưới
        }

        try
        {
            // Linux / Docker
            return TimeZoneInfo.FindSystemTimeZoneById(
                "Asia/Ho_Chi_Minh");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.CreateCustomTimeZone(
                "Vietnam Standard Time",
                TimeSpan.FromHours(7),
                "Vietnam Standard Time",
                "Vietnam Standard Time");
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.CreateCustomTimeZone(
                "Vietnam Standard Time",
                TimeSpan.FromHours(7),
                "Vietnam Standard Time",
                "Vietnam Standard Time");
        }
    }

    private static DateTime EnsureUtc(DateTime value)
    {
        return value.Kind switch
        {
            DateTimeKind.Utc => value,

            DateTimeKind.Local =>
                value.ToUniversalTime(),

            _ => DateTime.SpecifyKind(
                value,
                DateTimeKind.Utc)
        };
    }

    private static bool IsEventInCurrentVietnamDay(
        DateTime eventTimeUtc)
    {
        var eventUtc = EnsureUtc(eventTimeUtc);

        var eventLocal =
            TimeZoneInfo.ConvertTimeFromUtc(
                eventUtc,
                VietnamTimeZone);

        var nowLocal =
            TimeZoneInfo.ConvertTimeFromUtc(
                DateTime.UtcNow,
                VietnamTimeZone);

        return eventLocal.Date == nowLocal.Date;
    }
    private async Task<DateTime?> GetLastTemperatureAlarmBeforeAsync(
    string serialNumber,
    DateTime beforeUtc,
    CancellationToken ct)
    {
        var serial = Norm(serialNumber);
        var before = EnsureUtc(beforeUtc);

        var fb = Builders<Event>.Filter;

        var filter =
            fb.Eq(x => x.serialNumber, serial)
            & fb.Lt(x => x.eventTimeUtc, before)
            & fb.In(
                x => x.eventType,
                new[]
                {
                "temperature_alarm",
                "temperature_alarm_high",
                "temperature_alarm_low"
                });

        return await _col
            .Find(filter)
            .SortByDescending(x => x.eventTimeUtc)
            .Project(x => (DateTime?)x.eventTimeUtc)
            .FirstOrDefaultAsync(ct);
    }
}
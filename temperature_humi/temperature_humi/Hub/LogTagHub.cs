// temperature_humi/Hubs/LogTagHub.cs
using System;
using System.Linq;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Bson;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Hubs
{
    [Authorize] // Giữ bảo mật
    public class LogTagHub : Hub
    {
        private readonly DeviceService _deviceService;
        private readonly StatusService _statusService;
        private readonly AlertService _alertService;
        private readonly LocationReadingService _locationReadingService;
        private readonly LogTagRealtimeWorker _rtWorker;
        private readonly AccountEventsService _eventsService;

        public LogTagHub(
            DeviceService deviceService,
            StatusService statusService,
            AlertService alertService,
            LocationReadingService locationReadingService,
            LogTagRealtimeWorker rtWorker,
            AccountEventsService eventsService
        )
        {
            _deviceService = deviceService;
            _statusService = statusService;
            _alertService = alertService;
            _locationReadingService = locationReadingService;
            _rtWorker = rtWorker;
            _eventsService = eventsService;
        }

        // ====== Subscriptions & helpers ======
        // serial -> số client subscribe
        private static readonly ConcurrentDictionary<string, int> _subscriptions =
            new(StringComparer.OrdinalIgnoreCase);

        // connectionId -> set serials mà connection đó đã join
        private static readonly ConcurrentDictionary<string, HashSet<string>> _connSerials =
            new();

        private static string NormalizeSerial(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
            var s = raw.Trim();
            if (s.StartsWith("serial:", StringComparison.OrdinalIgnoreCase))
                s = s.Substring("serial:".Length);
            return s.Trim().ToUpperInvariant();
        }

        private static string SerialGroup(string serialUpper) => $"serial:{serialUpper}";
        private static string AdminGroup => "Admin";

        public static IReadOnlyCollection<string> GetActiveSerials()
            => _subscriptions.Where(kv => kv.Value > 0).Select(kv => kv.Key).ToList();

        // ===== Event names =====
        public static class Events
        {
            public const string ReadingUpdate = "ReadingUpdate";
            public const string ReceiveStatusUpdate = "ReceiveStatusUpdate";
            public const string ReceiveAlert = "ReceiveAlert";
            public const string ReceiveAdminEvent = "ReceiveAdminEvent";
        }

        // ===== DTO =====
        public record LiveStatusDto(
            string SerialNumber,
            string? Notes,
            string Status,
            double? Temperature,
            double? Humidity,
            DateTime TimeUtc
        );

        public record LiveAlertDto(
            string SerialNumber,
            string? Notes,
            string Message,
            DateTime TimeUtc
        );

        // ===== Compatibility methods (broadcast toàn hệ thống) =====
        public Task SendStatusUpdate(object data)
            => Clients.All.SendAsync(Events.ReceiveStatusUpdate, data);

        public Task SendAlert(object data)
            => Clients.All.SendAsync(Events.ReceiveAlert, data);

        // ===== Group helpers =====
        public Task SendStatusToSerial(string serialUpper, object payload)
            => Clients.Group(SerialGroup(NormalizeSerial(serialUpper)))
                      .SendAsync(Events.ReceiveStatusUpdate, payload);

        public Task SendAlertToSerial(string serialUpper, object payload)
            => Clients.Group(SerialGroup(NormalizeSerial(serialUpper)))
                      .SendAsync(Events.ReceiveAlert, payload);

        public Task SendAdmin(object payload)
            => Clients.Group(AdminGroup).SendAsync(Events.ReceiveAdminEvent, payload);

        public Task<DateTime> Ping() => Task.FromResult(DateTime.UtcNow);

        // ===== Lifecycle =====
        public override async Task OnConnectedAsync()
        {
            _connSerials.TryAdd(
                Context.ConnectionId,
                new HashSet<string>(StringComparer.OrdinalIgnoreCase));

            try
            {
                // 1) Admin group
                if (Context.User?.IsInRole("Admin") == true)
                {
                    await Groups.AddToGroupAsync(
                        Context.ConnectionId,
                        AdminGroup);
                }

                // 2) Join theo claims.
                // KHÔNG dùng ConnectionAborted để tránh cancel giữa quá trình seed.
                var accountIdClaim =
                    Context.User?.FindFirst("accountId")?.Value;

                // Hoàn tất handshake trước khi seed.
                await base.OnConnectedAsync();

                if (ObjectId.TryParse(
                    accountIdClaim,
                    out var accountIdFromClaim))
                {
                    // Lấy serials theo quyền.
                    var serials =
                        await _eventsService.GetMySerialsAsync(
                            Context.User!,
                            CancellationToken.None);

                    foreach (var serial in serials
                        .Select(NormalizeSerial)
                        .Where(s => !string.IsNullOrWhiteSpace(s))
                        .Distinct(StringComparer.OrdinalIgnoreCase))
                    {
                        await AddSerialToConnectionAsync(
                            Context.ConnectionId,
                            serial);
                    }

                    await SeedForAccount(accountIdFromClaim);
                    return;
                }

                // 3) Fallback token dạng ObjectId trong query ?access_token=
                var http = Context.GetHttpContext();
                var token =
                    http?.Request.Query["access_token"].ToString();

                if (ObjectId.TryParse(
                    token,
                    out var accIdFromToken))
                {
                    await SeedForTokenFallback(accIdFromToken);
                }
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine(
                    $"[LogTagHub] OnConnected canceled for {Context.ConnectionId}");
            }
            catch (Exception ex)
            {
                Console.WriteLine(
                    $"[LogTagHub] ❌ OnConnectedAsync error: {ex}");

                await Clients.Caller.SendAsync(
                    Events.ReceiveStatusUpdate,
                    Array.Empty<LiveStatusDto>());

                await Clients.Caller.SendAsync(
                    Events.ReceiveAlert,
                    Array.Empty<LiveAlertDto>());
            }
        }

        public override async Task OnDisconnectedAsync(
            Exception? exception)
        {
            Console.WriteLine(
                $"[Hub] Disconnected: {Context.ConnectionId}, err={exception?.Message}");

            if (_connSerials.TryRemove(
                Context.ConnectionId,
                out var set))
            {
                List<string> serials;

                lock (set)
                {
                    serials = set
                        .Select(NormalizeSerial)
                        .Where(s => !string.IsNullOrWhiteSpace(s))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    set.Clear();
                }

                foreach (var serial in serials)
                {
                    try
                    {
                        await Groups.RemoveFromGroupAsync(
                            Context.ConnectionId,
                            SerialGroup(serial));
                    }
                    catch
                    {
                        // ignore disconnect cleanup errors
                    }

                    _subscriptions.AddOrUpdate(
                        serial,
                        0,
                        (_, n) => Math.Max(0, n - 1));

                    _rtWorker.Unwatch(serial);

                    Console.WriteLine(
                        $"[Hub] {Context.ConnectionId} LEAVE {SerialGroup(serial)} (disconnect)");
                }
            }

            await base.OnDisconnectedAsync(exception);
        }

        // ====== Connection/group helpers ======

        /// <summary>
        /// Add serial vào connection theo kiểu idempotent.
        ///
        /// Quan trọng:
        /// - Không tăng _subscriptions nhiều lần nếu FE gọi lại.
        /// - Không Watch() nhiều lần cho cùng connection + serial.
        /// - Chờ Groups.AddToGroupAsync hoàn tất thay vì fire-and-forget.
        /// </summary>
        private async Task AddSerialToConnectionAsync(
            string connectionId,
            string serialNumber)
        {
            var serial = NormalizeSerial(serialNumber);

            if (string.IsNullOrWhiteSpace(serial))
                return;

            var set = _connSerials.GetOrAdd(
                connectionId,
                _ => new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase));

            bool added;

            lock (set)
            {
                added = set.Add(serial);
            }

            // Đã join rồi -> không tăng counter/watch thêm.
            if (!added)
                return;

            try
            {
                await Groups.AddToGroupAsync(
                    connectionId,
                    SerialGroup(serial));

                _subscriptions.AddOrUpdate(
                    serial,
                    1,
                    (_, n) => n + 1);

                _rtWorker.Watch(serial);

                Console.WriteLine(
                    $"[Hub] {connectionId} JOIN {SerialGroup(serial)}");
            }
            catch
            {
                // Rollback local state nếu add group thất bại.
                lock (set)
                {
                    set.Remove(serial);
                }

                throw;
            }
        }

        /// <summary>
        /// Remove serial khỏi connection theo kiểu idempotent.
        /// </summary>
        private async Task RemoveSerialFromConnectionAsync(
            string connectionId,
            string serialNumber)
        {
            var serial = NormalizeSerial(serialNumber);

            if (string.IsNullOrWhiteSpace(serial))
                return;

            if (!_connSerials.TryGetValue(
                connectionId,
                out var set))
            {
                return;
            }

            bool removed;

            lock (set)
            {
                removed = set.Remove(serial);
            }

            // Không tồn tại -> không decrement lần nữa.
            if (!removed)
                return;

            try
            {
                await Groups.RemoveFromGroupAsync(
                    connectionId,
                    SerialGroup(serial));
            }
            catch
            {
                // vẫn cleanup watcher/counter bên server
            }

            _subscriptions.AddOrUpdate(
                serial,
                0,
                (_, n) => Math.Max(0, n - 1));

            _rtWorker.Unwatch(serial);

            Console.WriteLine(
                $"[Hub] {connectionId} LEAVE {SerialGroup(serial)}");
        }

        // ====== Client APIs ======

        // FE subscribe một serial (thủ công).
        //
        // Luồng User bình thường KHÔNG cần gọi method này,
        // vì OnConnectedAsync() đã tự join các serial được cấp quyền.
        public async Task JoinSerial(string serialNumber)
        {
            await AddSerialToConnectionAsync(
                Context.ConnectionId,
                serialNumber);
        }

        // FE unsubscribe một serial (thủ công).
        public async Task LeaveSerial(string serialOrGroup)
        {
            await RemoveSerialFromConnectionAsync(
                Context.ConnectionId,
                serialOrGroup);
        }

        // Gửi reading theo group serial.
        //
        // Backend có thể dùng PushReadingToGroup() trực tiếp.
        // Method này giữ lại cho compatibility.
        public async Task BroadcastReading(object payload)
        {
            if (payload is null)
                return;

            var serial = payload.GetType()
                                .GetProperty("SerialNumber")
                                ?.GetValue(payload)?
                                .ToString()?
                                .Trim();

            serial = NormalizeSerial(
                serial ?? string.Empty);

            if (string.IsNullOrEmpty(serial))
                return;

            await Clients.Group(
                    SerialGroup(serial))
                .SendAsync(
                    Events.ReadingUpdate,
                    payload);
        }

        /// <summary>
        /// Backend push reading vào đúng group serial.
        ///
        /// Webhook flow:
        /// LogTag -> Webhook Controller
        /// -> LocationReadingService
        /// -> SignalR ReadingUpdate
        /// -> group serial:{SERIAL}
        /// -> FE User
        /// </summary>
        internal Task PushReadingToGroup(
            string serial,
            object payload)
        {
            var normalized =
                NormalizeSerial(serial);

            if (string.IsNullOrWhiteSpace(normalized) ||
                payload is null)
            {
                return Task.CompletedTask;
            }

            return Clients
                .Group(SerialGroup(normalized))
                .SendAsync(
                    Events.ReadingUpdate,
                    payload);
        }

        // Cho phép client yêu cầu re-join groups
        // khi quyền/mapping thay đổi.
        //
        // Hàm này được làm idempotent:
        // - Xóa toàn bộ serial cũ trước.
        // - Add lại đúng danh sách hiện tại.
        // - Không làm _subscriptions/_rtWorker bị tăng ảo.
        public async Task RefreshGroups()
        {
            try
            {
                // ===== 1) Admin group =====
                await Groups.RemoveFromGroupAsync(
                    Context.ConnectionId,
                    AdminGroup);

                if (Context.User?.IsInRole("Admin") == true)
                {
                    await Groups.AddToGroupAsync(
                        Context.ConnectionId,
                        AdminGroup);
                }

                // ===== 2) Remove serial groups hiện tại =====
                if (_connSerials.TryGetValue(
                    Context.ConnectionId,
                    out var set))
                {
                    List<string> oldSerials;

                    lock (set)
                    {
                        oldSerials = set
                            .Select(NormalizeSerial)
                            .Where(s => !string.IsNullOrWhiteSpace(s))
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();
                    }

                    foreach (var oldSerial in oldSerials)
                    {
                        await RemoveSerialFromConnectionAsync(
                            Context.ConnectionId,
                            oldSerial);
                    }
                }

                // ===== 3) Load quyền mới =====
                var serials =
                    await _eventsService.GetMySerialsAsync(
                        Context.User!,
                        CancellationToken.None);

                // ===== 4) Add lại đúng serial hiện tại =====
                foreach (var serial in serials
                    .Select(NormalizeSerial)
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    await AddSerialToConnectionAsync(
                        Context.ConnectionId,
                        serial);
                }

                Console.WriteLine(
                    $"[LogTagHub] ✅ RefreshGroups completed. Connection={Context.ConnectionId}");
            }
            catch (Exception ex)
            {
                Console.WriteLine(
                    $"[LogTagHub] ❌ RefreshGroups error: {ex}");
            }
        }

        // ====== Seed helpers ======
        private async Task SeedForAccount(ObjectId accountId)
        {
            var devices = await _deviceService.GetDevicesByAccountAsync(accountId, onlyActive: false);
            if (devices == null || devices.Count == 0)
            {
                await Clients.Caller.SendAsync(Events.ReceiveStatusUpdate, Array.Empty<LiveStatusDto>());
                await Clients.Caller.SendAsync(Events.ReceiveAlert, Array.Empty<LiveAlertDto>());
                return;
            }

            var devById = devices.ToDictionary(d => d.Id, d => d);
            var deviceIds = devices.Select(d => d.Id).ToList();

            var statuses = await _statusService.GetLatestStatuses(deviceIds);
            var alerts = await _alertService.GetAlerts(deviceIds);

            var statusDtos = statuses
                .Where(s => devById.ContainsKey(s.DeviceId))
                .Select(s =>
                {
                    var d = devById[s.DeviceId];
                    var isRecent = s.Timestamp >= DateTime.UtcNow.AddMinutes(-15);
                    var statusText = s.Status ?? (isRecent ? "Online" : "Offline");

                    return new LiveStatusDto(
                        SerialNumber: d.serialNumber,
                        Notes: d.description ?? s.Notes,
                        Status: statusText,
                        Temperature: s.Temperature,
                        Humidity: s.Humidity,
                        TimeUtc: s.Timestamp
                    );
                })
                .ToList();

            // Bổ sung Offline cho thiết bị chưa có status
            var hadStatus = new HashSet<ObjectId>(statuses.Select(s => s.DeviceId));
            foreach (var dv in devices)
            {
                if (!hadStatus.Contains(dv.Id))
                {
                    statusDtos.Add(new LiveStatusDto(
                        SerialNumber: dv.serialNumber,
                        Notes: dv.description,
                        Status: "Offline",
                        Temperature: null,
                        Humidity: null,
                        TimeUtc: DateTime.UtcNow
                    ));
                }
            }

            statusDtos = statusDtos
                .OrderByDescending(x => x.TimeUtc)
                .Take(50)
                .ToList();

            var alertDtos = alerts
                .Where(a => devById.ContainsKey(a.DeviceId))
                .Select(a =>
                {
                    var d = devById[a.DeviceId];
                    return new LiveAlertDto(
                        SerialNumber: d.serialNumber,
                        Notes: d.description ?? a.Notes,
                        Message: a.Message,
                        TimeUtc: a.Time
                    );
                })
                .OrderByDescending(x => x.TimeUtc)
                .Take(100)
                .ToList();

            await Clients.Caller.SendAsync(Events.ReceiveStatusUpdate, statusDtos);
            await Clients.Caller.SendAsync(Events.ReceiveAlert, alertDtos);

            Console.WriteLine($"[LogTagHub] ✅ Seed {statusDtos.Count} status, {alertDtos.Count} alerts (claims)");
        }

        private async Task SeedForTokenFallback(ObjectId accountId)
        {
            try
            {
                var devices = await _deviceService.GetDevicesByAccountAsync(accountId);
                if (devices is null || devices.Count == 0)
                {
                    await Clients.Caller.SendAsync(Events.ReceiveStatusUpdate, Array.Empty<LiveStatusDto>());
                    await Clients.Caller.SendAsync(Events.ReceiveAlert, Array.Empty<LiveAlertDto>());
                    return;
                }

                var serials = devices
                    .Select(d => NormalizeSerial(d.serialNumber))
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                foreach (var serial in serials)
                {
                    await AddSerialToConnectionAsync(
                        Context.ConnectionId,
                        serial);
                }

                var devById = devices.ToDictionary(d => d.Id, d => d);
                var deviceIds = devices.Select(d => d.Id).ToList();

                var statuses = await _statusService.GetLatestStatuses(deviceIds);
                var alerts = await _alertService.GetAlerts(deviceIds);

                var statusDtos = statuses.Select(s =>
                {
                    var d = devById[s.DeviceId];
                    var isRecent = s.Timestamp >= DateTime.UtcNow.AddMinutes(-15);
                    var statusText = s.Status ?? (isRecent ? "Online" : "Offline");
                    return new LiveStatusDto(
                        d.serialNumber,
                        d.description ?? s.Notes,
                        statusText,
                        s.Temperature,
                        s.Humidity,
                        s.Timestamp
                    );
                }).ToList();

                var had = new HashSet<ObjectId>(statuses.Select(x => x.DeviceId));
                foreach (var dv in devices)
                    if (!had.Contains(dv.Id))
                        statusDtos.Add(new LiveStatusDto(
                            dv.serialNumber,
                            dv.description,
                            "Offline",
                            null,
                            null,
                            DateTime.UtcNow
                        ));

                statusDtos = statusDtos.OrderByDescending(x => x.TimeUtc).Take(50).ToList();

                var alertDtos = alerts.Select(a =>
                {
                    var d = devById[a.DeviceId];
                    return new LiveAlertDto(
                        d.serialNumber,
                        d.description ?? a.Notes,
                        a.Message,
                        a.Time
                    );
                }).OrderByDescending(x => x.TimeUtc).Take(100).ToList();

                await Clients.Caller.SendAsync(Events.ReceiveStatusUpdate, statusDtos);
                await Clients.Caller.SendAsync(Events.ReceiveAlert, alertDtos);

                Console.WriteLine($"[Hub] ✅ Push init (token) to {accountId}. status={statusDtos.Count}, alerts={alertDtos.Count}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Hub] ❌ OnConnected init (token) error: {ex}");
                await Clients.Caller.SendAsync(Events.ReceiveStatusUpdate, Array.Empty<LiveStatusDto>());
                await Clients.Caller.SendAsync(Events.ReceiveAlert, Array.Empty<LiveAlertDto>());
            }
        }
    }
}
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Bson;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;
using temperature_humi.Service;
using temperature_humi.Hubs;

namespace temperature_humi.Logtag
{
    [ApiController]
    [Route("api/logtag-statistics")]
    #region LogTagStatisticsController
    public class LogTagStatisticsController : ControllerBase
    {
        private readonly AccountService _accountService;
        private readonly DeviceService _deviceService;
        private readonly EventService _eventService;
        private readonly LocationReadingService _readingService;
        private readonly RoleService _roleService;
        private readonly IHubContext<LogTagHub> _hubContext;

        public LogTagStatisticsController(
            AccountService accountService,
            DeviceService deviceService,
            EventService eventService,
            LocationReadingService locationReadingService,
            RoleService roleService,
            IHubContext<LogTagHub> hubContext)
        {
            _accountService = accountService;
            _deviceService = deviceService;
            _eventService = eventService;
            _readingService = locationReadingService;
            _roleService = roleService;
            _hubContext = hubContext;
        }
        #endregion
        // ===== Helpers =====
        #region GetAccountIdFromRequest
        private ObjectId GetAccountIdFromRequest()
        {
            var s = Request.Headers["accountId"].FirstOrDefault();
            return ObjectId.TryParse(s, out var id)
                ? id
                : throw new Exception("accountId không hợp lệ");
        }
        #endregion
        private async Task<(ObjectId accountId, bool isAdmin)> GetAccountAndRoleAsync()
        {
            var accId = GetAccountIdFromRequest();
            var acc = await _accountService.GetByIdAsync(accId)
                      ?? throw new Exception("Tài khoản không tồn tại.");
            var role = await _roleService.GetRoleByIdAsync(acc.RoleId);
            var isAdmin = string.Equals(role?.RoleName?.Trim(), "admin", StringComparison.OrdinalIgnoreCase);
            return (acc.Id, isAdmin);
        }

        // ===== 1) Realtime status (theo deviceState) =====
        [HttpGet("status-live")]
        public async Task<IActionResult> GetLiveStatus([FromQuery] string? teamId = null)
        {
            var (accountId, isAdmin) = await GetAccountAndRoleAsync();

            // ⬇️ cho employee: không lọc Active
            var devices = isAdmin
                ? _deviceService.GetAll()
                : await _deviceService.GetDevicesByAccountAsync(accountId, onlyActive: false);

            if (devices.Count == 0) return Ok(Array.Empty<object>());

            var serials = devices
                .Select(d => d.serialNumber)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var latest = await _readingService.GetLatestBySerialsAsync(serials);

            var result = latest.Where(p => p != null).Select(p =>
            {
                var dev = devices.FirstOrDefault(d =>
                    string.Equals(d.serialNumber, p!.SerialNumber, StringComparison.OrdinalIgnoreCase));

                var isActive = string.Equals(dev?.deviceState, "Active", StringComparison.OrdinalIgnoreCase);

                return new
                {
                    serialNumber = p!.SerialNumber,
                    name = dev?.description ?? p.SerialNumber,
                    // status từ isActive cho FE
                    status = isActive ? "Online" : "Offline",
                    isActive,                         // ⬅️ FE dùng để quyết định Online/Offline
                    dev?.deviceState,   // (tuỳ, nếu muốn xem trực tiếp)
                    battery = "Good",
                    lastReading = p.DateUtc,
                    temperature = p.Temperature,
                    humidity = p.Humidity ?? 0
                };
            }).ToList();

            await _hubContext.Clients.All.SendAsync("ReceiveStatusUpdate", result);
            return Ok(result);
        }

        [HttpGet("alerts")]
        public async Task<IActionResult> GetTemperatureAlerts([FromQuery] long? teamId = null)
        {
            var (accountId, isAdmin) = await GetAccountAndRoleAsync();

            // ⬇️ lấy cả NoActive để vẫn thấy thiết bị (nếu muốn chỉ alert cho Active thì để true)
            var devices = isAdmin
                ? _deviceService.GetAll()
                : await _deviceService.GetDevicesByAccountAsync(accountId, onlyActive: false);

            if (devices.Count == 0) return Ok(new List<object>());

            var serials = devices
                .Select(d => d.serialNumber)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var latest = await _readingService.GetLatestBySerialsAsync(serials);

            const double minTemp = 5.0, maxTemp = 25.0;

            var alerts = latest.Where(p => p != null && (p!.Temperature < minTemp || p.Temperature > maxTemp))
                .Select(p =>
                {
                    var dev = devices.FirstOrDefault(d =>
                        string.Equals(d.serialNumber, p!.SerialNumber, StringComparison.OrdinalIgnoreCase));

                    return new
                    {
                        serialNumber = p!.SerialNumber,
                        teamId = dev?.teamId ?? 0,
                        name = dev?.description ?? p.SerialNumber,
                        temperature = p.Temperature,
                        humidity = p.Humidity ?? 0,
                        message = $"⚠️ Nhiệt độ vượt ngưỡng an toàn ({p.Temperature:F1} °C)",
                        time = p.DateUtc
                    };
                })
                .ToList();

            foreach (var a in alerts)
            {
                var threshold = a.temperature > maxTemp ? maxTemp : minTemp;
                await _eventService.InsertTemperatureAlarmAsync(a.teamId, a.serialNumber, threshold, a.temperature);
            }

            if (alerts.Count > 0)
                await _hubContext.Clients.All.SendAsync("ReceiveAlert", alerts);

            return Ok(alerts);
        }

        // ===== 3) History =====
        [HttpGet("history")]
        public async Task<IActionResult> GetHistory(
            [FromQuery] string serial,
            [FromQuery] int take = 100,
            [FromQuery] string? teamId = null)
        {
            if (string.IsNullOrWhiteSpace(serial))
                return BadRequest(new { message = "Thiếu tham số 'serial'." });

            ObjectId accountId; bool isAdmin;
            try { (accountId, isAdmin) = await GetAccountAndRoleAsync(); }
            catch (Exception ex) { return BadRequest(new { message = ex.Message }); }

            if (!isAdmin)
            {
                var myDevices = await _deviceService.GetDevicesByAccountAsync(accountId /*, teamId*/);
                var allowed = myDevices.Any(d =>
                    string.Equals(d.serialNumber, serial, StringComparison.OrdinalIgnoreCase));
                if (!allowed) return Forbid("Bạn không có quyền xem thiết bị này.");
            }

            take = Math.Clamp(take, 1, 1000);
            var data = await _readingService.GetRecentAsync(serial, TimeSpan.FromDays(7)); // hoặc GetHistoryBySerialAsync nếu có
            return Ok(data.Take(take));
        }

        // ===== 4) My devices =====
        [HttpGet("my-devices")]
        public async Task<IActionResult> GetMyDevices([FromQuery] string? teamId = null)
        {
            ObjectId accountId; bool isAdmin;
            try { (accountId, isAdmin) = await GetAccountAndRoleAsync(); }
            catch (Exception ex) { return BadRequest(new { message = ex.Message }); }

            var list = isAdmin
                ? _deviceService.GetAll()
                : await _deviceService.GetDevicesByAccountAsync(accountId /*, teamId*/);

            if (list.Count == 0) return Ok(Array.Empty<object>());

            var result = list.Select(d => new
            {
                serial = d.serialNumber,
                d.teamId,
                name = d.description ?? d.deviceState ?? d.serialNumber,
                d.deviceState,                // trả về luôn cho tiện FE
                lastConnectionAt = d.lastConnectionDateUtc
            });

            return Ok(result);
        }
    }
}
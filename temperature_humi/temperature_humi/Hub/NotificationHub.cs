using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using temperature_humi.Helpers.Config;   // LogTagApiSettings
using temperature_humi.Service.LogtagService;          // AccountDeviceService

namespace temperature_humi.Hubs
{
    [Authorize] // dùng cookie auth hiện tại của bạn
    public class NotificationHub : Hub
    {
        private readonly AccountDeviceService _accDevs;
        private readonly LogTagApiSettings _cfg;

        public NotificationHub(AccountDeviceService accDevs, IOptions<LogTagApiSettings> cfg)
        {
            _accDevs = accDevs;
            _cfg = cfg.Value;
        }

        private static string? GetUserIdFromClaims(System.Security.Claims.ClaimsPrincipal user)
        {
            return user.FindFirst("AccountId")?.Value
                ?? user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? user.FindFirst("sub")?.Value
                ?? user.FindFirst("uid")?.Value;
        }

        public override async Task OnConnectedAsync()
        {
            var user = Context.User;

            // Admin/Owner nhận tất cả
            if (user?.IsInRole("Admin") == true || user?.IsInRole("Owner") == true)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, "admins");
                await base.OnConnectedAsync();
                return;
            }

            // User thường: join theo serial được gán trong team
            var uidStr = GetUserIdFromClaims(user!);
            if (!string.IsNullOrWhiteSpace(uidStr))
            {
                var serials = await _accDevs.GetMySerialsAsync(uidStr, _cfg.TeamId);
                foreach (var s in serials)
                    await Groups.AddToGroupAsync(Context.ConnectionId, $"serial:{s}");
            }
            await base.OnConnectedAsync();
        }

        // Cho phép client chủ động refresh mapping khi admin thay đổi gán thiết bị
        public async Task RefreshGroups()
        {
            // rời khỏi tất cả group cũ (trừ "admins" nếu là admin)
            // SignalR không có API liệt kê group của 1 connection, nên làm nhẹ nhàng:
            // - nếu là admin: đảm bảo vào group "admins"
            // - nếu là user: join lại theo serials
            var user = Context.User;
            if (user?.IsInRole("Admin") == true || user?.IsInRole("Owner") == true)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, "admins");
                return;
            }

            var uidStr = GetUserIdFromClaims(user!);
            if (!string.IsNullOrWhiteSpace(uidStr))
            {
                var serials = await _accDevs.GetMySerialsAsync(uidStr, _cfg.TeamId);
                foreach (var s in serials)
                    await Groups.AddToGroupAsync(Context.ConnectionId, $"serial:{s}");
            }
        }
    }
}

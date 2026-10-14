// Helpers/UserContext.cs
using System.Security.Claims;

namespace temperature_humi.Helpers
{
    public static class UserContext
    {
        public static string? GetUserId(HttpContext ctx)
        {
            // Bạn đã set cả "AccountId" (custom) và NameIdentifier
            var id = ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                  ?? ctx.User.FindFirst("AccountId")?.Value;
            return string.IsNullOrWhiteSpace(id) ? null : id;
        }

        public static bool IsAdmin(HttpContext ctx)
        {
            return ctx.User.IsInRole("Admin") || ctx.User.IsInRole("Owner");
        }
    }
}
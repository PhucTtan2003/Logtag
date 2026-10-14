using MongoDB.Bson;
using System.Security.Claims;

namespace temperature_humi.Models
{
    public static class ClaimsExtensions // Changed to static class to fix CS1106  
    {
        /// <summary>  
        /// Lấy ObjectId của user từ Claim "accountId" hoặc "sub"  
        /// </summary>  
        public static ObjectId GetObjectId(this ClaimsPrincipal user)
        {
            if (user == null) return ObjectId.Empty;

            // lấy từ token claims  
            var id =
                user.FindFirst("accountId")?.Value ??
                user.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
                user.FindFirst("sub")?.Value ??
                string.Empty;

            if (ObjectId.TryParse(id, out var oid))
                return oid;

            return ObjectId.Empty;
        }
    }
}

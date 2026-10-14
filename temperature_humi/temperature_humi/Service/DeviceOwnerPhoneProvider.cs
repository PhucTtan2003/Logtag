using Microsoft.AspNetCore.Http;
using MongoDB.Bson;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service.LogtagService;
using System;
using System.Collections.Generic;
using System.Linq;

namespace temperature_humi.Service
{
    public interface IDeviceOwnerPhoneProvider
    {
        Task<IReadOnlyList<string>> GetPhonesAsync(string serial, CancellationToken ct);
    }

    public class DeviceOwnerPhoneProvider : IDeviceOwnerPhoneProvider
    {
        private readonly IHttpContextAccessor _http;
        private readonly AccountDeviceService _accDevices;

        public DeviceOwnerPhoneProvider(
            IHttpContextAccessor http,
            AccountDeviceService accDevices)
        {
            _http = http;
            _accDevices = accDevices;
        }

        // ================= GET PHONE BY SERIAL =====================
        public async Task<IReadOnlyList<string>> GetPhonesAsync(string serial, CancellationToken ct)
        {
            // (1) Tìm user sở hữu thiết bị
            var ownerId = await _accDevices.GetOwnerUserIdAsync(serial, ct);
            if (ownerId == ObjectId.Empty)
            {
                Console.WriteLine($"[SMS] Không tìm thấy chủ sở hữu của serial {serial}");
                return Array.Empty<string>();
            }

            // (2) Lấy Session từ HttpContext (phiên user hiện tại)
            var ctx = _http.HttpContext;
            if (ctx == null)
            {
                Console.WriteLine("[SMS] Không có HttpContext → Không có Session");
                return Array.Empty<string>();
            }

            var phones = new List<string>();

            // ===== Kiểu mới: Phone1..Phone5 trong Session =====
            for (int i = 1; i <= 5; i++)
            {
                var raw = ctx.Session.GetString($"Phone{i}");
                var norm = NormalizePhone(raw);
                if (IsValidVnPhone(norm) && !phones.Contains(norm))
                {
                    phones.Add(norm);
                }
            }

            // ===== Fallback: kiểu cũ Phone:{ownerId} / Phone =====
            if (phones.Count == 0)
            {
                var keyOldPerUser = $"Phone:{ownerId}";
                var rawOldPerUser = ctx.Session.GetString(keyOldPerUser);
                var normOldPerUser = NormalizePhone(rawOldPerUser);
                if (IsValidVnPhone(normOldPerUser) && !phones.Contains(normOldPerUser))
                {
                    phones.Add(normOldPerUser);
                }

                var rawOld = ctx.Session.GetString("Phone");
                var normOld = NormalizePhone(rawOld);
                if (IsValidVnPhone(normOld) && !phones.Contains(normOld))
                {
                    phones.Add(normOld);
                }
            }

            if (phones.Count == 0)
            {
                Console.WriteLine($"[SMS] Không tìm thấy số điện thoại hợp lệ trong Session cho user {ownerId}");
                return Array.Empty<string>();
            }

            Console.WriteLine($"[SMS] Phones for serial {serial}: {string.Join(", ", phones)}");
            return phones;
        }

        // ================= HELPERS =====================
        private static string NormalizePhone(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return string.Empty;

            raw = raw.Trim();

            if (raw.StartsWith("+84"))
                raw = "0" + raw.Substring(3);

            if (raw.StartsWith("84"))
                raw = "0" + raw.Substring(2);

            return new string(raw.Where(char.IsDigit).ToArray());
        }

        private static bool IsValidVnPhone(string digits)
        {
            if (string.IsNullOrWhiteSpace(digits)) return false;
            // 0 + 9 số nữa
            return Regex.IsMatch(digits, @"^(0\d{9})$");
        }
    }
}

using Microsoft.Extensions.Logging;
using System;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Service.LogtagService.Lt5
{
    /// <summary>
    /// Service đọc dữ liệu LT5/LTGEO.
    ///
    /// Hỗ trợ mô hình mới:
    /// - Nhiều LogTag account
    /// - Mỗi account nhiều TeamID
    /// - Tự chọn đúng LogTagApiClient theo teamId thông qua LogTagAccountRouter
    ///
    /// Vẫn giữ overload cũ GetReadingsAsync(serial, startUtc, endUtc)
    /// để các controller hiện tại không bị vỡ khi chưa truyền teamId.
    /// </summary>
    public class Lt5Service
    {
        private readonly LogTagAccountRouter _router;
        private readonly ILogger<Lt5Service> _log;

        public Lt5Service(
            LogTagAccountRouter router,
            ILogger<Lt5Service> log)
        {
            _router = router;
            _log = log;
        }

        /// <summary>
        /// Overload cũ: tự lấy LT5 team mặc định từ LogTagAccounts hoặc LogTagTeamRouting.
        /// Dùng tạm cho controller cũ chưa truyền teamId.
        /// </summary>
        public Task<LtgeoReadingsEnvelope> GetReadingsAsync(
            string serial,
            DateTime? startUtc,
            DateTime? endUtc,
            CancellationToken ct = default)
        {
            var teamId = _router.GetDefaultTeamId("LT5");

            if (!teamId.HasValue || teamId.Value <= 0)
            {
                throw new InvalidOperationException(
                    "Không tìm thấy LT5 TeamID mặc định. Vui lòng cấu hình LogTagAccounts với Kind='LT5' hoặc LogTagTeamRouting:Lt5Teams.");
            }

            return GetReadingsAsync(teamId.Value, serial, startUtc, endUtc, ct);
        }

        /// <summary>
        /// Overload mới: truyền rõ teamId để tránh nhầm account khi có nhiều LT5 TeamID.
        /// Nên dùng overload này cho controller/API mới.
        /// </summary>
        public async Task<LtgeoReadingsEnvelope> GetReadingsAsync(
            long teamId,
            string serial,
            DateTime? startUtc,
            DateTime? endUtc,
            CancellationToken ct = default)
        {
            if (teamId <= 0)
                throw new ArgumentOutOfRangeException(nameof(teamId), "teamId không hợp lệ.");

            var serialNorm = (serial ?? string.Empty).Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(serialNorm))
                throw new ArgumentException("serial không được để trống.", nameof(serial));

            var client = _router.GetClientByTeamId(teamId);
            var accountKey = _router.GetAccountKeyByTeamId(teamId);

            _log.LogInformation(
                "[LT5-READINGS] Pull readings teamId={TeamId}, account={AccountKey}, serial={Serial}, start={Start:o}, end={End:o}",
                teamId,
                accountKey,
                serialNorm,
                startUtc,
                endUtc);

            return await client.GetLtgeoReadingsFullAsync(
                teamId,
                serialNorm,
                startUtc,
                endUtc,
                ct);
        }
    }
}

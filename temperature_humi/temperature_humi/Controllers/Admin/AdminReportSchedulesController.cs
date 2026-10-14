using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service.Reports;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/report-schedules")]
    [Authorize(Roles = "Admin")]
    public class AdminReportSchedulesController : ControllerBase
    {
        private readonly MonthlyReportService _reports;

        public AdminReportSchedulesController(MonthlyReportService reports)
        {
            _reports = reports;
        }

        // GET /api/admin/report-schedules?search=A0A&skip=0&take=100
        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] string? search,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            var (total, items) = await _reports.AdminListSchedulesAsync(search, skip, take, ct);
            return Ok(new { total, items = items.Select(ToDto) });
        }

        // PATCH /api/admin/report-schedules/{id}/toggle?enabled=true
        [HttpPatch("{id}/toggle")]
        public async Task<IActionResult> Toggle(string id, [FromQuery] bool enabled, CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(id, out var oid))
                return BadRequest(new { message = "Id không hợp lệ." });

            var updated = await _reports.ToggleAsync(oid, enabled, ct);
            if (updated == null) return NotFound(new { message = "Không tìm thấy lịch gửi báo cáo." });

            return Ok(new { message = "updated", item = ToDto(updated) });
        }

        // POST /api/admin/report-schedules/{id}/send-now
        [HttpPost("{id}/send-now")]
        public async Task<IActionResult> SendNow(string id, CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(id, out var oid))
                return BadRequest(new { message = "Id không hợp lệ." });

            try
            {
                var run = await _reports.SendNowByAdminAsync(oid, ct);
                return Ok(new { message = "sent", run = ToRunDto(run) });
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // GET /api/admin/report-schedules/runs?skip=0&take=50
        [HttpGet("runs")]
        public async Task<IActionResult> Runs([FromQuery] int skip = 0, [FromQuery] int take = 50, CancellationToken ct = default)
        {
            var items = await _reports.ListRunsAsync(null, skip, take, ct);
            return Ok(new { total = items.Count, items = items.Select(ToRunDto) });
        }

        private static object ToDto(Models.Reports.MonthlyReportSchedule x) => new
        {
            id = x.Id.ToString(),
            userId = x.UserId.ToString(),
            teamId = x.TeamId,
            serialNumbers = x.SerialNumbers,
            recipients = x.Recipients,
            cc = x.Cc,
            isEnabled = x.IsEnabled,
            frequency = x.Frequency,
            sendDayOfMonth = x.SendDayOfMonth,
            sendTimeLocal = x.SendTimeLocal,
            timeZoneId = x.TimeZoneId,
            format = x.Format,
            notes = x.Notes,
            createdAtUtc = x.CreatedAtUtc,
            updatedAtUtc = x.UpdatedAtUtc
        };

        private static object ToRunDto(Models.Reports.MonthlyReportRun x) => new
        {
            id = x.Id.ToString(),
            scheduleId = x.ScheduleId.ToString(),
            userId = x.UserId.ToString(),
            periodKey = x.PeriodKey,
            fromUtc = x.FromUtc,
            toUtc = x.ToUtc,
            status = x.Status,
            totalReadings = x.TotalReadings,
            recipients = x.Recipients,
            cc = x.Cc,
            attachmentNames = x.AttachmentNames,
            error = x.Error,
            startedAtUtc = x.StartedAtUtc,
            sentAtUtc = x.SentAtUtc,
            finishedAtUtc = x.FinishedAtUtc
        };
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service.Reports;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/report-schedules")]
    [Authorize]
    public class ReportSchedulesController : ControllerBase
    {
        private readonly MonthlyReportService _reports;

        public ReportSchedulesController(MonthlyReportService reports)
        {
            _reports = reports;
        }

        // GET /api/report-schedules
        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct = default)
        {
            var userId = MonthlyReportService.GetUserObjectId(User);
            var items = await _reports.ListForUserAsync(userId, ct);

            return Ok(new
            {
                total = items.Count,
                items = items.Select(ToDto)
            });
        }

        // POST /api/report-schedules
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] MonthlyReportCreateDto dto, CancellationToken ct = default)
        {
            try
            {
                var userId = MonthlyReportService.GetUserObjectId(User);
                var created = await _reports.CreateForUserAsync(userId, dto, ct);
                return Ok(new { message = "created", item = ToDto(created) });
            }
            catch (UnauthorizedAccessException ex)
            {
                return StatusCode(403, new { message = ex.Message });
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // PUT /api/report-schedules/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(string id, [FromBody] MonthlyReportUpdateDto dto, CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(id, out var oid))
                return BadRequest(new { message = "Id không hợp lệ." });

            try
            {
                var userId = MonthlyReportService.GetUserObjectId(User);
                var updated = await _reports.UpdateForUserAsync(userId, oid, dto, isAdmin: false, ct);
                if (updated == null) return NotFound(new { message = "Không tìm thấy lịch gửi báo cáo." });
                return Ok(new { message = "updated", item = ToDto(updated) });
            }
            catch (UnauthorizedAccessException ex)
            {
                return StatusCode(403, new { message = ex.Message });
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // DELETE /api/report-schedules/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id, CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(id, out var oid))
                return BadRequest(new { message = "Id không hợp lệ." });

            var userId = MonthlyReportService.GetUserObjectId(User);
            var ok = await _reports.DeleteForUserAsync(userId, oid, isAdmin: false, ct);
            if (!ok) return NotFound(new { message = "Không tìm thấy lịch gửi báo cáo." });

            return Ok(new { message = "deleted" });
        }

        // POST /api/report-schedules/{id}/send-test
        [HttpPost("{id}/send-test")]
        public async Task<IActionResult> SendTest(string id, CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(id, out var oid))
                return BadRequest(new { message = "Id không hợp lệ." });

            try
            {
                var userId = MonthlyReportService.GetUserObjectId(User);
                var run = await _reports.SendTestAsync(userId, oid, isAdmin: false, ct);
                return Ok(new { message = "sent", run = ToRunDto(run) });
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // GET /api/report-schedules/runs?skip=0&take=50
        [HttpGet("runs")]
        public async Task<IActionResult> Runs([FromQuery] int skip = 0, [FromQuery] int take = 50, CancellationToken ct = default)
        {
            var userId = MonthlyReportService.GetUserObjectId(User);
            var items = await _reports.ListRunsAsync(userId, skip, take, ct);
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

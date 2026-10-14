// Controllers/Lt5ProfilesController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Service.LogtagService.Lt5;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/lt5")]
    //[Authorize] // tuỳ bạn bật lại theo cookie auth
    [Produces("application/json")]
    public class Lt5ProfilesController : ControllerBase
    {
        private readonly Lt5ProfilesStoreService _store;

        public Lt5ProfilesController(Lt5ProfilesStoreService store)
        {
            _store = store;
        }

        /// <summary>
        /// FE: Lấy danh sách Logger Profiles của team LT5 (đọc từ DB cache).
        /// </summary>
        [HttpGet("profiles")]
        public async Task<IActionResult> GetProfiles(CancellationToken ct)
        {
            try
            {
                var data = await _store.ListAsync(ct);
                return Ok(new { data });
            }
            catch (OperationCanceledException)
            {
                return StatusCode(499, new { message = "client canceled" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Get LT5 profiles failed", error = ex.Message });
            }
        }

        /// <summary>
        /// Admin/manual: Sync profiles từ LogTag Online về MongoDB.
        /// </summary>
        //[Authorize(Roles = "Admin")]
        [HttpPost("profiles/sync")]
        public async Task<IActionResult> SyncProfiles(CancellationToken ct)
        {
            try
            {
                var synced = await _store.SyncAsync(ct);
                return Ok(new { ok = true, synced });
            }
            catch (OperationCanceledException)
            {
                return StatusCode(499, new { message = "client canceled" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Sync LT5 profiles failed", error = ex.Message });
            }
        }

        /// <summary>
        /// Detail: lấy 1 profile theo profileId (loggerProfileId) từ DB.
        /// </summary>
        [HttpGet("profiles/{profileId:int}")]
        public async Task<IActionResult> GetProfileById([FromRoute] int profileId, CancellationToken ct)
        {
            try
            {
                if (profileId <= 0) return BadRequest(new { message = "profileId invalid" });

                var p = await _store.GetByProfileIdAsync(profileId, ct);
                if (p == null) return NotFound(new { message = "Profile not found" });

                return Ok(p);
            }
            catch (OperationCanceledException)
            {
                return StatusCode(499, new { message = "client canceled" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Get LT5 profile failed", error = ex.Message });
            }
        }
    }
}
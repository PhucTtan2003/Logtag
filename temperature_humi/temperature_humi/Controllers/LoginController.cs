using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using System.Security.Claims;
using temperature_humi.Models;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

namespace temperature_humi.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public class LoginController : ControllerBase
    {
        private static readonly TimeSpan NormalLoginLifetime = TimeSpan.FromHours(8);
        private static readonly TimeSpan RememberLoginLifetime = TimeSpan.FromDays(30);

        private readonly AccountService _accountService;
        private readonly RoleService _roleService;
        private readonly LoginSessionService _loginSessionService;
        private readonly LogTagApiClient _logTagApiClient;
        private readonly ILogger<LoginController> _logger;

        public sealed class LoginDto
        {
            public string Email { get; set; } = string.Empty;
            public string Password { get; set; } = string.Empty;
            public bool RememberMe { get; set; }
        }

        private static string NormalizePhone(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return string.Empty;

            raw = raw.Trim();
            if (raw.StartsWith("+84", StringComparison.Ordinal))
                raw = "84" + raw[3..];

            return new string(raw.Where(char.IsDigit).ToArray());
        }

        public LoginController(
            AccountService accountService,
            RoleService roleService,
            LoginSessionService loginSessionService,
            LogTagApiClient logTagApiClient,
            ILogger<LoginController> logger)
        {
            _accountService = accountService;
            _roleService = roleService;
            _loginSessionService = loginSessionService;
            _logTagApiClient = logTagApiClient;
            _logger = logger;
        }

        // POST /api/auth/login
        [AllowAnonymous]
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginDto request)
        {
            try
            {
                // Cookie vẫn hợp lệ thì không tạo thêm phiên đăng nhập mới.
                if (User?.Identity?.IsAuthenticated == true)
                {
                    return StatusCode(StatusCodes.Status409Conflict, new
                    {
                        message = "Bạn đã đăng nhập rồi."
                    });
                }

                if (request == null ||
                    string.IsNullOrWhiteSpace(request.Email) ||
                    string.IsNullOrWhiteSpace(request.Password))
                {
                    return BadRequest(new { message = "Thiếu email hoặc mật khẩu." });
                }

                var email = request.Email.Trim();
                var user = await _accountService.FindByEmailAsync(email);

                if (user == null || !PasswordHasher.Verify(request.Password, user.Passwords))
                {
                    return BadRequest(new { message = "Email hoặc mật khẩu không đúng." });
                }

                // Tài khoản không hoạt động quá 30 ngày sẽ bị khóa theo nghiệp vụ hiện tại.
                if (user.LastLoginAt != default &&
                     user.LastLoginAt.AddDays(30) < DateTime.UtcNow)
                {
                    user.IsActive = false;
                    user.UpdateAt = DateTime.UtcNow;
                    await _accountService.UpdateAsync(user.Id, user);

                    return StatusCode(StatusCodes.Status403Forbidden, new
                    {
                        message = "Tài khoản đã bị khóa do không hoạt động trong 30 ngày."
                    });
                }

                if (!user.IsActive)
                {
                    return StatusCode(StatusCodes.Status403Forbidden, new
                    {
                        message = "Tài khoản đang bị khóa, liên hệ quản trị viên."
                    });
                }

                var role = await _roleService.GetRoleByIdAsync(user.RoleId);
                var roleName = role?.RoleName?.Trim();
                if (string.IsNullOrWhiteSpace(roleName))
                    roleName = "User";

                var normalizedPhone = NormalizePhone(user.Phone);
                var nowUtc = DateTime.UtcNow;
                var lifetime = request.RememberMe
                    ? RememberLoginLifetime
                    : NormalLoginLifetime;
                var expiresUtc = nowUtc.Add(lifetime);

                user.LastLoginAt = nowUtc;
                user.UpdateAt = nowUtc;
                await _accountService.UpdateAsync(user.Id, user);

                var claims = new List<Claim>
                {
                    new("AccountId", user.Id.ToString()),
                    new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                    new(ClaimTypes.Name, user.FullName ?? user.Email),
                    new(ClaimTypes.Email, user.Email),
                    new(ClaimTypes.Role, roleName),
                    new("remember_me", request.RememberMe ? "true" : "false")
                };

                if (!string.IsNullOrWhiteSpace(normalizedPhone))
                {
                    claims.Add(new Claim(ClaimTypes.MobilePhone, normalizedPhone));
                    claims.Add(new Claim("phone", normalizedPhone));
                    claims.Add(new Claim("phone_number", normalizedPhone));
                }

                // Session chỉ dùng cho dữ liệu tiện ích, không dùng làm nguồn xác thực chính.
                HttpContext.Session.SetString("Phone", normalizedPhone);
                HttpContext.Session.SetString("AccountId", user.Id.ToString());

                var identity = new ClaimsIdentity(
                    claims,
                    CookieAuthenticationDefaults.AuthenticationScheme);
                var principal = new ClaimsPrincipal(identity);

                // Chỉ giữ một phiên active cho mỗi tài khoản.
                await _loginSessionService.DeactivateSessionsAsync(user.Id);
                await _loginSessionService.CreateAsync(new LoginSession
                {
                    AccountId = user.Id,
                    LoginTime = nowUtc,
                    ExpiresAt = expiresUtc,
                    IsActive = true
                });

                await HttpContext.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    principal,
                    new AuthenticationProperties
                    {
                        IsPersistent = request.RememberMe,
                        IssuedUtc = new DateTimeOffset(nowUtc),
                        ExpiresUtc = new DateTimeOffset(expiresUtc),
                        AllowRefresh = true
                    });

                List<long> teamIds = new();
                try
                {
                    var tokenDto = await _logTagApiClient.GetTokenDtoAsync();
                    teamIds = tokenDto.TeamIds ?? new List<long>();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Không lấy được danh sách team LogTag sau khi đăng nhập.");
                }

                return Ok(new
                {
                    message = "Đăng nhập thành công",
                    authenticated = true,
                    expiresAtUtc = expiresUtc,
                    rememberMe = request.RememberMe,
                    user = new
                    {
                        id = user.Id.ToString(),
                        user.FullName,
                        user.Email,
                        normalizedPhone,
                        roleName
                    },
                    logtag = new { teams = teamIds }
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi đăng nhập cho email {Email}", request?.Email);
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    message = "Không thể đăng nhập lúc này. Vui lòng thử lại."
                });
            }
        }

        // GET /api/auth/me
        // Frontend dùng endpoint này khi tải lại trang hoặc khi cookie vẫn còn hiệu lực.
        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> Me()
        {
            var accountIdText =
                User.FindFirstValue("AccountId") ??
                User.FindFirstValue(ClaimTypes.NameIdentifier);

            if (!ObjectId.TryParse(accountIdText, out var accountId))
            {
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Unauthorized(new { authenticated = false, message = "Phiên đăng nhập không hợp lệ." });
            }

            var user = await _accountService.GetByIdAsync(accountId);
            if (user == null || !user.IsActive)
            {
                await _loginSessionService.DeactivateSessionsAsync(accountId);
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                HttpContext.Session.Clear();

                return Unauthorized(new
                {
                    authenticated = false,
                    message = "Tài khoản không tồn tại hoặc đã bị khóa."
                });
            }

            var role = await _roleService.GetRoleByIdAsync(user.RoleId);
            var roleName = role?.RoleName ?? User.FindFirstValue(ClaimTypes.Role) ?? "User";
            var normalizedPhone = NormalizePhone(user.Phone);

            // Khôi phục dữ liệu Session nếu Session đã hết nhưng cookie auth vẫn còn.
            HttpContext.Session.SetString("Phone", normalizedPhone);
            HttpContext.Session.SetString("AccountId", user.Id.ToString());

            return Ok(new
            {
                authenticated = true,
                user = new
                {
                    id = user.Id.ToString(),
                    user.FullName,
                    user.Email,
                    normalizedPhone,
                    roleName
                }
            });
        }

        // POST /api/auth/logout
        [Authorize]
        [HttpPost("logout")]
        public async Task<IActionResult> Logout([FromBody] LogOutRequest? model)
        {
            ObjectId accountId;

            if (model != null && ObjectId.TryParse(model.AccountId, out var parsed))
            {
                accountId = parsed;
            }
            else
            {
                var claimId =
                    User.FindFirstValue("AccountId") ??
                    User.FindFirstValue(ClaimTypes.NameIdentifier);

                if (!ObjectId.TryParse(claimId, out accountId))
                    return BadRequest(new { message = "AccountId không hợp lệ." });
            }

            await _loginSessionService.DeactivateSessionsAsync(accountId);
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            HttpContext.Session.Clear();

            return Ok(new { message = "Đăng xuất thành công." });
        }

        [Authorize]
        [HttpGet("debug-claims")]
        public IActionResult DebugClaims()
        {
            var claims = HttpContext.User.Claims.Select(c => new { c.Type, c.Value });
            return Ok(claims);
        }

        // Cookie middleware trả status code cho SPA, không redirect HTML.
        [AllowAnonymous]
        [HttpGet("login")]
        public IActionResult LoginRedirect()
            => Unauthorized(new { message = "Bạn chưa đăng nhập." });

        [AllowAnonymous]
        [HttpGet("forbidden")]
        public IActionResult Forbidden()
            => StatusCode(StatusCodes.Status403Forbidden, new { message = "Bạn không có quyền truy cập." });
    }
}
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using temperature_humi.Data;
using temperature_humi.Models;
using temperature_humi.Service.LogtagService;

public sealed class AccountEventsService
{
    private const double MaxCloudRangeDays = 31.5;

    private readonly IMongoCollection<AccountDevice> _accountDevices;
    private readonly LogTagAccountRouter _logTagRouter;
    private readonly EventService _eventStore;
    private readonly ILogger<AccountEventsService> _log;

    public AccountEventsService(
        IOptions<MongoDBSettings> mongo,
        LogTagAccountRouter logTagRouter,
        EventService eventStore,
        ILogger<AccountEventsService> log)
    {
        var settings = mongo.Value;

        var client = new MongoClient(
            settings.ConnectionString);

        var database = client.GetDatabase(
            settings.DatabaseName);

        _accountDevices =
            database.GetCollection<AccountDevice>(
                "AccountDevices");

        _logTagRouter = logTagRouter;
        _eventStore = eventStore;
        _log = log;

        // Không tạo index trong constructor.
        // Index AccountDevices phải được tạo một lần tại Program.cs
        // thông qua AccountDeviceService.EnsureIndexesAsync().
    }

    public sealed record AssignedDevice(
        long TeamId,
        string SerialNumber);

    private static string NormalizeSerial(
        string? serial)
    {
        return (serial ?? string.Empty)
            .Trim()
            .ToUpperInvariant();
    }

    private static DateTime? NormalizeUtc(
        DateTime? value)
    {
        if (!value.HasValue)
            return null;

        return value.Value.Kind switch
        {
            DateTimeKind.Utc =>
                value.Value,

            DateTimeKind.Local =>
                value.Value.ToUniversalTime(),

            _ =>
                DateTime.SpecifyKind(
                    value.Value,
                    DateTimeKind.Utc)
        };
    }

    private static ObjectId GetUserIdOrThrow(
        ClaimsPrincipal user)
    {
        var raw =
            user.FindFirstValue(
                ClaimTypes.NameIdentifier)
            ?? user.FindFirst("userId")?.Value
            ?? user.FindFirst("UserId")?.Value
            ?? user.FindFirst("id")?.Value
            ?? user.FindFirst("Id")?.Value
            ?? user.FindFirst("accountId")?.Value
            ?? user.FindFirst("AccountId")?.Value
            ?? user.FindFirst("sub")?.Value
            ?? user.FindFirst("uid")?.Value;

        if (!ObjectId.TryParse(
                raw,
                out var userId))
        {
            throw new UnauthorizedAccessException(
                "Không xác định được UserId hợp lệ từ token.");
        }

        return userId;
    }

    /// <summary>
    /// Trả về tất cả thiết bị được gán cho user trên mọi TeamId.
    /// Không còn giới hạn theo LogTagApiSettingsMain.TeamId.
    /// </summary>
    public async Task<IReadOnlyList<AssignedDevice>>
        GetMyDevicesAsync(
            ClaimsPrincipal user,
            CancellationToken ct = default)
    {
        var userId =
            GetUserIdOrThrow(user);

        var rows = await _accountDevices
            .Find(x => x.UserId == userId)
            .Project(x => new
            {
                x.TeamId,
                x.SerialNumber
            })
            .ToListAsync(ct);

        return rows
            .Where(x =>
                x.TeamId > 0 &&
                !string.IsNullOrWhiteSpace(
                    x.SerialNumber))
            .Select(x => new AssignedDevice(
                x.TeamId,
                NormalizeSerial(
                    x.SerialNumber)))
            .Where(x =>
                !string.IsNullOrWhiteSpace(
                    x.SerialNumber))
            .GroupBy(x => new
            {
                x.TeamId,
                x.SerialNumber
            })
            .Select(g => g.First())
            .OrderBy(x => x.TeamId)
            .ThenBy(x => x.SerialNumber)
            .ToArray();
    }

    /// <summary>
    /// Danh sách serial user có quyền trên tất cả team.
    /// Giữ chữ ký cũ để controller/frontend hiện tại tiếp tục sử dụng.
    /// </summary>
    public async Task<IReadOnlyList<string>>
        GetMySerialsAsync(
            ClaimsPrincipal user,
            CancellationToken ct = default)
    {
        var devices =
            await GetMyDevicesAsync(
                user,
                ct);

        return devices
            .Select(x => x.SerialNumber)
            .Distinct(
                StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToArray();
    }

    /// <summary>
    /// Xác định mapping TeamId + SerialNumber mà user được phép truy cập.
    /// Với Admin/Owner, tìm mapping mới nhất của serial trên toàn hệ thống.
    /// </summary>
    public async Task<AssignedDevice?>
        ResolveDeviceAsync(
            ClaimsPrincipal user,
            string serialNumber,
            CancellationToken ct = default)
    {
        var serial =
            NormalizeSerial(serialNumber);

        if (string.IsNullOrWhiteSpace(serial))
            return null;

        FilterDefinition<AccountDevice> filter;

        if (user.IsInRole("Admin") ||
            user.IsInRole("Owner"))
        {
            filter =
                Builders<AccountDevice>.Filter.Eq(
                    x => x.SerialNumber,
                    serial);
        }
        else
        {
            var userId =
                GetUserIdOrThrow(user);

            filter =
                Builders<AccountDevice>.Filter.And(
                    Builders<AccountDevice>.Filter.Eq(
                        x => x.UserId,
                        userId),
                    Builders<AccountDevice>.Filter.Eq(
                        x => x.SerialNumber,
                        serial));
        }

        var mapping = await _accountDevices
            .Find(filter)
            .SortByDescending(
                x => x.AssignedAtUtc)
            .FirstOrDefaultAsync(ct);

        if (mapping == null ||
            mapping.TeamId <= 0 ||
            string.IsNullOrWhiteSpace(
                mapping.SerialNumber))
        {
            return null;
        }

        return new AssignedDevice(
            mapping.TeamId,
            NormalizeSerial(
                mapping.SerialNumber));
    }

    /// <summary>
    /// Kiểm tra user có quyền xem serial trên bất kỳ team nào hay không.
    /// </summary>
    public async Task<bool> CanAccessAsync(
        ClaimsPrincipal user,
        string serialNumber,
        CancellationToken ct = default)
    {
        return await ResolveDeviceAsync(
            user,
            serialNumber,
            ct) != null;
    }

    /// <summary>
    /// Kéo sự kiện từ đúng LogTag account/team, lưu vào MongoDB
    /// và trả response gốc cho frontend.
    /// </summary>
    public async Task<LogTagApiClient.LogTagEventsResponse>
        FetchStoreAndReturnAsync(
            ClaimsPrincipal user,
            string serialNumber,
            DateTime? startUtc,
            DateTime? endUtc,
            CancellationToken ct = default)
    {
        var result =
            await FetchAndStoreCoreAsync(
                user,
                serialNumber,
                startUtc,
                endUtc,
                ct);

        return result.response;
    }

    /// <summary>
    /// Kéo từ LogTag và trả đúng số bản ghi mới được chèn vào MongoDB.
    /// </summary>
    public async Task<int> FetchAndStoreOnceAsync(
        ClaimsPrincipal user,
        string serialNumber,
        DateTime? startUtc,
        DateTime? endUtc,
        CancellationToken ct = default)
    {
        var result =
            await FetchAndStoreCoreAsync(
                user,
                serialNumber,
                startUtc,
                endUtc,
                ct);

        return result.inserted;
    }

    private async Task<(
        LogTagApiClient.LogTagEventsResponse response,
        int inserted)> FetchAndStoreCoreAsync(
            ClaimsPrincipal user,
            string serialNumber,
            DateTime? startUtc,
            DateTime? endUtc,
            CancellationToken ct)
    {
        var device =
            await ResolveDeviceAsync(
                user,
                serialNumber,
                ct);

        if (device == null)
        {
            throw new UnauthorizedAccessException(
                "Thiết bị không được gán cho tài khoản.");
        }

        var normalizedEnd =
            NormalizeUtc(endUtc)
            ?? DateTime.UtcNow;

        var normalizedStart =
            NormalizeUtc(startUtc)
            ?? normalizedEnd.AddDays(-31);

        if (normalizedStart >
            normalizedEnd)
        {
            (normalizedStart, normalizedEnd) =
                (normalizedEnd, normalizedStart);
        }

        if ((normalizedEnd -
             normalizedStart).TotalDays >
            MaxCloudRangeDays)
        {
            throw new ArgumentOutOfRangeException(
                nameof(startUtc),
                "Khoảng thời gian kéo LogTag không được vượt quá 31 ngày.");
        }

        var client =
            _logTagRouter.GetClientByTeamId(
                device.TeamId);

        _log.LogInformation(
            "[AccountEvents] Fetching Team={TeamId}, Serial={Serial}, Start={Start:O}, End={End:O}.",
            device.TeamId,
            device.SerialNumber,
            normalizedStart,
            normalizedEnd);

        var response =
            await client.GetEventsAsync(
                device.SerialNumber,
                normalizedStart,
                normalizedEnd,
                ct);

        if (response == null)
        {
            throw new InvalidOperationException(
                "LogTag không trả về dữ liệu sự kiện.");
        }

        var inserted =
            await _eventStore.SaveNewEventsAsync(
                device.SerialNumber,
                response,
                ct);

        _log.LogInformation(
            "[AccountEvents] Completed Team={TeamId}, Serial={Serial}, Api={ApiCount}, Inserted={Inserted}.",
            device.TeamId,
            device.SerialNumber,
            response.data?.Count ?? 0,
            inserted);

        return (
            response,
            inserted);
    }

    /// <summary>
    /// Đọc Events đã lưu trong MongoDB, không gọi LogTag Cloud.
    /// </summary>
    public async Task<List<Event>> QuerySavedAsync(
        ClaimsPrincipal user,
        string serialNumber,
        DateTime? startUtc,
        DateTime? endUtc,
        int? limit,
        CancellationToken ct = default)
    {
        var device =
            await ResolveDeviceAsync(
                user,
                serialNumber,
                ct);

        if (device == null)
        {
            throw new UnauthorizedAccessException(
                "Thiết bị không được gán cho tài khoản.");
        }

        var normalizedStart =
            NormalizeUtc(startUtc);

        var normalizedEnd =
            NormalizeUtc(endUtc);

        if (normalizedStart.HasValue &&
            normalizedEnd.HasValue &&
            normalizedStart.Value >
            normalizedEnd.Value)
        {
            (normalizedStart, normalizedEnd) =
                (normalizedEnd, normalizedStart);
        }

        var safeLimit = Math.Clamp(
            limit ?? 500,
            1,
            50_000);

        return await _eventStore.QueryAsync(
            serialNumber:
                device.SerialNumber,
            startUtc:
                normalizedStart,
            endUtc:
                normalizedEnd,
            limit:
                safeLimit,
            eventType:
                null,
            ct:
                ct);
    }
}
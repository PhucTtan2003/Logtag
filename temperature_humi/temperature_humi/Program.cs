using Microsoft.AspNetCore.HttpOverrides;
using System.Net;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using Polly;
using System.Configuration;
using System.Text.Json;
using temperature_humi.Background;
using temperature_humi.Data;
using temperature_humi.Helpers.Config;
using temperature_humi.Hubs;
using temperature_humi.Infrastructure;
using temperature_humi.Models;
using temperature_humi.Models.SmsFpt;
using temperature_humi.Service;
using temperature_humi.Service.Admin;
using temperature_humi.Service.LogtagService;
using temperature_humi.Service.LogtagService.Lt5;
using temperature_humi.Service.Reports;
using temperature_humi.Service.SmsSchedule;
using static Org.BouncyCastle.Math.EC.ECCurve;
using static temperature_humi.Service.LocationReadingService;

var builder = WebApplication.CreateBuilder(args);

// WorkerMode=ApiOnly: test Docker API, không tự polling hoặc gửi SMS theo lịch.
// WorkerMode=Full (mặc định): giữ hành vi vận hành trước đây.
var workerMode = builder.Configuration["WorkerMode"] ?? "Full";
if (!string.Equals(workerMode, "Full", StringComparison.OrdinalIgnoreCase) &&
    !string.Equals(workerMode, "ApiOnly", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("WorkerMode phải là Full hoặc ApiOnly.");
var runBackgroundWorkers = !string.Equals(workerMode, "ApiOnly", StringComparison.OrdinalIgnoreCase);

// Linux Docker dùng volume lưu key; Windows local dùng LocalApplicationData.
var keysPath = builder.Configuration["DataProtection:KeysPath"];
if (string.IsNullOrWhiteSpace(keysPath))
    keysPath = OperatingSystem.IsWindows()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "temperature_humi", "dataprotection-keys")
        : "/var/lib/temperature_humi/dataprotection-keys";
Directory.CreateDirectory(keysPath);
builder.Services
    .AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(keysPath))
    .SetApplicationName("temperature_humi");

// Nginx HTTPS termination: chỉ tin header của proxy được cấu hình cụ thể.
// Với Nginx bên host Docker, khai báo ReverseProxy__KnownProxy là IP gateway của Docker.
var proxyAddress = builder.Configuration["ReverseProxy:KnownProxy"];
if (!string.IsNullOrWhiteSpace(proxyAddress))
{
    if (!IPAddress.TryParse(proxyAddress, out var trustedProxy))
        throw new InvalidOperationException("ReverseProxy:KnownProxy phải là địa chỉ IP hợp lệ.");
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownProxies.Add(trustedProxy);
    });
}
// ==============================
// 1) Services (DI)
// ==============================

builder.Services.AddControllersWithViews();

builder.Services.AddControllers()
    .AddJsonOptions(opt =>
    {
        opt.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    });

// SignalR
builder.Services.AddSignalR(o =>
{
    o.EnableDetailedErrors = true;
    o.KeepAliveInterval = TimeSpan.FromSeconds(10);
    o.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
}).AddJsonProtocol();

builder.Services.AddHttpClient();

// Response compression
builder.Services.AddResponseCompression(opts =>
{
    opts.EnableForHttps = true;
    opts.MimeTypes = new[]
    {
        "application/octet-stream",
        "application/json",
        "text/plain",
        "text/html",
        "text/css",
        "application/javascript"
    };
});

// ===== Infra singletons
builder.Services.AddSingleton<EndpointRateLimiter>();
builder.Services.AddSingleton<SingleFlight>();
builder.Services.AddSingleton<SimpleMemoryCache>();

builder.Services.AddSingleton(new EventIngestCacheOptions
{
    CoalesceWindow = TimeSpan.FromSeconds(2),
    FlushInterval = TimeSpan.FromSeconds(1),
    BatchSize = 1500,
    QueueCapacity = 50_000,

    EnableInMemoryDedupe = true,
    DedupeTtl = TimeSpan.FromHours(1),
    DedupeTimeRounding = TimeSpan.FromSeconds(1),
    SweepInterval = TimeSpan.FromMinutes(2),
    MaxDedupeKeys = 1_000_000
});
builder.Services.AddSingleton<EventIngestProcessingCache>(sp =>
{
    var opt = sp.GetRequiredService<EventIngestCacheOptions>();
    var scopeFactory = sp.GetRequiredService<IServiceScopeFactory>();
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger<EventIngestProcessingCache>();

    return new EventIngestProcessingCache(opt, async (docs, ct) =>
    {
        using var scope = scopeFactory.CreateScope();
        var svc = scope.ServiceProvider.GetRequiredService<EventService>();

        try
        {
            return await svc.InsertManySkipDuplicatesAsync(docs, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[EventCache] Flush failed. docs={count}", docs?.Count ?? 0);
            throw;
        }
    });
});


if (runBackgroundWorkers) builder.Services.AddHostedService<EventIngestCacheWorker>();

// ===== Bind configs
builder.Services.Configure<MongoDBSettings>(builder.Configuration.GetSection("MongoDbSettings"));
builder.Services.Configure<ReadingsPollingSettings>(builder.Configuration.GetSection("ReadingsPolling"));
builder.Services.Configure<LatestStatusSyncOptions>(builder.Configuration.GetSection("LatestStatusSync"));
builder.Services.Configure<AlertRealtimeOptions>(builder.Configuration.GetSection("AlertRealtime"));
builder.Services.Configure<ProfilesPollingSettings>(builder.Configuration.GetSection("ProfilesPolling"));
builder.Services.Configure<ExportSettings>(builder.Configuration.GetSection("ExportSettings"));
builder.Services.Configure<DeviceSyncOptions>(builder.Configuration.GetSection("DeviceSync"));
builder.Services.Configure<FptSmsOptions>(builder.Configuration.GetSection("FptSms"));
builder.Services.Configure<SmsEventOptions>(builder.Configuration.GetSection("SmsEvent"));
builder.Services.Configure<EndpointSchedulerOptions>(
    builder.Configuration.GetSection("EndpointScheduler"));
builder.Services.Configure<MonthlyReportOptions>(
    builder.Configuration.GetSection("MonthlyReport"));

builder.Services.Configure<SmtpReportOptions>(
    builder.Configuration.GetSection("SmtpReport"));
// Base client cũ -> dùng cấu hình Main
builder.Services.Configure<LogTagApiSettings>(
    builder.Configuration.GetSection("LogTagApiMain"));

// Main account
builder.Services.Configure<LogTagApiSettingsMain>(
    builder.Configuration.GetSection("LogTagApiMain"));

builder.Services.Configure<LogTagApiSettingsLt5>(builder.Configuration.GetSection("LogTagApiLt5"));

builder.Services.Configure<LogTagTeamRoutingOptions>(builder.Configuration.GetSection("LogTagTeamRouting"));
builder.Services.Configure<LogTagAccountsOptions>(builder.Configuration.GetSection("LogTagAccounts"));

builder.Services.AddMemoryCache();

builder.Services.AddHttpClient<IFptSmsService, FptSmsService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
});

// ======================================================
// SMS SERVICES
// ======================================================
// Đăng ký bằng tên đầy đủ để tránh nhầm namespace hoặc chạy nhầm
// bản Program.cs cũ. TryAddSingleton cũng tránh đăng ký trùng.
builder.Services.TryAddSingleton<temperature_humi.Service.SmsQuotaService>();
// Persistent idempotency store for SMS dispatches (MongoDB: SmsDispatches).
builder.Services.TryAddSingleton<temperature_humi.Service.SmsDispatchService>();
builder.Services.TryAddSingleton<ISmsRateLimiter, SmsRateLimiter>();
builder.Services.TryAddSingleton<ISmsEventNotifier, SmsEventNotifier>();


////test lát xóa
//builder.Services.Configure<LogTagContinuousQuotaTestOptions>(
//    builder.Configuration.GetSection("LogTagContinuousQuotaTest"));
//builder.Services.Configure<LogTagTestFilterOptions>(
//    builder.Configuration.GetSection("LogTagTestFilter"));
//builder.Services.AddSingleton<LogTagContinuousQuotaTestWorker>();
//builder.Services.AddHostedService(sp =>
//    sp.GetRequiredService<LogTagContinuousQuotaTestWorker>());
// Provider để EventService lấy phone người nhận theo serial 
builder.Services.AddSingleton<IDeviceOwnerPhoneProvider, DeviceOwnerPhoneProvider>();

// ===== App services
builder.Services.AddSingleton<LogTagApiClient>();
builder.Services.AddSingleton<WarrantyService>();
builder.Services.AddSingleton<AccountService>();
builder.Services.AddSingleton<RoleService>();
builder.Services.AddSingleton<LoginSessionService>();
builder.Services.AddSingleton<DeviceService>();
builder.Services.AddSingleton<ParameterService>();
builder.Services.AddSingleton<NotificationService>();
builder.Services.AddSingleton<StatusService>();
builder.Services.AddSingleton<AlertService>();
builder.Services.AddSingleton<AccountDeviceService>();
builder.Services.AddSingleton<LocationReadingService>();
builder.Services.AddSingleton<EventService>();
builder.Services.AddSingleton<AccountEventsService>();
builder.Services.AddSingleton<EmployeeAccountDeviceService>();
if (runBackgroundWorkers) builder.Services.AddHostedService<ProfilesPollingStream>();
builder.Services.AddSingleton<DeviceAlarmRuleService>();
builder.Services.AddSingleton<AlertThresholdService>();
builder.Services.AddSingleton<Lt5Service>();
builder.Services.AddSingleton<SmsActivationService>();
builder.Services.AddSingleton<SubscriptionService>();
builder.Services.Configure<SubscriptionCleanupOptions>(
builder.Configuration.GetSection("SubscriptionCleanup"));
if (runBackgroundWorkers) builder.Services.AddHostedService<SubscriptionCleanupWorker>();

builder.Services.AddSingleton<LogTagApiClientMain>();
builder.Services.AddSingleton<LogTagApiClientLt5>();

// Router mới: chọn đúng LogTag account/client theo TeamID (multi account -> multi team).
builder.Services.AddSingleton<LogTagAccountRouter>();

// Router cũ: giữ lại để không vỡ các service/controller chưa migrate.
builder.Services.AddSingleton<LogTagClientRouter>();
builder.Services.AddSingleton<MonthlyReportCsvBuilder>();
builder.Services.AddSingleton<ReportEmailSender>();
builder.Services.AddSingleton<MonthlyReportService>();
builder.Services.AddSingleton<MonthlyReportWorker>();
if (runBackgroundWorkers) builder.Services.AddHostedService(sp => sp.GetRequiredService<MonthlyReportWorker>());

// Thêm vào khu vực Bind configs:
builder.Services.Configure<ReadingAggregationOptions>(builder.Configuration.GetSection("ReadingAggregation"));

// Thêm vào khu vực App services / Hosted services:
builder.Services.AddSingleton<ReadingAggregationService>();
if (runBackgroundWorkers) builder.Services.AddHostedService<ReadingAggregationWorker>();
// Realtime worker
builder.Services.AddSingleton<LogTagRealtimeWorker>();
//builder.Services.AddHostedService(sp => sp.GetRequiredService<LogTagRealtimeWorker>());
builder.Services.AddSingleton<DevicesSyncWorker>();
if (runBackgroundWorkers) builder.Services.AddHostedService(sp => sp.GetRequiredService<DevicesSyncWorker>());

builder.Services.Configure<Lt5EventsOptions>(builder.Configuration.GetSection("Lt5Events"));
builder.Services.AddSingleton<Lt5EventPullWorker>();
if (runBackgroundWorkers) builder.Services.AddHostedService(sp => sp.GetRequiredService<Lt5EventPullWorker>());

builder.Services.AddSingleton<Lt5ProfilesStoreService>();
// Scheduler cho các request LogTag
builder.Services.AddSingleton<EndpointScheduler>();
builder.Services.AddSingleton<LocationReadingService.IEndpointScheduler>(
    sp => sp.GetRequiredService<EndpointScheduler>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<EndpointScheduler>());

// Worker chính kéo LocationReadings v2
if (runBackgroundWorkers) builder.Services.AddHostedService<ReadingsPollingStream>();

// Các worker khác
if (runBackgroundWorkers) builder.Services.AddHostedService<EventsChangeStream>();
if (runBackgroundWorkers) builder.Services.AddHostedService<LogTagPullWorker>();

builder.Services.AddSingleton<SmsScheduleService>();
builder.Services.AddSingleton<SmsScheduleEnqueueWorker>();
if (runBackgroundWorkers) builder.Services.AddHostedService(sp => sp.GetRequiredService<SmsScheduleEnqueueWorker>());
builder.Services.AddSingleton<SmsScheduleSenderWorker>();
if (runBackgroundWorkers) builder.Services.AddHostedService(sp => sp.GetRequiredService<SmsScheduleSenderWorker>());

// Session
builder.Services.AddSession(o =>
{
    o.Cookie.Name = ".th.session";

    o.IdleTimeout = TimeSpan.FromHours(2);

    o.Cookie.HttpOnly = true;

    o.Cookie.IsEssential = true;

    // Production friendly
    o.Cookie.SameSite =
        builder.Environment.IsDevelopment()
            ? SameSiteMode.None
            : SameSiteMode.Lax;

    o.Cookie.SecurePolicy =
        builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;
});
// ======================================================
// COOKIE POLICY
// ======================================================

builder.Services.Configure<CookiePolicyOptions>(opts =>
{
    opts.MinimumSameSitePolicy =
        builder.Environment.IsDevelopment()
            ? SameSiteMode.None
            : SameSiteMode.Lax;

    opts.Secure =
        builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;
});

// ======================================================
// AUTHENTICATION
// ======================================================

builder.Services
    .AddAuthentication(
        CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "MyAppAuth";

        options.Cookie.HttpOnly = true;

        options.Cookie.SameSite =
            builder.Environment.IsDevelopment()
                ? SameSiteMode.None
                : SameSiteMode.Lax;

        options.Cookie.SecurePolicy =
            builder.Environment.IsDevelopment()
                ? CookieSecurePolicy.Always
                : CookieSecurePolicy.SameAsRequest;

        options.Cookie.IsEssential = true;

        options.LoginPath = "/api/auth/login";

        options.LogoutPath = "/api/auth/logout";

        options.AccessDeniedPath =
            "/api/auth/forbidden";

        options.ExpireTimeSpan =
            TimeSpan.FromMinutes(120);

        options.SlidingExpiration = true;

        options.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = 401;
            return Task.CompletedTask;
        };

        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            ctx.Response.StatusCode = 403;
            return Task.CompletedTask;
        };
    });
// AuthZ
var allowEmpViewAll = builder.Configuration.GetValue<bool>("Security:AllowEmployeeViewAllDevices");
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("ViewAllDeviceSerials", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("Admin") ||
            (allowEmpViewAll && ctx.User.IsInRole("Employee"))
        ));
});

// CORS
//
// Cho phép frontend local chạy ở bất kỳ port localhost/127.0.0.1,
// đồng thời giữ các domain production đã biết. Không dùng
// AllowAnyOrigin() vì hệ thống đang dùng cookie + AllowCredentials().
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy
            .SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrWhiteSpace(origin))
                    return false;

                if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                    return false;

                var isLocal =
                    string.Equals(
                        uri.Host,
                        "localhost",
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    string.Equals(
                        uri.Host,
                        "127.0.0.1",
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    string.Equals(
                        uri.Host,
                        "::1",
                        StringComparison.OrdinalIgnoreCase);

                var isProduction =
                    string.Equals(
                        uri.Host,
                        "smarttechcloud.net",
                        StringComparison.OrdinalIgnoreCase)
                    ||
                    string.Equals(
                        uri.Host,
                        "www.smarttechcloud.net",
                        StringComparison.OrdinalIgnoreCase);

                return isLocal || isProduction;
            })
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials()
            .WithExposedHeaders(
                "Retry-After",
                "Content-Disposition");
    });
});

builder.Services.AddHttpContextAccessor();

// ==============================
// 2) Validate DI + Build pipeline
// ==============================

// Kiểm tra descriptor trước khi Build để nếu project đang chạy nhầm
// Program.cs hoặc file chưa được compile, log sẽ chỉ rõ ngay.
var hasSmsQuotaService = builder.Services.Any(descriptor =>
    descriptor.ServiceType == typeof(temperature_humi.Service.SmsQuotaService));

var hasSmsDispatchService = builder.Services.Any(descriptor =>
    descriptor.ServiceType == typeof(temperature_humi.Service.SmsDispatchService));

var hasSmsNotifier = builder.Services.Any(descriptor =>
    descriptor.ServiceType == typeof(ISmsEventNotifier));

if (!hasSmsQuotaService)
{
    throw new InvalidOperationException(
        "DI configuration error: SmsQuotaService has not been registered.");
}

if (!hasSmsDispatchService)
{
    throw new InvalidOperationException(
        "DI configuration error: SmsDispatchService has not been registered.");
}

if (!hasSmsNotifier)
{
    throw new InvalidOperationException(
        "DI configuration error: ISmsEventNotifier has not been registered.");
}

var app = builder.Build();
app.Logger.LogInformation("[WorkerMode] {Mode}", workerMode);
if (!string.IsNullOrWhiteSpace(proxyAddress))
    app.UseForwardedHeaders();

// ============================================================
// CORS PREFLIGHT FALLBACK
// ============================================================
// Chạy trước routing/auth để OPTIONS luôn nhận header CORS.
// Cần thiết khi frontend localhost gọi backend IIS Express HTTPS
// và axios gắn các header accountId / X-User-Id.
static bool IsAllowedFrontendOrigin(string? origin)
{
    if (string.IsNullOrWhiteSpace(origin))
        return false;

    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
        return false;

    return string.Equals(
               uri.Host,
               "localhost",
               StringComparison.OrdinalIgnoreCase)
        || string.Equals(
               uri.Host,
               "127.0.0.1",
               StringComparison.OrdinalIgnoreCase)
        || string.Equals(
               uri.Host,
               "::1",
               StringComparison.OrdinalIgnoreCase)
        || string.Equals(
               uri.Host,
               "smarttechcloud.net",
               StringComparison.OrdinalIgnoreCase)
        || string.Equals(
               uri.Host,
               "www.smarttechcloud.net",
               StringComparison.OrdinalIgnoreCase);
}

app.Use(async (context, next) =>
{
    var origin =
        context.Request.Headers.Origin.ToString();

    if (IsAllowedFrontendOrigin(origin))
    {
        context.Response.Headers[
            "Access-Control-Allow-Origin"] = origin;

        context.Response.Headers[
            "Access-Control-Allow-Credentials"] = "true";

        context.Response.Headers[
            "Access-Control-Expose-Headers"] =
            "Retry-After, Content-Disposition";

        context.Response.Headers["Vary"] = "Origin";

        if (HttpMethods.IsOptions(
                context.Request.Method))
        {
            var requestedHeaders =
                context.Request.Headers[
                    "Access-Control-Request-Headers"]
                .ToString();

            var requestedMethod =
                context.Request.Headers[
                    "Access-Control-Request-Method"]
                .ToString();

            context.Response.Headers[
                "Access-Control-Allow-Headers"] =
                string.IsNullOrWhiteSpace(
                    requestedHeaders)
                    ? "Content-Type, Authorization, X-User-Id, accountId, Cache-Control"
                    : requestedHeaders;

            context.Response.Headers[
                "Access-Control-Allow-Methods"] =
                string.IsNullOrWhiteSpace(
                    requestedMethod)
                    ? "GET, POST, PUT, PATCH, DELETE, OPTIONS"
                    : requestedMethod;

            context.Response.Headers[
                "Access-Control-Max-Age"] = "600";

            context.Response.StatusCode =
                StatusCodes.Status204NoContent;

            return;
        }
    }

    await next();
});

if (runBackgroundWorkers)
{
    // Xác nhận container có thể resolve trực tiếp các service SMS.
    // SmsDispatchService được resolve sớm để tạo/kiểm tra unique index
    // ux_smsdispatch_idempotency trước khi worker bắt đầu gửi SMS.
    _ = app.Services.GetRequiredService<temperature_humi.Service.SmsQuotaService>();
    _ = app.Services.GetRequiredService<temperature_humi.Service.SmsDispatchService>();
    _ = app.Services.GetRequiredService<ISmsEventNotifier>();

    app.Logger.LogInformation(
        "[DI] SmsQuotaService, SmsDispatchService and ISmsEventNotifier resolved successfully.");

    try
    {
        // AccountDeviceService tự kiểm tra index theo key và unique option,
        // nên không bị lỗi khi MongoDB đang có cùng key nhưng tên index khác.
        var accountDeviceService =
            app.Services.GetRequiredService<AccountDeviceService>();

        await accountDeviceService.EnsureIndexesAsync();

        app.Logger.LogInformation(
            "[MongoIndex] AccountDevices indexes ensured successfully.");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(
            ex,
            "[MongoIndex] AccountDevices bootstrap failed. Detail={Detail}",
            ex.ToString());
    }

    try
    {
        // ===== LocationReadings collection =====
        // Multi-team cần unique theo:
        // TeamId + SerialNumber + DateUtc.
        var mongoOptions =
            app.Services.GetRequiredService<IOptions<MongoDBSettings>>().Value;

        var mongoClient = new MongoClient(mongoOptions.ConnectionString);
        var database = mongoClient.GetDatabase(mongoOptions.DatabaseName);
        var readings =
            database.GetCollection<LocationReading>("LocationReadings");

        static string? GetIndexName(MongoDB.Bson.BsonDocument index)
        {
            return index.TryGetValue("name", out var value) && value.IsString
                ? value.AsString
                : null;
        }

        static bool IsUniqueIndex(MongoDB.Bson.BsonDocument index)
        {
            return index.TryGetValue("unique", out var value)
                && value.IsBoolean
                && value.AsBoolean;
        }

        static bool SameBsonValue(
            MongoDB.Bson.BsonValue left,
            MongoDB.Bson.BsonValue right)
        {
            return left.BsonType == right.BsonType
                ? left.Equals(right)
                : string.Equals(
                    left.ToString(),
                    right.ToString(),
                    StringComparison.Ordinal);
        }

        static bool SameIndexKey(
            MongoDB.Bson.BsonDocument index,
            params MongoDB.Bson.BsonDocument[] expectedKeys)
        {
            if (!index.TryGetValue("key", out var keyValue)
                || !keyValue.IsBsonDocument)
            {
                return false;
            }

            var actual = keyValue.AsBsonDocument;

            foreach (var expected in expectedKeys)
            {
                if (actual.ElementCount != expected.ElementCount)
                    continue;

                var matches = true;

                foreach (var element in expected.Elements)
                {
                    if (!actual.TryGetValue(element.Name, out var actualValue)
                        || !SameBsonValue(actualValue, element.Value))
                    {
                        matches = false;
                        break;
                    }
                }

                if (matches)
                    return true;
            }

            return false;
        }

        static async Task DropIndexSafeAsync(
            IMongoCollection<LocationReading> collection,
            string indexName,
            ILogger logger)
        {
            if (string.IsNullOrWhiteSpace(indexName)
                || string.Equals(indexName, "_id_", StringComparison.Ordinal))
            {
                return;
            }

            try
            {
                await collection.Indexes.DropOneAsync(indexName);

                logger.LogWarning(
                    "[MongoIndex] Dropped LocationReadings index {IndexName}.",
                    indexName);
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "[MongoIndex] Could not drop LocationReadings index {IndexName}.",
                    indexName);
            }
        }

        var legacyIndexes =
            await (await readings.Indexes.ListAsync()).ToListAsync();

        // Xóa unique legacy SerialNumber + DateUtc.
        // Index này không an toàn khi nhiều team có serial trùng nhau.
        foreach (var legacy in legacyIndexes.Where(x =>
                     string.Equals(
                         GetIndexName(x),
                         "ux_serial_date",
                         StringComparison.Ordinal)))
        {
            await DropIndexSafeAsync(
                readings,
                GetIndexName(legacy)!,
                app.Logger);
        }

        var expectedUniqueLower = new MongoDB.Bson.BsonDocument
        {
            { "teamId", 1 },
            { "serialNumber", 1 },
            { "dateUtc", 1 }
        };

        var expectedUniquePascal = new MongoDB.Bson.BsonDocument
        {
            { "TeamId", 1 },
            { "SerialNumber", 1 },
            { "DateUtc", 1 }
        };

        var indexes =
            await (await readings.Indexes.ListAsync()).ToListAsync();

        var sameUniqueKeyIndexes = indexes
            .Where(x => SameIndexKey(
                x,
                expectedUniqueLower,
                expectedUniquePascal))
            .ToList();

        if (!sameUniqueKeyIndexes.Any(IsUniqueIndex))
        {
            // Nếu đang có cùng key nhưng non-unique, phải drop trước khi tạo unique.
            foreach (var existing in sameUniqueKeyIndexes)
            {
                var existingName = GetIndexName(existing);

                if (!string.IsNullOrWhiteSpace(existingName))
                {
                    await DropIndexSafeAsync(
                        readings,
                        existingName,
                        app.Logger);
                }
            }

            await readings.Indexes.CreateOneAsync(
                new CreateIndexModel<LocationReading>(
                    Builders<LocationReading>.IndexKeys
                        .Ascending(x => x.TeamId)
                        .Ascending(x => x.SerialNumber)
                        .Ascending(x => x.DateUtc),
                    new CreateIndexOptions
                    {
                        Name = "ux_team_serial_date",
                        Unique = true,
                        Background = true
                    }));

            app.Logger.LogInformation(
                "[MongoIndex] Created ux_team_serial_date.");
        }
        else
        {
            app.Logger.LogInformation(
                "[MongoIndex] LocationReadings unique team/serial/date index already exists. Existing={Indexes}",
                string.Join(
                    ",",
                    sameUniqueKeyIndexes.Select(GetIndexName)));
        }

        var expectedQueryLower = new MongoDB.Bson.BsonDocument
        {
            { "teamId", 1 },
            { "serialNumber", 1 },
            { "dateUtc", -1 }
        };

        var expectedQueryPascal = new MongoDB.Bson.BsonDocument
        {
            { "TeamId", 1 },
            { "SerialNumber", 1 },
            { "DateUtc", -1 }
        };

        indexes = await (await readings.Indexes.ListAsync()).ToListAsync();

        if (!indexes.Any(x => SameIndexKey(
                x,
                expectedQueryLower,
                expectedQueryPascal)))
        {
            await readings.Indexes.CreateOneAsync(
                new CreateIndexModel<LocationReading>(
                    Builders<LocationReading>.IndexKeys
                        .Ascending(x => x.TeamId)
                        .Ascending(x => x.SerialNumber)
                        .Descending(x => x.DateUtc),
                    new CreateIndexOptions
                    {
                        Name = "ix_team_serial_date_desc",
                        Background = true
                    }));

            app.Logger.LogInformation(
                "[MongoIndex] Created ix_team_serial_date_desc.");
        }
        else
        {
            app.Logger.LogInformation(
                "[MongoIndex] LocationReadings team/serial/date-desc index already exists.");
        }
    }
    catch (Exception ex)
    {
        // Không chặn app khởi động, nhưng log rõ để xử lý duplicate data/index.
        app.Logger.LogError(
            ex,
            "[MongoIndex] LocationReadings bootstrap failed. Detail={Detail}",
            ex.ToString());
    }

}
else
{
    app.Logger.LogWarning("[WorkerMode] ApiOnly: bỏ qua khởi tạo SMS/index và các worker định kỳ. Không dùng để ghi dữ liệu production.");
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

// CORS phải chạy ngay sau UseRouting và trước compression/session/auth.
app.UseCors("AllowFrontend");
app.UseResponseCompression();
app.UseCookiePolicy();
app.UseSession();
app.UseAuthentication();
app.UseAuthorization();

// Gắn policy trực tiếp vào endpoint để cả response 401/403/500
// do controller trả về vẫn có header CORS.
app.MapControllers()
    .RequireCors("AllowFrontend");

app.MapHub<NotificationHub>("/notificationHub")
    .RequireCors("AllowFrontend");

app.MapHub<LogTagHub>("/hub/logtag")
    .RequireCors("AllowFrontend");

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");
app.MapGet("/health", () =>
{
    return Results.Ok(new
    {
        status = "ok",
        service = "logtag-api",
        utc = DateTime.UtcNow
    });
});

app.Run();

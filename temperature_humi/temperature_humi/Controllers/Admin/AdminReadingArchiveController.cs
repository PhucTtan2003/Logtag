using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Globalization;
using System.Text;
using System.Text.Json;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/reading-archive")]
    [Authorize(Roles = "Admin")]
    public class AdminReadingArchiveController : ControllerBase
    {
        private readonly IMongoCollection<LocationReading> _raw;
        private readonly IMongoCollection<LocationReadingHourly> _hourly;
        private readonly IMongoCollection<LocationReadingDaily> _daily;
        private readonly IMongoCollection<LatestDeviceStatus> _latest;

        public AdminReadingArchiveController(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);

            _raw = db.GetCollection<LocationReading>("LocationReadings");
            _hourly = db.GetCollection<LocationReadingHourly>("LocationReadingHourly");
            _daily = db.GetCollection<LocationReadingDaily>("LocationReadingDaily");
            _latest = db.GetCollection<LatestDeviceStatus>("LatestDeviceStatus");
        }

        // GET /api/admin/reading-archive/summary?teamId=16922
        [HttpGet("summary")]
        public async Task<IActionResult> Summary(
            [FromQuery] string? teamId,
            CancellationToken ct = default)
        {
            var rawFilter = BuildTeamFilter<LocationReading>(teamId);
            var hourlyFilter = BuildTeamFilter<LocationReadingHourly>(teamId);
            var dailyFilter = BuildTeamFilter<LocationReadingDaily>(teamId);
            var latestFilter = BuildTeamFilter<LatestDeviceStatus>(teamId);

            var rawCount = await _raw.CountDocumentsAsync(rawFilter, cancellationToken: ct);
            var hourlyCount = await _hourly.CountDocumentsAsync(hourlyFilter, cancellationToken: ct);
            var dailyCount = await _daily.CountDocumentsAsync(dailyFilter, cancellationToken: ct);
            var latestCount = await _latest.CountDocumentsAsync(latestFilter, cancellationToken: ct);

            return Ok(new
            {
                raw = rawCount,
                hourly = hourlyCount,
                daily = dailyCount,
                latest = latestCount
            });
        }

        // GET /api/admin/reading-archive/latest?teamId=16922&serial=A0A
        [HttpGet("latest")]
        public async Task<IActionResult> Latest(
            [FromQuery] string? teamId,
            [FromQuery] string? serial,
            [FromQuery] int skip = 0,
            [FromQuery] int take = 200,
            CancellationToken ct = default)
        {
            skip = Math.Max(0, skip);
            take = Math.Clamp(take, 1, 1000);

            var fb = Builders<LatestDeviceStatus>.Filter;
            var filter = fb.Empty;

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId.Trim());

            if (!string.IsNullOrWhiteSpace(serial))
            {
                var regex = new BsonRegularExpression(serial.Trim(), "i");
                filter &= fb.Regex(x => x.SerialNumber, regex);
            }

            var total = await _latest.CountDocumentsAsync(filter, cancellationToken: ct);

            var items = await _latest
                .Find(filter)
                .SortBy(x => x.SerialNumber)
                .Skip(skip)
                .Limit(take)
                .ToListAsync(ct);

            return Ok(new { total, items });
        }

        // GET /api/admin/reading-archive/history?teamId=16922&serial=...&fromUtc=...&toUtc=...&mode=auto
        [HttpGet("history")]
        public async Task<IActionResult> History(
            [FromQuery] string? teamId,
            [FromQuery] string serial,
            [FromQuery] string fromUtc,
            [FromQuery] string toUtc,
            [FromQuery] string mode = "auto",
            [FromQuery] int limit = 5000,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(serial))
                return BadRequest(new { message = "Thiếu serial." });

            if (!TryParseUtc(fromUtc, out var from))
                return BadRequest(new { message = "fromUtc không hợp lệ." });

            if (!TryParseUtc(toUtc, out var to))
                return BadRequest(new { message = "toUtc không hợp lệ." });

            if (from > to)
                return BadRequest(new { message = "fromUtc phải nhỏ hơn toUtc." });

            limit = Math.Clamp(limit, 1, 50000);

            var selectedMode = (mode ?? "auto").Trim().ToLowerInvariant();
            var days = (to - from).TotalDays;

            if (selectedMode == "auto")
            {
                selectedMode = days <= 7 ? "raw" : days <= 180 ? "hourly" : "daily";
            }

            if (selectedMode == "raw")
                return await QueryRaw(teamId, serial, from, to, limit, ct);

            if (selectedMode == "hourly")
                return await QueryHourly(teamId, serial, from, to, limit, ct);

            if (selectedMode == "daily")
                return await QueryDaily(teamId, serial, from, to, limit, ct);

            return BadRequest(new { message = "mode chỉ nhận auto/raw/hourly/daily." });
        }

        // GET /api/admin/reading-archive/export?teamId=16922&serial=...&fromUtc=...&toUtc=...&mode=hourly
        [HttpGet("export")]
        public async Task<IActionResult> Export(
            [FromQuery] string? teamId,
            [FromQuery] string serial,
            [FromQuery] string fromUtc,
            [FromQuery] string toUtc,
            [FromQuery] string mode = "auto",
            CancellationToken ct = default)
        {
            var result = await History(teamId, serial, fromUtc, toUtc, mode, 50000, ct);

            if (result is not OkObjectResult ok)
                return result;

            var json = JsonSerializer.Serialize(ok.Value);
            using var doc = JsonDocument.Parse(json);

            var root = doc.RootElement;
            var selectedMode = root.GetProperty("mode").GetString() ?? mode;
            var items = root.GetProperty("items");

            var sb = new StringBuilder();

            if (selectedMode == "raw")
            {
                sb.AppendLine("Type,TeamId,SerialNumber,TimeUtc,Temperature,Humidity,Count");

                foreach (var item in items.EnumerateArray())
                {
                    sb.AppendLine(string.Join(",",
                        Csv(GetString(item, "type")),
                        Csv(GetString(item, "teamId")),
                        Csv(GetString(item, "serialNumber")),
                        Csv(GetString(item, "timeUtc")),
                        Csv(GetString(item, "temperature")),
                        Csv(GetString(item, "humidity")),
                        "1"
                    ));
                }
            }
            else
            {
                sb.AppendLine("Type,TeamId,SerialNumber,TimeUtc,MinTemperature,MaxTemperature,AvgTemperature,MinHumidity,MaxHumidity,AvgHumidity,Count");

                foreach (var item in items.EnumerateArray())
                {
                    sb.AppendLine(string.Join(",",
                        Csv(GetString(item, "type")),
                        Csv(GetString(item, "teamId")),
                        Csv(GetString(item, "serialNumber")),
                        Csv(GetString(item, "timeUtc")),
                        Csv(GetString(item, "minTemperature")),
                        Csv(GetString(item, "maxTemperature")),
                        Csv(GetString(item, "avgTemperature")),
                        Csv(GetString(item, "minHumidity")),
                        Csv(GetString(item, "maxHumidity")),
                        Csv(GetString(item, "avgHumidity")),
                        Csv(GetString(item, "count"))
                    ));
                }
            }

            var bytes = Encoding.UTF8.GetPreamble()
                .Concat(Encoding.UTF8.GetBytes(sb.ToString()))
                .ToArray();

            var safeSerial = string.Join("_", serial.Split(Path.GetInvalidFileNameChars()));
            var fileName = $"reading-archive-{safeSerial}-{selectedMode}-{DateTime.UtcNow:yyyyMMddHHmmss}.csv";

            return File(bytes, "text/csv; charset=utf-8", fileName);
        }

        private async Task<IActionResult> QueryRaw(
            string? teamId,
            string serial,
            DateTime from,
            DateTime to,
            int limit,
            CancellationToken ct)
        {
            var fb = Builders<LocationReading>.Filter;

            var filter = fb.Eq(x => x.SerialNumber, serial.Trim())
                       & fb.Gte(x => x.DateUtc, from)
                       & fb.Lte(x => x.DateUtc, to);

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId.Trim());

            var rows = await _raw
                .Find(filter)
                .SortBy(x => x.DateUtc)
                .Limit(limit)
                .Project(x => new
                {
                    type = "raw",
                    teamId = x.TeamId,
                    serialNumber = x.SerialNumber,
                    timeUtc = x.DateUtc,
                    temperature = x.Temperature,
                    humidity = x.Humidity,
                    count = 1
                })
                .ToListAsync(ct);

            return Ok(new
            {
                mode = "raw",
                total = rows.Count,
                items = rows
            });
        }

        private async Task<IActionResult> QueryHourly(
            string? teamId,
            string serial,
            DateTime from,
            DateTime to,
            int limit,
            CancellationToken ct)
        {
            var fb = Builders<LocationReadingHourly>.Filter;

            var filter = fb.Eq(x => x.SerialNumber, serial.Trim())
                       & fb.Gte(x => x.BucketUtc, from)
                       & fb.Lte(x => x.BucketUtc, to);

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId.Trim());

            var rows = await _hourly
                .Find(filter)
                .SortBy(x => x.BucketUtc)
                .Limit(limit)
                .Project(x => new
                {
                    type = "hourly",
                    teamId = x.TeamId,
                    serialNumber = x.SerialNumber,
                    timeUtc = x.BucketUtc,
                    minTemperature = x.MinTemperature,
                    maxTemperature = x.MaxTemperature,
                    avgTemperature = x.AvgTemperature,
                    minHumidity = x.MinHumidity,
                    maxHumidity = x.MaxHumidity,
                    avgHumidity = x.AvgHumidity,
                    count = x.Count
                })
                .ToListAsync(ct);

            return Ok(new
            {
                mode = "hourly",
                total = rows.Count,
                items = rows
            });
        }

        private async Task<IActionResult> QueryDaily(
            string? teamId,
            string serial,
            DateTime from,
            DateTime to,
            int limit,
            CancellationToken ct)
        {
            var fb = Builders<LocationReadingDaily>.Filter;

            var filter = fb.Eq(x => x.SerialNumber, serial.Trim())
                       & fb.Gte(x => x.BucketUtc, from)
                       & fb.Lte(x => x.BucketUtc, to);

            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(x => x.TeamId, teamId.Trim());

            var rows = await _daily
                .Find(filter)
                .SortBy(x => x.BucketUtc)
                .Limit(limit)
                .Project(x => new
                {
                    type = "daily",
                    teamId = x.TeamId,
                    serialNumber = x.SerialNumber,
                    timeUtc = x.BucketUtc,
                    minTemperature = x.MinTemperature,
                    maxTemperature = x.MaxTemperature,
                    avgTemperature = x.AvgTemperature,
                    minHumidity = x.MinHumidity,
                    maxHumidity = x.MaxHumidity,
                    avgHumidity = x.AvgHumidity,
                    count = x.Count
                })
                .ToListAsync(ct);

            return Ok(new
            {
                mode = "daily",
                total = rows.Count,
                items = rows
            });
        }

        private static bool TryParseUtc(string? value, out DateTime utc)
        {
            utc = default;

            if (string.IsNullOrWhiteSpace(value))
                return false;

            if (!DateTime.TryParse(
                    value,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var parsed))
            {
                return false;
            }

            utc = DateTime.SpecifyKind(parsed.ToUniversalTime(), DateTimeKind.Utc);
            return true;
        }

        private static string Csv(string? value)
        {
            value ??= "";
            value = value.Replace("\"", "\"\"");
            return $"\"{value}\"";
        }

        private static string GetString(JsonElement item, string name)
        {
            if (!item.TryGetProperty(name, out var prop))
                return "";

            return prop.ValueKind switch
            {
                JsonValueKind.String => prop.GetString() ?? "",
                JsonValueKind.Number => prop.ToString(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Null => "",
                _ => prop.ToString()
            };
        }

        private static FilterDefinition<T> BuildTeamFilter<T>(string? teamId)
        {
            if (string.IsNullOrWhiteSpace(teamId))
                return Builders<T>.Filter.Empty;

            return Builders<T>.Filter.Eq("TeamId", teamId.Trim());
        }
    }
}
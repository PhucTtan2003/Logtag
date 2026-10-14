using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.IO;
using MongoDB.Driver;
using System.Diagnostics;
using System.Text.Json;
using temperature_humi.Data;
using temperature_humi.Models;


namespace temperature_humi.Controllers.Admin
{
    [ApiController]
    [Route("api/admin/benchmark")]
    [Authorize(Roles = "Admin")]
    public class BenchmarkController : ControllerBase
    {
        private readonly IMongoDatabase _db;
        private readonly IMongoCollection<LocationReading> _col;
        private readonly bool _enabled;
        private readonly string _collectionName;

        public BenchmarkController(
            IOptions<MongoDBSettings> settings,
            IConfiguration configuration)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            _db = client.GetDatabase(settings.Value.DatabaseName);

            _enabled = configuration.GetValue<bool>("Benchmark:Enabled");
            _collectionName = configuration["Benchmark:CollectionName"]
                              ?? "LocationReadings_Benchmark";

            _col = _db.GetCollection<LocationReading>(_collectionName);
        }

        private IActionResult? Guard()
        {
            if (_enabled) return null;

            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Benchmark API đang bị tắt. Set Benchmark:Enabled=true ở môi trường test/local."
            });
        }

        // GET /api/admin/benchmark/health
        [HttpGet("health")]
        public async Task<IActionResult> Health(CancellationToken ct)
        {
            if (Guard() is IActionResult blocked) return blocked;

            var sw = Stopwatch.StartNew();
            var count = await _col.CountDocumentsAsync(FilterDefinition<LocationReading>.Empty, cancellationToken: ct);
            sw.Stop();

            return Ok(new
            {
                enabled = true,
                collection = _collectionName,
                documents = count,
                elapsedMs = sw.Elapsed.TotalMilliseconds
            });
        }

        // POST /api/admin/benchmark/seed?count=1000000&serialCount=500&intervalSeconds=60&batchSize=5000
        // Tạo dữ liệu giả vào collection benchmark RIÊNG, không đụng dữ liệu LocationReadings thật.
        [HttpPost("seed")]
        public async Task<IActionResult> Seed(
            [FromQuery] int count = 1_000_000,
            [FromQuery] int serialCount = 500,
            [FromQuery] int intervalSeconds = 60,
            [FromQuery] int batchSize = 5_000,
            [FromQuery] long teamId = 99999,
            [FromQuery] bool clearFirst = true,
            CancellationToken ct = default)
        {
            if (Guard() is IActionResult blocked) return blocked;

            if (count < 1 || count > 5_000_000)
                return BadRequest(new { message = "count phải nằm trong 1..5,000,000" });

            if (serialCount < 1 || serialCount > 5_000)
                return BadRequest(new { message = "serialCount phải nằm trong 1..5,000" });

            if (intervalSeconds < 1 || intervalSeconds > 86_400)
                return BadRequest(new { message = "intervalSeconds không hợp lệ" });

            batchSize = Math.Clamp(batchSize, 100, 20_000);

            if (clearFirst)
                await _col.DeleteManyAsync(FilterDefinition<LocationReading>.Empty, ct);

            var sw = Stopwatch.StartNew();
            var buffer = new List<LocationReading>(batchSize);
            var startUtc = DateTime.UtcNow.AddDays(-60);
            long inserted = 0;

            for (int i = 0; i < count; i++)
            {
                ct.ThrowIfCancellationRequested();

                var serialIndex = i % serialCount;
                var readingIndexForSerial = i / serialCount;
                var ts = startUtc.AddSeconds((long)readingIndexForSerial * intervalSeconds);

                // Dữ liệu đủ biến thiên để query/range giống dữ liệu thật hơn.
                var temp = 2.0 + (serialIndex % 15) * 0.1 + Math.Sin(readingIndexForSerial / 10.0) * 3.0;
                var hum = 45.0 + (serialIndex % 20) + Math.Cos(readingIndexForSerial / 8.0) * 5.0;

                buffer.Add(new LocationReading
                {
                    Id = ObjectId.GenerateNewId(),
                    TeamId = teamId.ToString(),
                    SerialNumber = $"BENCH{serialIndex:D7}",
                    DateUtc = DateTime.SpecifyKind(ts, DateTimeKind.Utc),
                    Temperature = temp,
                    Humidity = hum
                });

                if (buffer.Count >= batchSize)
                {
                    await _col.InsertManyAsync(
                        buffer,
                        new InsertManyOptions { IsOrdered = false },
                        ct);

                    inserted += buffer.Count;
                    buffer.Clear();
                }
            }

            if (buffer.Count > 0)
            {
                await _col.InsertManyAsync(
                    buffer,
                    new InsertManyOptions { IsOrdered = false },
                    ct);

                inserted += buffer.Count;
            }

            sw.Stop();

            return Ok(new
            {
                collection = _collectionName,
                inserted,
                serialCount,
                intervalSeconds,
                elapsedSeconds = sw.Elapsed.TotalSeconds,
                docsPerSecond = sw.Elapsed.TotalSeconds <= 0
                    ? inserted
                    : Math.Round(inserted / sw.Elapsed.TotalSeconds, 2),
                sampleSerial = "BENCH0000000"
            });
        }

        // GET /api/admin/benchmark/latest?serial=BENCH0000000&take=100
        // Đây là endpoint chính để JMeter bắn tải.
        [HttpGet("latest")]
        public async Task<IActionResult> Latest(
            [FromQuery] string serial = "BENCH0000000",
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            if (Guard() is IActionResult blocked) return blocked;

            take = Math.Clamp(take, 1, 1_000);
            serial = (serial ?? string.Empty).Trim().ToUpperInvariant();

            var sw = Stopwatch.StartNew();

            var rows = await _col
                .Find(x => x.SerialNumber == serial)
                .SortByDescending(x => x.DateUtc)
                .Limit(take)
                .Project(x => new
                {
                    x.SerialNumber,
                    x.DateUtc,
                    x.Temperature,
                    x.Humidity
                })
                .ToListAsync(ct);

            sw.Stop();
            Response.Headers["X-Elapsed-Ms"] = sw.Elapsed.TotalMilliseconds.ToString("0.###");
            Response.Headers["X-Benchmark-Collection"] = _collectionName;

            return Ok(new
            {
                serial,
                count = rows.Count,
                elapsedMs = sw.Elapsed.TotalMilliseconds,
                data = rows
            });
        }

        // GET /api/admin/benchmark/range?serial=BENCH0000000&minutes=1440&take=5000
        [HttpGet("range")]
        public async Task<IActionResult> Range(
            [FromQuery] string serial = "BENCH0000000",
            [FromQuery] int minutes = 1_440,
            [FromQuery] int take = 5_000,
            CancellationToken ct = default)
        {
            if (Guard() is IActionResult blocked) return blocked;

            minutes = Math.Clamp(minutes, 1, 60 * 24 * 31);
            take = Math.Clamp(take, 1, 100_000);
            serial = (serial ?? string.Empty).Trim().ToUpperInvariant();

            var toUtc = DateTime.UtcNow;
            var fromUtc = toUtc.AddMinutes(-minutes);

            var sw = Stopwatch.StartNew();

            var rows = await _col
                .Find(x => x.SerialNumber == serial && x.DateUtc >= fromUtc && x.DateUtc <= toUtc)
                .SortBy(x => x.DateUtc)
                .Limit(take)
                .Project(x => new
                {
                    x.SerialNumber,
                    x.DateUtc,
                    x.Temperature,
                    x.Humidity
                })
                .ToListAsync(ct);

            sw.Stop();
            Response.Headers["X-Elapsed-Ms"] = sw.Elapsed.TotalMilliseconds.ToString("0.###");

            return Ok(new
            {
                serial,
                fromUtc,
                toUtc,
                count = rows.Count,
                elapsedMs = sw.Elapsed.TotalMilliseconds,
                data = rows
            });
        }

        // POST /api/admin/benchmark/index/create
        // Index khớp pattern: SerialNumber = ? + sort DateUtc DESC.
        [HttpPost("index/create")]
        public async Task<IActionResult> CreateIndex(CancellationToken ct)
        {
            if (Guard() is IActionResult blocked) return blocked;

            var keys = Builders<LocationReading>.IndexKeys
                .Ascending(x => x.SerialNumber)
                .Descending(x => x.DateUtc);

            var model = new CreateIndexModel<LocationReading>(
                keys,
                new CreateIndexOptions
                {
                    Name = "ix_bench_serial_date_desc"
                });

            var sw = Stopwatch.StartNew();
            var name = await _col.Indexes.CreateOneAsync(model, cancellationToken: ct);
            sw.Stop();

            return Ok(new
            {
                index = name,
                elapsedMs = sw.Elapsed.TotalMilliseconds
            });
        }

        // DELETE /api/admin/benchmark/index/drop
        [HttpDelete("index/drop")]
        public async Task<IActionResult> DropIndex(CancellationToken ct)
        {
            if (Guard() is IActionResult blocked) return blocked;

            try
            {
                await _col.Indexes.DropOneAsync("ix_bench_serial_date_desc", ct);
                return Ok(new { message = "index dropped" });
            }
            catch (MongoCommandException ex) when (ex.CodeName == "IndexNotFound")
            {
                return Ok(new { message = "index not found - nothing to drop" });
            }
        }

        // GET /api/admin/benchmark/index/list
        [HttpGet("index/list")]
        public async Task<IActionResult> ListIndexes(CancellationToken ct)
        {
            if (Guard() is IActionResult blocked) return blocked;

            using var cursor = await _col.Indexes.ListAsync(ct);
            var indexes = await cursor.ToListAsync(ct);

            // Không trả BsonDocument trực tiếp cho System.Text.Json.
            // BsonDocument có các getter kiểu AsBoolean/AsInt32... và có thể gây InvalidCastException
            // khi ASP.NET Core cố serialize chúng như object CLR thông thường.
            var safeIndexes = indexes.Select(BsonToJsonElement).ToList();

            return Ok(new
            {
                count = safeIndexes.Count,
                indexes = safeIndexes
            });
        }

        // GET /api/admin/benchmark/explain/latest?serial=BENCH0000000&take=100
        // Tương đương EXPLAIN ANALYZE trong MongoDB: explain(..., executionStats).
        [HttpGet("explain/latest")]
        public async Task<IActionResult> ExplainLatest(
            [FromQuery] string serial = "BENCH0000000",
            [FromQuery] int take = 100,
            CancellationToken ct = default)
        {
            if (Guard() is IActionResult blocked) return blocked;

            take = Math.Clamp(take, 1, 1_000);
            serial = (serial ?? string.Empty).Trim().ToUpperInvariant();

            // IMPORTANT: resolve the ACTUAL BSON element names from the LocationReading class map.
            // The model may use [BsonElement("serialNumber")] / camelCase names, while the C#
            // properties are SerialNumber / DateUtc. Hard-coding the CLR property names in a raw
            // RunCommand can therefore scan the whole collection and still return 0 rows.
            var classMap = MongoDB.Bson.Serialization.BsonClassMap.LookupClassMap(typeof(LocationReading));
            string ElementName(string memberName) => classMap.GetMemberMap(memberName).ElementName;

            var serialField = ElementName(nameof(LocationReading.SerialNumber));
            var dateField = ElementName(nameof(LocationReading.DateUtc));
            var temperatureField = ElementName(nameof(LocationReading.Temperature));
            var humidityField = ElementName(nameof(LocationReading.Humidity));

            var find = new BsonDocument
            {
                { "find", _collectionName },
                { "filter", new BsonDocument(serialField, serial) },
                { "sort", new BsonDocument(dateField, -1) },
                { "limit", take },
                { "projection", new BsonDocument
                    {
                        { "_id", 0 },
                        { serialField, 1 },
                        { dateField, 1 },
                        { temperatureField, 1 },
                        { humidityField, 1 }
                    }
                }
            };

            var cmd = new BsonDocument
            {
                { "explain", find },
                { "verbosity", "executionStats" }
            };

            var result = await _db.RunCommandAsync<BsonDocument>(cmd, cancellationToken: ct);

            var executionStats = result.GetValue("executionStats", new BsonDocument()).AsBsonDocument;
            var queryPlanner = result.GetValue("queryPlanner", new BsonDocument()).AsBsonDocument;

            var winningPlan = queryPlanner.GetValue("winningPlan", new BsonDocument());

            return Ok(new
            {
                executionTimeMillis = BsonNumberToLong(executionStats.GetValue("executionTimeMillis", BsonNull.Value)),
                nReturned = BsonNumberToLong(executionStats.GetValue("nReturned", BsonNull.Value)),
                totalKeysExamined = BsonNumberToLong(executionStats.GetValue("totalKeysExamined", BsonNull.Value)),
                totalDocsExamined = BsonNumberToLong(executionStats.GetValue("totalDocsExamined", BsonNull.Value)),

                // Helpful when the model maps CLR names to camelCase BSON element names.
                bsonFields = new
                {
                    serialNumber = serialField,
                    dateUtc = dateField,
                    temperature = temperatureField,
                    humidity = humidityField
                },

                // Trả stage dạng text để đọc nhanh COLLSCAN / IXSCAN / SORT / FETCH...
                stages = CollectStages(winningPlan),

                // Convert BSON -> JsonElement trước khi trả về ASP.NET Core.
                winningPlan = BsonToJsonElement(winningPlan),
                full = BsonToJsonElement(result)
            });
        }

        private static long? BsonNumberToLong(BsonValue value)
        {
            if (value == null || value.IsBsonNull) return null;
            if (value.IsInt32) return value.AsInt32;
            if (value.IsInt64) return value.AsInt64;
            if (value.IsDouble) return (long)value.AsDouble;
            if (long.TryParse(value.ToString(), out var parsed)) return parsed;
            return null;
        }





        private static JsonElement BsonToJsonElement(BsonValue value)
        {
            var json = value.ToJson(new JsonWriterSettings
            {
                OutputMode = JsonOutputMode.RelaxedExtendedJson
            });

            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }

        private static List<string> CollectStages(BsonValue root)
        {
            var stages = new List<string>();

            void Walk(BsonValue value)
            {
                if (value is BsonDocument doc)
                {
                    if (doc.TryGetValue("stage", out var stage) && stage.IsString)
                        stages.Add(stage.AsString);

                    foreach (var element in doc.Elements)
                        Walk(element.Value);
                }
                else if (value is BsonArray array)
                {
                    foreach (var item in array)
                        Walk(item);
                }
            }

            Walk(root);
            return stages.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        // DELETE /api/admin/benchmark/data
        [HttpDelete("data")]
        public async Task<IActionResult> DeleteData(CancellationToken ct)
        {
            if (Guard() is IActionResult blocked) return blocked;

            var result = await _col.DeleteManyAsync(FilterDefinition<LocationReading>.Empty, ct);
            return Ok(new { deleted = result.DeletedCount });
        }
    }
}

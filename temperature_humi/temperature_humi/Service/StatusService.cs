using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MongoDB.Bson;
using MongoDB.Driver;
using Microsoft.Extensions.Options;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Service
{
    public class StatusService
    {
        private readonly IMongoCollection<StatusModel> _col;

        private const string F_Id = "_id";
        private const string F_DeviceId = "deviceId";
        private const string F_Temperature = "temperature";
        private const string F_Humidity = "humidity";
        private const string F_Timestamp = "timestamp";
        private const string F_Status = "status";
        private const string F_Notes = "notes";

        public StatusService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _col = db.GetCollection<StatusModel>("Statuses");
            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            // Mỗi deviceId chỉ 1 doc latest
            var uxDevice = new CreateIndexModel<StatusModel>(
                Builders<StatusModel>.IndexKeys.Ascending(F_DeviceId),
                new CreateIndexOptions { Name = "ux_device", Unique = true }
            );
            EnsureIndexSafe(uxDevice);

            // Phụ (nếu cần truy vấn phụ): deviceId + timestamp desc
            var ixDevTs = new CreateIndexModel<StatusModel>(
                Builders<StatusModel>.IndexKeys.Ascending(F_DeviceId).Descending(F_Timestamp),
                new CreateIndexOptions { Name = "ix_device_ts" }
            );
            EnsureIndexSafe(ixDevTs);
        }

        private void EnsureIndexSafe(CreateIndexModel<StatusModel> model)
        {
            try { _col.Indexes.CreateOne(model); }
            catch (MongoCommandException ex)
            {
                var msg = ex.Message ?? string.Empty;
                if (msg.Contains("already exists", StringComparison.OrdinalIgnoreCase) ||
                    msg.Contains("exists with different options", StringComparison.OrdinalIgnoreCase)) return;
                throw;
            }
        }

        public async Task<List<StatusModel>> GetLatestStatuses(
            List<ObjectId> deviceIds,
            CancellationToken ct = default)
        {
            if (deviceIds == null || deviceIds.Count == 0) return new();
            var filter = Builders<StatusModel>.Filter.In(F_DeviceId, deviceIds);
            // Sau khi có unique index, mỗi deviceId chỉ có 1 doc
            return await _col.Find(filter).ToListAsync(ct);
        }

        /// Ghi latest an toàn: chỉ update khi timestamp mới hơn (tránh “đè ngược”).
        public async Task<bool> UpsertLatestAsync(
            ObjectId deviceId,
            double? temp,
            double? humi,
            DateTime timeUtc,
            string? status,
            string? notes,
            CancellationToken ct = default)
        {
            if (timeUtc.Kind != DateTimeKind.Utc)
                timeUtc = DateTime.SpecifyKind(timeUtc, DateTimeKind.Utc);

            var f = Builders<StatusModel>.Filter.And(
                Builders<StatusModel>.Filter.Eq(F_DeviceId, deviceId),
                Builders<StatusModel>.Filter.Or(
                    Builders<StatusModel>.Filter.Exists(F_Timestamp, false),
                    Builders<StatusModel>.Filter.Lt(F_Timestamp, timeUtc)
                )
            );

            var u = Builders<StatusModel>.Update
                .Set(F_DeviceId, deviceId)
                .Set(F_Temperature, temp)
                .Set(F_Humidity, humi)
                .Set(F_Timestamp, timeUtc)
                .Set(F_Status, status)
                .Set(F_Notes, notes)
                .SetOnInsert(F_Id, ObjectId.GenerateNewId());

            var res = await _col.UpdateOneAsync(f, u, new UpdateOptions { IsUpsert = true }, ct);
            return res.UpsertedId != null || res.ModifiedCount > 0;
        }

        public async Task<int> UpsertLatestManyAsync(
            IEnumerable<(ObjectId deviceId, double? temp, double? humi, DateTime timeUtc, string? status, string? notes)> batch,
            CancellationToken ct = default)
        {
            var writes = new List<WriteModel<StatusModel>>();
            foreach (var (deviceId, temp, humi, timeUtc, status, notes) in batch)
            {
                var ts = timeUtc.Kind == DateTimeKind.Utc ? timeUtc : DateTime.SpecifyKind(timeUtc, DateTimeKind.Utc);
                var f = Builders<StatusModel>.Filter.And(
                    Builders<StatusModel>.Filter.Eq(F_DeviceId, deviceId),
                    Builders<StatusModel>.Filter.Or(
                        Builders<StatusModel>.Filter.Exists(F_Timestamp, false),
                        Builders<StatusModel>.Filter.Lt(F_Timestamp, ts)
                    )
                );
                var u = Builders<StatusModel>.Update
                    .Set(F_DeviceId, deviceId)
                    .Set(F_Temperature, temp)
                    .Set(F_Humidity, humi)
                    .Set(F_Timestamp, ts)
                    .Set(F_Status, status)
                    .Set(F_Notes, notes)
                    .SetOnInsert(F_Id, ObjectId.GenerateNewId());

                writes.Add(new UpdateOneModel<StatusModel>(f, u) { IsUpsert = true });
            }
            if (writes.Count == 0) return 0;
            var res = await _col.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
            return (res.Upserts?.Count ?? 0) + (int)res.ModifiedCount;
        }
    }
}
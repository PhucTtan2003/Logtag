// Services/DeviceService.cs
using MongoDB.Driver;
using Microsoft.Extensions.Options;
using temperature_humi.Models;
using MongoDB.Bson;
using temperature_humi.Data;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System;

namespace temperature_humi.Service
{
    // Mapping phụ cho bảng phân công Employee riêng (file 2)
    public class EmployeeAccountDevice
    {
        public ObjectId Id { get; set; }
        public ObjectId UserId { get; set; }
        public long TeamId { get; set; }
        public string SerialNumber { get; set; } = "";
        public string? Notes { get; set; }
        public string? Model { get; set; }
        public DateTime? AssignedAtUtc { get; set; }
    }

    public class DeviceService
    {
        private readonly IMongoCollection<Device> _devices;
        private readonly IMongoCollection<AccountDevice> _accountDevices;
        private readonly IMongoCollection<EmployeeAccountDevice> _empAccountDevices;

        public DeviceService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var database = client.GetDatabase(settings.Value.DatabaseName);

            // ✅ đúng collection name (theo file 1)
            _devices = database.GetCollection<Device>("Device");
            _accountDevices = database.GetCollection<AccountDevice>("AccountDevices");
            _empAccountDevices = database.GetCollection<EmployeeAccountDevice>("EmployeeAccountDevices");

            // ===== Indexes =====
            // Unique theo serialNumber
            var idxSerial = Builders<Device>.IndexKeys.Ascending(d => d.serialNumber);
            _devices.Indexes.CreateOne(new CreateIndexModel<Device>(idxSerial, new CreateIndexOptions { Unique = true }));

            // Phục vụ truy vấn team + serial
            var idxTeamSerial = Builders<Device>.IndexKeys
                .Ascending(d => d.teamId)
                .Ascending(d => d.serialNumber);
            _devices.Indexes.CreateOne(new CreateIndexModel<Device>(idxTeamSerial));

            // Unique mapping (UserId, TeamId, SerialNumber) cho EmployeeAccountDevices
            var idxEmpMap = Builders<EmployeeAccountDevice>.IndexKeys
                .Ascending(x => x.UserId)
                .Ascending(x => x.TeamId)
                .Ascending(x => x.SerialNumber);
            _empAccountDevices.Indexes.CreateOne(
                new CreateIndexModel<EmployeeAccountDevice>(idxEmpMap, new CreateIndexOptions { Unique = true })
            );
        }

        // ===== Helpers =====
        private static string NormalizeSerial(string s) => (s ?? "").Trim().ToUpperInvariant();

        private static IEnumerable<string> NormalizeSerials(IEnumerable<string> serials) =>
            serials.Where(s => !string.IsNullOrWhiteSpace(s))
                   .Select(NormalizeSerial)
                   .Distinct(StringComparer.OrdinalIgnoreCase);

        // ===== Basic gets =====
        public List<Device> GetAll() => _devices.Find(_ => true).ToList();

        public Task<List<Device>> GetAllAsync() => _devices.Find(_ => true).ToListAsync();

        public async Task<List<Device>> GetActiveDevicesAsync() =>
            await _devices.Find(d => d.deviceState == "AttachedToLocation").ToListAsync();

        public async Task<List<string>> GetActiveDeviceSerialsAsync() =>
            await _devices.Find(d => d.deviceState == "AttachedToLocation" || d.deviceState == "AttachedToShipment")
                          .Project(d => d.serialNumber)
                          .ToListAsync();

        // Sync get by serial (giữ nguyên tên theo file 1/2)
        public Device GetBySerial(string serial)
        {
            var s = NormalizeSerial(serial);
            return _devices.Find(d => d.serialNumber == s).FirstOrDefault();
        }

        // Async get by serial (thêm để dùng chung)
        public async Task<Device?> GetBySerialAsync(string serial)
        {
            var s = NormalizeSerial(serial);
            return await _devices.Find(d => d.serialNumber == s).FirstOrDefaultAsync();
        }

        // Giữ tên "FindBySerialAsync" (file 2), nhưng ủy quyền để không trùng logic
        public Task<Device?> FindBySerialAsync(string serialNumber) => GetBySerialAsync(serialNumber);

        // Lấy nhiều device theo danh sách serial (tuỳ chọn lọc trạng thái)
        public async Task<List<Device>> GetBySerialsAsync(IEnumerable<string> serials, bool onlyActive = true)
        {
            var normalized = NormalizeSerials(serials).ToList();
            if (normalized.Count == 0) return new List<Device>();

            var f = Builders<Device>.Filter;
            var filter = f.In(d => d.serialNumber, normalized);
            if (onlyActive)
                filter &= f.Eq(d => d.deviceState, "AttachedToLocation");

            return await _devices.Find(filter).ToListAsync();
        }

        public IQueryable<Device> AsQueryable() => _devices.AsQueryable();

        // ===== Mapping qua AccountDevices (User ↔ Device) =====

        // Overload 1: theo AccountDevices (teamId: long?)
        public async Task<List<string>> GetSerialsByAccountAsync(ObjectId userId, long? teamId = null)
        {
            var fb = Builders<AccountDevice>.Filter;
            var filter = fb.Eq(ad => ad.UserId, userId);
            if (teamId.HasValue)
                filter &= fb.Eq(ad => ad.TeamId, teamId.Value);

            var serials = await _accountDevices
                .Find(filter)
                .Project(ad => ad.SerialNumber)
                .ToListAsync();

            return NormalizeSerials(serials).ToList();
        }

        // Overload 2: theo EmployeeAccountDevices (teamId: string?) – giữ nguyên tên theo file 2
        public async Task<List<string>> GetSerialsByAccountAsync(ObjectId userId, string? teamId = null)
        {
            var fb = Builders<EmployeeAccountDevice>.Filter;
            var filter = fb.Eq(ad => ad.UserId, userId);
            if (!string.IsNullOrWhiteSpace(teamId))
                filter &= fb.Eq(ad => ad.TeamId, long.Parse(teamId));

            var serials = await _empAccountDevices
                .Find(filter)
                .Project(ad => ad.SerialNumber)
                .ToListAsync();

            return NormalizeSerials(serials).ToList();
        }

        // Lấy device list theo user (AccountDevices). onlyActive mặc định true.
        public async Task<List<Device>> GetDevicesByAccountAsync(ObjectId userId, bool onlyActive = true)
        {
            var serials = await _accountDevices
                .Find(ad => ad.UserId == userId)
                .Project(ad => ad.SerialNumber)
                .ToListAsync();

            if (serials == null || serials.Count == 0)
                return new List<Device>();

            return await GetBySerialsAsync(serials, onlyActive);
        }

        // ===== Tìm kiếm & lọc =====
        public async Task<List<Device>> SearchAsync(string q, bool onlyAttached = true)
        {
            var f = Builders<Device>.Filter;
            var filters = new List<FilterDefinition<Device>>();

            if (onlyAttached)
                filters.Add(f.Eq(d => d.deviceState, "AttachedToLocation"));

            if (!string.IsNullOrWhiteSpace(q))
            {
                var regex = new BsonRegularExpression(q.Trim(), "i");
                filters.Add(f.Or(
                    f.Regex(d => d.serialNumber, regex),
                    f.Regex(d => d.model, regex)
                // Có thêm name/alias thì bổ sung thêm trường ở đây
                ));
            }

            var filter = filters.Count > 0 ? f.And(filters) : FilterDefinition<Device>.Empty;
            return await _devices.Find(filter).Limit(100).ToListAsync();
        }

        // Lấy toàn bộ device theo team
        public async Task<List<Device>> GetByTeamAsync(long teamId, bool onlyAttached = true)
        {
            var f = Builders<Device>.Filter;
            var filter = f.Eq("teamId", teamId);
            if (onlyAttached)
                filter = f.And(filter, f.Eq("deviceState", "AttachedToLocation"));

            return await _devices.Find(filter).ToListAsync();
        }

        // Lấy toàn bộ serial theo team (teamId: long)
        public async Task<List<string>> GetAllSerialNumbersAsync(long teamId, CancellationToken ct = default)
        {
            var filter = Builders<Device>.Filter.Eq(x => x.teamId, teamId);
            var serials = await _devices
                .Find(filter)
                .Project(x => x.serialNumber)
                .ToListAsync(ct);

            return NormalizeSerials(serials).ToList();
        }

        // Lấy toàn bộ serial (không lọc team)
        public async Task<List<string>> GetAllSerialsAsync(CancellationToken ct = default)
        {
            var serials = await _devices
                .Distinct<string>(nameof(Device.serialNumber), FilterDefinition<Device>.Empty)
                .ToListAsync(ct);

            return NormalizeSerials(serials).ToList();
        }

        // Lấy toàn bộ serial có lọc theo teamId (string?)
        public async Task<List<string>> GetAllSerialsAsync(string? teamId, CancellationToken ct = default)
        {
            var filter = string.IsNullOrWhiteSpace(teamId)
                ? FilterDefinition<Device>.Empty
                : Builders<Device>.Filter.Eq("teamId", teamId);

            var serials = await _devices
                .Distinct<string>(nameof(Device.serialNumber), filter)
                .ToListAsync(ct);

            return NormalizeSerials(serials).ToList();
        }

        // ===== Upsert / Sync từ upstream =====
        public Task UpsertBySerialAsync(Device d)
        {
            d.serialNumber = NormalizeSerial(d.serialNumber);

            var filter = Builders<Device>.Filter.Eq(x => x.serialNumber, d.serialNumber);

            var update = Builders<Device>.Update
                .Set(x => x.model, d.model)
                .Set(x => x.description, d.description)
                .Set(x => x.deviceState, d.deviceState)
                .Set(x => x.registrationDateUtc, d.registrationDateUtc)
                .Set(x => x.lastConnectionDateUtc, d.lastConnectionDateUtc)
                .Set(x => x.updatedAtUtc, DateTime.UtcNow)
                .Set(x => x.teamId, d.teamId)
                .SetOnInsert(x => x.serialNumber, d.serialNumber);

            return _devices.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
        }

        // Upsert sau khi register thành công
        public Task UpsertAfterRegisterAsync(string serial, string deviceType, string? description, long teamId)
        {
            var s = NormalizeSerial(serial);

            var filter = Builders<Device>.Filter.Eq(x => x.serialNumber, s);
            var update = Builders<Device>.Update
                .Set(x => x.teamId, teamId)
                .Set(x => x.model, deviceType)
                .Set(x => x.description, description)
                .Set(x => x.deviceState, "Active")
                .SetOnInsert(x => x.registrationDateUtc, DateTime.UtcNow)
                .Set(x => x.updatedAtUtc, DateTime.UtcNow)
                .SetOnInsert(x => x.serialNumber, s);

            return _devices.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
        }

        // ===== Delete / Soft-delete =====

        // (1) Bản đầy đủ: cho phép softDelete và excludeSimulated
        public async Task<int> DeleteWhereSerialNotInAsync(
            ISet<string> keepSerials,
            bool softDelete = true,
            bool excludeSimulated = false)
        {
            var normalizedKeeps = new HashSet<string>(NormalizeSerials(keepSerials), StringComparer.OrdinalIgnoreCase);

            var filter = Builders<Device>.Filter.Not(
                Builders<Device>.Filter.In(d => d.serialNumber, normalizedKeeps)
            );

            if (excludeSimulated)
            {
                filter = Builders<Device>.Filter.And(
                    filter,
                    Builders<Device>.Filter.Ne(d => d.deviceState, "Simulated")
                );
            }

            if (softDelete)
            {
                var update = Builders<Device>.Update
                    .Set(d => d.deviceState, "Deleted")
                    .Set(d => d.updatedAtUtc, DateTime.UtcNow);

                var res = await _devices.UpdateManyAsync(filter, update);
                return (int)res.ModifiedCount;
            }
            else
            {
                var res = await _devices.DeleteManyAsync(filter);
                return (int)res.DeletedCount;
            }
        }

        // (2) Overload tiện cho IEnumerable
        public Task<int> DeleteWhereSerialNotInAsync(
            IEnumerable<string> serials,
            bool softDelete = true,
            bool excludeSimulated = false)
        {
            return DeleteWhereSerialNotInAsync(
                new HashSet<string>(NormalizeSerials(serials), StringComparer.OrdinalIgnoreCase),
                softDelete,
                excludeSimulated
            );
        }

        // Đánh dấu Deleted theo serial
        public Task MarkDeletedAsync(string serialNumber)
        {
            var s = NormalizeSerial(serialNumber);
            var filter = Builders<Device>.Filter.Eq(x => x.serialNumber, s);
            var update = Builders<Device>.Update
                .Set(x => x.deviceState, "Deleted")
                .Set(x => x.updatedAtUtc, DateTime.UtcNow);

            return _devices.UpdateOneAsync(filter, update);
        }

        // Xoá cứng theo serial
        public Task RemoveBySerialAsync(string serialNumber)
        {
            var s = NormalizeSerial(serialNumber);
            return _devices.DeleteOneAsync(d => d.serialNumber == s);
        }

        // ===== Hỗ trợ rebalance / báo cáo =====
        public async Task<List<string>> GetSerialsByTeamAsync(long teamId)
        {
            var serials = await _devices
                .Find(d => d.teamId == teamId)
                .Project(d => d.serialNumber)
                .ToListAsync();

            return NormalizeSerials(serials).OrderBy(s => s).ToList();
        }
    }
}
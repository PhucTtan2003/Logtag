using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Collections.Concurrent;
using temperature_humi.Data;
using temperature_humi.Helpers;
using temperature_humi.Models;

namespace temperature_humi.Service.LogtagService
{
    public class AccountDeviceService
    {
        private readonly IMongoCollection<AccountDevice> _col;
        private readonly ILogger<AccountDeviceService>? _log;

        private static readonly ConcurrentDictionary<long, SemaphoreSlim> _teamLocks = new();

        public AccountDeviceService(
            IOptions<MongoDBSettings> settings,
            ILogger<AccountDeviceService>? log = null)
        {
            _log = log;

            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _col = db.GetCollection<AccountDevice>("AccountDevices");

            // Không tạo hoặc thay đổi index trong constructor.
            // Program.cs sẽ chủ động gọi EnsureIndexesAsync() đúng một lần khi ứng dụng boot.
            // Cách này tránh nhiều singleton/hosted service cùng khởi tạo collection và tạo index trùng tên.
        }

        // ================== Normalize helpers ==================
        private static string NormSerial(string? s) => (s ?? string.Empty).Trim().ToUpperInvariant();

        private static SemaphoreSlim GetTeamLock(long teamId)
            => _teamLocks.GetOrAdd(teamId, _ => new SemaphoreSlim(1, 1));

        private static BsonDocument KeyUserTeamSerialLower => new()
        {
            { "userId", 1 },
            { "teamId", 1 },
            { "serialNumber", 1 }
        };

        private static BsonDocument KeyUserTeamSerialPascal => new()
        {
            { "UserId", 1 },
            { "TeamId", 1 },
            { "SerialNumber", 1 }
        };

        private static BsonDocument KeyTeamSerialLower => new()
        {
            { "teamId", 1 },
            { "serialNumber", 1 }
        };

        private static BsonDocument KeyTeamSerialPascal => new()
        {
            { "TeamId", 1 },
            { "SerialNumber", 1 }
        };

        private static BsonDocument KeyUserLower => new()
        {
            { "userId", 1 }
        };

        private static BsonDocument KeyUserPascal => new()
        {
            { "UserId", 1 }
        };

        private static bool BsonValueEquals(BsonValue a, BsonValue b)
        {
            if (a.BsonType == b.BsonType)
                return a.Equals(b);

            return a.ToString() == b.ToString();
        }

        private static bool SameIndexKey(BsonDocument indexDoc, params BsonDocument[] expectedKeys)
        {
            if (!indexDoc.TryGetValue("key", out var keyValue) || !keyValue.IsBsonDocument)
                return false;

            var actual = keyValue.AsBsonDocument;

            foreach (var expected in expectedKeys)
            {
                if (actual.ElementCount != expected.ElementCount)
                    continue;

                var ok = true;
                foreach (var e in expected.Elements)
                {
                    if (!actual.TryGetValue(e.Name, out var actualValue) ||
                        !BsonValueEquals(actualValue, e.Value))
                    {
                        ok = false;
                        break;
                    }
                }

                if (ok) return true;
            }

            return false;
        }

        private static string? IndexName(BsonDocument indexDoc)
        {
            if (indexDoc.TryGetValue("name", out var name) && name.IsString)
                return name.AsString;

            return null;
        }

        private static bool IndexIsUnique(BsonDocument indexDoc)
        {
            return indexDoc.TryGetValue("unique", out var unique)
                && unique.IsBoolean
                && unique.AsBoolean;
        }

        private static HashSet<string> IndexNames(List<BsonDocument> indexes)
        {
            return indexes
                .Select(IndexName)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.Ordinal);
        }

        /// <summary>
        /// Chuẩn hoá SerialNumber về UPPER/TRIM cho toàn bộ collection.
        /// </summary>
        private async Task<int> NormalizeAllSerialsAsync(CancellationToken ct = default)
        {
            var docs = await _col.Find(_ => true)
                .Project(x => new { x.Id, x.SerialNumber })
                .ToListAsync(ct);

            var updates = new List<WriteModel<AccountDevice>>();

            foreach (var doc in docs)
            {
                var normalized = NormSerial(doc.SerialNumber);
                if (normalized != (doc.SerialNumber ?? string.Empty))
                {
                    var filter = Builders<AccountDevice>.Filter.Eq(x => x.Id, doc.Id);
                    var update = Builders<AccountDevice>.Update.Set(x => x.SerialNumber, normalized);
                    updates.Add(new UpdateOneModel<AccountDevice>(filter, update));
                }
            }

            if (updates.Count == 0) return 0;

            var res = await _col.BulkWriteAsync(updates, new BulkWriteOptions { IsOrdered = false }, ct);
            return (int)res.ModifiedCount;
        }

        /// <summary>
        /// Dọn duplicate theo key chuẩn multi-team: (TeamId, SerialNumber).
        /// Giữ bản mới nhất theo AssignedAtUtc; nếu bằng nhau thì giữ _id mới nhất.
        /// </summary>
        public async Task<int> DeduplicateTeamSerialsAsync(CancellationToken ct = default)
        {
            // MongoDB LINQ không dịch được custom method NormSerial(...)
            // bên trong .Project(). Chỉ lấy dữ liệu thô, sau đó normalize
            // trong bộ nhớ.
            var raw = await _col.Find(_ => true)
                .Project(x => new
                {
                    x.Id,
                    x.UserId,
                    x.TeamId,
                    x.SerialNumber,
                    x.AssignedAtUtc
                })
                .ToListAsync(ct);

            var all = raw
                .Select(x => new
                {
                    x.Id,
                    x.UserId,
                    x.TeamId,
                    SerialNorm = NormSerial(x.SerialNumber),
                    x.AssignedAtUtc
                })
                .ToList();

            var grouped = all
                .Where(x => x.TeamId > 0 && !string.IsNullOrWhiteSpace(x.SerialNorm))
                .GroupBy(x => (x.TeamId, x.SerialNorm));

            var updates = new List<WriteModel<AccountDevice>>();
            var deletes = new List<WriteModel<AccountDevice>>();

            foreach (var g in grouped)
            {
                var keep = g
                    .OrderByDescending(x => x.AssignedAtUtc)
                    .ThenByDescending(x => x.Id)
                    .First();

                updates.Add(new UpdateOneModel<AccountDevice>(
                    Builders<AccountDevice>.Filter.Eq(x => x.Id, keep.Id),
                    Builders<AccountDevice>.Update.Set(x => x.SerialNumber, g.Key.SerialNorm)));

                foreach (var d in g.Where(x => x.Id != keep.Id))
                {
                    deletes.Add(new DeleteOneModel<AccountDevice>(
                        Builders<AccountDevice>.Filter.Eq(x => x.Id, d.Id)));
                }
            }

            var deleted = 0;

            if (updates.Count > 0)
                await _col.BulkWriteAsync(updates, new BulkWriteOptions { IsOrdered = false }, ct);

            if (deletes.Count > 0)
            {
                var res = await _col.BulkWriteAsync(deletes, new BulkWriteOptions { IsOrdered = false }, ct);
                deleted = (int)res.DeletedCount;
            }

            return deleted;
        }

        /// <summary>
        /// Drop index theo name nếu tồn tại.
        /// </summary>
        private async Task DropIndexIfExistsAsync(string name, CancellationToken ct)
        {
            var indexes = await _col.Indexes.List().ToListAsync(ct);
            var names = IndexNames(indexes);

            if (!names.Contains(name))
                return;

            try
            {
                await _col.Indexes.DropOneAsync(name, ct);
                _log?.LogWarning("[AccountDevice][Index] Dropped index {IndexName}", name);
            }
            catch (Exception ex)
            {
                _log?.LogWarning(ex, "[AccountDevice][Index] Drop index warning {IndexName}", name);
            }
        }

        /// <summary>
        /// Đảm bảo index theo key, tránh lỗi "same key different name".
        /// Nếu requireUnique=true mà đang có index cùng key nhưng non-unique, sẽ drop index đó rồi tạo lại unique.
        /// </summary>
        private async Task EnsureIndexByKeyAsync(
            string desiredName,
            IndexKeysDefinition<AccountDevice> keyDefinition,
            bool requireUnique,
            BsonDocument expectedLowerKey,
            BsonDocument expectedPascalKey,
            CancellationToken ct)
        {
            var indexes = await _col.Indexes.List().ToListAsync(ct);

            var sameKeyIndexes = indexes
                .Where(ix => SameIndexKey(ix, expectedLowerKey, expectedPascalKey))
                .ToList();

            if (sameKeyIndexes.Count > 0)
            {
                // Nếu chỉ cần non-unique, index unique/non-unique có cùng key đều dùng được cho query.
                if (!requireUnique)
                {
                    _log?.LogInformation(
                        "[AccountDevice][Index] Key already exists for {DesiredName}. Existing={Existing}",
                        desiredName,
                        string.Join(",", sameKeyIndexes.Select(IndexName)));
                    return;
                }

                // Nếu cần unique mà đã có unique rồi thì thôi, dù tên khác cũng OK.
                if (sameKeyIndexes.Any(IndexIsUnique))
                {
                    _log?.LogInformation(
                        "[AccountDevice][Index] Unique key already exists for {DesiredName}. Existing={Existing}",
                        desiredName,
                        string.Join(",", sameKeyIndexes.Select(IndexName)));
                    return;
                }

                // Nếu đang có cùng key nhưng non-unique, Mongo không cho tạo thêm unique cùng key.
                // Sau khi deduplicate xong thì drop non-unique và tạo unique.
                foreach (var ix in sameKeyIndexes)
                {
                    var name = IndexName(ix);
                    if (string.IsNullOrWhiteSpace(name) || name == "_id_")
                        continue;

                    try
                    {
                        await _col.Indexes.DropOneAsync(name, ct);
                        _log?.LogWarning(
                            "[AccountDevice][Index] Dropped non-unique same-key index {IndexName} before creating unique {DesiredName}",
                            name,
                            desiredName);
                    }
                    catch (Exception ex)
                    {
                        _log?.LogWarning(
                            ex,
                            "[AccountDevice][Index] Drop same-key index warning {IndexName}",
                            name);
                    }
                }
            }

            try
            {
                await _col.Indexes.CreateOneAsync(new CreateIndexModel<AccountDevice>(
                    keyDefinition,
                    new CreateIndexOptions
                    {
                        Name = desiredName,
                        Unique = requireUnique,
                        Background = true
                    }), cancellationToken: ct);

                _log?.LogInformation(
                    "[AccountDevice][Index] Created {IndexName}, unique={Unique}",
                    desiredName,
                    requireUnique);
            }
            catch (MongoCommandException ex)
                when ((ex.Message ?? string.Empty).Contains("already exists", StringComparison.OrdinalIgnoreCase) ||
                      (ex.Message ?? string.Empty).Contains("different name", StringComparison.OrdinalIgnoreCase) ||
                      (ex.Message ?? string.Empty).Contains("equivalent index", StringComparison.OrdinalIgnoreCase))
            {
                _log?.LogWarning(
                    ex,
                    "[AccountDevice][Index] Create index ignored because equivalent index already exists. Desired={DesiredName}",
                    desiredName);
            }
        }

        /// <summary>
        /// Gọi tại Program.cs khi boot.
        /// Chuẩn multi-team:
        /// - query nhanh theo UserId/TeamId/Serial
        /// - mỗi TeamId + SerialNumber chỉ có 1 owner hiện hành
        /// </summary>
        public async Task EnsureIndexesAsync(CancellationToken ct = default)
        {
            // 1) Dọn dữ liệu trước khi tạo unique index.
            await NormalizeAllSerialsAsync(ct);
            await DeduplicateTeamSerialsAsync(ct);

            // 2) Drop index legacy gây conflict / không phù hợp multi-team.
            await DropIndexIfExistsAsync("ux_user_serial", ct);

            // Index unique cũ theo UserId+TeamId+Serial là dư thừa và không chặn được việc
            // cùng 1 serial gán cho nhiều user khác nhau trong cùng team.
            await DropIndexIfExistsAsync("ux_user_team_serial", ct);

            // 3) Query index: userId + teamId + serialNumber.
            await EnsureIndexByKeyAsync(
                desiredName: "ix_user_team_serial",
                keyDefinition: Builders<AccountDevice>.IndexKeys
                    .Ascending(x => x.UserId)
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber),
                requireUnique: false,
                expectedLowerKey: KeyUserTeamSerialLower,
                expectedPascalKey: KeyUserTeamSerialPascal,
                ct: ct);

            // 4) Unique owner index: teamId + serialNumber.
            // Nếu trước đó có index default name teamId_1_serialNumber_1 non-unique,
            // hàm này sẽ drop và tạo lại unique ux_team_serial.
            await EnsureIndexByKeyAsync(
                desiredName: "ux_team_serial",
                keyDefinition: Builders<AccountDevice>.IndexKeys
                    .Ascending(x => x.TeamId)
                    .Ascending(x => x.SerialNumber),
                requireUnique: true,
                expectedLowerKey: KeyTeamSerialLower,
                expectedPascalKey: KeyTeamSerialPascal,
                ct: ct);

            // 5) Query theo user.
            await EnsureIndexByKeyAsync(
                desiredName: "ix_user",
                keyDefinition: Builders<AccountDevice>.IndexKeys
                    .Ascending(x => x.UserId),
                requireUnique: false,
                expectedLowerKey: KeyUserLower,
                expectedPascalKey: KeyUserPascal,
                ct: ct);
        }

        // ================= Basic queries =================
        public Task<List<AccountDevice>> GetMapsByAccountAsync(ObjectId userId)
            => _col.Find(x => x.UserId == userId).ToListAsync();

        /// <summary>Trả về (teamId, serialNumber) của 1 user.</summary>
        public async Task<List<(long teamId, string serial)>> GetSerialsByAccountAsync(ObjectId userId)
        {
            var maps = await _col.Find(x => x.UserId == userId)
                .Project(x => new { x.TeamId, x.SerialNumber })
                .ToListAsync();

            return maps
                .Select(m => (m.TeamId, NormSerial(m.SerialNumber)))
                .Distinct()
                .ToList();
        }

        public async Task<List<string>> GetSerialsByAccountOnlyAsync(ObjectId userId)
        {
            var list = await _col.Find(x => x.UserId == userId)
                .Project(x => x.SerialNumber)
                .ToListAsync();

            return list
                .Select(NormSerial)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(s => s)
                .ToList();
        }

        // ================= ACL APIs dùng cho Events =================
        public async Task<bool> HasAccessAsync(
            ObjectId userId,
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            var serial = NormSerial(serialNumber);

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, serial);

            return await _col.CountDocumentsAsync(filter, cancellationToken: ct) > 0;
        }

        public async Task<List<string>> GetMySerialsAsync(
            string userId,
            long teamId,
            CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(userId, out var oid))
                return new List<string>();

            return await GetMySerialsAsync(oid, teamId, ct);
        }

        public async Task<List<string>> GetMySerialsAsync(
            ObjectId userId,
            long teamId,
            CancellationToken ct = default)
        {
            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId);

            var serials = await _col.Find(filter)
                .Project(x => x.SerialNumber)
                .ToListAsync(ct);

            return serials
                .Select(NormSerial)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(s => s)
                .ToList();
        }

        // ================= Ghi / Xóa mapping =================
        /// <summary>
        /// Gán thiết bị cho user.
        /// Chuẩn mới: 1 TeamId + SerialNumber chỉ có 1 owner.
        /// Nếu serial đã gán user khác trong cùng team, hàm này sẽ chuyển owner sang user mới.
        /// </summary>
        public async Task AssignAsync(
            ObjectId userId,
            long teamId,
            string serialNumber,
            string? notes = null)
        {
            var serial = NormSerial(serialNumber);

            if (teamId <= 0)
                throw new ArgumentException("teamId không hợp lệ.", nameof(teamId));

            if (string.IsNullOrWhiteSpace(serial))
                throw new ArgumentException("serialNumber không hợp lệ.", nameof(serialNumber));

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, serial);

            var update = Builders<AccountDevice>.Update
                .Set(x => x.UserId, userId)
                .Set(x => x.TeamId, teamId)
                .Set(x => x.SerialNumber, serial)
                .Set(x => x.Notes, notes)
                .Set(x => x.AssignedAtUtc, DateTime.UtcNow);

            try
            {
                await _col.UpdateOneAsync(
                    filter,
                    update,
                    new UpdateOptions { IsUpsert = true });
            }
            catch (MongoWriteException ex) when (ex.WriteError?.Code == 11000)
            {
                // Nếu race condition khi unique index vừa được tạo, dọn duplicate và thử lại 1 lần.
                await DeduplicateTeamSerialsAsync();
                await _col.UpdateOneAsync(
                    filter,
                    update,
                    new UpdateOptions { IsUpsert = true });
            }
        }

        public Task UnassignAsync(ObjectId userId, long teamId, string serialNumber)
        {
            var serial = NormSerial(serialNumber);

            return _col.DeleteOneAsync(x =>
                x.UserId == userId &&
                x.TeamId == teamId &&
                x.SerialNumber == serial);
        }

        public async Task<bool> RemoveAsync(
            ObjectId userId,
            long teamId,
            string serialNumber,
            CancellationToken ct = default)
        {
            var serial = NormSerial(serialNumber);

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, serial);

            var res = await _col.DeleteOneAsync(filter, ct);
            return res.DeletedCount > 0;
        }

        /// <summary>
        /// Giữ tương thích controller cũ chưa truyền teamId.
        /// Nếu serial có thể trùng giữa nhiều team, nên dùng overload có teamId.
        /// </summary>
        public async Task<bool> RemoveAsync(
            ObjectId userId,
            string serialNumber,
            CancellationToken ct = default)
        {
            var serial = NormSerial(serialNumber);

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, serial);

            var res = await _col.DeleteManyAsync(filter, ct);
            return res.DeletedCount > 0;
        }

        public async Task<List<AccountDevice>> GetMapsByTeamAsync(long teamId, CancellationToken ct)
        {
            return await _col.Find(x => x.TeamId == teamId).ToListAsync(ct);
        }

        public async Task<List<AccountDevice>> GetMapsByTeamAsync(long teamId)
        {
            return await _col.Find(x => x.TeamId == teamId).ToListAsync();
        }

        #region Rebalance
        public async Task RebalanceTeamAsync(
            long teamId,
            IEnumerable<ObjectId>? participantUserIds = null,
            CancellationToken ct = default)
        {
            var locker = GetTeamLock(teamId);
            await locker.WaitAsync(ct);

            try
            {
                var currentMaps = await GetMapsByTeamAsync(teamId, ct);

                var allSerials = currentMaps
                    .Select(x => NormSerial(x.SerialNumber))
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                HashSet<ObjectId> participants =
                    participantUserIds is not null && participantUserIds.Any()
                        ? new HashSet<ObjectId>(participantUserIds)
                        : currentMaps.Select(m => m.UserId).ToHashSet();

                if (participants.Count == 0 || allSerials.Count == 0)
                    return;

                var assignedByUser = participants.ToDictionary(
                    uid => uid,
                    _ => new HashSet<string>(StringComparer.OrdinalIgnoreCase));

                foreach (var m in currentMaps.Where(m => participants.Contains(m.UserId)))
                    assignedByUser[m.UserId].Add(NormSerial(m.SerialNumber));

                int total = allSerials.Count;
                int n = participants.Count;
                int baseQuota = total / n;
                int remainder = total % n;

                var orderedUsers = participants
                    .OrderBy(x => x, Comparer<ObjectId>.Create((a, b) => a.CompareTo(b)))
                    .ToList();

                var targetByUser = new Dictionary<ObjectId, int>();
                for (int i = 0; i < orderedUsers.Count; i++)
                    targetByUser[orderedUsers[i]] = baseQuota + (i < remainder ? 1 : 0);

                var currentlyAssignedSerials = currentMaps
                    .Select(m => NormSerial(m.SerialNumber))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                var unassignedPool = allSerials
                    .Where(s => !currentlyAssignedSerials.Contains(s))
                    .ToList();

                foreach (var uid in orderedUsers)
                {
                    var have = assignedByUser[uid];
                    int target = targetByUser[uid];

                    if (have.Count > target)
                    {
                        var takeBack = have.Take(have.Count - target).ToList();
                        foreach (var s in takeBack)
                        {
                            have.Remove(s);
                            unassignedPool.Add(s);
                        }
                    }
                }

                var desiredPairs = new HashSet<(ObjectId uid, string serial)>(new PairComparer());

                foreach (var uid in orderedUsers)
                {
                    var have = assignedByUser[uid];
                    int target = targetByUser[uid];

                    while (have.Count < target && unassignedPool.Count > 0)
                    {
                        var s = unassignedPool[^1];
                        unassignedPool.RemoveAt(unassignedPool.Count - 1);
                        have.Add(s);
                    }

                    foreach (var s in have)
                        desiredPairs.Add((uid, s));
                }

                var currentPairSet = currentMaps
                    .Select(m => (m.UserId, serial: NormSerial(m.SerialNumber)))
                    .ToHashSet(new PairComparer());

                var removeOps = new List<WriteModel<AccountDevice>>();
                var upsertOps = new List<WriteModel<AccountDevice>>();

                foreach (var map in currentMaps.Where(m => participants.Contains(m.UserId)))
                {
                    var pair = (map.UserId, serial: NormSerial(map.SerialNumber));

                    if (!desiredPairs.Contains(pair))
                    {
                        var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, map.UserId)
                                   & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                                   & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, pair.serial);

                        removeOps.Add(new DeleteOneModel<AccountDevice>(filter));
                    }
                }

                foreach (var p in desiredPairs)
                {
                    if (currentPairSet.Contains(p))
                        continue;

                    var filter = Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                               & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, p.serial);

                    var update = Builders<AccountDevice>.Update
                        .Set(x => x.UserId, p.uid)
                        .Set(x => x.TeamId, teamId)
                        .Set(x => x.SerialNumber, p.serial)
                        .Set(x => x.AssignedAtUtc, DateTime.UtcNow);

                    upsertOps.Add(new UpdateOneModel<AccountDevice>(filter, update)
                    {
                        IsUpsert = true
                    });
                }

                if (removeOps.Count > 0)
                    await _col.BulkWriteAsync(removeOps, new BulkWriteOptions { IsOrdered = false }, ct);

                if (upsertOps.Count > 0)
                    await _col.BulkWriteAsync(upsertOps, new BulkWriteOptions { IsOrdered = false }, ct);
            }
            finally
            {
                locker.Release();
            }
        }

        public async Task AssignAndRebalanceAsync(ObjectId userId, long teamId, CancellationToken ct)
        {
            var maps = await GetMapsByTeamAsync(teamId, ct);
            var participants = maps.Select(m => m.UserId).ToHashSet();
            participants.Add(userId);

            await RebalanceTeamAsync(teamId, participants, ct);
        }

        private sealed class PairComparer : IEqualityComparer<(ObjectId uid, string serial)>
        {
            public bool Equals((ObjectId uid, string serial) x, (ObjectId uid, string serial) y)
                => x.uid == y.uid && string.Equals(x.serial, y.serial, StringComparison.OrdinalIgnoreCase);

            public int GetHashCode((ObjectId uid, string serial) obj)
                => HashCode.Combine(obj.uid, obj.serial?.ToLowerInvariant());
        }
        #endregion

        #region String-id convenience
        public async Task<List<AccountDevice>> GetByAccountIdAsync(string accountId)
        {
            if (!ObjectId.TryParse(accountId, out var oid))
                return new List<AccountDevice>();

            return await GetMapsByAccountAsync(oid);
        }

        public async Task<List<string>> GetSerialsByAccountOnlyAsync(string accountId)
        {
            if (!ObjectId.TryParse(accountId, out var oid))
                return new List<string>();

            return await GetSerialsByAccountOnlyAsync(oid);
        }

        public async Task<List<(long teamId, string serial)>> GetSerialsByAccountAsync(string accountId)
        {
            if (!ObjectId.TryParse(accountId, out var oid))
                return new List<(long, string)>();

            return await GetSerialsByAccountAsync(oid);
        }
        #endregion

        public async Task<long> DeleteAllByUserAsync(ObjectId userId, CancellationToken ct = default)
        {
            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, userId);
            var res = await _col.DeleteManyAsync(filter, ct);
            return res.DeletedCount;
        }

        /// <summary>
        /// Lấy tất cả serial đang có trong AccountDevices.
        /// </summary>
        public async Task<List<string>> GetAllSerialsAsync(CancellationToken ct = default)
        {
            var serials = await _col.Distinct(
                x => x.SerialNumber,
                FilterDefinition<AccountDevice>.Empty).ToListAsync(ct);

            return serials
                .Select(NormSerial)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(s => s)
                .ToList();
        }

        public Task<List<AccountDevice>> GetMapsBySerialAsync(string serial, CancellationToken ct = default)
        {
            var sn = NormSerial(serial);
            var filter = Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, sn);
            return _col.Find(filter).ToListAsync(ct);
        }

        public Task<List<AccountDevice>> GetMapsBySerialAsync(long teamId, string serial, CancellationToken ct = default)
        {
            var sn = NormSerial(serial);
            var filter = Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, sn);

            return _col.Find(filter).ToListAsync(ct);
        }

        public async Task<ObjectId> GetOwnerUserIdAsync(string serial, CancellationToken ct = default)
        {
            var norm = NormSerial(serial);

            var map = await _col
                .Find(x => x.SerialNumber == norm)
                .SortByDescending(x => x.AssignedAtUtc)
                .FirstOrDefaultAsync(ct);

            return map?.UserId ?? ObjectId.Empty;
        }

        public async Task<ObjectId> GetOwnerUserIdAsync(long teamId, string serial, CancellationToken ct = default)
        {
            var norm = NormSerial(serial);

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId)
                       & Builders<AccountDevice>.Filter.Eq(x => x.SerialNumber, norm);

            var map = await _col.Find(filter).FirstOrDefaultAsync(ct);
            return map?.UserId ?? ObjectId.Empty;
        }

        public async Task<List<string>> GetLt5GeoSerialsByUserAsync(
            string userId,
            CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(userId, out var uid))
                return new List<string>();

            var serials = await _col
                .Find(x => x.UserId == uid)
                .Project(x => x.SerialNumber)
                .ToListAsync(ct);

            return serials
                .Select(NormSerial)
                .Where(DeviceSerialHelper.IsLt5Geo)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(x => x)
                .ToList();
        }

        public async Task<List<string>> GetLt5GeoSerialsByUserAsync(
            string userId,
            long teamId,
            CancellationToken ct = default)
        {
            if (!ObjectId.TryParse(userId, out var uid))
                return new List<string>();

            var filter = Builders<AccountDevice>.Filter.Eq(x => x.UserId, uid)
                       & Builders<AccountDevice>.Filter.Eq(x => x.TeamId, teamId);

            var serials = await _col
                .Find(filter)
                .Project(x => x.SerialNumber)
                .ToListAsync(ct);

            return serials
                .Select(NormSerial)
                .Where(DeviceSerialHelper.IsLt5Geo)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(x => x)
                .ToList();
        }

        public async Task<List<string>> GetAllLt5GeoSerialsAsync(CancellationToken ct = default)
        {
            var serials = await _col
                .Find(Builders<AccountDevice>.Filter.Empty)
                .Project(x => x.SerialNumber)
                .ToListAsync(ct);

            return serials
                .Select(NormSerial)
                .Where(DeviceSerialHelper.IsLt5Geo)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(x => x)
                .ToList();
        }

        public async Task<List<string>> GetAllLt5GeoSerialsAsync(long teamId, CancellationToken ct = default)
        {
            var serials = await _col
                .Find(x => x.TeamId == teamId)
                .Project(x => x.SerialNumber)
                .ToListAsync(ct);

            return serials
                .Select(NormSerial)
                .Where(DeviceSerialHelper.IsLt5Geo)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(x => x)
                .ToList();
        }
    }
}
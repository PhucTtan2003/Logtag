using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Models;
using System.Collections.Concurrent;

namespace temperature_humi.Service
{
    public class EmployeeAccountDeviceService
    {
        private readonly IMongoCollection<EmployeeAccountDevice> _col;
        private static readonly ConcurrentDictionary<long, SemaphoreSlim> _teamLocks = new();

        public EmployeeAccountDeviceService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _col = db.GetCollection<EmployeeAccountDevice>("EmployeeAccountDevices");
        }

        private static SemaphoreSlim GetTeamLock(long teamId)
            => _teamLocks.GetOrAdd(teamId, _ => new SemaphoreSlim(1, 1));

        // === Match cả teamId lưu kiểu long hoặc string "16922"
        private static FilterDefinition<EmployeeAccountDevice> TeamFilter(long teamId)
        {
            var fLong = Builders<EmployeeAccountDevice>.Filter.Eq(x => x.TeamId, teamId);
            var fStr = Builders<EmployeeAccountDevice>.Filter.Eq("teamId", teamId.ToString());
            return Builders<EmployeeAccountDevice>.Filter.Or(fLong, fStr);
        }

        public async Task<List<EmployeeAccountDevice>> GetMapsByTeamAsync(long teamId)
            => await _col.Find(TeamFilter(teamId)).ToListAsync();

        public async Task<List<EmployeeAccountDevice>> GetMapsByAccountAsync(ObjectId userId)
            => await _col.Find(x => x.UserId == userId).ToListAsync();

        public async Task AssignAsync(ObjectId userId, long teamId, string serialNumber, string? notes = null, string? model = null)
        {
            var fUser = Builders<EmployeeAccountDevice>.Filter.Eq(x => x.UserId, userId);
            var fSer = Builders<EmployeeAccountDevice>.Filter.Eq(x => x.SerialNumber, serialNumber);
            var filter = Builders<EmployeeAccountDevice>.Filter.And(TeamFilter(teamId), fUser, fSer);

            var update = Builders<EmployeeAccountDevice>.Update
                .SetOnInsert(x => x.UserId, userId)
                .SetOnInsert(x => x.TeamId, teamId) // sẽ lưu kiểu long (chuẩn hoá dần)
                .SetOnInsert(x => x.SerialNumber, serialNumber)
                .SetOnInsert(x => x.AssignedAtUtc, DateTime.UtcNow)
                .Set(x => x.Notes, notes)
                .Set(x => x.Model, model);

            await _col.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
        }


        public async Task<List<string>> GetSerialsByAccountOnlyAsync(ObjectId accountId)
        {
            var rows = await _col.Find(x => x.UserId == accountId)
                                 .Project(x => x.SerialNumber)
                                 .ToListAsync();
            return rows ?? new List<string>();
        }

        // Chỉ thao tác trên collection EmployeeAccountDevices
        public async Task<long> ClearByTeamAsync(long teamId, IEnumerable<ObjectId>? userIds = null)
        {
            var filter = TeamFilter(teamId);                // match long + string
            if (userIds != null && userIds.Any())
            {
                var inUsers = Builders<EmployeeAccountDevice>
                              .Filter.In(x => x.UserId, userIds);
                filter = Builders<EmployeeAccountDevice>
                         .Filter.And(filter, inUsers);
            }
            var result = await _col.DeleteManyAsync(filter); // ✅ chỉ xóa mapping
            return result.DeletedCount;
        }


        public async Task<long> CountAsync(FilterDefinition<EmployeeAccountDevice> filter)
            => await _col.CountDocumentsAsync(filter);

        public async Task RebalanceTeamAsync(long teamId, IEnumerable<ObjectId>? participantUserIds = null)
        {
            var locker = GetTeamLock(teamId);
            await locker.WaitAsync();
            try
            {
                // Lấy toàn bộ serial đang có mapping trong team (nguồn hiện thời)
                var allSerials = await _col
                    .Find(TeamFilter(teamId))
                    .Project(x => x.SerialNumber)
                    .ToListAsync();
                allSerials = allSerials.Distinct(StringComparer.OrdinalIgnoreCase).ToList();

                var currentMaps = await GetMapsByTeamAsync(teamId);

                HashSet<ObjectId> participants =
                    participantUserIds is not null && participantUserIds.Any()
                        ? new HashSet<ObjectId>(participantUserIds)
                        : currentMaps.Select(m => m.UserId).ToHashSet();

                if (participants.Count == 0) return;

                var assignedByUser = participants.ToDictionary(
                    uid => uid,
                    uid => new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                );
                foreach (var m in currentMaps.Where(m => participants.Contains(m.UserId)))
                    assignedByUser[m.UserId].Add(m.SerialNumber);

                int total = allSerials.Count;
                int n = participants.Count;
                int baseQuota = total / n;
                int remainder = total % n;

                var orderedUsers = participants.OrderBy(x => x).ToList();

                var targetByUser = new Dictionary<ObjectId, int>();
                for (int i = 0; i < orderedUsers.Count; i++)
                    targetByUser[orderedUsers[i]] = baseQuota + (i < remainder ? 1 : 0);

                var currentlyAssignedSerials = currentMaps.Select(m => m.SerialNumber)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                var unassignedPool = allSerials.Where(s => !currentlyAssignedSerials.Contains(s)).ToList();

                // Thu hồi bớt
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

                var removeOps = new List<WriteModel<EmployeeAccountDevice>>();
                var assignOps = new List<WriteModel<EmployeeAccountDevice>>();

                foreach (var map in currentMaps.Where(m => participants.Contains(m.UserId)))
                {
                    if (!desiredPairs.Contains((map.UserId, map.SerialNumber)))
                    {
                        var fUser = Builders<EmployeeAccountDevice>.Filter.Eq(x => x.UserId, map.UserId);
                        var fSer = Builders<EmployeeAccountDevice>.Filter.Eq(x => x.SerialNumber, map.SerialNumber);
                        var rf = Builders<EmployeeAccountDevice>.Filter.And(TeamFilter(teamId), fUser, fSer);
                        removeOps.Add(new DeleteOneModel<EmployeeAccountDevice>(rf));
                    }
                }

                var currentPairSet = currentMaps
                    .Select(m => (m.UserId, m.SerialNumber))
                    .ToHashSet(new PairComparer());

                foreach (var p in desiredPairs)
                {
                    if (!currentPairSet.Contains(p))
                    {
                        assignOps.Add(new InsertOneModel<EmployeeAccountDevice>(new EmployeeAccountDevice
                        {
                            UserId = p.uid,
                            TeamId = teamId,              // chuẩn hoá long
                            SerialNumber = p.serial,
                            AssignedAtUtc = DateTime.UtcNow
                        }));
                    }
                }

                if (removeOps.Count > 0)
                    await _col.BulkWriteAsync(removeOps, new BulkWriteOptions { IsOrdered = false });

                if (assignOps.Count > 0)
                    await _col.BulkWriteAsync(assignOps, new BulkWriteOptions { IsOrdered = false });
            }
            finally
            {
                locker.Release();
            }
        }

        private sealed class PairComparer : IEqualityComparer<(ObjectId uid, string serial)>
        {
            public bool Equals((ObjectId uid, string serial) x, (ObjectId uid, string serial) y)
                => x.uid == y.uid && string.Equals(x.serial, y.serial, StringComparison.OrdinalIgnoreCase);

            public int GetHashCode((ObjectId uid, string serial) obj)
                => HashCode.Combine(obj.uid, obj.serial?.ToLowerInvariant());
        }
    }
}
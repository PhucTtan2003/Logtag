using Microsoft.Extensions.Options;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Helpers.Config;
using temperature_humi.Models.LogTag.LT5;

namespace temperature_humi.Service.LogtagService.Lt5
{
    public class Lt5ProfilesStoreService
    {
        private readonly IMongoCollection<Lt5ProfilesViewModel> _col;
        private readonly LogTagApiClientLt5 _api;
        private readonly LogTagApiSettingsLt5 _cfg;

        public Lt5ProfilesStoreService(
            IOptions<MongoDBSettings> mongo,
            LogTagApiClientLt5 api,
            IOptions<LogTagApiSettingsLt5> cfg)
        {
            _api = api;
            _cfg = cfg.Value;

            var cli = new MongoClient(mongo.Value.ConnectionString);
            var db = cli.GetDatabase(mongo.Value.DatabaseName);
            _col = db.GetCollection<Lt5ProfilesViewModel>("Lt5Profiles");

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            // Key pattern: teamId + profileId
            var key = Builders<Lt5ProfilesViewModel>.IndexKeys
                .Ascending(x => x.TeamId)
                .Ascending(x => x.ProfileId);

            // Nếu DB đã có index cùng key (dù khác name) thì thôi, không tạo lại.
            // Nếu bạn muốn ép tên index, có thể drop index cũ và tạo lại (bên dưới).
            var existing = _col.Indexes.List().ToList();

            bool hasSameKey = existing.Any(ix =>
            {
                if (!ix.TryGetValue("key", out var keyDocBson) || !keyDocBson.IsBsonDocument) return false;
                var kd = keyDocBson.AsBsonDocument;

                // So khớp đúng pattern { teamId: 1, profileId: 1 }
                return kd.ElementCount == 2
                       && kd.TryGetValue("teamId", out var t) && t.ToInt32() == 1
                       && kd.TryGetValue("profileId", out var p) && p.ToInt32() == 1;
            });

            if (hasSameKey) return;

            // Chưa có index đúng key → tạo mới (unique)
            _col.Indexes.CreateOne(new CreateIndexModel<Lt5ProfilesViewModel>(
                key,
                new CreateIndexOptions
                {
                    Name = "ux_team_profile",
                    Unique = true,
                    Background = true
                }
            ));
        }

        public async Task<(int upserted, int deleted)> SyncAsync(CancellationToken ct)
        {
            var teamId = _cfg.TeamId;

            var upstream = await _api.GetProfilesAsync(teamId, ct);
            var profiles = upstream.Data ?? new();

            var upIds = profiles.Select(x => x.Id).Distinct().ToList();

            int upserted = 0;

            foreach (var p in profiles)
            {
                var doc = new Lt5ProfilesViewModel
                {
                    TeamId = teamId,
                    ProfileId = p.Id,
                    Name = p.Name,
                    Model = p.Model,
                    RecordingIntervalInSeconds = p.RecordingIntervalInSeconds,
                    StartDelayInSeconds = p.StartDelayInSeconds,
                    AlarmIndicatorEnabled = p.AlarmIndicatorEnabled ?? false,
                    AllowLoggingStop = p.AllowLoggingStop ?? false,
                    Alarms = p.Alarms?.Select(a => new Lt5AlarmRuleDoc
                    {
                        Sensor = a.Sensor,
                        IsUpper = a.IsUpper,
                        ThresholdValue = a.ThresholdValue,
                        AlarmTriggerType = a.AlarmTriggerType,
                        NumberOfReadingsBeforeAlert = a.NumberOfReadingsBeforeAlert
                    }).ToList() ?? new(),
                    UpdatedAtUtc = DateTime.UtcNow,

                    // ✅ revive nếu từng bị deleted
                    IsDeleted = false,
                    DeletedAtUtc = null
                };

                var filter = Builders<Lt5ProfilesViewModel>.Filter.And(
                    Builders<Lt5ProfilesViewModel>.Filter.Eq(x => x.TeamId, teamId),
                    Builders<Lt5ProfilesViewModel>.Filter.Eq(x => x.ProfileId, p.Id)
                );

                await _col.ReplaceOneAsync(filter, doc, new ReplaceOptions { IsUpsert = true }, ct);
                upserted++;
            }

            // ✅ Soft-delete những profile không còn tồn tại ở upstream
            // Nếu upstream trả rỗng do lỗi tạm thời, KHÔNG nên delete hàng loạt -> thêm guard
            int deleted = 0;
            if (upIds.Count > 0)
            {
                var delFilter = Builders<Lt5ProfilesViewModel>.Filter.And(
                    Builders<Lt5ProfilesViewModel>.Filter.Eq(x => x.TeamId, teamId),
                    Builders<Lt5ProfilesViewModel>.Filter.Nin(x => x.ProfileId, upIds),
                    Builders<Lt5ProfilesViewModel>.Filter.Eq(x => x.IsDeleted, false)
                );

                var delUpdate = Builders<Lt5ProfilesViewModel>.Update
                    .Set(x => x.IsDeleted, true)
                    .Set(x => x.DeletedAtUtc, DateTime.UtcNow)
                    .Set(x => x.UpdatedAtUtc, DateTime.UtcNow);

                var res = await _col.UpdateManyAsync(delFilter, delUpdate, cancellationToken: ct);
                deleted = (int)res.ModifiedCount;
            }

            return (upserted, deleted);
        }


        // 📄 List for FE (select + preview)
        public async Task<List<Lt5ProfilesViewModel>> ListAsync(CancellationToken ct)
        {
            return await _col
                .Find(x => x.TeamId == _cfg.TeamId && x.IsDeleted == false)
                .SortBy(x => x.Name)
                .ToListAsync(ct);
        }

        public async Task<Lt5ProfilesViewModel?> GetByProfileIdAsync(int profileId, CancellationToken ct)
        {
            return await _col
                .Find(x => x.TeamId == _cfg.TeamId && x.ProfileId == profileId)
                .FirstOrDefaultAsync(ct);
        }

        /// <summary>
        /// Kiểm tra profile còn tồn tại & active (chưa bị xoá trên LogTag Online)
        /// Dùng cho Create Shipment
        /// </summary>
        public async Task<bool> ExistsActiveAsync(
            long teamId,
            int profileId,
            CancellationToken ct = default)
        {
            var filter = Builders<Lt5ProfilesViewModel>.Filter.And(
                Builders<Lt5ProfilesViewModel>.Filter.Eq(x => x.TeamId, teamId),
                Builders<Lt5ProfilesViewModel>.Filter.Eq(x => x.ProfileId, profileId),
                Builders<Lt5ProfilesViewModel>.Filter.Ne(x => x.IsDeleted, true)
            );

            return await _col
                .Find(filter)
                .Limit(1)
                .AnyAsync(ct);
        }
    }
}
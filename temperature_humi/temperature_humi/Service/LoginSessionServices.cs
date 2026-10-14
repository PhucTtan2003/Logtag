using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Service
{
    public class LoginSessionService
    {
        private readonly IMongoCollection<LoginSession> _sessions;

        public LoginSessionService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _sessions = db.GetCollection<LoginSession>("LoginSessions");

            EnsureIndexes();
        }

        private void EnsureIndexes()
        {
            var accountActiveIndex = new CreateIndexModel<LoginSession>(
                Builders<LoginSession>.IndexKeys
                    .Ascending(x => x.AccountId)
                    .Ascending(x => x.IsActive)
                    .Descending(x => x.LoginTime),
                new CreateIndexOptions
                {
                    Name = "ix_login_sessions_account_active_time"
                });

            try
            {
                _sessions.Indexes.CreateOne(accountActiveIndex);
            }
            catch (MongoCommandException ex)
                when (ex.CodeName == "IndexOptionsConflict" || ex.CodeName == "IndexKeySpecsConflict")
            {
                // Index tương đương đã tồn tại với tên hoặc options khác.
            }
        }

        public async Task DeactivateSessionsAsync(ObjectId accountId)
        {
            // Không lọc ExpiresAt: mọi bản ghi còn IsActive đều phải được đóng.
            var filter = Builders<LoginSession>.Filter.And(
                Builders<LoginSession>.Filter.Eq(x => x.AccountId, accountId),
                Builders<LoginSession>.Filter.Eq(x => x.IsActive, true));

            var update = Builders<LoginSession>.Update
                .Set(x => x.IsActive, false);

            await _sessions.UpdateManyAsync(filter, update);
        }

        public Task CreateAsync(LoginSession session)
        {
            return _sessions.InsertOneAsync(session);
        }

        // Giữ tên hàm cũ để các controller khác không bị lỗi compile.
        public Task DeactivateLatestSessionAsync(ObjectId accountId)
        {
            return DeactivateSessionsAsync(accountId);
        }
    }
}
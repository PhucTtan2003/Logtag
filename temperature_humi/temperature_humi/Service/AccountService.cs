using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;

namespace temperature_humi.Service
{
    public class AccountDeleteCascadeResult
    {
        public long AccountsDeleted { get; set; }

        public long DeviceAssignmentsDeleted { get; set; }
        public long SubscriptionsDeleted { get; set; }
        public long SmsActivationsDeleted { get; set; }
        public long SmsSchedulesDeleted { get; set; }

        public long LoginSessionsDeleted { get; set; }
        public long AccountEventsDeleted { get; set; }
        public long NotificationsDeleted { get; set; }

        public long LicenseCodesTouched { get; set; }
    }

    public class AccountService
    {
        private readonly IMongoDatabase _db;
        private readonly IMongoCollection<Account> _accounts;
        private readonly RoleService _roleService;

        public AccountService(IOptions<MongoDBSettings> settings, RoleService roleService)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            _db = client.GetDatabase(settings.Value.DatabaseName);

            _accounts = _db.GetCollection<Account>("Account");
            _roleService = roleService;
        }

        #region FindByEmailAsync
        public async Task<Account> FindByEmailAsync(string email)
        {
            return await _accounts.Find(a => a.Email == email).FirstOrDefaultAsync();
        }
        #endregion

        #region FindByEmailAndPasswordAsync
        public async Task<Account> FindByEmailAndPasswordAsync(string email, string password)
        {
            return await _accounts.Find(a => a.Email == email && a.Passwords == password).FirstOrDefaultAsync();
        }
        #endregion

        #region UpdateAsync
        public async Task UpdateAsync(ObjectId id, Account update)
        {
            await _accounts.ReplaceOneAsync(a => a.Id == id, update);
        }
        #endregion

        #region GetByIdAsync
        public async Task<Account> GetByIdAsync(ObjectId id)
        {
            return await _accounts.Find(a => a.Id == id).FirstOrDefaultAsync();
        }
        #endregion

        #region GetAllAsync
        public async Task<List<Account>> GetAllAsync()
        {
            return await _accounts.Find(_ => true).ToListAsync();
        }
        #endregion

        #region CreateAsync
        public async Task CreateAsync(Account account)
        {
            await _accounts.InsertOneAsync(account);
        }
        #endregion

        #region DeleteAsync
        public async Task DeleteAsync(ObjectId id)
        {
            await DeleteAccountAndServicesAsync(id);
        }

        public async Task<AccountDeleteCascadeResult> DeleteAccountAndServicesAsync(
            ObjectId id,
            CancellationToken ct = default)
        {
            var result = new AccountDeleteCascadeResult();

            // 1) Xóa thiết bị đã gán cho tài khoản
            result.DeviceAssignmentsDeleted += await DeleteManyByUserAsync(
                "AccountDevices",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 2) Xóa các gói / dịch vụ đã đăng ký
            result.SubscriptionsDeleted += await DeleteManyByUserAsync(
                "Subscriptions",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            result.SubscriptionsDeleted += await DeleteManyByUserAsync(
                "UserSubscriptions",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            result.SubscriptionsDeleted += await DeleteManyByUserAsync(
                "SmsSubscriptions",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 3) Xóa kích hoạt SMS
            result.SmsActivationsDeleted += await DeleteManyByUserAsync(
                "SmsActivations",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 4) Xóa lịch gửi SMS theo giờ
            result.SmsSchedulesDeleted += await DeleteManyByUserAsync(
                "SmsScheduleConfigs",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 5) Xóa session đăng nhập nếu có
            result.LoginSessionsDeleted += await DeleteManyByUserAsync(
                "LoginSessions",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 6) Xóa event/log riêng theo account nếu có
            result.AccountEventsDeleted += await DeleteManyByUserAsync(
                "AccountEvents",
                id,
                ct,
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 7) Xóa thông báo liên quan account
            result.NotificationsDeleted += await DeleteManyByUserAsync(
                "Notifications",
                id,
                ct,
                "SentTo", "sentTo",
                "SentBy", "sentBy",
                "UserId", "userId",
                "AccountId", "accountId"
            );

            // 8) Không xóa LicenseCodes vì mã có thể dùng chung nhiều user.
            // Chỉ gỡ ReservedForUserId và activation của user đó ra khỏi mã.
            result.LicenseCodesTouched = await CleanupLicenseCodesByUserAsync(id, ct);

            // 9) Cuối cùng mới xóa account
            var accRes = await _accounts.DeleteOneAsync(a => a.Id == id, ct);
            result.AccountsDeleted = accRes.DeletedCount;

            return result;
        }
        #endregion

        #region Cascade helpers
        private async Task<long> DeleteManyByUserAsync(
            string collectionName,
            ObjectId userId,
            CancellationToken ct,
            params string[] fieldNames)
        {
            var col = _db.GetCollection<BsonDocument>(collectionName);
            var filter = BuildUserFilter(userId, fieldNames);

            var res = await col.DeleteManyAsync(filter, ct);
            return res.DeletedCount;
        }

        private static FilterDefinition<BsonDocument> BuildUserFilter(
            ObjectId userId,
            params string[] fieldNames)
        {
            var fb = Builders<BsonDocument>.Filter;
            var userIdString = userId.ToString();

            if (fieldNames == null || fieldNames.Length == 0)
            {
                fieldNames = new[]
                {
                    "UserId", "userId",
                    "AccountId", "accountId"
                };
            }

            var filters = new List<FilterDefinition<BsonDocument>>();

            foreach (var field in fieldNames.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                filters.Add(fb.Eq(field, userId));
                filters.Add(fb.Eq(field, userIdString));
            }

            return filters.Count == 0 ? fb.Empty : fb.Or(filters);
        }

        private async Task<long> CleanupLicenseCodesByUserAsync(ObjectId userId, CancellationToken ct)
        {
            var col = _db.GetCollection<BsonDocument>("LicenseCodes");
            var fb = Builders<BsonDocument>.Filter;
            var ub = Builders<BsonDocument>.Update;

            var userIdString = userId.ToString();

            // Clear ReservedForUserId nếu code đang reserve cho user này
            var reservedFilter = fb.Or(
                fb.Eq("ReservedForUserId", userId),
                fb.Eq("ReservedForUserId", userIdString),
                fb.Eq("reservedForUserId", userId),
                fb.Eq("reservedForUserId", userIdString)
            );

            var reservedUpdate = ub
                .Unset("ReservedForUserId")
                .Unset("reservedForUserId");

            var reservedRes = await col.UpdateManyAsync(
                reservedFilter,
                reservedUpdate,
                cancellationToken: ct
            );

            // Pull activation của user ra khỏi mảng Activations / activations
            var activationFilterDoc = new BsonDocument("$or", new BsonArray
            {
                new BsonDocument("Activations.UserId", userId),
                new BsonDocument("Activations.UserId", userIdString),
                new BsonDocument("Activations.userId", userId),
                new BsonDocument("Activations.userId", userIdString),

                new BsonDocument("activations.UserId", userId),
                new BsonDocument("activations.UserId", userIdString),
                new BsonDocument("activations.userId", userId),
                new BsonDocument("activations.userId", userIdString)
            });

            var pullCondition = new BsonDocument("$or", new BsonArray
            {
                new BsonDocument("UserId", userId),
                new BsonDocument("UserId", userIdString),
                new BsonDocument("userId", userId),
                new BsonDocument("userId", userIdString)
            });

            var pullUpdateDoc = new BsonDocument("$pull", new BsonDocument
            {
                { "Activations", pullCondition },
                { "activations", pullCondition }
            });

            var activationRes = await col.UpdateManyAsync(
                new BsonDocumentFilterDefinition<BsonDocument>(activationFilterDoc),
                new BsonDocumentUpdateDefinition<BsonDocument>(pullUpdateDoc),
                cancellationToken: ct
            );

            return reservedRes.ModifiedCount + activationRes.ModifiedCount;
        }
        #endregion

        #region GetInactiveAccountsAsync
        public async Task<List<Account>> GetInactiveAccountsAsync(DateTime threshold)
        {
            return await _accounts.Find(a => (a.LastLoginAt < threshold || a.LastLoginAt == null) && a.IsActive).ToListAsync();
        }
        #endregion

        #region GetAccountsByRoleNameAsync
        public async Task<List<Account>> GetAccountsByRoleNameAsync(string roleName)
        {
            var pipeline = new[]
            {
                new BsonDocument("$lookup", new BsonDocument
                {
                    { "from", "Roles" },
                    { "localField", "roleId" },
                    { "foreignField", "_id" },
                    { "as", "RoleData" }
                }),
                new BsonDocument("$unwind", "$RoleData"),
                new BsonDocument("$match", new BsonDocument("RoleData.roleName", roleName))
            };

            return await _accounts.Aggregate<Account>(pipeline).ToListAsync();
        }
        #endregion

        #region UpdateManyAsync
        public async Task UpdateManyAsync(List<Account> accounts)
        {
            foreach (var acc in accounts)
            {
                await _accounts.ReplaceOneAsync(a => a.Id == acc.Id, acc);
            }
        }
        #endregion

        #region GetByRoleAsync
        public async Task<List<Account>> GetByRoleAsync(string roleName)
        {
            var roles = await _roleService.GetAllAsync();
            var role = roles.FirstOrDefault(r => r.RoleName.ToLower() == roleName.ToLower());
            if (role == null) return new List<Account>();

            return await _accounts.Find(a => a.RoleId == role.Id && a.IsActive).ToListAsync();
        }
        #endregion

        #region GetByIdsAsync
        /// <summary>
        /// Lấy danh sách account theo tập hợp ObjectId.
        /// </summary>
        public async Task<List<Account>> GetByIdsAsync(IEnumerable<ObjectId> ids, CancellationToken ct = default)
        {
            if (ids == null) return new List<Account>();

            var idList = ids.Distinct().ToList();
            if (idList.Count == 0) return new List<Account>();

            var filter = Builders<Account>.Filter.In(a => a.Id, idList);
            return await _accounts.Find(filter).ToListAsync(ct);
        }

        /// <summary>
        /// Lấy danh sách account theo tập hợp string id (convert sang ObjectId).
        /// </summary>
        public async Task<List<Account>> GetByIdsAsync(IEnumerable<string> ids, CancellationToken ct = default)
        {
            if (ids == null) return new List<Account>();

            var list = new List<ObjectId>();
            foreach (var s in ids)
            {
                if (ObjectId.TryParse(s, out var oid))
                    list.Add(oid);
            }

            return await GetByIdsAsync(list, ct);
        }
        #endregion

        #region GetAccountsByRoleIdAsync
        public async Task<List<Account>> GetAccountsByRoleIdAsync(ObjectId roleId)
        {
            return await _accounts.Find(a => a.RoleId == roleId && a.IsActive).ToListAsync();
        }
        #endregion
    }
}
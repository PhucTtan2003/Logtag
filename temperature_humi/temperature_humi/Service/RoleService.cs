using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.Data;
using temperature_humi.Models;

namespace temperature_humi.Service
{
    public class RoleService
    {
        private readonly IMongoCollection<Role> _roles;

        public RoleService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var db = client.GetDatabase(settings.Value.DatabaseName);
            _roles = db.GetCollection<Role>("Roles");
        }

        public async Task<List<Role>> GetAllAsync()
        {
            return await _roles.Find(_ => true).ToListAsync();
        }

        public async Task<Role> GetRoleByIdAsync(ObjectId roleId)
        {
            return await _roles.Find(r => r.Id == roleId).FirstOrDefaultAsync();
        }

        public async Task<ObjectId?> GetRoleIdByNameAsync(string roleName)
        {
            var role = await _roles.Find(r => r.RoleName.ToLower() == roleName.ToLower()).FirstOrDefaultAsync();
            return role?.Id;
        }

    }
}
using MongoDB.Driver;
using Microsoft.Extensions.Options;
using temperature_humi.Models;
using temperature_humi.Data;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;

namespace temperature_humi.Service
{
   public class WarrantyService
   {
        private readonly IMongoCollection<WarrantyRequest> _warrantyCollection;
        private readonly IMongoCollection<WarrantyRequest> _collection;

        public WarrantyService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var database = client.GetDatabase(settings.Value.DatabaseName);
            _warrantyCollection = database.GetCollection<WarrantyRequest>("WarrantyRequests");
            _collection = database.GetCollection<WarrantyRequest>("WarrantyRequests");
        }
        public IMongoCollection<WarrantyRequest> Collection => _collection;


        public async Task CreateAsync(WarrantyRequest warranty)
        {
            await _warrantyCollection.InsertOneAsync(warranty);
        }
        public IQueryable<WarrantyRequest> AsQueryable()
        {
            return _warrantyCollection.AsQueryable();
        }

        public async Task<List<WarrantyRequest>> GetAllAsync()
        {
            return await _warrantyCollection.Find(_ => true).ToListAsync();
        }
        public async Task<List<WarrantyRequest>> GetByEmployeeIdAsync(string employeeId)
        {
            if (!ObjectId.TryParse(employeeId, out var objectId))
                return new List<WarrantyRequest>(); // hoặc return BadRequest nếu ở controller

            return await _warrantyCollection
                .Find(w => w.AssignedEmployeeId == objectId)
                .SortByDescending(w => w.CreatedAt)
                .ToListAsync();
        }
        public IMongoCollection<WarrantyRequest> GetCollection()
        {
            return _warrantyCollection;
        }

    }
}

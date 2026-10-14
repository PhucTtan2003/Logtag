using MongoDB.Driver;
using Microsoft.Extensions.Options;
using temperature_humi.Data;
using MongoDB.Bson;

namespace temperature_humi.Service
{
    public class ParameterService
    {
        private readonly IMongoCollection<Parameter> _parameters;

        public ParameterService(IOptions<MongoDBSettings> settings)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var database = client.GetDatabase(settings.Value.DatabaseName);
            _parameters = database.GetCollection<Parameter>("Parameters");
        }

        public IQueryable<Parameter> AsQueryable()
        {
            return _parameters.AsQueryable();
        }

        public async Task<List<Parameter>> GetByDeviceAsync(ObjectId deviceId)
        {
            return await _parameters.Find(p => p.DeviceId == deviceId)
                                    .SortByDescending(p => p.CreateAt)
                                    .ToListAsync();
        }
        public List<Parameter> GetAllByDevice(ObjectId deviceId)
        {
            return _parameters.AsQueryable()
                .Where(p => p.DeviceId == deviceId)
                .OrderByDescending(p => p.CreateAt)
                .ToList();
        }
        public void Create(Parameter parameter)
        {
            _parameters.InsertOne(parameter);
        }
        public Parameter GetLatestByDeviceId(ObjectId deviceId)
        {
            return _parameters.Find(p => p.DeviceId == deviceId)
                              .SortByDescending(p => p.CreateAt)
                              .FirstOrDefault();
        }

        public void CreateMany(List<Parameter> parameters)
        {
            _parameters.InsertMany(parameters);
        }
        public List<Parameter> GetAll()
        {
            return _parameters.Find(_ => true).ToList();
        }
        public void DeleteByDevice(ObjectId deviceId)
        {
            _parameters.DeleteMany(p => p.DeviceId == deviceId);
        }
    }
}

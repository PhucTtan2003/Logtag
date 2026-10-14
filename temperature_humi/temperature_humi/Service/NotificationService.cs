using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Linq.Expressions;
using temperature_humi.Data;
using temperature_humi.Hubs;


namespace temperature_humi.Service
{
    public class NotificationService
    {
        private readonly IMongoCollection<Notification> _notifications;
        private readonly IHubContext<NotificationHub> _hubContext;

        public NotificationService(IOptions<MongoDBSettings> settings, IHubContext<NotificationHub> hubContext)
        {
            var client = new MongoClient(settings.Value.ConnectionString);
            var database = client.GetDatabase(settings.Value.DatabaseName);
            _notifications = database.GetCollection<Notification>("Notifications"); // Tên collection
            _hubContext = hubContext;
        }

        public List<Notification> GetAll() => _notifications.Find(_ => true).ToList();

        public async Task CreateManyAsync(List<Notification> notifications)
        {
            await _notifications.InsertManyAsync(notifications);
        }
        public async Task<List<Notification>> GetForEmployeeAsync(ObjectId employeeId)
        {
            var filter = Builders<Notification>.Filter.Or(
                Builders<Notification>.Filter.Eq(n => n.SentTo, employeeId),
                Builders<Notification>.Filter.Eq(n => n.SentTo, (ObjectId?)null)
            );
            return await _notifications.Find(filter)
                .SortByDescending(n => n.SentAt)
                .ToListAsync();
        }
        public async Task MarkAllAsReadAsync(ObjectId employeeId)
        {
            var filter = Builders<Notification>.Filter.And(
                Builders<Notification>.Filter.Eq(n => n.SentTo, employeeId),
                Builders<Notification>.Filter.Eq(n => n.IsRead, false)
            );
            var update = Builders<Notification>.Update.Set(n => n.IsRead, true);
            await _notifications.UpdateManyAsync(filter, update);
        }

        public async Task MarkAsReadAsync(ObjectId notificationId, ObjectId employeeId)
        {
            // Chỉ đánh dấu isRead với thông báo GỬI RIÊNG cho user
            var filter = Builders<Notification>.Filter.And(
                Builders<Notification>.Filter.Eq(n => n.Id, notificationId),
                Builders<Notification>.Filter.Eq(n => n.SentTo, employeeId)
            );
            var update = Builders<Notification>.Update.Set(n => n.IsRead, true);
            await _notifications.UpdateOneAsync(filter, update);
        }

        public async Task SendNotificationToUser(string accountId, Notification notification)
        {
            await _hubContext.Clients.Group(accountId).SendAsync("ReceiveNotification", new
            {
                notificationId = notification.Id.ToString(),
                title = notification.Title,
                message = notification.Message,
                sentAt = notification.SentAt,
                isRead = notification.IsRead // Thường là false khi gửi mới!
            });
        }

        public async Task SendWarrantyToUser(string accountId, object warranty)
        {
            await _hubContext.Clients.Group(accountId).SendAsync("ReceiveWarranty", warranty);
        }

        public async Task<List<object>> GetAllWithStatusAsync(AccountService accountService)
        {
            var notifications = await _notifications.Find(_ => true).ToListAsync();

            var result = new List<object>();

            foreach (var n in notifications)
            {
                string sentToName = "Tất cả";
                if (n.SentTo.HasValue)
                {
                    var acc = await accountService.GetByIdAsync(n.SentTo.Value);
                    sentToName = acc?.FullName ?? n.SentTo.Value.ToString();
                }

                result.Add(new
                {
                    notificationId = n.Id.ToString(),
                    title = n.Title,
                    message = n.Message,
                    sentTo = sentToName, // ✅ tên nhân viên
                    sentAt = n.SentAt,
                    status = n.Status
                });
            }

            return result;
        }

        public async Task<UpdateResult> UpdateOneAsync(Expression<Func<Notification, bool>> filter, UpdateDefinition<Notification> update)
        {
            return await _notifications.UpdateOneAsync(filter, update);
        }


        public Task<UpdateResult> UpdateStatusForAsync(ObjectId id, string status, ObjectId empId) =>
            _notifications.UpdateOneAsync(
                n => n.Id == id && n.SentTo == empId,
                Builders<Notification>.Update.Set(n => n.Status, status)
            );
    }
}

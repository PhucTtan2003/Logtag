using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

public class Account
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonElement("username")]
    public string Username { get; set; }

    [BsonElement("passwords")]
    public string Passwords { get; set; }

    [BsonElement("address")]
    public string Address { get; set; }

    [BsonElement("fullName")]
    public string FullName { get; set; }

    [BsonElement("email")]
    public string Email { get; set; }

    [BsonElement("phone")]
    public string Phone { get; set; }

    [BsonElement("isActive")]
    public bool IsActive { get; set; }
    [BsonElement("lastloginat")]
    public DateTime LastLoginAt { get; set; }
    [BsonElement("updateat")]
    public DateTime UpdateAt { get; set; }
    [BsonElement("createat")]
    public DateTime CreateAt { get; set; }

    [BsonElement("roleId")]
    public ObjectId RoleId { get; set; }
}
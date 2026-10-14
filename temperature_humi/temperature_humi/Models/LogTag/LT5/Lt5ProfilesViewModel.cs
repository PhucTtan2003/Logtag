using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace temperature_humi.Models.LogTag.LT5
{
    /// <summary>
    /// Cached LT5 Logger Profile (from LogTag Online)
    /// profileId == loggerProfileId when creating shipment
    /// </summary>
    [BsonIgnoreExtraElements]
    public class Lt5ProfilesViewModel
    {
        [BsonElement("teamId")]
        public long TeamId { get; set; }

        [BsonElement("profileId")]
        public int ProfileId { get; set; }

        [BsonElement("name")]
        public string? Name { get; set; }

        [BsonElement("model")]
        public string? Model { get; set; }

        [BsonElement("recordingIntervalInSeconds")]
        public int RecordingIntervalInSeconds { get; set; }

        [BsonElement("startDelayInSeconds")]
        public int StartDelayInSeconds { get; set; }

        [BsonElement("alarmIndicatorEnabled")]
        public bool AlarmIndicatorEnabled { get; set; }

        [BsonElement("allowLoggingStop")]
        public bool AllowLoggingStop { get; set; }

        [BsonElement("alarms")]
        public List<Lt5AlarmRuleDoc> Alarms { get; set; } = new();

        [BsonElement("updatedAtUtc")]
        public DateTime UpdatedAtUtc { get; set; }
        public bool IsDeleted { get; internal set; }
        public object DeletedAtUtc { get; internal set; }
    }

    public class Lt5AlarmRuleDoc
    {
        [BsonElement("sensor")]
        public string? Sensor { get; set; }

        [BsonElement("isUpper")]
        public bool IsUpper { get; set; }

        [BsonElement("thresholdValue")]
        public double? ThresholdValue { get; set; }

        [BsonElement("alarmTriggerType")]
        public string? AlarmTriggerType { get; set; }

        [BsonElement("numberOfReadingsBeforeAlert")]
        public int? NumberOfReadingsBeforeAlert { get; set; }
    }
}
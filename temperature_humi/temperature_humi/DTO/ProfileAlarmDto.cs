using System.Text.Json.Serialization;

namespace temperature_humi.DTO
{
    public class ProfileAlarmDto
    {
        [JsonPropertyName("isUpper")] public bool IsUpper { get; set; }
        [JsonPropertyName("thresholdValue")] public double? ThresholdValue { get; set; }
        [JsonPropertyName("numberOfReadingsBeforeAlert")] public int NumberOfReadingsBeforeAlert { get; set; }
        [JsonPropertyName("alarmTriggerType")] public string? AlarmTriggerType { get; set; } // Consecutive | Accumulative | Instant
        [JsonPropertyName("sensor")] public string? Sensor { get; set; } // Temperature | Humidity | Lux | Shock
    }
}

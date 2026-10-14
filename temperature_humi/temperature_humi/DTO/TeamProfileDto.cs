using System.Text.Json.Serialization;

namespace temperature_humi.DTO
{
    public class TeamProfileDto
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("model")] public string? Model { get; set; } // ví dụ: LTGEO
        [JsonPropertyName("recordingIntervalInSeconds")] public int RecordingIntervalInSeconds { get; set; }
        [JsonPropertyName("startDelayInSeconds")] public int StartDelayInSeconds { get; set; }
        [JsonPropertyName("alarmIndicatorEnabled")] public bool? AlarmIndicatorEnabled { get; set; }
        [JsonPropertyName("allowLoggingStop")] public bool? AllowLoggingStop { get; set; }
        [JsonPropertyName("alarms")] public List<ProfileAlarmDto> Alarms { get; set; } = new();
    }
}

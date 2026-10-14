using System.Text.Json.Serialization;

namespace temperature_humi.DTO
{
    public class ApiEnvelopeProfiles
    {
        [JsonPropertyName("data")] public List<TeamProfileDto> Data { get; set; } = new();
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("timestampUtc")] public DateTime? TimestampUtc { get; set; }
    }
}

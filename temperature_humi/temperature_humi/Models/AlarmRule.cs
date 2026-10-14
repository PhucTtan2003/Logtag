namespace temperature_humi.Models
{
    public class AlarmRule
    {
        public double? UpperC { get; init; }
        public double? LowerC { get; init; }
        public string? TriggerType { get; init; }            // "Instant" | "Consecutive" | "Accumulative" | ...
        public int? RequiredReadings { get; init; }          // số mẫu liên tiếp/accumulate
        public string Source { get; init; } = "device";      // "device" | "profile"
        public string? ProfileName { get; init; }
    }
}

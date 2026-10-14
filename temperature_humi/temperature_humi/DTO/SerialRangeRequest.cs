namespace temperature_humi.DTO
{
    public class SerialRangeRequest
    {
        public List<string> SerialNumbers { get; set; } = new();
        public string? FromUtc { get; set; }
        public string? ToUtc { get; set; }
        public string? Range { get; set; } = "7d"; // nếu From/To trống thì dùng range
    }
}
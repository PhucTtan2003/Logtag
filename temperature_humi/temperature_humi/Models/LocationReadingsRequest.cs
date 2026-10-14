namespace temperature_humi.Models
{
    public class LocationReadingsRequest
    {
        public string serialNumber { get; set; } = default!;
        public DateTime? startDateUtc { get; set; }
        public DateTime? endDateUtc { get; set; }
    }
}

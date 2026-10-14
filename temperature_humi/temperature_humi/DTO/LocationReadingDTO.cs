namespace temperature_humi.DTO
{
    public class LocationReadingDTO
    {
        public double? temperature { get; set; }
        public double? humidity { get; set; }   // có thể không có, tùy thiết bị
        public DateTime dateUtc { get; set; }
    }
}

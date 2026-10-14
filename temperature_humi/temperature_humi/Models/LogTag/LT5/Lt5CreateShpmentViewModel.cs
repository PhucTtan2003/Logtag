namespace temperature_humi.Models.LogTag.LT5
{
    public class Lt5CreateShipmentViewModel
    {
        public string? ShipmentName { get; set; }
        public DateTime? StartDateUtc { get; set; }
        public DateTime? EndDateUtc { get; set; }

        public List<Lt5ShipmentDeviceDto> Devices { get; set; } = new();
    }
    public sealed class Lt5ShipmentDeviceDto
    {
        public string SerialNumber { get; set; } = "";
        public int? LoggerProfileId { get; set; } // profileId
    }
}
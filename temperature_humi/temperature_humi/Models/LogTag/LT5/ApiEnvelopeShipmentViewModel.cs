namespace temperature_humi.Models.LogTag.LT5
{
    /// <summary>
    /// Envelope chuẩn theo LogTag API v1.9
    /// Dùng cho Create Shipment (LT5)
    /// </summary>
    /// <typeparam name="T">Payload data bên trong</typeparam>
    public class ApiEnvelopeShipments<T>
    {
        public string? Status { get; set; }
        public DateTime? TimestampUtc { get; set; }
        public T? Data { get; set; }
    }

    /// <summary>
    /// Shipment response từ LogTag Online
    /// </summary>
    public class Lt5ShipmentDto
    {
        public int ShipmentId { get; set; }

        public string? ShipmentName { get; set; }

        public string? ShipmentState { get; set; }

        public List<Lt5ShipmentDeviceDto> Devices { get; set; } = new();
    }

    public sealed class ApiEnvelopeShipmentsRaw
    {
        public string? Status { get; set; }
        public DateTime? TimestampUtc { get; set; }
        public System.Text.Json.JsonElement Data { get; set; }
    }

}
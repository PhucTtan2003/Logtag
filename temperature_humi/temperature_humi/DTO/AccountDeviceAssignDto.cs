namespace temperature_humi.DTO
{
    public class AccountDeviceAssignDto
    {
        public string userId { get; set; } = string.Empty;
        public long teamId { get; set; } = 0;
        public string serialNumber { get; set; } = string.Empty;  // AA62...
        public string? notes { get; set; }
        public DateTime? assignedAtUtc { get; set; }
    }
}
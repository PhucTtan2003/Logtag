namespace temperature_humi.Helpers
{
    public static class DeviceSerialHelper
    {
        /// <summary>
        /// LT5GEO = serial KHÔNG chứa "-CH"
        /// UTRED  = có "-CH1", "-CH2", ...
        /// </summary>
        public static bool IsLt5Geo(string? serial)
        {
            if (string.IsNullOrWhiteSpace(serial)) return false;

            serial = serial.Trim().ToUpperInvariant();

            return !serial.Contains("-CH");
        }
    }
}
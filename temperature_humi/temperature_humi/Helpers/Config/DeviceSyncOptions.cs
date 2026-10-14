using System.Collections.Generic;

namespace temperature_humi.Helpers.Config
{
    public sealed class DeviceSyncOptions
    {
        public bool Enabled { get; set; } = false;

        public int IntervalMinutes { get; set; } = 60;

        public List<long> TeamIds { get; set; } = new();
    }
}
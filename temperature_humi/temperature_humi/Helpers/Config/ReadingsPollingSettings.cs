namespace temperature_humi.Helpers.Config
{
    public class ReadingsPollingSettings
    {
        public bool Enabled { get; set; } = true;
        public int PollIntervalSeconds { get; set; } = 60; // [5..600] sẽ clamp trong code
        public int BackfillSeconds { get; set; } = 30;     // [5..600] sẽ clamp trong code
    }
}
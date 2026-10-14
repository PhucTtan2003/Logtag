namespace temperature_humi.Helpers.Config
{
    //test lát xóa
    public class LogTagTestFilterOptions
    {
        public bool Enabled { get; set; } = false;
        public long TeamId { get; set; }
        public List<string> AllowedSerials { get; set; } = new();
    }
}
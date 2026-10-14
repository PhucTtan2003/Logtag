namespace temperature_humi.DTO
{
    public class RebalanceDto
    {
        public long TeamId { get; set; }
        public List<string>? Participants { get; set; }
    }

    public class AssignAndRebalanceDto
    {
        public long TeamId { get; set; }
        public string AccountId { get; set; } = null!;
    }

}
namespace temperature_humi.Models
{
    public class UpdateAccountRequest
    {
        public string FullName { get; set; }
        public string Phone { get; set; }
        public string Address { get; set; }
        public string RoleId { get; set; }
        public bool IsActive { get; set; }
        public string Passwords { get; set; }
    }
}

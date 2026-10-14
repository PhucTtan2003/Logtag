using Microsoft.Extensions.Options;
using temperature_humi.Helpers.Config;

namespace temperature_humi.Service.LogtagService
{
    public class LogTagTeamRoutingOptions
    {
        public List<long> MainTeams { get; set; } = new();
        public List<long> Lt5Teams { get; set; } = new();
    }

    public class LogTagClientRouter
    {
        private readonly LogTagApiClientMain _main;
        private readonly LogTagApiClientLt5 _lt5;
        private readonly LogTagTeamRoutingOptions _routing;

        public LogTagClientRouter(
            LogTagApiClientMain main,
            LogTagApiClientLt5 lt5,
            IOptions<LogTagTeamRoutingOptions> routing)
        {
            _main = main;
            _lt5 = lt5;
            _routing = routing.Value;
        }

        public LogTagApiClient GetClientForTeam(long teamId)
        {
            if (_routing.Lt5Teams.Contains(teamId))
                return _lt5;

            return _main;
        }
    }
}

using Microsoft.Extensions.Options;
using temperature_humi.Helpers.Config;
using temperature_humi.Infrastructure;

namespace temperature_humi.Service.LogtagService
{
    public class LogTagApiClientMain : LogTagApiClient
    {
        public LogTagApiClientMain(
            IHttpClientFactory httpClientFactory,
            IOptions<LogTagApiSettingsMain> options,
            EndpointRateLimiter rateLimiter,
            SingleFlight singleFlight,
            SimpleMemoryCache cache)
            : base(
                httpClientFactory,
                // convert về LogTagApiSettings cho base
                Options.Create(new LogTagApiSettings
                {
                    BaseUrl = options.Value.BaseUrl,
                    Email = options.Value.Email,
                    Password = options.Value.Password,
                    TeamId = options.Value.TeamId,
                    EnableRegister = options.Value.EnableRegister,
                    SimulateRegister = options.Value.SimulateRegister
                }),
                rateLimiter,
                singleFlight,
                cache)
        {
        }
    }

    public class LogTagApiClientLt5 : LogTagApiClient
    {
        public LogTagApiClientLt5(
            IHttpClientFactory httpClientFactory,
            IOptions<LogTagApiSettingsLt5> options,
            EndpointRateLimiter rateLimiter,
            SingleFlight singleFlight,
            SimpleMemoryCache cache)
            : base(
                httpClientFactory,
                Options.Create(new LogTagApiSettings
                {
                    BaseUrl = options.Value.BaseUrl,
                    Email = options.Value.Email,
                    Password = options.Value.Password,
                    TeamId = options.Value.TeamId,
                    EnableRegister = options.Value.EnableRegister,
                    SimulateRegister = options.Value.SimulateRegister
                }),
                rateLimiter,
                singleFlight,
                cache)
        {
        }
    }
}
// Infrastructure/TooManyRequestsException.cs
namespace temperature_humi.Infrastructure
{
    public sealed class TooManyRequestsException : Exception
    {
        public TimeSpan RetryAfter { get; }
        public TooManyRequestsException(TimeSpan retryAfter, string? message = null)
            : base(message ?? "Too many requests") => RetryAfter = retryAfter;
    }
}

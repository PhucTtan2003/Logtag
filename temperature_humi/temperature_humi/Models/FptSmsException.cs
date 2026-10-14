using System.Net;

namespace temperature_humi.Models.SmsFpt
{
    /// <summary>
    /// Exception chuẩn hoá cho FPT SMS để caller phân biệt:
    /// - lỗi có thể retry an toàn;
    /// - lỗi không nên retry;
    /// - lỗi mơ hồ (request có thể đã tới FPT, không được tự động gửi lại).
    /// </summary>
    public sealed class FptSmsException : Exception
    {
        public HttpStatusCode? StatusCode { get; }
        public bool IsRetryable { get; }
        public bool IsAmbiguous { get; }
        public string Stage { get; }
        public string? ResponseBody { get; }

        public FptSmsException(
            string message,
            HttpStatusCode? statusCode,
            bool isRetryable,
            bool isAmbiguous,
            string stage,
            string? responseBody = null,
            Exception? innerException = null)
            : base(message, innerException)
        {
            StatusCode = statusCode;
            IsRetryable = isRetryable;
            IsAmbiguous = isAmbiguous;
            Stage = stage;
            ResponseBody = responseBody;
        }
    }
}

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace temperature_humi.Service.Reports
{
    public record ReportAttachment(string FileName, string ContentType, byte[] Bytes);

    public class ReportEmailSender
    {
        private readonly SmtpReportOptions _opt;
        private readonly ILogger<ReportEmailSender> _log;

        public ReportEmailSender(
            IOptions<SmtpReportOptions> opt,
            ILogger<ReportEmailSender> log)
        {
            _opt = opt.Value;
            _log = log;
        }

        public async Task SendAsync(
            IEnumerable<string> to,
            IEnumerable<string>? cc,
            string subject,
            string htmlBody,
            IEnumerable<ReportAttachment> attachments,
            CancellationToken ct = default)
        {
            if (!_opt.Enabled)
                throw new InvalidOperationException("SMTP chưa được bật. Vui lòng cấu hình SmtpReport.Enabled = true.");

            if (string.IsNullOrWhiteSpace(_opt.Host))
                throw new InvalidOperationException("Thiếu SmtpReport.Host.");

            if (string.IsNullOrWhiteSpace(_opt.FromEmail))
                throw new InvalidOperationException("Thiếu SmtpReport.FromEmail.");

            var toList = CleanEmails(to).ToList();
            var ccList = CleanEmails(cc ?? Array.Empty<string>()).ToList();

            if (toList.Count == 0)
                throw new InvalidOperationException("Không có email người nhận hợp lệ.");

            using var msg = new MailMessage
            {
                From = new MailAddress(_opt.FromEmail, _opt.FromName, Encoding.UTF8),
                Subject = subject,
                SubjectEncoding = Encoding.UTF8,
                Body = htmlBody,
                BodyEncoding = Encoding.UTF8,
                IsBodyHtml = true
            };

            foreach (var e in toList) msg.To.Add(e);
            foreach (var e in ccList) msg.CC.Add(e);

            foreach (var a in attachments ?? Array.Empty<ReportAttachment>())
            {
                var stream = new MemoryStream(a.Bytes);
                var att = new Attachment(stream, a.FileName, a.ContentType);
                msg.Attachments.Add(att);
            }

            using var smtp = new SmtpClient(_opt.Host, _opt.Port)
            {
                EnableSsl = _opt.EnableSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                Timeout = 60_000
            };

            if (!string.IsNullOrWhiteSpace(_opt.UserName))
                smtp.Credentials = new NetworkCredential(_opt.UserName, _opt.Password);

            ct.ThrowIfCancellationRequested();
            await smtp.SendMailAsync(msg);

            _log.LogInformation("[MonthlyReport][Email] Sent to={ToCount} cc={CcCount} subject={Subject}",
                toList.Count, ccList.Count, subject);
        }

        private static IEnumerable<string> CleanEmails(IEnumerable<string> emails)
        {
            return emails
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }
    }
}

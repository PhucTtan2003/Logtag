using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using temperature_humi.Models;

namespace temperature_humi.Service.Reports
{
    public class MonthlyReportCsvBuilder
    {
        public byte[] BuildCsv(
            string periodKey,
            string serial,
            DateTime fromLocal,
            DateTime toLocalExclusive,
            TimeZoneInfo tz,
            IReadOnlyList<LocationReading> rows)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Report,Monthly temperature report");
            sb.AppendLine($"Period,{Csv(periodKey)}");
            sb.AppendLine($"Serial,{Csv(serial)}");
            sb.AppendLine($"From,{Csv(fromLocal.ToString("yyyy-MM-dd HH:mm:ss"))}");
            sb.AppendLine($"To,{Csv(toLocalExclusive.AddSeconds(-1).ToString("yyyy-MM-dd HH:mm:ss"))}");
            sb.AppendLine($"TotalReadings,{rows.Count}");

            var validTemps = rows.Select(x => x.Temperature).Where(x => x > -1e300).ToList();
            if (validTemps.Count > 0)
            {
                sb.AppendLine($"MinTemperature,{validTemps.Min().ToString("0.##", CultureInfo.InvariantCulture)}");
                sb.AppendLine($"MaxTemperature,{validTemps.Max().ToString("0.##", CultureInfo.InvariantCulture)}");
                sb.AppendLine($"AverageTemperature,{validTemps.Average().ToString("0.##", CultureInfo.InvariantCulture)}");
            }

            sb.AppendLine();
            sb.AppendLine("SerialNumber,DateLocal,DateUtc,Temperature,Humidity");

            foreach (var r in rows.OrderBy(x => x.DateUtc))
            {
                var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(r.DateUtc, DateTimeKind.Utc), tz);
                sb.Append(Csv(r.SerialNumber));
                sb.Append(',');
                sb.Append(Csv(local.ToString("yyyy-MM-dd HH:mm:ss")));
                sb.Append(',');
                sb.Append(Csv(DateTime.SpecifyKind(r.DateUtc, DateTimeKind.Utc).ToString("yyyy-MM-dd HH:mm:ss")));
                sb.Append(',');
                sb.Append(r.Temperature > -1e300 ? r.Temperature.ToString("0.##", CultureInfo.InvariantCulture) : "");
                sb.Append(',');
                sb.Append(r.Humidity.HasValue ? r.Humidity.Value.ToString("0.##", CultureInfo.InvariantCulture) : "");
                sb.AppendLine();
            }

            // BOM để Excel mở tiếng Việt không lỗi font.
            return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        }

        private static string Csv(string? value)
        {
            value ??= string.Empty;
            if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
                return "\"" + value.Replace("\"", "\"\"") + "\"";
            return value;
        }
    }
}

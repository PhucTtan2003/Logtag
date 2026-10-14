using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using temperature_humi.DTO;
using temperature_humi.Helpers.Config;
using temperature_humi.Models;
using temperature_humi.Service;
using temperature_humi.Service.LogtagService;

[Route("api/[controller]")]
[ApiController]
public class ExportController : ControllerBase
{
    private readonly LocationReadingService _readingService;
    private readonly AccountDeviceService _accountDeviceService;
    private readonly ExportSettings _exportSettings;

    public ExportController(
        LocationReadingService readingService,
        AccountDeviceService accountDeviceService,
        IOptions<ExportSettings> exportOptions)
    {
        _readingService = readingService;
        _accountDeviceService = accountDeviceService;
        _exportSettings = exportOptions?.Value ?? new ExportSettings();
        if (_exportSettings.MaxDays <= 0) _exportSettings.MaxDays = 62; // fallback an toàn
    }

    private TimeSpan MaxSpan => TimeSpan.FromDays(_exportSettings.MaxDays);

    private bool ExceedsMaxSpan(DateTime fromUtc, DateTime toUtc)
        => (toUtc - fromUtc) > MaxSpan;

    // Gắn header để FE đọc hiển thị tooltip
    private void StampMaxDaysHeader()
    {
        Response.Headers["X-Export-MaxDays"] = _exportSettings.MaxDays.ToString();
    }

    // ===================== 1) Theo serialNumber (UTC mặc định) =====================
    [HttpGet("export-excel-by-serial")]
    public async Task<IActionResult> ExportExcelBySerial(
        string serialNumber,
        string? fromUtc = null,
        string? toUtc = null,
        string? range = "7d")
    {
        if (string.IsNullOrWhiteSpace(serialNumber))
            return BadRequest("Thiếu serialNumber.");

        // stamp sớm để mọi response (200/4xx) đều có header
        StampMaxDaysHeader();

        var (from, to) = ResolveTimeRange(fromUtc, toUtc, range);

        if (from >= to) return BadRequest("'Từ' phải nhỏ hơn 'Đến'.");
        if (ExceedsMaxSpan(from, to))
            return BadRequest($"Khoảng thời gian vượt quá giới hạn (≤ {_exportSettings.MaxDays} ngày). Vui lòng chọn lại.");

        var rows = await QueryReadingsBySerial(serialNumber.Trim(), from, to);
        if (rows == null || rows.Count == 0)
            return NotFound($"Không có dữ liệu cho serialNumber: {serialNumber}");

        using var wb = new XLWorkbook();

        // sheet dữ liệu: ghi theo UTC cho endpoint này
        var ws = wb.Worksheets.Add(SafeSheetName($"Serial_{serialNumber}"));
        WriteSheetUtc(ws, serialNumber, rows);

        AddSummarySheet(wb, new Dictionary<string, List<LocationReading>>
        {
            { serialNumber, rows }
        }, from, to);

        var bytes = SaveToBytes(wb);
        var fileName = $"export_{serialNumber}_{from:yyyyMMddHHmm}_{to:yyyyMMddHHmm}.xlsx";
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    // ===================== 2) Theo accountId (nhiều serial, UTC mặc định) =====================
    [HttpGet("export-excel-by-account")]
    public async Task<IActionResult> ExportExcelByAccount(
        string accountId,
        string? fromUtc = null,
        string? toUtc = null,
        string? range = "7d")
    {
        if (!ObjectId.TryParse(accountId, out var accId))
            return BadRequest("accountId không hợp lệ.");

        // stamp sớm để mọi response (200/4xx) đều có header
        StampMaxDaysHeader();

        var serials = await _accountDeviceService.GetSerialsByAccountOnlyAsync(accId);
        if (serials.Count == 0) return NotFound("Tài khoản chưa có thiết bị.");

        var (from, to) = ResolveTimeRange(fromUtc, toUtc, range);

        if (from >= to) return BadRequest("'Từ' phải nhỏ hơn 'Đến'.");
        if (ExceedsMaxSpan(from, to))
            return BadRequest($"Khoảng thời gian vượt quá giới hạn (≤ {_exportSettings.MaxDays} ngày). Vui lòng chọn lại.");

        using var wb = new XLWorkbook();
        var bucket = new Dictionary<string, List<LocationReading>>();

        foreach (var sn in serials.Distinct())
        {
            var rows = await QueryReadingsBySerial(sn, from, to);
            bucket[sn] = rows ?? new List<LocationReading>();

            var ws = wb.Worksheets.Add(SafeSheetName(sn));
            WriteSheetUtc(ws, sn, bucket[sn]);
        }

        AddSummarySheet(wb, bucket, from, to);

        var bytes = SaveToBytes(wb);
        var fileName = $"export_account_{accId}_{from:yyyyMMddHHmm}_{to:yyyyMMddHHmm}.xlsx";
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    // ===================== 0) Alias khớp FE: hỗ trợ múi giờ =====================
    // FE: /api/export/excel-by-serial-range?serialNumber=...&from=...&to=...&tz=Asia/Ho_Chi_Minh
    // hoặc offsetMinutes=420
    [HttpGet("excel-by-serial-range")]
    public async Task<IActionResult> ExportExcelBySerialRange(
        string serialNumber,
        string? from = null,
        string? to = null,
        string? range = "7d",
        string? tz = null,
        int? offsetMinutes = null)
    {
        if (string.IsNullOrWhiteSpace(serialNumber))
            return BadRequest("Thiếu serialNumber.");

        // stamp sớm để mọi response (200/4xx) đều có header
        StampMaxDaysHeader();

        var (fromUtc, toUtc) = ResolveTimeRange(from, to, range);

        if (fromUtc >= toUtc) return BadRequest("'Từ' phải nhỏ hơn 'Đến'.");
        if (ExceedsMaxSpan(fromUtc, toUtc))
            return BadRequest($"Khoảng thời gian vượt quá giới hạn (≤ {_exportSettings.MaxDays} ngày). Vui lòng chọn lại.");

        var rows = await QueryReadingsBySerial(serialNumber.Trim(), fromUtc, toUtc);
        if (rows == null || rows.Count == 0)
            return NotFound($"Không có dữ liệu cho serialNumber: {serialNumber}");

        var tzInfo = ResolveTz(tz, offsetMinutes);

        using var wb = new XLWorkbook();

        var ws = wb.Worksheets.Add(SafeSheetName($"Serial_{serialNumber}"));
        WriteSheetLocal(ws, serialNumber, rows, tzInfo);

        AddSummarySheet(wb, new Dictionary<string, List<LocationReading>>
        {
            { serialNumber, rows }
        }, fromUtc, toUtc);

        var tzTag = tzInfo.Id.Replace(' ', '_').Replace('/', '-');
        var bytes = SaveToBytes(wb);
        var fileName = $"export_{serialNumber}_{fromUtc:yyyyMMddHHmm}_{toUtc:yyyyMMddHHmm}_{tzTag}.xlsx";
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    // ===================== 3) Export nhiều serial trong 1 khoảng (UTC mặc định) =====================
    [HttpPost("excel-by-serials-range")]
    public async Task<IActionResult> ExportExcelBySerialsRange([FromBody] SerialRangeRequest req)
    {
        if (req == null || req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            return BadRequest("Danh sách serial trống.");

        // stamp sớm để mọi response (200/4xx) đều có header
        StampMaxDaysHeader();

        var (fromUtc, toUtc) = ResolveTimeRange(req.FromUtc, req.ToUtc, req.Range);

        if (fromUtc >= toUtc) return BadRequest("'Từ' phải nhỏ hơn 'Đến'.");
        if (ExceedsMaxSpan(fromUtc, toUtc))
            return BadRequest($"Khoảng thời gian vượt quá giới hạn (≤ {_exportSettings.MaxDays} ngày). Vui lòng chọn lại.");

        using var wb = new XLWorkbook();
        var bucket = new Dictionary<string, List<LocationReading>>();

        foreach (var sn in req.SerialNumbers.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Distinct())
        {
            var rows = await QueryReadingsBySerial(sn, fromUtc, toUtc);
            var list = rows ?? new List<LocationReading>();
            bucket[sn] = list;

            var ws = wb.Worksheets.Add(SafeSheetName(sn));
            WriteSheetUtc(ws, sn, list);
        }

        if (bucket.Count == 0)
            return NotFound("Không có dữ liệu cho các serial đã chọn.");

        AddSummarySheet(wb, bucket, fromUtc, toUtc);

        var bytes = SaveToBytes(wb);
        var fileName = $"export_serials_{fromUtc:yyyyMMddHHmm}_{toUtc:yyyyMMddHHmm}.xlsx";
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    // ===================== Helpers =====================
    private (DateTime from, DateTime to) ResolveTimeRange(string? fromUtc, string? toUtc, string? range)
    {
        DateTime to = DateTime.UtcNow, from;

        if (!string.IsNullOrWhiteSpace(fromUtc) || !string.IsNullOrWhiteSpace(toUtc))
        {
            if (DateTimeOffset.TryParse(toUtc, out var dtoTo)) to = dtoTo.UtcDateTime;
            else to = DateTime.UtcNow;

            if (DateTimeOffset.TryParse(fromUtc, out var dtoFrom)) from = dtoFrom.UtcDateTime;
            else from = to.AddDays(-30);
        }
        else
        {
            to = DateTime.UtcNow;
            from = range switch
            {
                "1h" => to.AddHours(-1),
                "6h" => to.AddHours(-6),
                "24h" => to.AddHours(-24),
                "7d" => to.AddDays(-7),
                "30d" => to.AddDays(-30),
                _ => to.AddDays(-30)
            };
        }

        if (from > to) (from, to) = (to, from);

        // Clamp theo MaxDays config
        if ((to - from) > MaxSpan)
            from = to - MaxSpan;

        return (from, to);
    }

    private async Task<List<LocationReading>> QueryReadingsBySerial(string serial, DateTime from, DateTime to)
    {
        var col = _readingService.GetCollection();
        var filter = Builders<LocationReading>.Filter.And(
            Builders<LocationReading>.Filter.Eq(r => r.SerialNumber, serial),
            Builders<LocationReading>.Filter.Gte(r => r.DateUtc, from),
            Builders<LocationReading>.Filter.Lte(r => r.DateUtc, to)
        );

        return await col.Find(filter)
            .SortBy(r => r.DateUtc)
            .ToListAsync();
    }

    // ---- Ghi sheet data theo UTC ----
    private static void WriteSheetUtc(IXLWorksheet ws, string serial, List<LocationReading> rows)
    {
        ws.Cell(1, 1).Value = "No";
        ws.Cell(1, 2).Value = "SerialNumber";
        ws.Cell(1, 3).Value = "Date (UTC)";
        ws.Cell(1, 4).Value = "Temperature (°C)";
        ws.Cell(1, 5).Value = "Humidity (%)";
        StyleHeader(ws.Range(1, 1, 1, 5));

        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            int row = i + 2;
            ws.Cell(row, 1).Value = i + 1;
            ws.Cell(row, 2).Value = r.SerialNumber;
            ws.Cell(row, 3).Value = r.DateUtc.ToUniversalTime();
            ws.Cell(row, 4).Value = r.Temperature;
            ws.Cell(row, 5).Value = r.Humidity ?? 0;
        }

        ws.Column(3).Style.DateFormat.Format = "yyyy-MM-dd HH:mm:ss";
        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(1);
        if (rows.Count > 0) ws?.RangeUsed()?.SetAutoFilter();
    }

    // ---- Ghi sheet data theo múi giờ người dùng chọn ----
    private static void WriteSheetLocal(IXLWorksheet ws, string serial, List<LocationReading> rows, TimeZoneInfo tz)
    {
        ws.Cell(1, 1).Value = "No";
        ws.Cell(1, 2).Value = "SerialNumber";
        ws.Cell(1, 3).Value = $"Date ({tz.StandardName})";
        ws.Cell(1, 4).Value = "Temperature (°C)";
        ws.Cell(1, 5).Value = "Humidity (%)";
        StyleHeader(ws.Range(1, 1, 1, 5));

        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            int row = i + 2;

            ws.Cell(row, 1).Value = i + 1;
            ws.Cell(row, 2).Value = r.SerialNumber;

            var localForExcel = ToLocalForExcelUtc(r.DateUtc, tz);
            ws.Cell(row, 3).Value = localForExcel;

            ws.Cell(row, 4).Value = r.Temperature;
            ws.Cell(row, 5).Value = r.Humidity ?? 0;
        }
        ws.Column(3).Style.DateFormat.Format = "yyyy-MM-dd HH:mm:ss";
        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(1);
        if (rows.Count > 0) ws?.RangeUsed()?.SetAutoFilter();
    }

    private static void AddSummarySheet(
        XLWorkbook wb,
        Dictionary<string, List<LocationReading>> dataBySerial,
        DateTime fromUtc, DateTime toUtc)
    {
        var ws = wb.Worksheets.Add("Summary");
        ws.Cell(1, 1).Value = "Từ (UTC)";
        ws.Cell(1, 2).Value = "Đến (UTC)";
        ws.Cell(2, 1).Value = fromUtc;
        ws.Cell(2, 2).Value = toUtc;
        ws.Column(1).Style.DateFormat.Format = "yyyy-MM-dd HH:mm:ss";
        ws.Column(2).Style.DateFormat.Format = "yyyy-MM-dd HH:mm:ss";

        ws.Cell(4, 1).Value = "SerialNumber";
        ws.Cell(4, 2).Value = "Records";
        ws.Cell(4, 3).Value = "Min Temp (°C)";
        ws.Cell(4, 4).Value = "Max Temp (°C)";
        ws.Cell(4, 5).Value = "Avg Temp (°C)";
        ws.Cell(4, 6).Value = "Min Hum (%)";
        ws.Cell(4, 7).Value = "Max Hum (%)";
        ws.Cell(4, 8).Value = "Avg Hum (%)";
        StyleHeader(ws.Range(4, 1, 4, 8));

        int r = 5;
        foreach (var (serial, list) in dataBySerial)
        {
            ws.Cell(r, 1).Value = serial;
            ws.Cell(r, 2).Value = list.Count;

            if (list.Count > 0)
            {
                ws.Cell(r, 3).Value = list.Min(x => x.Temperature);
                ws.Cell(r, 4).Value = list.Max(x => x.Temperature);
                ws.Cell(r, 5).Value = Math.Round(list.Average(x => x.Temperature), 2);

                var humList = list.Where(x => x.Humidity.HasValue).Select(x => x.Humidity!.Value).ToList();
                if (humList.Count > 0)
                {
                    ws.Cell(r, 6).Value = humList.Min();
                    ws.Cell(r, 7).Value = humList.Max();
                    ws.Cell(r, 8).Value = Math.Round(humList.Average(), 2);
                }
            }
            r++;
        }

        ws.Columns().AdjustToContents();
        ws.Range(4, 1, r - 1, 8).SetAutoFilter();
    }

    private static void StyleHeader(IXLRange range)
    {
        range.Style.Font.Bold = true;
        range.Style.Fill.BackgroundColor = XLColor.LightSteelBlue;
        range.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        range.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
    }

    private static string SafeSheetName(string name)
    {
        var bad = Path.GetInvalidFileNameChars();
        var filtered = new string(name.Where(c => !bad.Contains(c)).ToArray());
        return filtered.Length > 31 ? filtered[..31] : filtered;
    }

    private static byte[] SaveToBytes(XLWorkbook wb)
    {
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ===== Helpers: chọn múi giờ và convert =====
    private static TimeZoneInfo ResolveTz(string? tz, int? offsetMinutes)
    {
        if (!string.IsNullOrWhiteSpace(tz))
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(tz); } catch { /* fall through */ }
        }
        if (offsetMinutes.HasValue)
        {
            var off = TimeSpan.FromMinutes(offsetMinutes.Value);
            var sign = off >= TimeSpan.Zero ? "+" : "-";
            var id = $"UTC{sign}{off:hh\\:mm}";
            return TimeZoneInfo.CreateCustomTimeZone(
                id: id,
                baseUtcOffset: off,
                displayName: id,
                standardDisplayName: id);
        }
        try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"); }
        catch { return TimeZoneInfo.Local; }
    }

    private static DateTime ToLocalForExcelUtc(DateTime utc, TimeZoneInfo tz)
    {
        var u = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        var local = TimeZoneInfo.ConvertTimeFromUtc(u, tz);
        return DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
    }
}

export function exportToCsv(filename: string, rows: any[]) {
  if (!rows || rows.length === 0) {
    alert("No data to export");
    return;
  }

  const header = Object.keys(rows[0]).join(",");
  const csv = rows
    .map(row =>
      Object.values(row)
        .map(val => `"${val ?? ""}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([header + "\n" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.click();
}

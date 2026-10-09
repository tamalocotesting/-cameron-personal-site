/**
 * Minimal RFC 4180 CSV writer.
 *
 * Cells that a spreadsheet would treat as a formula (=, +, -, @, tab, CR) are
 * prefixed with an apostrophe so an employee's note can never execute as a
 * formula when a manager opens the export in Excel or Google Sheets.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

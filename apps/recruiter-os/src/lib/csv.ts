/**
 * CSV writer that is safe to open in a spreadsheet.
 *
 * A cell beginning with =, +, -, @, tab or CR is a formula to Excel/Sheets and
 * will execute on open. We prefix those cells with a single quote and always
 * quote every field, which also removes the delimiter/newline ambiguity.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  text = text.replace(/\u0000/g, '');
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  // CRLF, because that is what spreadsheet software expects.
  return `${lines.join('\r\n')}\r\n`;
}

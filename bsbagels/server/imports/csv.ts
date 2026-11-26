/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM). Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Map rows to objects keyed by normalized header (lowercase, single spaces). */
export function records(rows: string[][]): { header: string[]; data: Record<string, string>[] } {
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  return { header, data: rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function pick(rec: Record<string, string>, ...aliases: string[]): string {
  for (const a of aliases) if (a in rec) return rec[a];
  return '';
}

/** Toast dates: "11/25/26 7:42 AM", "11/25/2026 07:42", "2026-11-25 07:42:00", "20261125". Returns ISO date. */
export function toastDate(v: string): string | null {
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
export const money = (v: string) => { const n = parseFloat(v.replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };
export const truthy = (v: string) => /^(true|yes|1|y)$/i.test(v.trim());

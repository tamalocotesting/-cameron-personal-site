/**
 * Minimal .xlsx reader (values only) — handles namespace-prefixed SpreadsheetML (e.g. `<x:c>`), which
 * the master workbook uses. Reads cached formula results; never evaluates formulas. Intended for the
 * trusted master workbook only; Toast imports use the CSV parser in server/imports.
 */
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

export type Cell = string | number | boolean | Date | null;

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const stripNs = (xml: string) => xml.replace(/<(\/?)[A-Za-z]+:/g, '<$1');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export interface Workbook { sheets: Map<string, string>; files: Record<string, Uint8Array>; shared: string[] }

export async function loadWorkbook(path: string): Promise<Workbook> {
  const files = unzipSync(readFileSync(path));
  const get = (p: string) => { const f = files[p.replace(/^\//, '')]; return f ? stripNs(strFromU8(f)) : ''; };
  const wbXml = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1]; let t = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && t) { t = t.replace(/^\//, ''); relMap.set(id, t.startsWith('xl/') ? t : 'xl/' + t); }
  }
  const sheets = new Map<string, string>();
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[1])![1]);
    const rid = /r:id="([^"]+)"|id="([^"]+)"/.exec(m[1]);
    const target = relMap.get(rid![1] ?? rid![2]);
    if (target) sheets.set(name, target);
  }
  const shared: string[] = [];
  const ss = get('xl/sharedStrings.xml');
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  return { sheets, files, shared };
}

export function sheetNames(wb: Workbook) { return [...wb.sheets.keys()]; }

export function sheetRows(wb: Workbook, name: string): Cell[][] {
  const path = wb.sheets.get(name);
  if (!path) throw new Error(`Sheet not found: ${name}`);
  const xml = stripNs(strFromU8(wb.files[path]));
  const rows: Cell[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = +(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
    const vals: Cell[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val: Cell = null;
      if (t === 'inlineStr') val = decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (v !== undefined) {
        if (t === 's') val = wb.shared[+v] ?? null;
        else if (t === 'str') val = decode(v);
        else if (t === 'b') val = v === '1';
        else if (t === 'd') val = new Date(v);
        else if (t === 'e') val = null;
        else val = v === '' ? null : +v;
      }
      if (ref) vals[colIndex(ref)] = val; else vals.push(val);
    }
    for (let i = 0; i < vals.length; i++) if (vals[i] === undefined) vals[i] = null;
    rows[r] = vals;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** Find the header row (first row containing `firstHeader`) and return objects keyed by header. */
export function table(rows: Cell[][], firstHeader: string): Record<string, Cell>[] {
  const hi = rows.findIndex((r) => r.some((c) => typeof c === 'string' && c.trim() === firstHeader));
  if (hi < 0) throw new Error(`Header "${firstHeader}" not found`);
  const header = rows[hi].map((c) => (c === null ? '' : String(c).trim()));
  const out: Record<string, Cell>[] = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r.length || r.every((c) => c === null || c === '')) continue;
    const o: Record<string, Cell> = {};
    header.forEach((h, i) => { if (h) o[h] = r[i] ?? null; });
    out.push(o);
  }
  return out;
}

export const isoDate = (c: Cell): string | null => {
  if (c instanceof Date && !isNaN(+c)) return c.toISOString().slice(0, 10);
  if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
  // Excel 1900-system serial (only called on known date columns)
  if (typeof c === 'number' && c > 20000 && c < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000).toISOString().slice(0, 10);
  return null;
};
export const num = (c: Cell): number | null => (typeof c === 'number' ? c : typeof c === 'string' && c.trim() !== '' && !isNaN(+c) ? +c : null);
export const str = (c: Cell): string | null => (c === null ? null : String(c).trim() || null);

/**
 * Toast export imports. Every file is hashed; re-importing the same bytes is a no-op. Dates already in
 * the database are only replaced when `replace` is true (the UI asks first), and the replacement is audited.
 */
import { createHash } from 'node:crypto';
import type { DB } from '../db.ts';
import { all, one, run, tx } from '../db.ts';
import { parseCsv, records, pick, toastDate, money, truthy } from './csv.ts';
import { BAGEL_GROUPS, canonicalFlavor } from '../domain/units.ts';
import { audit, type Actor } from '../audit.ts';

export type ImportKind = 'item_selection' | 'modifier_selection' | 'sales_by_day';

export function detectKind(header: string[]): ImportKind | null {
  const h = new Set(header);
  if (h.has('option group name') || h.has('option group') || h.has('parent menu selection') || h.has('modifier')) return 'modifier_selection';
  if (h.has('menu item') && (h.has('qty') || h.has('quantity'))) return 'item_selection';
  if ([...h].some((x) => x.includes('net sales')) && [...h].some((x) => x === 'date' || x.includes('business date') || x === 'yyyymmdd')) return 'sales_by_day';
  return null;
}

interface Preview {
  kind: ImportKind; sha256: string; filename: string; rows: number; usedRows: number; voidRows: number;
  dates: string[]; overlap: string[]; duplicateFile: boolean; warnings: string[];
  summary: Record<string, number>;
}

function parse(text: string, filename: string, forced?: ImportKind) {
  const sha256 = createHash('sha256').update(text).digest('hex');
  const { header, data } = records(parseCsv(text));
  const kind = forced ?? detectKind(header);
  if (!kind) throw new Error('Unrecognized file. Expected a Toast Item Selection Details, Modifier Selection Details, or Sales by day CSV.');
  return { sha256, header, data, kind, filename };
}

type Parsed = ReturnType<typeof parse>;

function extract(p: Parsed) {
  const warnings: string[] = [];
  let voids = 0;
  if (p.kind === 'item_selection') {
    const agg = new Map<string, { date: string; item: string; group: string; qty: number; net: number }>();
    for (const r of p.data) {
      if (truthy(pick(r, 'void?', 'voided', 'void'))) { voids++; continue; }
      const d = toastDate(pick(r, 'sent date', 'order date', 'business date'));
      const item = pick(r, 'menu item', 'item');
      if (!d || !item) continue;
      const k = `${d}|${item}`;
      const e = agg.get(k) ?? { date: d, item, group: pick(r, 'menu group'), qty: 0, net: 0 };
      e.qty += parseFloat(pick(r, 'qty', 'quantity')) || 0; e.net += money(pick(r, 'net price', 'net amount')) ?? 0;
      agg.set(k, e);
    }
    return { kind: p.kind, items: [...agg.values()], voids, warnings };
  }
  if (p.kind === 'modifier_selection') {
    const agg = new Map<string, { date: string; group: string; parent: string; modifier: string; qty: number }>();
    for (const r of p.data) {
      if (truthy(pick(r, 'void?', 'voided', 'void'))) { voids++; continue; }
      const d = toastDate(pick(r, 'sent date', 'order date', 'business date'));
      const mod = pick(r, 'modifier');
      if (!d || !mod) continue;
      const group = pick(r, 'option group name', 'option group'), parent = pick(r, 'parent menu selection', 'parent selection');
      const k = `${d}|${group}|${parent}|${mod}`;
      const e = agg.get(k) ?? { date: d, group, parent, modifier: mod, qty: 0 };
      e.qty += parseFloat(pick(r, 'qty', 'quantity')) || 0;
      agg.set(k, e);
    }
    const mods = [...agg.values()];
    if (!mods.some((m) => BAGEL_GROUPS.has(m.group))) warnings.push('No bagel option groups found (Bagel Choices / Dozen Bagels / Half Dozen Bagels). Bagel history will not be updated from this file.');
    return { kind: p.kind, mods, voids, warnings };
  }
  const days: { date: string; net: number | null; orders: number | null; guests: number | null }[] = [];
  for (const r of p.data) {
    const d = toastDate(pick(r, 'date', 'business date', 'yyyymmdd'));
    if (!d) continue;
    const netKey = Object.keys(r).find((k) => k.includes('net sales'))!;
    days.push({ date: d, net: money(r[netKey]), orders: parseInt(pick(r, 'orders', 'total orders', 'order count')) || null, guests: parseInt(pick(r, 'guests', 'total guests', 'guest count')) || null });
  }
  return { kind: p.kind, days, voids, warnings };
}

function datesOf(x: ReturnType<typeof extract>): string[] {
  const s = new Set<string>();
  if ('items' in x) x.items!.forEach((i) => s.add(i.date));
  if ('mods' in x) x.mods!.forEach((i) => s.add(i.date));
  if ('days' in x) x.days!.forEach((i) => s.add(i.date));
  return [...s].sort();
}

export function previewImport(db: DB, text: string, filename: string, forced?: ImportKind): Preview {
  const p = parse(text, filename, forced);
  const x = extract(p);
  const dates = datesOf(x);
  const dup = !!one(db, 'SELECT 1 FROM sources WHERE sha256=?', p.sha256);
  let overlap: string[] = [];
  if (dates.length) {
    const ph = dates.map(() => '?').join(',');
    const q = p.kind === 'sales_by_day' ? `SELECT date FROM daily_sales WHERE status='actual' AND date IN (${ph})`
      : p.kind === 'modifier_selection' ? `SELECT date FROM bagel_day WHERE status='recorded' AND date IN (${ph})`
      : `SELECT DISTINCT date FROM item_daily WHERE date IN (${ph})`;
    overlap = all<{ date: string }>(db, q, ...dates).map((r) => r.date);
  }
  const summary: Record<string, number> = {};
  if ('mods' in x) {
    let bagels = 0;
    for (const m of x.mods!) if (BAGEL_GROUPS.has(m.group) && canonicalFlavor(m.modifier)) bagels += m.qty;
    summary.bagelUnits = bagels; summary.modifierRows = x.mods!.length;
  }
  if ('items' in x) summary.itemUnits = x.items!.reduce((a, i) => a + i.qty, 0);
  if ('days' in x) summary.netSales = x.days!.reduce((a, d) => a + (d.net ?? 0), 0);
  return { kind: p.kind, sha256: p.sha256, filename, rows: p.data.length, usedRows: p.data.length - x.voids, voidRows: x.voids, dates, overlap, duplicateFile: dup, warnings: x.warnings, summary };
}

export function applyImport(db: DB, actor: Actor, text: string, filename: string, opts: { replace?: boolean; kind?: ImportKind } = {}) {
  const pv = previewImport(db, text, filename, opts.kind);
  if (pv.duplicateFile) return { ...pv, applied: false, reason: 'This exact file was already imported.' };
  if (pv.overlap.length && !opts.replace) return { ...pv, applied: false, reason: `${pv.overlap.length} date(s) already have data. Confirm replacement to continue.` };
  const p = parse(text, filename, opts.kind);
  const x = extract(p);
  const sid = `IMP:${pv.sha256.slice(0, 16)}`;
  tx(db, () => {
    run(db, `INSERT INTO sources(id,kind,label,filename,sha256,period_start,period_end,row_count,imported_by,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      sid, `toast_${pv.kind}`, `Toast ${pv.kind.replace(/_/g, ' ')} import`, filename, pv.sha256, pv.dates[0] ?? null, pv.dates.at(-1) ?? null, pv.rows, actor.username,
      pv.overlap.length ? `Replaced ${pv.overlap.length} existing date(s)` : null);
    if ('items' in x) {
      for (const d of pv.dates) run(db, 'DELETE FROM item_daily WHERE date=?', d);
      for (const i of x.items!) run(db, 'INSERT INTO item_daily(date,item,menu_group,qty,net,source_id) VALUES (?,?,?,?,?,?)', i.date, i.item, i.group || null, i.qty, i.net, sid);
    }
    if ('mods' in x) {
      for (const d of pv.dates) { run(db, 'DELETE FROM modifier_daily WHERE date=?', d); }
      const bagel = new Map<string, Record<string, number>>();
      for (const m of x.mods!) {
        run(db, 'INSERT INTO modifier_daily(date,option_group,parent,modifier,qty,source_id) VALUES (?,?,?,?,?,?)', m.date, m.group || null, m.parent || null, m.modifier, m.qty, sid);
        const f = canonicalFlavor(m.modifier);
        if (BAGEL_GROUPS.has(m.group) && f) { const e = bagel.get(m.date) ?? {}; e[f] = (e[f] ?? 0) + m.qty; bagel.set(m.date, e); }
      }
      if (bagel.size) for (const d of pv.dates) {
        const before = one(db, 'SELECT * FROM bagel_day WHERE date=?', d);
        run(db, 'DELETE FROM bagel_daily WHERE date=?', d);
        const f = bagel.get(d);
        if (f) {
          for (const [k, v] of Object.entries(f)) run(db, 'INSERT INTO bagel_daily(date,flavor,units,source_id) VALUES (?,?,?,?)', d, k, v, sid);
          run(db, `INSERT INTO bagel_day(date,status,total,source_id) VALUES (?,'recorded',?,?) ON CONFLICT(date) DO UPDATE SET status='recorded', total=excluded.total, source_id=excluded.source_id, note=NULL`,
            d, Object.values(f).reduce((a, b) => a + b, 0), sid);
        } else {
          run(db, `INSERT INTO bagel_day(date,status,total,source_id,note) VALUES (?,'no_records',NULL,?,'Import had activity but no named bagel modifiers') ON CONFLICT(date) DO UPDATE SET status='no_records', total=NULL, source_id=excluded.source_id`, d, sid);
        }
        if (before) audit(db, actor, 'history.replace', 'bagel_day', d, before, one(db, 'SELECT * FROM bagel_day WHERE date=?', d), `Import ${filename}`);
      }
    }
    if ('days' in x) {
      for (const d of x.days!) {
        const before = one(db, 'SELECT * FROM daily_sales WHERE date=?', d.date);
        run(db, `INSERT INTO daily_sales(date,net_sales,orders,guests,status,source_id) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(date) DO UPDATE SET net_sales=excluded.net_sales, orders=excluded.orders, guests=excluded.guests, status=excluded.status, source_id=excluded.source_id`,
          d.date, d.net, d.orders, d.guests, d.net === null ? 'blank_in_source' : 'actual', sid);
        if (before && (before as { status: string }).status === 'actual') audit(db, actor, 'history.replace', 'daily_sales', d.date, before, d, `Import ${filename}`);
      }
    }
    audit(db, actor, 'import.apply', 'sources', sid, null, { kind: pv.kind, filename, dates: [pv.dates[0], pv.dates.at(-1)], rows: pv.rows, replaced: pv.overlap.length }, null as never);
  });
  return { ...pv, applied: true, sourceId: sid };
}

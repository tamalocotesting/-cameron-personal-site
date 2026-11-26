/**
 * Build the historical database from the private source kit.
 *
 *   npm run seed                 # uses private/source_kit/01_Master_Toast_Workbook/master.xlsx
 *   npm run seed -- --workbook <path> [--demo] [--fresh]
 *
 * --fresh  delete the existing database first
 * --demo   also create demo crew/lead/manager accounts (random PINs written to data/initial-credentials.txt)
 *
 * Never writes business data anywhere but the database file under data/.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, tx, run, all, one, ROOT, DB_PATH, DATA_DIR } from '../db.ts';
import { loadWorkbook, sheetRows, table, isoDate, num, str } from './workbook.ts';
import { CANONICAL_FLAVORS, FLAVOR_META, BAGEL_GROUPS, canonicalFlavor, bagelsPerItem } from '../domain/units.ts';
import { DEFAULT_ASSUMPTIONS } from '../domain/assumptions.ts';
import { hashSecret, randomPassword, randomPin } from '../auth.ts';
import { dateRange } from '../domain/calendar.ts';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const WORKBOOK = arg('--workbook') ?? join(ROOT, 'private', 'source_kit', '01_Master_Toast_Workbook', 'master.xlsx');
const SEED_DIR = arg('--seed-dir') ?? join(ROOT, 'private', 'seed');

if (!existsSync(WORKBOOK)) {
  console.error(`Workbook not found: ${WORKBOOK}\nPlace the private source kit at private/source_kit (see docs/SETUP.md).`);
  process.exit(1);
}
if (args.includes('--fresh')) for (const s of ['', '-wal', '-shm']) rmSync(DB_PATH + s, { force: true });

const sha256 = createHash('sha256').update(readFileSync(WORKBOOK)).digest('hex');
console.log(`Workbook ${WORKBOOK}\nSHA-256 ${sha256}`);
const wb = await loadWorkbook(WORKBOOK);
const db = openDb();

const src = (sheet: string, label: string, ps: string | null, pe: string | null, rows: number, notes = '') => {
  const id = `WB:${sheet}`;
  run(db, `INSERT OR REPLACE INTO sources(id,kind,label,filename,sha256,period_start,period_end,row_count,imported_by,notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)`, id, 'workbook_sheet', label, `master workbook › ${sheet}`, sha256, ps, pe, rows, 'seed', notes);
  return id;
};

tx(db, () => {
  // ── Daily sales ───────────────────────────────────────────────────────────
  const dh = table(sheetRows(wb, 'Daily History'), 'Date');
  const statusMap: Record<string, string> = { Actual: 'actual', 'Not supplied': 'not_supplied', 'Sales blank in source': 'blank_in_source', 'Not supplied; cutoff day': 'not_supplied' };
  const sid = src('Daily History', 'Toast daily net sales (Sales by Day, S039/S041/S042/S043)', '2024-08-13', '2026-11-05', dh.length,
    'One row per calendar date; gaps kept as not_supplied.');
  run(db, 'DELETE FROM daily_sales');
  for (const r of dh) {
    const d = isoDate(r['Date']);
    if (!d) continue;
    const st = statusMap[str(r['Sales status']) ?? ''] ?? 'not_supplied';
    run(db, 'INSERT INTO daily_sales(date,net_sales,orders,guests,status,source_id) VALUES (?,?,?,?,?,?)',
      d, st === 'actual' ? num(r['Net sales']) : null, num(r['Orders']), num(r['Guests']), st, sid);
  }

  // ── Daily bagels by flavor (sent date). Sum across report months. ────────
  run(db, 'DELETE FROM bagel_daily'); run(db, 'DELETE FROM bagel_day');
  const perDay = new Map<string, Record<string, number>>();
  const noRecords = new Set<string>();
  let rowsSeen = 0;
  for (const sheet of ['2025 Bagels Daily', '2026 Bagels Daily']) {
    const t = table(sheetRows(wb, sheet), 'Sent Date');
    src(sheet, `Daily named-flavor bagel units by Toast sent date (${sheet.slice(0, 4)})`, null, null, t.length,
      'Bagel Choices + Dozen + Half Dozen flavor modifiers (+ Jan–Feb 2025 legacy groups and named items). Catering bundles excluded.');
    for (const r of t) {
      const d = isoDate(r['Sent Date']);
      if (!d) continue;
      rowsSeen++;
      if (num(r['Total']) === null) { noRecords.add(d); continue; }
      const acc = perDay.get(d) ?? {};
      for (const f of CANONICAL_FLAVORS) {
        const v = num(r[f]);
        if (v) acc[f] = (acc[f] ?? 0) + v;
      }
      perDay.set(d, acc);
    }
  }
  // Coverage starts 2025-01-01: earlier sent dates only carry advance orders from the January report.
  const START = '2025-01-01', END = '2026-10-31';
  for (const d of dateRange(START, END)) {
    const f = perDay.get(d);
    if (f) {
      const total = Object.values(f).reduce((a, b) => a + b, 0);
      run(db, "INSERT INTO bagel_day(date,status,total,source_id) VALUES (?, 'recorded', ?, ?)", d, total, 'WB:2026 Bagels Daily');
      for (const [fl, u] of Object.entries(f)) run(db, 'INSERT INTO bagel_daily(date,flavor,units,source_id) VALUES (?,?,?,?)', d, fl, u, `WB:${d < '2026-01-01' ? '2025' : '2026'} Bagels Daily`);
    } else {
      run(db, "INSERT INTO bagel_day(date,status,total,source_id,note) VALUES (?, ?, NULL, ?, ?)", d, noRecords.has(d) ? 'no_records' : 'not_covered', 'WB:2026 Bagels Daily',
        noRecords.has(d) ? 'No named bagel entries in Toast; open/closed not confirmed' : 'No row in source');
    }
  }
  console.log(`bagel days: ${perDay.size} recorded rows from ${rowsSeen} sheet rows; ${noRecords.size} no-record days`);

  // ── Monthly items & modifiers ────────────────────────────────────────────
  run(db, 'DELETE FROM item_monthly'); run(db, 'DELETE FROM modifier_monthly');
  for (const y of ['2025', '2026']) {
    const it = table(sheetRows(wb, `${y} Item Totals`), 'Report month');
    const s1 = src(`${y} Item Totals`, `Monthly nonvoid item quantities ${y}`, `${y}-01-01`, y === '2026' ? '2026-11-16' : '2025-12-31', it.length, y === '2026' ? 'November 2026 covers Nov 1–16 only.' : '');
    for (const r of it) {
      const m = isoDate(r['Report month'])?.slice(0, 7);
      const item = str(r['Menu item']);
      if (!m || !item) continue;
      run(db, 'INSERT INTO item_monthly(month,item,menu_group,qty,net,partial_note,source_id) VALUES (?,?,?,?,?,?,?)',
        m, item, str(r['Menu group']), num(r['Quantity']) ?? 0, num(r['Net price']), m === '2026-11' ? 'Nov 1–16 only' : null, s1);
    }
    const mo = table(sheetRows(wb, `${y} Modifier Totals`), 'Report month');
    const s2 = src(`${y} Modifier Totals`, `Monthly nonvoid modifier quantities ${y}`, `${y}-01-01`, y === '2026' ? '2026-11-30' : '2025-12-31', mo.length, y === '2026' ? 'November 2026 range differs from items (Nov 1–30).' : '');
    for (const r of mo) {
      const m = isoDate(r['Report month'])?.slice(0, 7);
      const mod = str(r['Modifier']);
      if (!m || !mod) continue;
      run(db, 'INSERT INTO modifier_monthly(month,option_group,parent,modifier,qty,net,source_id) VALUES (?,?,?,?,?,?,?)',
        m, str(r['Option group']), str(r['Parent selection']), mod, num(r['Quantity']) ?? 0, num(r['Net price']), s2);
    }
  }

  // ── Daily items (Nov 2025, sent date) ────────────────────────────────────
  run(db, 'DELETE FROM item_daily');
  const nd = table(sheetRows(wb, 'Item Detail Nov25'), 'Source ID');
  const s3 = src('Item Detail Nov25', 'Daily nonvoid item quantities by sent date, Nov 1–Dec 1 2025 (S024)', '2025-10-31', '2025-12-01', nd.length);
  for (const r of nd) {
    const d = isoDate(r['Sent date']); const item = str(r['Item']);
    if (!d || !item) continue;
    run(db, `INSERT INTO item_daily(date,item,menu_group,qty,net,source_id) VALUES (?,?,?,?,?,?)
             ON CONFLICT(date,item,source_id) DO UPDATE SET qty=qty+excluded.qty, net=coalesce(net,0)+coalesce(excluded.net,0)`,
      d, item, str(r['Menu group']), num(r['Nonvoid quantity']) ?? 0, num(r['Net price sum']), s3);
  }

  // ── Reference: flavors, menu items ───────────────────────────────────────
  for (const f of CANONICAL_FLAVORS) {
    const m = FLAVOR_META[f];
    run(db, `INSERT INTO flavors(name,name_es,short,gluten_free,seasonal,active,sort) VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(name) DO UPDATE SET name_es=excluded.name_es, short=excluded.short, sort=excluded.sort`,
      f, m.es, m.short, m.gf ? 1 : 0, m.seasonal ? 1 : 0, m.seasonal ? 0 : 1, m.sort);
  }
  // Bagel-carrying items = any parent with Bagel Choices flavor modifiers, plus packs.
  const parents = all<{ parent: string }>(db, `SELECT DISTINCT parent FROM modifier_monthly WHERE option_group='Bagel Choices' AND parent IS NOT NULL`);
  const items = all<{ item: string; menu_group: string | null }>(db, 'SELECT DISTINCT item, menu_group FROM item_monthly');
  const groupOf = new Map(items.map((i) => [i.item, i.menu_group]));
  for (const { item, menu_group } of items) {
    const per = bagelsPerItem(item, menu_group);
    const kind = /^Single Bagel$/.test(item) ? 'single' : per === 12 ? 'dozen' : per === 6 ? 'half_dozen'
      : canonicalFlavor(item) && per === 1 ? 'named_bagel' : menu_group === 'Sandwiches' ? 'sandwich'
      : (menu_group === 'Spreads' || menu_group === 'Cream Cheese') ? 'spread_retail' : 'other';
    run(db, `INSERT INTO menu_items(name,kind,bagels_per_unit) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, bagels_per_unit=excluded.bagels_per_unit`, item, kind, per);
  }
  for (const { parent } of parents) {
    if (!groupOf.has(parent)) {
      run(db, `INSERT INTO menu_items(name,kind,bagels_per_unit,display_name) VALUES (?,?,1,?) ON CONFLICT(name) DO NOTHING`, parent, 'sandwich', parent);
    } else if (!['Single Bagel', 'Bagel w/ Cream Cheese', 'Bagel w/ Butter'].includes(parent)) {
      run(db, `UPDATE menu_items SET kind='sandwich', bagels_per_unit=1 WHERE name=? AND kind='other'`, parent);
    }
  }
  // Known rename (Import Review): Toast item rows use Chicken Caesar / Crispy Chicken Sandwich; modifiers use Southwest Chorizo.
  for (const n of ['Chicken Caesar Sandwich', 'Crispy Chicken Sandwich']) run(db, `UPDATE menu_items SET kind='sandwich', bagels_per_unit=1 WHERE name=?`, n);

  // ── Recipes ──────────────────────────────────────────────────────────────
  const rpath = join(SEED_DIR, 'recipes.json');
  if (existsSync(rpath)) {
    const { recipes } = JSON.parse(readFileSync(rpath, 'utf8'));
    for (const r of recipes) {
      run(db, `INSERT OR REPLACE INTO recipes(id,name,name_es,kind,headline,headline_es,status,status_note,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        r.id, r.name, r.name_es, r.kind, r.headline, r.headline_es, r.status ?? 'source', r.status_note ?? null, 'B’s Bagels build cards (PDF), transcribed', new Date().toISOString());
      run(db, 'DELETE FROM recipe_steps WHERE recipe_id=?', r.id);
      r.steps.forEach((s: string[], i: number) => run(db, `INSERT INTO recipe_steps(recipe_id,n,title,title_es,amount,amount_es,body,body_es) VALUES (?,?,?,?,?,?,?,?)`,
        r.id, i + 1, s[0], s[1], s[2] || null, s[3] || null, s[4], s[5]));
      run(db, 'DELETE FROM recipe_components WHERE recipe_id=?', r.id);
      for (const [c, q] of Object.entries(r.components as Record<string, number | null>)) {
        const unit = c.endsWith('_oz') ? 'oz' : c.endsWith('_slice') ? 'slice' : c.endsWith('_strip') ? 'strip' : c.endsWith('_half') ? 'half' : 'each';
        run(db, `INSERT INTO recipe_components(recipe_id,component,qty,unit,assumption_key) VALUES (?,?,?,?,?)`, r.id, c, q, unit, r.component_assumptions?.[c] ?? null);
      }
      for (const t of r.toast_items) run(db, `UPDATE menu_items SET recipe_id=? WHERE name=?`, r.id, t);
    }
    console.log(`recipes: ${recipes.length}`);
  } else console.warn('No recipes.json in seed dir — build-card library will be empty.');

  // ── Assumptions (keep any user edits) ────────────────────────────────────
  for (const a of DEFAULT_ASSUMPTIONS) {
    run(db, `INSERT INTO assumptions(key,value,unit,label,label_es,category,status,basis,owner,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(key) DO UPDATE SET label=excluded.label, label_es=excluded.label_es, unit=excluded.unit, category=excluded.category, basis=CASE WHEN assumptions.updated_by='seed' THEN excluded.basis ELSE assumptions.basis END`,
      a.key, a.value, a.unit, a.label, a.label_es, a.category, a.status, a.basis, 'BOH manager', new Date().toISOString(), 'seed');
  }

  // ── Checklists ───────────────────────────────────────────────────────────
  const cpath = join(SEED_DIR, 'checklists.json');
  if (existsSync(cpath)) {
    for (const c of JSON.parse(readFileSync(cpath, 'utf8')).checklists) {
      run(db, `INSERT INTO checklists(id,name,name_es,status,items_json,updated_at,updated_by) VALUES (?,?,?,'draft',?,?,'seed') ON CONFLICT(id) DO NOTHING`,
        c.id, c.name, c.name_es, JSON.stringify(c.items), new Date().toISOString());
    }
  }
  run(db, `INSERT OR REPLACE INTO meta(key,value) VALUES ('seeded_at',?),('workbook_sha256',?),('history_end_bagels',?),('history_end_sales',?)`,
    new Date().toISOString(), sha256, END, one<{ d: string }>(db, "SELECT max(date) d FROM daily_sales WHERE status='actual'")!.d);
});

// ── Accounts: never hard-coded. Owner from env or generated once. ─────────
const credFile = join(DATA_DIR, 'initial-credentials.txt');
const ensureUser = (username: string, display: string, role: string, secret: string, lang = 'en', station: string | null = null) => {
  if (one(db, 'SELECT 1 FROM users WHERE username=?', username)) return false;
  run(db, 'INSERT INTO users(username,display_name,role,secret_hash,lang,station) VALUES (?,?,?,?,?,?)', username, display, role, hashSecret(secret), lang, station);
  appendFileSync(credFile, `${role.padEnd(8)} ${username.padEnd(10)} ${secret}\n`, { mode: 0o600 });
  return true;
};
if (!existsSync(credFile)) writeFileSync(credFile, '# Initial credentials — change them after first sign-in, then delete this file.\n', { mode: 0o600 });
const ownerPw = process.env.BSB_OWNER_PASSWORD ?? randomPassword();
if (ensureUser(process.env.BSB_OWNER_USERNAME ?? 'owner', 'Owner', 'owner', ownerPw)) console.log(`Owner account created — see ${credFile}`);
if (args.includes('--demo')) {
  ensureUser('manager', 'BOH Manager', 'manager', randomPassword());
  ensureUser('lead', 'Shift Lead', 'lead', randomPin(), 'en', 'prep');
  ensureUser('maria', 'María (crew)', 'crew', randomPin(), 'es', 'oven');
  ensureUser('sam', 'Sam (crew)', 'crew', randomPin(), 'en', 'line');
  console.log(`Demo accounts ensured — see ${credFile}`);
}

const c = one<{ s: number; b: number; i: number; m: number; d: number }>(db, `SELECT (SELECT count(*) FROM daily_sales) s,(SELECT count(*) FROM bagel_day WHERE status='recorded') b,
  (SELECT count(*) FROM item_monthly) i,(SELECT count(*) FROM modifier_monthly) m,(SELECT count(*) FROM item_daily) d`)!;
console.log(`daily_sales ${c.s} · bagel days ${c.b} · item_monthly ${c.i} · modifier_monthly ${c.m} · item_daily ${c.d}\nDatabase: ${DB_PATH}`);
db.close();

/**
 * Assistant tools. Each is read-only, deterministic, and declares the minimum role allowed to call it.
 * Results carry `sources` so every number in an answer can be traced to records.
 */
import type { DB } from '../db.ts';
import { all, one } from '../db.ts';
import { atLeast, type Role } from '../auth.ts';
import { buildPlan } from '../domain/plan.ts';
import { dateRange, dow, DOW_NAMES, addDays } from '../domain/calendar.ts';
import { loadSeries } from '../domain/history.ts';
import { walkForward, scoreTable } from '../domain/backtest.ts';
import { loadAssumptions } from '../domain/assumptions.ts';

export interface ToolResult { data: unknown; sources: string[] }
interface ToolDef {
  name: string; minRole: Role; description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  run: (db: DB, input: Record<string, unknown>, role: Role) => ToolResult;
}

const D = { type: 'string', description: 'ISO date YYYY-MM-DD', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const iso = (v: unknown, name: string) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} must be YYYY-MM-DD`); return v; };
const clampRange = (from: string, to: string) => { if (to < from) throw new Error('to must be on or after from'); if (dateRange(from, to).length > 800) throw new Error('Range too long (max 800 days)'); };

/** Safe arithmetic: numbers, + - * / ^ %, parentheses, unary minus. No identifiers. */
export function evaluate(expr: string): number {
  const s = expr.replace(/\s+/g, '').replace(/,/g, '');
  if (!/^[0-9.+\-*/()^%]+$/.test(s) || s.length > 300) throw new Error('Only numbers and + - * / ^ % ( ) are allowed');
  let i = 0;
  const peek = () => s[i];
  const num = (): number => {
    if (peek() === '(') { i++; const v = add(); if (s[i++] !== ')') throw new Error('Missing )'); return v; }
    if (peek() === '-') { i++; return -num(); }
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) throw new Error('Bad number'); i += m[0].length;
    let v = parseFloat(m[0]); if (peek() === '%') { i++; v /= 100; } return v;
  };
  const pow = (): number => { const b = num(); if (peek() === '^') { i++; return b ** pow(); } return b; };
  const mul = (): number => { let v = pow(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
  const add = (): number => { let v = mul(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  const v = add(); if (i !== s.length) throw new Error('Unexpected input'); if (!Number.isFinite(v)) throw new Error('Result is not finite'); return v;
}

function bagelRows(db: DB, from: string, to: string, flavor?: string) {
  const days = all<{ date: string; status: string; total: number | null }>(db, 'SELECT date,status,total FROM bagel_day WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
  const fl = flavor ? new Map(all<{ date: string; units: number }>(db, 'SELECT date,units FROM bagel_daily WHERE flavor=? AND date BETWEEN ? AND ?', flavor, from, to).map((r) => [r.date, r.units])) : null;
  return days.map((d) => ({ date: d.date, weekday: DOW_NAMES[dow(d.date)], status: d.status, units: d.status !== 'recorded' ? null : fl ? (fl.get(d.date) ?? 0) : d.total }));
}

function summarize(rows: { units: number | null; status: string }[], requested: number) {
  const rec = rows.filter((r) => r.units !== null);
  const total = rec.reduce((a, r) => a + (r.units as number), 0);
  return { total, recordedDays: rec.length, requestedDays: requested, missingDays: requested - rec.length, dailyAverage: rec.length ? total / rec.length : null };
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_day_plan', minRole: 'crew',
    description: 'The production plan for one business date: bagels to bake by flavor, freezer pull for the next open day, expected sandwiches by item, bacon/sausage/eggs, other prep, cream cheese to make and 8 oz tubs to pack, alerts, and the reasoning behind each number. Every figure has kind = verified | forecast | assumption | missing.',
    input_schema: { type: 'object', properties: { date: D, section: { type: 'string', enum: ['all', 'bagels', 'pull', 'sandwiches', 'proteins', 'cream_cheese', 'other', 'alerts', 'tickets'] } }, required: ['date'], additionalProperties: false },
    run: (db, i) => {
      const p = buildPlan(db, iso(i.date, 'date'));
      const sec = (i.section as string) ?? 'all';
      const pick: Record<string, unknown> = {
        bagels: { total: p.bagels.total, bake: p.bagels.bake, cateringBagels: p.bagels.cateringBagels }, pull: p.pull,
        sandwiches: p.sandwiches, proteins: p.proteins, cream_cheese: p.cream, other: p.other, alerts: p.alerts, tickets: p.tickets.map((t) => ({ key: t.key, due: t.due, title: t.title, qty: t.adjusted?.qty ?? t.qty, unit: t.unit, status: t.status })),
      };
      const data = sec === 'all' ? { date: p.date, weekday: p.weekday, holiday: p.holiday, closedLikely: p.closedLikely, historyEnd: p.historyEnd, horizonDays: p.horizonDays, ...pick, outlook: p.outlook, assumptionsUsed: p.assumptionsUsed.map((a) => a.label) } : { date: p.date, weekday: p.weekday, [sec]: pick[sec] };
      return { data, sources: [`plan:${p.date} (model ${p.model}, history through ${p.historyEnd}, profile ${p.profileMonths.join('/')})`] };
    },
  },
  {
    name: 'get_bagel_history', minRole: 'crew',
    description: 'Verified physical bagels sold (Toast named-flavor units by sent date) between two dates, optionally for one flavor, grouped by day, week, month or weekday. Days without records are returned as missing (units null), never zero.',
    input_schema: { type: 'object', properties: { from: D, to: D, flavor: { type: 'string', description: 'Canonical flavor, e.g. Plain, Everything, Cinnamon Raisin, GF Plain' }, group_by: { type: 'string', enum: ['day', 'week', 'month', 'weekday'] } }, required: ['from', 'to'], additionalProperties: false },
    run: (db, i) => {
      const from = iso(i.from, 'from'), to = iso(i.to, 'to'); clampRange(from, to);
      const rows = bagelRows(db, from, to, i.flavor as string | undefined);
      const g = (i.group_by as string) ?? 'day';
      const requested = dateRange(from, to).length;
      let grouped: unknown = rows;
      if (g !== 'day') {
        const key = (d: string) => g === 'month' ? d.slice(0, 7) : g === 'weekday' ? DOW_NAMES[dow(d)] : addDays(d, -dow(d));
        const m = new Map<string, typeof rows>();
        for (const r of rows) { const k = key(r.date); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
        grouped = [...m].map(([k, rs]) => ({ [g]: k, ...summarize(rs, rs.length) }));
      }
      return { data: { from, to, flavor: i.flavor ?? 'all flavors', basis: 'Toast sent date; catering bundles excluded', summary: summarize(rows, requested), rows: grouped, outsideCoverage: requested - rows.length }, sources: [`bagel_day/bagel_daily ${from}..${to}`] };
    },
  },
  {
    name: 'compare_periods', minRole: 'crew',
    description: 'Compare two date ranges on bagels (any role) or net_sales / orders (manager+). Returns totals, recorded-day counts, daily averages over recorded days only, and percent change of the daily average. Use for "this week vs last year" style questions.',
    input_schema: { type: 'object', properties: { metric: { type: 'string', enum: ['bagels', 'net_sales', 'orders'] }, flavor: { type: 'string' }, a_from: D, a_to: D, b_from: D, b_to: D }, required: ['metric', 'a_from', 'a_to', 'b_from', 'b_to'], additionalProperties: false },
    run: (db, i, role) => {
      const metric = i.metric as string;
      if (metric !== 'bagels' && !atLeast(role, 'manager')) throw new Error('PERMISSION: sales and order figures require the manager role');
      const per = (from: string, to: string) => {
        clampRange(from, to);
        const n = dateRange(from, to).length;
        if (metric === 'bagels') return summarize(bagelRows(db, from, to, i.flavor as string | undefined), n);
        const col = metric === 'net_sales' ? 'net_sales' : 'orders';
        const rows = all<{ v: number | null; status: string }>(db, `SELECT ${col} v, status FROM daily_sales WHERE date BETWEEN ? AND ?`, from, to);
        return summarize(rows.map((r) => ({ units: r.status === 'actual' ? r.v : null, status: r.status })), n);
      };
      const a = per(iso(i.a_from, 'a_from'), iso(i.a_to, 'a_to')), b = per(iso(i.b_from, 'b_from'), iso(i.b_to, 'b_to'));
      const chg = a.dailyAverage !== null && b.dailyAverage ? (a.dailyAverage - b.dailyAverage) / b.dailyAverage : null;
      return { data: { metric, flavor: i.flavor ?? null, a: { from: i.a_from, to: i.a_to, ...a }, b: { from: i.b_from, to: i.b_to, ...b }, dailyAverageChange: chg, note: 'Averages use recorded days only; missing days are excluded, not counted as zero.' },
        sources: [metric === 'bagels' ? 'bagel_day/bagel_daily' : 'daily_sales', `${i.a_from}..${i.a_to}`, `${i.b_from}..${i.b_to}`] };
    },
  },
  {
    name: 'get_item_sales', minRole: 'lead',
    description: 'Verified Toast quantities for menu items (sandwiches, packs, spreads, drinks). Monthly totals for any month; daily only where daily item data exists (Nov 2025 and new imports). Net dollars only for manager+.',
    input_schema: { type: 'object', properties: { item: { type: 'string', description: 'Exact or partial item name; omit for top items' }, from_month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, to_month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, daily: { type: 'boolean' } }, required: ['from_month', 'to_month'], additionalProperties: false },
    run: (db, i, role) => {
      const like = `%${(i.item as string) ?? ''}%`;
      const money = atLeast(role, 'manager');
      if (i.daily) {
        const rows = all(db, `SELECT date,item,menu_group,qty${money ? ',net' : ''} FROM item_daily WHERE item LIKE ? AND substr(date,1,7) BETWEEN ? AND ? ORDER BY date, qty DESC LIMIT 400`, like, i.from_month, i.to_month);
        return { data: { rows, note: rows.length ? 'Daily item data (sent date).' : 'No daily item data in this range — only monthly totals exist.' }, sources: ['item_daily'] };
      }
      const rows = all(db, `SELECT month,item,menu_group,sum(qty) qty${money ? ',round(sum(net),2) net' : ''},max(partial_note) partial FROM item_monthly WHERE item LIKE ? AND month BETWEEN ? AND ? GROUP BY month,item ORDER BY month, qty DESC LIMIT 400`, like, i.from_month, i.to_month);
      return { data: { rows, note: 'Monthly nonvoid quantities. "partial" marks months with incomplete report ranges.' }, sources: ['item_monthly'] };
    },
  },
  {
    name: 'get_sales', minRole: 'manager',
    description: 'Verified daily net sales, orders and guests from Toast between two dates, with status per day (actual / not_supplied / blank_in_source).',
    input_schema: { type: 'object', properties: { from: D, to: D }, required: ['from', 'to'], additionalProperties: false },
    run: (db, i) => {
      const from = iso(i.from, 'from'), to = iso(i.to, 'to'); clampRange(from, to);
      const rows = all<{ date: string; net_sales: number | null; orders: number | null; status: string }>(db, 'SELECT date,net_sales,orders,guests,status FROM daily_sales WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
      const act = rows.filter((r) => r.status === 'actual');
      return { data: { rows, totals: { net_sales: act.reduce((a, r) => a + (r.net_sales ?? 0), 0), orders: act.reduce((a, r) => a + (r.orders ?? 0), 0), actualDays: act.length, missingDays: dateRange(from, to).length - act.length } }, sources: [`daily_sales ${from}..${to}`] };
    },
  },
  {
    name: 'get_forecast_accuracy', minRole: 'manager',
    description: 'Walk-forward accuracy of the daily bagel forecast (WAPE) over a date range, next to two baselines (mean of last 8 same weekdays; same day last week), plus saved forecast snapshots vs actuals.',
    input_schema: { type: 'object', properties: { from: D, to: D }, required: ['from', 'to'], additionalProperties: false },
    run: (db, i) => {
      const from = iso(i.from, 'from'), to = iso(i.to, 'to'); clampRange(from, to);
      const rows = walkForward(loadSeries(db), from, to);
      const snaps = all(db, `SELECT s.target_date, s.made_on, s.total_point, s.total_lo, s.total_hi, d.total actual FROM forecast_snapshots s LEFT JOIN bagel_day d ON d.date=s.target_date AND d.status='recorded' WHERE s.target_date BETWEEN ? AND ? ORDER BY s.target_date`, from, to);
      return { data: { days: rows.length, scores: scoreTable(rows), snapshots: snaps }, sources: ['walk-forward backtest over bagel_day', 'forecast_snapshots'] };
    },
  },
  {
    name: 'get_recipe', minRole: 'crew',
    description: "B's build card for a sandwich or method (English and B's Spanish): steps, portions, and any confirmation notes.",
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    run: (db, i) => {
      const q = `%${String(i.name).replace(/[%_]/g, '')}%`;
      const r = one<{ id: string }>(db, `SELECT r.id FROM recipes r LEFT JOIN menu_items m ON m.recipe_id=r.id WHERE r.name LIKE ? OR r.name_es LIKE ? OR m.name LIKE ? OR r.id LIKE ? LIMIT 1`, q, q, q, q);
      if (!r) return { data: { found: false, available: all(db, 'SELECT name FROM recipes') }, sources: ['recipes'] };
      return { data: { recipe: one(db, 'SELECT * FROM recipes WHERE id=?', r.id), steps: all(db, 'SELECT * FROM recipe_steps WHERE recipe_id=? ORDER BY n', r.id), components: all(db, 'SELECT * FROM recipe_components WHERE recipe_id=?', r.id) }, sources: [`recipe:${r.id} (build card PDF)`] };
    },
  },
  {
    name: 'get_assumptions', minRole: 'crew',
    description: 'The register of planning assumptions and confirmed facts (portions, tray sizes, buffers, model settings) with status and basis.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: (db) => ({ data: all(db, 'SELECT key,label,value,unit,status,basis,updated_by,updated_at FROM assumptions ORDER BY category,key'), sources: ['assumptions'] }),
  },
  {
    name: 'get_inventory', minRole: 'crew',
    description: 'Latest recorded inventory counts (thawed/frozen bagels by flavor, cream cheese bulk and tubs, cooked proteins) with when they were counted. Items never counted are absent — unknown, not zero.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: (db) => ({ data: all(db, `SELECT i.item,i.state,i.qty,i.unit,i.counted_at,i.business_date FROM inventory_counts i JOIN (SELECT item,state,max(counted_at) m FROM inventory_counts GROUP BY item,state) x ON x.item=i.item AND x.state=i.state AND x.m=i.counted_at ORDER BY i.item`), sources: ['inventory_counts'] }),
  },
  {
    name: 'get_handoffs', minRole: 'crew',
    description: 'Shift handoff notes and completed/skipped prep tickets for a date.',
    input_schema: { type: 'object', properties: { date: D }, required: ['date'], additionalProperties: false },
    run: (db, i) => {
      const d = iso(i.date, 'date');
      return { data: { handoffs: all(db, 'SELECT h.shift,h.note,h.at,u.display_name author FROM handoffs h LEFT JOIN users u ON u.id=h.user_id WHERE date=? ORDER BY at', d), tickets: all(db, 'SELECT t.ticket_key,t.status,t.qty_done,t.at,u.display_name who FROM ticket_status t LEFT JOIN users u ON u.id=t.user_id WHERE date=? ORDER BY at', d), waste: all(db, 'SELECT item,qty,unit,reason FROM waste_log WHERE date=?', d) }, sources: [`handoffs/ticket_status/waste_log ${d}`] };
    },
  },
  {
    name: 'get_data_coverage', minRole: 'crew',
    description: 'What history exists: date ranges of bagel and sales data, missing dates, latest import, and known data limitations.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: (db) => ({
      data: {
        bagels: one(db, "SELECT min(date) first, max(date) last, sum(status='recorded') recorded, sum(status='no_records') no_records FROM bagel_day"),
        bagelGaps: all(db, "SELECT date,status,note FROM bagel_day WHERE status!='recorded' ORDER BY date"),
        sales: one(db, "SELECT min(date) first, max(CASE WHEN status='actual' THEN date END) last_actual, sum(status='actual') actual_days FROM daily_sales"),
        dailyItems: one(db, 'SELECT min(date) first, max(date) last, count(DISTINCT date) days FROM item_daily'),
        latestImports: all(db, 'SELECT id,kind,filename,period_start,period_end,imported_at FROM sources ORDER BY imported_at DESC LIMIT 5'),
        limitations: ['Bagel dates are Toast sent dates, not pickup dates.', 'Catering bundle bagels are excluded from bagel history; booked catering is added to plans separately.', 'Daily sandwich detail exists only for Nov 2025 plus new imports.', 'No live inventory is known unless counted in the app.'],
      }, sources: ['bagel_day', 'daily_sales', 'item_daily', 'sources'],
    }),
  },
  {
    name: 'calculate', minRole: 'crew',
    description: 'Exact arithmetic on numbers taken from other tool results. Use for every sum, ratio, percentage or unit conversion instead of mental math.',
    input_schema: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. (531*1.11*1.037)/16' } }, required: ['expression'], additionalProperties: false },
    run: (_db, i) => ({ data: { expression: i.expression, result: evaluate(String(i.expression)) }, sources: ['calculator'] }),
  },
];

export function toolsFor(role: Role) { return TOOLS.filter((t) => atLeast(role, t.minRole)); }

export function runTool(db: DB, name: string, input: Record<string, unknown>, role: Role): ToolResult {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  if (!atLeast(role, t.minRole)) throw new Error(`PERMISSION: ${name} requires the ${t.minRole} role`);
  return t.run(db, input, role);
}

export function assumptionsSnapshot(db: DB) { return loadAssumptions(db); }

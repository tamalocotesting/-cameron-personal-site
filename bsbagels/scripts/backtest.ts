/** npm run backtest [-- --from 2026-08-01 --to 2026-10-31 --csv out.csv] */
import { writeFileSync } from 'node:fs';
import { openDb } from '../server/db.ts';
import { loadSeries } from '../server/domain/history.ts';
import { walkForward, scoreTable, byWeekday, bias } from '../server/domain/backtest.ts';
import { DOW_NAMES } from '../server/domain/calendar.ts';

const a = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const from = opt('--from', '2026-08-01'), to = opt('--to', '2026-10-31');
const db = openDb();
const s = loadSeries(db);
const rows = walkForward(s, from, to);
const pct = (x: number) => (x * 100).toFixed(1) + '%';
console.log(`Walk-forward ${from} → ${to}: ${rows.length} days with recorded actuals`);
console.log('segment    model    avg-8-same-weekday   same-day-last-week   (n)');
for (const r of scoreTable(rows)) console.log(`${r.segment.padEnd(10)} ${pct(r.model.wape).padEnd(8)} ${pct(r.avg8.wape).padEnd(20)} ${pct(r.lastWeek.wape).padEnd(20)} ${r.model.n}`);
for (const w of byWeekday(rows)) console.log(`  ${DOW_NAMES[w.dow].padEnd(10)} model ${pct(w.model.wape)}  avg8 ${pct(w.avg8.wape)}`);
console.log('bias (model − actual) / actual:', pct(bias(rows)));
const csv = opt('--csv', '');
if (csv) writeFileSync(csv, 'date,actual,model,avg8,last_week\n' + rows.map((r) => [r.date, r.actual, r.model.toFixed(1), r.avg8.toFixed(1), r.lastWeek].join(',')).join('\n'));

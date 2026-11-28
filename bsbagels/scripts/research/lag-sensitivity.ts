import { openDb } from '../../server/db.ts';
import { loadSeries } from '../../server/domain/history.ts';
import { forecastTotal, flavorShares, DEFAULT_PARAMS, type Series } from '../../server/domain/forecast.ts';
import { addDays, dow, dateRange } from '../../server/domain/calendar.ts';
const s = loadSeries(openDb());
const FL = ['Plain','Everything','GF Plain','GF Everything','Whole Wheat','Whole Wheat Everything','Sesame','Cinnamon Raisin','Poppy','Rainbow','Onion','Pumpernickel','Blueberry'];
const last = '2026-10-31', first = addDays(last, -195), hold = addDays(last, -55);
const truncate = (cut: string): Series => ({ total: new Map([...s.total].filter(([d]) => d <= cut)), flavors: s.flavors, first: s.first, last: cut });
function twelveWeek(t: string, cut: string) { // their method: mean of same weekday in (cut-83 .. cut], missing days excluded
  const out: Record<string, number> = {}; const days = dateRange(addDays(cut, -83), cut).filter((d) => dow(d) === dow(t) && s.flavors.has(d));
  for (const f of FL) out[f] = days.reduce((a, d) => a + (s.flavors.get(d)![f] ?? 0), 0) / days.length; return out; }
function rail(t: string, cut: string, lag = true) { const ts = truncate(cut); const fc = forecastTotal(ts, t, addDays(cut, 1)); const sh = flavorShares(ts, fc.baseDays); const out: Record<string, number> = {}; for (const f of FL) out[f] = (sh[f] ?? 0) * fc.point; return out; }
type Acc = { fe: number; te: number; act: number; n: number };
const res: Record<string, { sel: Acc; hold: Acc }> = {};
for (const name of ['12-week same weekday (prior system)', 'Rail v1.1']) res[name] = { sel: { fe: 0, te: 0, act: 0, n: 0 }, hold: { fe: 0, te: 0, act: 0, n: 0 } };
for (let w = 0; w < 28; w++) {
  const start = addDays(first, 7 * w);
  for (let k = 0; k < 7; k++) {
    const t = addDays(start, k); const cut = addDays(t, -(+process.env.LAG!)); const a = s.flavors.get(t); if (!a) continue;
    for (const [name, fn] of [['12-week same weekday (prior system)', twelveWeek], ['Rail v1.1', rail]] as const) {
      const p = fn(t, cut); const acc = t >= hold ? res[name].hold : res[name].sel;
      let tot = 0, ptot = 0; for (const f of FL) { acc.fe += Math.abs((a[f] ?? 0) - p[f]); tot += a[f] ?? 0; ptot += p[f]; }
      acc.te += Math.abs(tot - ptot); acc.act += tot; acc.n++;
    }
  }
}
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(38), 'selection flavor', (v.sel.fe / v.sel.act * 100).toFixed(1) + '%', 'total', (v.sel.te / v.sel.act * 100).toFixed(1) + '%', '| HOLDOUT flavor', (v.hold.fe / v.hold.act * 100).toFixed(1) + '%', 'total', (v.hold.te / v.hold.act * 100).toFixed(1) + '%', 'n', v.hold.n);

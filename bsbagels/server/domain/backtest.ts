import { dateRange, isWeekend, dow } from './calendar.ts';
import { forecastTotal, baselineAvg8, baselineLastWeek, DEFAULT_PARAMS, type Series, type ModelParams } from './forecast.ts';

export interface BacktestRow { date: string; actual: number; model: number; avg8: number; lastWeek: number }
export interface Score { wape: number; n: number; actualSum: number }

/**
 * Walk-forward: each day D is forecast with a series truncated to dates < D (the functions only read
 * dates before the origin, and we additionally pass origin = D). Days without a recorded actual are
 * skipped (missing ≠ zero).
 */
export function walkForward(s: Series, from: string, to: string, p: ModelParams = DEFAULT_PARAMS): BacktestRow[] {
  const out: BacktestRow[] = [];
  for (const d of dateRange(from, to)) {
    const actual = s.total.get(d);
    if (actual === undefined) continue;
    const truncated: Series = { ...s, total: new Map([...s.total].filter(([k]) => k < d)), flavors: s.flavors, last: d };
    out.push({ date: d, actual, model: forecastTotal(truncated, d, d, p).point, avg8: baselineAvg8(truncated, d), lastWeek: baselineLastWeek(truncated, d) });
  }
  return out;
}

export function wape(rows: BacktestRow[], key: 'model' | 'avg8' | 'lastWeek', filter: (r: BacktestRow) => boolean = () => true): Score {
  let err = 0, act = 0, n = 0;
  for (const r of rows) {
    if (!filter(r) || !Number.isFinite(r[key])) continue;
    err += Math.abs(r.actual - r[key]); act += r.actual; n++;
  }
  return { wape: act ? err / act : NaN, n, actualSum: act };
}

export function scoreTable(rows: BacktestRow[]) {
  const segs: [string, (r: BacktestRow) => boolean][] = [['all', () => true], ['weekdays', (r) => !isWeekend(r.date)], ['weekends', (r) => isWeekend(r.date)]];
  return segs.map(([name, f]) => ({ segment: name, model: wape(rows, 'model', f), avg8: wape(rows, 'avg8', f), lastWeek: wape(rows, 'lastWeek', f) }));
}

export function byWeekday(rows: BacktestRow[]) {
  return [0, 1, 2, 3, 4, 5, 6].map((w) => ({ dow: w, model: wape(rows, 'model', (r) => dow(r.date) === w), avg8: wape(rows, 'avg8', (r) => dow(r.date) === w) }));
}

export function bias(rows: BacktestRow[]) {
  const e = rows.reduce((a, r) => a + (r.model - r.actual), 0);
  const act = rows.reduce((a, r) => a + r.actual, 0);
  return e / act;
}

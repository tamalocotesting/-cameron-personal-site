/**
 * Daily bagel forecast — "trimmed weekday baseline × holiday lift × seasonal drift".
 *
 *   base     = mean of the last N (default 8) recorded, non-holiday same-weekday days, dropping the
 *              single highest and lowest (robust to one-off bulk orders)
 *   holiday  = geometric mean of (actual ÷ base) on prior occurrences of the same holiday,
 *              shrunk toward 1 by `holidayShrink` (default 0.8 keeps 80 % of the observed lift)
 *   season   = 1 + w·(LY level around target ÷ LY level around the baseline days − 1),  w = 0.5
 *   forecast = base × holiday × season
 *
 * Only data strictly before `origin` is used (walk-forward safe). Missing days are skipped, never 0.
 */
import { addDays, dow, isHoliday, holidayOn, priorOccurrences, isWeekend } from './calendar.ts';

export interface Series {
  /** date → total physical bagels (only recorded days present) */
  total: Map<string, number>;
  /** date → flavor → units */
  flavors: Map<string, Record<string, number>>;
  first: string;
  last: string;
}

export interface ModelParams { weeks: number; trim: number; holidayShrink: number; seasonWeight: number; seasonWindow: number }
export const DEFAULT_PARAMS: ModelParams = { weeks: 8, trim: 1, holidayShrink: 0.8, seasonWeight: 0.5, seasonWindow: 14 };
export const MODEL_ID = 'rail-v1.1';
const FIXED_DATE_HOLIDAYS = new Set(['new_years_day', 'valentines', 'st_patricks', 'july_4', 'halloween', 'christmas_eve', 'christmas', 'nye']);

export function makeSeries(rows: { date: string; flavor: string; units: number }[], recordedDays?: Set<string>): Series {
  const total = new Map<string, number>();
  const flavors = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (recordedDays && !recordedDays.has(r.date)) continue;
    total.set(r.date, (total.get(r.date) ?? 0) + r.units);
    const f = flavors.get(r.date) ?? {};
    f[r.flavor] = (f[r.flavor] ?? 0) + r.units;
    flavors.set(r.date, f);
  }
  const dates = [...total.keys()].sort();
  return { total, flavors, first: dates[0], last: dates[dates.length - 1] };
}

/** Last n recorded non-holiday days with the same weekday as `target`, strictly before `origin`. */
export function sameWeekdayHistory(s: Series, target: string, origin: string, n: number): string[] {
  const wd = dow(target);
  // start from the latest date < origin with matching weekday
  let d = addDays(origin, -1);
  while (dow(d) !== wd) d = addDays(d, -1);
  const out: string[] = [];
  for (let guard = 0; out.length < n && d >= s.first && guard < 200; guard++, d = addDays(d, -7)) {
    if (s.total.has(d) && !isHoliday(d)) out.push(d);
  }
  return out;
}

export function trimmedMean(xs: number[], k: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  if (a.length > 2 * k + 1) return a.slice(k, a.length - k).reduce((p, q) => p + q, 0) / (a.length - 2 * k);
  return a.reduce((p, q) => p + q, 0) / a.length;
}

export function baseline(s: Series, target: string, origin: string, p: ModelParams) {
  const days = sameWeekdayHistory(s, target, origin, p.weeks);
  return { value: trimmedMean(days.map((d) => s.total.get(d)!), p.trim), days };
}

function meanAround(s: Series, center: string, half: number, excludeHolidays = true): number {
  let sum = 0, n = 0;
  for (let k = -half; k <= half; k++) {
    const d = addDays(center, k);
    if (s.total.has(d) && !(excludeHolidays && isHoliday(d))) { sum += s.total.get(d)!; n++; }
  }
  return n ? sum / n : NaN;
}

/**
 * Seasonal drift compares SAME-WEEKDAY values only, so partial windows can't skew the weekday mix:
 *   last year's target weekday (±2 weeks)  ÷  last year's equivalents of the baseline days.
 * Requires ≥3 target values and ≥60% of baseline equivalents; otherwise no adjustment.
 */
export function seasonFactor(s: Series, target: string, baselineDays: string[], p: ModelParams) {
  if (!baselineDays.length || p.seasonWeight === 0) return { value: 1, ratio: null as number | null };
  const val = (d: string) => (s.total.has(d) && !isHoliday(d) ? s.total.get(d)! : null);
  const halfWeeks = Math.max(1, Math.round(p.seasonWindow / 7));
  const tv: number[] = [];
  for (let k = -halfWeeks; k <= halfWeeks; k++) { const v = val(addDays(target, -364 + 7 * k)); if (v !== null) tv.push(v); }
  const bv = baselineDays.map((d) => val(addDays(d, -364))).filter((v): v is number => v !== null);
  if (tv.length < 3 || bv.length < Math.ceil(0.6 * baselineDays.length)) return { value: 1, ratio: null };
  const lyTarget = tv.reduce((a, b) => a + b, 0) / tv.length;
  const lyBase = bv.reduce((a, b) => a + b, 0) / bv.length;
  if (lyBase <= 0) return { value: 1, ratio: null };
  const ratio = lyTarget / lyBase;
  return { value: 1 + p.seasonWeight * (ratio - 1), ratio };
}

export function holidayFactor(s: Series, target: string, p: ModelParams) {
  const h = holidayOn(target);
  if (!h) return { value: 1, holiday: null as string | null, observations: [] as { date: string; ratio: number }[] };
  const obs: { date: string; ratio: number }[] = [];
  // Fixed-date holidays move across weekdays and their effect depends on it (e.g. July 4 on a Friday
  // vs a Saturday). Learn only from prior occurrences in the same weekday class (weekday vs weekend).
  const fixedDate = FIXED_DATE_HOLIDAYS.has(h.key);
  for (const d of priorOccurrences(h.key, target)) {
    if (fixedDate && isWeekend(d) !== isWeekend(target)) continue;
    if (d >= s.first && s.total.has(d)) {
      const b = baseline(s, d, d, p).value;
      if (b > 0) obs.push({ date: d, ratio: s.total.get(d)! / b });
    }
  }
  if (!obs.length) return { value: 1, holiday: h.key, observations: obs };
  const g = Math.exp(obs.reduce((a, o) => a + Math.log(Math.max(o.ratio, 0.05)), 0) / obs.length);
  return { value: 1 + p.holidayShrink * (g - 1), holiday: h.key, observations: obs };
}

export interface DayForecast {
  target: string;
  origin: string;
  point: number;
  base: number;
  baseDays: string[];
  holiday: ReturnType<typeof holidayFactor>;
  season: ReturnType<typeof seasonFactor>;
}

/** Forecast total physical bagels (walk-in + online; excludes catering bundles) for `target`. */
export function forecastTotal(s: Series, target: string, origin: string = target, p: ModelParams = DEFAULT_PARAMS): DayForecast {
  const o = origin > addDays(s.last, 1) ? addDays(s.last, 1) : origin;
  const b = baseline(s, target, o, p);
  const h = holidayFactor(s, target, p);
  const se = seasonFactor(s, target, b.days, p);
  return { target, origin: o, point: b.value * h.value * se.value, base: b.value, baseDays: b.days, holiday: h, season: se };
}

/** Flavor shares from the same baseline days (so mix matches the weekday). */
export function flavorShares(s: Series, days: string[]): Record<string, number> {
  const acc: Record<string, number> = {};
  let tot = 0;
  for (const d of days) {
    const f = s.flavors.get(d);
    if (!f) continue;
    for (const [k, v] of Object.entries(f)) { acc[k] = (acc[k] ?? 0) + v; tot += v; }
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) if (v > 0) out[k] = v / tot;
  return out;
}

/** Largest-remainder rounding so the flavor counts add up exactly to `total`. */
export function allocate(total: number, shares: Record<string, number>): Record<string, number> {
  const t = Math.round(total);
  const keys = Object.keys(shares);
  const raw = keys.map((k) => ({ k, v: shares[k] * t }));
  const out: Record<string, number> = {};
  let used = 0;
  for (const r of raw) { out[r.k] = Math.floor(r.v); used += out[r.k]; }
  raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (let i = 0; used < t && i < raw.length; i++, used++) out[raw[i].k]++;
  return out;
}

/**
 * Empirical uncertainty: walk-forward ratio errors (actual ÷ forecast) over the `lookback` days before
 * origin, split weekday/weekend. Returns multiplicative P20 and P80 bands.
 */
export function errorBands(s: Series, origin: string, lookback = 91, p: ModelParams = DEFAULT_PARAMS) {
  const ratios: { we: number[]; wd: number[] } = { we: [], wd: [] };
  for (let k = lookback; k >= 1; k--) {
    const d = addDays(origin, -k);
    if (!s.total.has(d) || d > s.last) continue;
    const f = forecastTotal(s, d, d, p).point;
    if (!(f > 0)) continue;
    (isWeekend(d) ? ratios.we : ratios.wd).push(s.total.get(d)! / f);
  }
  const q = (xs: number[], p_: number) => {
    if (xs.length < 5) return NaN;
    const a = [...xs].sort((x, y) => x - y);
    const i = (a.length - 1) * p_;
    return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i - Math.floor(i));
  };
  return {
    weekday: { lo: q(ratios.wd, 0.2), hi: q(ratios.wd, 0.8), n: ratios.wd.length },
    weekend: { lo: q(ratios.we, 0.2), hi: q(ratios.we, 0.8), n: ratios.we.length },
  };
}

// ── Baselines for the scorecard ────────────────────────────────────────────
export function baselineAvg8(s: Series, target: string): number {
  const wd = dow(target);
  let d = addDays(target, -1);
  while (dow(d) !== wd) d = addDays(d, -1);
  const xs: number[] = [];
  for (let g = 0; xs.length < 8 && d >= s.first && g < 60; g++, d = addDays(d, -7)) if (s.total.has(d)) xs.push(s.total.get(d)!);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
export function baselineLastWeek(s: Series, target: string): number {
  const v = s.total.get(addDays(target, -7));
  return v === undefined ? NaN : v;
}

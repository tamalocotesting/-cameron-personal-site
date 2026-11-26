import type { DB } from '../db.ts';
import { all } from '../db.ts';
import { makeSeries, type Series } from './forecast.ts';

/** Load the verified daily bagel series. `asOf` (exclusive) hides later data — used for walk-forward. */
export function loadSeries(db: DB, asOf?: string): Series {
  const rows = all<{ date: string; flavor: string; units: number }>(db,
    `SELECT b.date, b.flavor, b.units FROM bagel_daily b JOIN bagel_day d ON d.date=b.date AND d.status='recorded'
     ${asOf ? 'WHERE b.date < ?' : ''} ORDER BY b.date`, ...(asOf ? [asOf] : []));
  return makeSeries(rows);
}

export function lastHistoryDate(db: DB): string {
  return (all<{ d: string }>(db, "SELECT max(date) d FROM bagel_day WHERE status='recorded'")[0]?.d) ?? '2026-10-31';
}

/**
 * Pilot metric: checklist completion rate.
 *
 *   completed required checklist runs ÷ expected checklist runs × 100
 *
 * "Completed" means submitted with every required task done. Runs submitted
 * with exceptions, runs never submitted and shifts with no run at all are not
 * completions. The expected count always comes from the manager; it is never
 * guessed from the data, so missing data can only lower the rate.
 */

export type RateResult =
  | { ok: true; rate: number; completed: number; expected: number; warning: string | null }
  | { ok: false; reason: string };

export function completionRate(completed: number | null, expected: number | null): RateResult {
  if (expected === null || !Number.isFinite(expected) || expected <= 0) {
    return { ok: false, reason: 'No expected count entered for this period.' };
  }
  if (completed === null || !Number.isFinite(completed) || completed < 0) {
    return { ok: false, reason: 'No completed count is available for this period.' };
  }
  const warning =
    completed > expected
      ? 'More completed checklists than expected. Check that the expected count matches the shift schedule.'
      : null;
  return { ok: true, rate: Math.round((completed / expected) * 1000) / 10, completed, expected, warning };
}

/** Difference in percentage points, or null when either side is unavailable. */
export function rateChange(baseline: RateResult, pilot: RateResult): number | null {
  if (!baseline.ok || !pilot.ok) return null;
  return Math.round((pilot.rate - baseline.rate) * 10) / 10;
}

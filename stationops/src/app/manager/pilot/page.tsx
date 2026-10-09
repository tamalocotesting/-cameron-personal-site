import { requireManager } from '@/lib/auth';
import { query } from '@/lib/db';
import { completionRate, rateChange, type RateResult } from '@/lib/metrics';
import { formatShiftDate } from '@/lib/time';
import { Badge, Card } from '@/components/ui';
import { PeriodForm } from './PeriodForm';
import { deletePeriodAction } from './actions';

export const metadata = { title: 'Pilot metric' };

type PeriodRow = {
  id: number;
  label: string;
  kind: 'baseline' | 'pilot';
  start_date: string;
  end_date: string;
  expected_runs: number;
  manual_completed_runs: number | null;
  notes: string | null;
  app_complete: number;
  app_exceptions: number;
  app_unsubmitted: number;
};

function RateValue({ r }: { r: RateResult }) {
  if (!r.ok) return <span className="text-sm text-muted">{r.reason}</span>;
  return (
    <span>
      <span className="text-2xl font-bold tabular-nums">{r.rate}%</span>
      <span className="ml-2 text-sm text-muted">
        {r.completed} of {r.expected}
      </span>
    </span>
  );
}

export default async function PilotPage() {
  const user = await requireManager();
  const periods = await query<PeriodRow>(
    `select p.id, p.label, p.kind, p.start_date, p.end_date, p.expected_runs, p.manual_completed_runs, p.notes,
            (select count(*)::int from checklist_runs r where r.restaurant_id = p.restaurant_id
               and r.shift_date between p.start_date and p.end_date and r.outcome = 'complete') as app_complete,
            (select count(*)::int from checklist_runs r where r.restaurant_id = p.restaurant_id
               and r.shift_date between p.start_date and p.end_date and r.outcome = 'exceptions') as app_exceptions,
            (select count(*)::int from checklist_runs r where r.restaurant_id = p.restaurant_id
               and r.shift_date between p.start_date and p.end_date and r.status = 'in_progress') as app_unsubmitted
       from measurement_periods p
      where p.restaurant_id = $1
      order by p.start_date`,
    [user.restaurantId],
  );

  const withRates = periods.map((p) => ({
    ...p,
    rate: completionRate(p.manual_completed_runs ?? p.app_complete, p.expected_runs),
  }));
  const baseline = [...withRates].reverse().find((p) => p.kind === 'baseline');
  const pilot = [...withRates].reverse().find((p) => p.kind === 'pilot');
  const change = baseline && pilot ? rateChange(baseline.rate, pilot.rate) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pilot metric: checklist completion rate</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Completion rate = fully completed checklists ÷ expected checklists × 100. A checklist counts as completed only when it was submitted with every
          required task done. Checklists submitted with exceptions, never submitted, or never started all count against the rate. The expected number
          must come from your shift schedule.
        </p>
      </div>

      {baseline && pilot && (
        <Card className="p-5">
          <h2 className="font-bold">Baseline vs. pilot</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{baseline.label}</p>
              <RateValue r={baseline.rate} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{pilot.label}</p>
              <RateValue r={pilot.rate} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Change</p>
              {change === null ? (
                <span className="text-sm text-muted">Not enough data to compare.</span>
              ) : (
                <span className="text-2xl font-bold tabular-nums">
                  {change > 0 ? '+' : ''}
                  {change} pts
                </span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            This compares two counts only. It does not account for staffing, season, or how carefully the baseline was recorded.
          </p>
        </Card>
      )}

      <Card>
        <h2 className="border-b border-line px-5 py-3 font-bold">Measurement periods</h2>
        {withRates.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">
            No periods yet. Add a baseline (for example, two weeks of paper checklists) and a pilot period to start measuring.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {withRates.map((p) => (
              <li key={p.id} className="grid gap-3 px-5 py-4 md:grid-cols-[2fr_1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{p.label}</p>
                    <Badge tone={p.kind === 'pilot' ? 'done' : 'neutral'}>{p.kind === 'pilot' ? 'Pilot' : 'Baseline'}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {formatShiftDate(p.start_date)} – {formatShiftDate(p.end_date)} · expected {p.expected_runs} ·{' '}
                    {p.manual_completed_runs !== null ? 'completed count entered manually' : 'completed count from StationOps'}
                  </p>
                  {p.manual_completed_runs === null && (
                    <p className="text-xs text-muted">
                      In StationOps: {p.app_complete} complete, {p.app_exceptions} with exceptions, {p.app_unsubmitted} never submitted,{' '}
                      {Math.max(0, p.expected_runs - p.app_complete - p.app_exceptions - p.app_unsubmitted)} expected with no record.
                    </p>
                  )}
                  {p.notes && <p className="mt-1 text-xs">{p.notes}</p>}
                  {p.rate.ok && p.rate.warning && <p className="mt-1 text-xs font-semibold text-warn">{p.rate.warning}</p>}
                </div>
                <RateValue r={p.rate} />
                <form action={deletePeriodAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-bold">Add a period</h2>
        <PeriodForm />
      </Card>
    </div>
  );
}

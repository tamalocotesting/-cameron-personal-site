import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getRunForStationDate, getRunItems, getStationTemplate } from '@/lib/checklists';
import { formatShiftDate, formatTime, localDate } from '@/lib/time';
import { computeProgress } from '@/lib/progress';
import { Card } from '@/components/ui';
import { ChecklistRunner } from './ChecklistRunner';

export const metadata = { title: 'Checklist' };

export default async function ChecklistPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const user = await requireUser();
  if (!user.stationId) redirect('/station');
  const today = localDate(user.timezone);
  const template = await getStationTemplate(user.stationId);
  const run = template ? await getRunForStationDate(user.stationId, template.shift_type, today) : null;
  if (!run) redirect('/station');

  const items = await getRunItems(run.id);
  const { submitted } = await searchParams;
  const progress = computeProgress(items);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/station" className="text-sm font-semibold text-navy-600">
          ← My station
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{run.checklist_name}</h1>
        <p className="mt-1 text-muted">
          {run.station_name} · {formatShiftDate(run.shift_date)}
        </p>
      </div>

      {run.status === 'submitted' && (
        <Card className="border-done/40 p-5" >
          <div role="status">
            <p className="text-lg font-bold text-done">{submitted ? 'Checklist submitted. Thank you!' : 'This checklist has been submitted.'}</p>
            <p className="mt-1 text-muted">
              Saved at {formatTime(run.submitted_at, user.timezone)} by {run.submitted_by_name}.{' '}
              {run.outcome === 'complete'
                ? 'Every required task was done.'
                : `Your manager will review the exceptions: ${progress.requiredOpen} required task${progress.requiredOpen === 1 ? '' : 's'} not done, ${progress.blocked} flagged.`}
            </p>
          </div>
        </Card>
      )}

      <ChecklistRunner
        runId={run.id}
        initialItems={items}
        timeZone={user.timezone}
        readOnly={run.status === 'submitted'}
      />
    </div>
  );
}

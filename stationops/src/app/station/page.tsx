import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getRunForStationDate, getRunItems, getStationTemplate } from '@/lib/checklists';
import { computeProgress, runState } from '@/lib/progress';
import { formatShiftDate, formatTime, localDate } from '@/lib/time';
import { Card, ProgressBar, RunStateBadge } from '@/components/ui';
import { StartButton } from './StartButton';

export const metadata = { title: 'My station' };

export default async function StationDashboard() {
  const user = await requireUser();
  const today = localDate(user.timezone);
  const firstName = user.displayName.split(' ')[0];

  if (!user.stationId) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-bold">Welcome, {firstName}</h1>
        <p className="mt-2 text-muted">You are not assigned to a station yet. Ask a manager to assign you one.</p>
      </Card>
    );
  }

  const template = await getStationTemplate(user.stationId);
  const run = template ? await getRunForStationDate(user.stationId, template.shift_type, today) : null;
  const items = run ? await getRunItems(run.id) : [];
  const progress = computeProgress(items);
  const state = runState(run);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome, {firstName}</h1>
        <p className="mt-1 text-muted">{formatShiftDate(today)}</p>
      </div>

      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your station</p>
        <p className="mt-1 text-lg font-bold">{user.stationName}</p>
      </Card>

      {!template || template.task_count === 0 ? (
        <Card className="p-5">
          <p className="font-semibold">No checklist is set up for your station yet.</p>
          <p className="mt-1 text-muted">Ask a manager to create one.</p>
        </Card>
      ) : (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Today’s checklist</p>
              <h2 className="mt-1 text-lg font-bold">{run?.checklist_name ?? template.name}</h2>
            </div>
            <RunStateBadge state={state} />
          </div>

          {run ? (
            <>
              <ProgressBar percent={progress.percent} label="Required tasks done" />
              <p className="text-sm text-muted">
                <strong className="text-ink">
                  {progress.requiredDone} of {progress.requiredTotal}
                </strong>{' '}
                required tasks done
                {progress.blocked > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-blocked">{progress.blocked} flagged</span>
                  </>
                )}
              </p>
              {run.status === 'submitted' ? (
                <div className="space-y-3">
                  <p className="rounded-lg bg-done-soft px-4 py-3 text-sm font-medium text-done">
                    Submitted at {formatTime(run.submitted_at, user.timezone)} by {run.submitted_by_name}.
                  </p>
                  <Link href="/station/checklist" className="block rounded-xl border border-line px-5 py-3 text-center font-semibold">
                    View submitted checklist
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    Started at {formatTime(run.started_at, user.timezone)} by {run.started_by_name}. Your progress is saved as you go.
                  </p>
                  <StartButton label="Continue checklist" />
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-muted">{template.task_count} tasks. Tap each one as you finish it.</p>
              <StartButton label="Start checklist" />
            </>
          )}
        </Card>
      )}
    </div>
  );
}

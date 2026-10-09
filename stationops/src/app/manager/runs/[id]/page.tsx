import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth';
import { getRun, getRunIssues, getRunItems } from '@/lib/checklists';
import { computeProgress, runState } from '@/lib/progress';
import { formatDateTime, formatShiftDate, formatTime } from '@/lib/time';
import { Badge, Card, ProgressBar, RunStateBadge } from '@/components/ui';
import { ResolveIssueForm } from '@/components/ResolveIssueForm';

export const metadata = { title: 'Checklist detail' };

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireManager();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const run = await getRun(id, user.restaurantId);
  if (!run) notFound();
  const [items, issues] = await Promise.all([getRunItems(run.id), getRunIssues(run.id)]);
  const progress = computeProgress(items);
  const tz = user.timezone;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/history" className="text-sm font-semibold text-navy-600">
          ← History
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{run.checklist_name}</h1>
          <RunStateBadge state={runState(run)} />
          {run.is_sample && <Badge tone="warn">Sample record</Badge>}
        </div>
        <p className="mt-1 text-muted">
          {run.station_name} · {formatShiftDate(run.shift_date)} · checklist version {run.version_number}
        </p>
      </div>

      <Card className="grid gap-4 p-5 sm:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Started</p>
          <p className="mt-1 font-semibold">{formatTime(run.started_at, tz)}</p>
          <p className="text-sm text-muted">{run.started_by_name}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Submitted</p>
          <p className="mt-1 font-semibold">{run.submitted_at ? formatTime(run.submitted_at, tz) : 'Not submitted'}</p>
          <p className="text-sm text-muted">{run.submitted_by_name ?? '—'}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Required tasks done</p>
          <p className="mt-1 font-semibold">
            {progress.requiredDone} of {progress.requiredTotal}
            {progress.percent !== null && ` (${progress.percent}%)`}
            {progress.blocked > 0 && <span className="text-blocked"> · {progress.blocked} flagged</span>}
            {progress.requiredOpen > 0 && <span className="text-warn"> · {progress.requiredOpen} not done</span>}
          </p>
          <div className="mt-2">
            <ProgressBar percent={progress.percent} label="Required tasks done" />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="border-b border-line px-5 py-3 font-bold">Tasks</h2>
        <ol className="divide-y divide-line">
          {items.map((item) => {
            const itemIssues = issues.filter((i) => i.run_item_id === item.id && i.status !== 'withdrawn');
            return (
              <li key={item.id} id={`item-${item.id}`} className="scroll-mt-4 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">
                    <span className="text-muted">{item.position}.</span> {item.description}
                    {!item.required && <span className="ml-2 text-xs font-normal text-muted">optional</span>}
                  </p>
                  {item.status === 'done' ? (
                    <Badge tone="done">Done</Badge>
                  ) : item.status === 'blocked' ? (
                    <Badge tone="blocked">Problem flagged</Badge>
                  ) : (
                    <Badge tone={item.required ? 'warn' : 'neutral'}>Not done</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {item.status === 'done' && `Done at ${formatTime(item.completed_at, tz)} by ${item.completed_by_name}`}
                  {item.status === 'blocked' && `Flagged at ${formatTime(item.flagged_at, tz)} by ${item.flagged_by_name}`}
                </p>
                {item.note && item.status !== 'blocked' && (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-sm">
                    <span className="font-semibold">Note: </span>
                    {item.note}
                  </p>
                )}
                {itemIssues.map((issue) => (
                  <div key={issue.id} className={`mt-3 rounded-xl border px-4 py-3 ${issue.status === 'open' ? 'border-blocked/40 bg-blocked-soft' : 'border-line bg-canvas'}`}>
                    <p className="text-sm font-semibold">{issue.status === 'open' ? 'Open issue' : 'Resolved issue'}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{issue.description}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Reported by {issue.reported_by_name} · {formatDateTime(issue.reported_at, tz)}
                    </p>
                    {issue.status === 'resolved' ? (
                      <div className="mt-2 border-t border-line pt-2">
                        <p className="whitespace-pre-wrap text-sm">
                          <span className="font-semibold">Resolution: </span>
                          {issue.resolution}
                        </p>
                        <p className="text-xs text-muted">
                          {issue.resolved_by_name} · {formatDateTime(issue.resolved_at, tz)}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <ResolveIssueForm issueId={issue.id} />
                      </div>
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { dashboardData } from '@/lib/dashboard';
import { formatDateTime, formatShiftDate, shortZoneName } from '@/lib/time';
import { Card, ProgressBar } from '@/components/ui';
import { RunTable } from '@/components/RunTable';

export const metadata = { title: 'Dashboard' };

function Stat({ label, value, tone, sub }: { label: string; value: string | number; tone?: 'done' | 'warn' | 'blocked'; sub?: string }) {
  const color = tone === 'done' ? 'text-done' : tone === 'warn' ? 'text-warn' : tone === 'blocked' ? 'text-blocked' : 'text-ink';
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export default async function ManagerDashboard() {
  const user = await requireManager();
  const d = await dashboardData(user.restaurantId, user.timezone);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today</h1>
          <p className="text-muted">
            {formatShiftDate(d.today)} · times in {shortZoneName(user.timezone)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Completed today" value={d.counts.completedToday} tone="done" sub={`of ${d.counts.expectedToday} station checklist${d.counts.expectedToday === 1 ? '' : 's'}`} />
        <Stat label="In progress" value={d.counts.inProgress} tone="warn" />
        <Stat label="With exceptions" value={d.counts.exceptionsToday} tone={d.counts.exceptionsToday ? 'blocked' : undefined} sub="submitted today" />
        <Stat label="Not started" value={d.counts.notStarted} />
        <Stat label="Need attention" value={d.counts.attention} tone={d.counts.attention ? 'blocked' : undefined} sub="last 30 days" />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">Required tasks done today</h2>
          <p className="text-sm text-muted">
            {d.requiredTotal === 0 ? 'No checklists started today' : `${d.requiredDone} of ${d.requiredTotal} (${d.requiredPercent}%)`}
          </p>
        </div>
        <div className="mt-3">
          <ProgressBar percent={d.requiredPercent} label="Required tasks done today" />
        </div>
        <div className="mt-4">
          <RunTable rows={d.todayRuns} timeZone={user.timezone} empty="No checklist has been started today yet." />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-bold">Open issues</h2>
            <Link href="/manager/issues" className="text-sm font-semibold text-navy-600">
              All issues →
            </Link>
          </div>
          {d.openIssues.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No open issues.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.openIssues.slice(0, 6).map((i) => (
                <li key={i.id} className="px-5 py-3">
                  <Link href={`/manager/runs/${i.run_id}#item-${i.run_item_id}`} className="font-semibold text-blocked hover:underline">
                    {i.item_description}
                  </Link>
                  <p className="mt-0.5 text-sm">{i.description}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {i.station_name} · {i.reported_by_name} · {formatDateTime(i.reported_at, user.timezone)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-bold">Needs attention</h2>
            <p className="text-xs text-muted">Open issues, today’s exceptions, and past checklists never submitted</p>
          </div>
          <RunTable rows={d.attention} timeZone={user.timezone} empty="Nothing needs attention." />
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-bold">Recent submissions</h2>
          <Link href="/manager/history" className="text-sm font-semibold text-navy-600">
            Full history →
          </Link>
        </div>
        <RunTable rows={d.recent} timeZone={user.timezone} empty="No submissions in the last 30 days." />
      </Card>
    </div>
  );
}

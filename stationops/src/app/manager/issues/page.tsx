import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { query } from '@/lib/db';
import { ISSUE_SELECT, type IssueRow } from '@/lib/checklists';
import { formatDateTime, formatShiftDate } from '@/lib/time';
import { Card } from '@/components/ui';
import { ResolveIssueForm } from '@/components/ResolveIssueForm';

export const metadata = { title: 'Issues' };

export default async function IssuesPage() {
  const user = await requireManager();
  const tz = user.timezone;
  const [open, resolved] = await Promise.all([
    query<IssueRow>(`${ISSUE_SELECT} where i.restaurant_id = $1 and i.status = 'open' order by i.reported_at`, [user.restaurantId]),
    query<IssueRow>(`${ISSUE_SELECT} where i.restaurant_id = $1 and i.status = 'resolved' order by i.resolved_at desc limit 25`, [
      user.restaurantId,
    ]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Issues</h1>
        <p className="text-muted">Problems employees flagged on checklist tasks. Record what was done to close each one.</p>
      </div>

      <Card>
        <h2 className="border-b border-line px-5 py-3 font-bold">Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No open issues.</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((i) => (
              <li key={i.id} className="grid gap-4 px-5 py-4 md:grid-cols-2">
                <div>
                  <Link href={`/manager/runs/${i.run_id}#item-${i.run_item_id}`} className="font-semibold text-blocked hover:underline">
                    {i.item_description}
                  </Link>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{i.description}</p>
                  <p className="mt-1 text-xs text-muted">
                    {i.station_name} · {formatShiftDate(i.shift_date)} · reported by {i.reported_by_name} at {formatDateTime(i.reported_at, tz)}
                  </p>
                </div>
                <ResolveIssueForm issueId={i.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="border-b border-line px-5 py-3 font-bold">Recently resolved</h2>
        {resolved.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nothing resolved yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {resolved.map((i) => (
              <li key={i.id} className="px-5 py-4 text-sm">
                <Link href={`/manager/runs/${i.run_id}#item-${i.run_item_id}`} className="font-semibold hover:underline">
                  {i.item_description}
                </Link>
                <p className="mt-1 whitespace-pre-wrap">{i.description}</p>
                <p className="mt-1 whitespace-pre-wrap">
                  <span className="font-semibold">Resolution: </span>
                  {i.resolution}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {i.station_name} · {formatShiftDate(i.shift_date)} · resolved by {i.resolved_by_name} at {formatDateTime(i.resolved_at, tz)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

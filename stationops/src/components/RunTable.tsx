import Link from 'next/link';
import type { HistoryRow } from '@/lib/reports';
import { percentOf } from '@/lib/reports';
import { runState } from '@/lib/progress';
import { formatShiftDate, formatTime } from '@/lib/time';
import { RunStateBadge } from './ui';

export function RunTable({ rows, timeZone, empty }: { rows: HistoryRow[]; timeZone: string; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Station</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Employee</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Required done</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Issues</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const pct = percentOf(r.required_done, r.required_total);
            return (
              <tr key={r.id} className="hover:bg-canvas">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link href={`/manager/runs/${r.id}`} className="font-semibold text-navy-600 underline-offset-2 hover:underline">
                    {formatShiftDate(r.shift_date)}
                  </Link>
                  {r.is_sample && <span className="ml-1.5 text-xs text-warn">sample</span>}
                </td>
                <td className="px-4 py-3">{r.station_name}</td>
                <td className="px-4 py-3">
                  {r.submitted_by_name ?? r.started_by_name}
                  {r.submitted_by_name && r.submitted_by_name !== r.started_by_name && (
                    <span className="block text-xs text-muted">started by {r.started_by_name}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <RunStateBadge state={runState(r)} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.required_done}/{r.required_total}
                  {pct !== null && <span className="ml-1 text-muted">({pct}%)</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.open_issue_count > 0 ? (
                    <span className="font-semibold text-blocked">{r.open_issue_count} open</span>
                  ) : r.issue_count > 0 ? (
                    <span className="text-muted">{r.issue_count} resolved</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{r.submitted_at ? formatTime(r.submitted_at, timeZone) : <span className="text-muted">Not submitted</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

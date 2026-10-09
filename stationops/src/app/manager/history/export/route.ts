import { getCurrentUser } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { historyDetailRows, historyRows, parseHistoryFilter, percentOf } from '@/lib/reports';
import { RUN_STATE_LABEL, runState } from '@/lib/progress';
import { formatCsvDateTime, localDate } from '@/lib/time';

const EXPORT_LIMIT = 10000;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in required.', { status: 401 });
  if (user.role !== 'manager') return new Response('Only managers can export checklist records.', { status: 403 });

  const url = new URL(request.url);
  const filter = parseHistoryFilter(Object.fromEntries(url.searchParams));
  const detail = url.searchParams.get('detail') === '1';
  const tz = user.timezone;
  const runs = await historyRows(user.restaurantId, filter, EXPORT_LIMIT);

  let csv: string;
  if (detail) {
    const rows = await historyDetailRows(user.restaurantId, runs.map((r) => r.id));
    csv = toCsv(
      ['run_id', 'shift_date', 'station', 'checklist', 'run_status', `submitted_at (${tz})`, 'submitted_by', 'task_number', 'task', 'required', 'task_status', 'note', `completed_at (${tz})`, 'completed_by', `flagged_at (${tz})`, 'issue_status', 'resolution'],
      rows.map((r) => [
        r.run_id,
        r.shift_date,
        r.station_name,
        r.checklist_name,
        RUN_STATE_LABEL[runState({ status: r.run_status, outcome: r.outcome })],
        formatCsvDateTime(r.submitted_at, tz),
        r.submitted_by_name,
        r.position,
        r.description,
        r.required ? 'yes' : 'no',
        r.item_status === 'blocked' ? 'problem flagged' : r.item_status === 'done' ? 'done' : 'not done',
        r.note,
        formatCsvDateTime(r.completed_at, tz),
        r.completed_by_name,
        formatCsvDateTime(r.flagged_at, tz),
        r.issue_status,
        r.resolution,
      ]),
    );
  } else {
    csv = toCsv(
      ['run_id', 'shift_date', 'station', 'checklist', 'checklist_version', 'status', 'required_done', 'required_total', 'completion_percent', 'tasks_flagged', 'issues_open', 'issues_total', 'started_by', `started_at (${tz})`, 'submitted_by', `submitted_at (${tz})`, 'sample_data'],
      runs.map((r) => [
        r.id,
        r.shift_date,
        r.station_name,
        r.checklist_name,
        r.version_number,
        RUN_STATE_LABEL[runState(r)],
        r.required_done,
        r.required_total,
        percentOf(r.required_done, r.required_total),
        r.blocked_count,
        r.open_issue_count,
        r.issue_count,
        r.started_by_name,
        formatCsvDateTime(r.started_at, tz),
        r.submitted_by_name,
        formatCsvDateTime(r.submitted_at, tz),
        r.is_sample ? 'yes' : 'no',
      ]),
    );
  }

  const name = `stationops-${detail ? 'tasks' : 'checklists'}-${localDate(tz)}.csv`;
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}

import 'server-only';
import { query } from './db';
import { ISSUE_SELECT, type IssueRow } from './checklists';
import { historyRows } from './reports';
import { addDays, localDate } from './time';

export async function dashboardData(restaurantId: number, timeZone: string) {
  const today = localDate(timeZone);

  const stations = await query<{ station_id: number; station_name: string; template_name: string }>(
    `select st.id as station_id, st.name as station_name, coalesce(tv.name, t.name) as template_name
       from checklist_templates t
       join stations st on st.id = t.station_id
       left join template_versions tv on tv.id = t.current_version_id
      where t.restaurant_id = $1 and t.active and st.active
      order by st.name`,
    [restaurantId],
  );

  const todayRuns = await historyRows(restaurantId, { from: today, to: today });
  const recent = (await historyRows(restaurantId, { from: addDays(today, -30) }, 200)).filter((r) => r.status === 'submitted').slice(0, 8);

  // Needs attention: submitted with exceptions and still has open issues, or a past shift never submitted.
  const attention = (await historyRows(restaurantId, { from: addDays(today, -30) }, 200)).filter(
    (r) => r.open_issue_count > 0 || (r.status === 'in_progress' && r.shift_date < today) || (r.outcome === 'exceptions' && r.shift_date === today),
  );

  const openIssues = await query<IssueRow>(`${ISSUE_SELECT} where i.restaurant_id = $1 and i.status = 'open' order by i.reported_at desc`, [
    restaurantId,
  ]);

  const requiredTotal = todayRuns.reduce((n, r) => n + r.required_total, 0);
  const requiredDone = todayRuns.reduce((n, r) => n + r.required_done, 0);

  return {
    today,
    stations,
    todayRuns,
    counts: {
      expectedToday: stations.length,
      completedToday: todayRuns.filter((r) => r.outcome === 'complete').length,
      exceptionsToday: todayRuns.filter((r) => r.outcome === 'exceptions').length,
      inProgress: todayRuns.filter((r) => r.status === 'in_progress').length,
      notStarted: stations.filter((s) => !todayRuns.some((r) => r.station_name === s.station_name)).length,
      attention: attention.length,
    },
    requiredPercent: requiredTotal === 0 ? null : Math.round((requiredDone / requiredTotal) * 100),
    requiredDone,
    requiredTotal,
    recent,
    attention,
    openIssues,
  };
}

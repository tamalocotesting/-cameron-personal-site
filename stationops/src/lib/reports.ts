import 'server-only';
import { z } from 'zod';
import { query } from './db';

export const historyFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  employee: z.coerce.number().int().positive().optional().catch(undefined),
  station: z.coerce.number().int().positive().optional().catch(undefined),
  status: z.enum(['complete', 'exceptions', 'in_progress']).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

export type HistoryFilter = z.infer<typeof historyFilterSchema>;

export function parseHistoryFilter(params: Record<string, string | string[] | undefined>): HistoryFilter {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flat[k] = value;
  }
  return historyFilterSchema.parse(flat);
}

export function filterToSearchParams(f: HistoryFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export type HistoryRow = {
  id: number;
  shift_date: string;
  station_name: string;
  checklist_name: string;
  version_number: number;
  status: 'in_progress' | 'submitted';
  outcome: 'complete' | 'exceptions' | null;
  started_by_name: string;
  started_at: Date;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  required_total: number;
  required_done: number;
  blocked_count: number;
  issue_count: number;
  open_issue_count: number;
  is_sample: boolean;
};

export async function historyRows(restaurantId: number, f: HistoryFilter, limit = 500): Promise<HistoryRow[]> {
  const where = ['r.restaurant_id = $1'];
  const params: unknown[] = [restaurantId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (f.from) add('r.shift_date >= ?', f.from);
  if (f.to) add('r.shift_date <= ?', f.to);
  if (f.station) add('r.station_id = ?', f.station);
  // An employee "worked" a run if they started it, submitted it, or completed or flagged any task on it.
  if (f.employee) {
    add(
      `(r.started_by = ? or r.submitted_by = ?
        or exists (select 1 from run_items x where x.run_id = r.id and (x.completed_by = ? or x.flagged_by = ?)))`,
      f.employee,
    );
  }
  if (f.status === 'in_progress') where.push(`r.status = 'in_progress'`);
  if (f.status === 'complete') where.push(`r.outcome = 'complete'`);
  if (f.status === 'exceptions') where.push(`r.outcome = 'exceptions'`);
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = `$${params.length}`;
    where.push(`(st.name ilike ${n} or r.checklist_name ilike ${n} or su.display_name ilike ${n} or sb.display_name ilike ${n}
      or exists (select 1 from run_items x where x.run_id = r.id and (x.note ilike ${n} or x.description ilike ${n})))`);
  }
  params.push(limit);

  return query<HistoryRow>(
    `select r.id, r.shift_date, st.name as station_name, r.checklist_name, tv.version_number, r.status, r.outcome,
            su.display_name as started_by_name, r.started_at, sb.display_name as submitted_by_name, r.submitted_at,
            r.is_sample,
            (select count(*)::int from run_items x where x.run_id = r.id and x.required) as required_total,
            (select count(*)::int from run_items x where x.run_id = r.id and x.required and x.status = 'done') as required_done,
            (select count(*)::int from run_items x where x.run_id = r.id and x.status = 'blocked') as blocked_count,
            (select count(*)::int from issues i where i.run_id = r.id and i.status <> 'withdrawn') as issue_count,
            (select count(*)::int from issues i where i.run_id = r.id and i.status = 'open') as open_issue_count
       from checklist_runs r
       join stations st on st.id = r.station_id
       join template_versions tv on tv.id = r.template_version_id
       join users su on su.id = r.started_by
       left join users sb on sb.id = r.submitted_by
      where ${where.join(' and ')}
      order by r.shift_date desc, r.started_at desc
      limit $${params.length}`,
    params,
  );
}

export function percentOf(done: number, total: number): number | null {
  return total === 0 ? null : Math.round((done / total) * 100);
}

export type DetailRow = {
  run_id: number;
  shift_date: string;
  station_name: string;
  checklist_name: string;
  run_status: string;
  outcome: string | null;
  submitted_at: Date | null;
  submitted_by_name: string | null;
  position: number;
  description: string;
  required: boolean;
  item_status: string;
  note: string | null;
  completed_at: Date | null;
  completed_by_name: string | null;
  flagged_at: Date | null;
  issue_status: string | null;
  resolution: string | null;
};

export async function historyDetailRows(restaurantId: number, runIds: number[]): Promise<DetailRow[]> {
  if (runIds.length === 0) return [];
  return query<DetailRow>(
    `select r.id as run_id, r.shift_date, st.name as station_name, r.checklist_name, r.status as run_status, r.outcome,
            r.submitted_at, sb.display_name as submitted_by_name,
            ri.position, ri.description, ri.required, ri.status as item_status, ri.note,
            ri.completed_at, cu.display_name as completed_by_name, ri.flagged_at,
            i.status as issue_status, i.resolution
       from checklist_runs r
       join stations st on st.id = r.station_id
       left join users sb on sb.id = r.submitted_by
       join run_items ri on ri.run_id = r.id
       left join users cu on cu.id = ri.completed_by
       left join lateral (
         select status, resolution from issues where run_item_id = ri.id and status <> 'withdrawn'
          order by reported_at desc limit 1
       ) i on true
      where r.restaurant_id = $1 and r.id = any($2::int[])
      order by r.shift_date desc, r.id, ri.position`,
    [restaurantId, runIds],
  );
}

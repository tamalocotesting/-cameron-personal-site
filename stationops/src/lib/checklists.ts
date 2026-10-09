import 'server-only';
import type { PoolClient } from 'pg';
import { query, queryOne, transaction } from './db';
import type { CurrentUser } from './auth';
import { localDate } from './time';
import { submissionOutcome, type ItemStatus } from './progress';

export class ChecklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecklistError';
  }
}

export type RunSummary = {
  id: number;
  station_id: number;
  station_name: string;
  checklist_name: string;
  shift_type: string;
  shift_date: string;
  status: 'in_progress' | 'submitted';
  outcome: 'complete' | 'exceptions' | null;
  started_by: number;
  started_by_name: string;
  started_at: Date;
  submitted_by: number | null;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  template_version_id: number;
  version_number: number;
  is_sample: boolean;
};

export type RunItem = {
  id: number;
  position: number;
  description: string;
  required: boolean;
  status: ItemStatus;
  note: string | null;
  completed_at: Date | null;
  completed_by_name: string | null;
  flagged_at: Date | null;
  flagged_by_name: string | null;
  updated_at: Date | null;
};

export type IssueRow = {
  id: number;
  run_id: number;
  run_item_id: number;
  item_description: string;
  description: string;
  status: 'open' | 'resolved' | 'withdrawn';
  reported_by_name: string;
  reported_at: Date;
  resolution: string | null;
  resolved_by_name: string | null;
  resolved_at: Date | null;
  station_name: string;
  shift_date: string;
  checklist_name: string;
};

const RUN_SELECT = `
  select r.id, r.station_id, st.name as station_name, r.checklist_name, r.shift_type,
         r.shift_date, r.status, r.outcome, r.started_by, su.display_name as started_by_name,
         r.started_at, r.submitted_by, sb.display_name as submitted_by_name, r.submitted_at,
         r.template_version_id, tv.version_number, r.is_sample
    from checklist_runs r
    join stations st on st.id = r.station_id
    join users su on su.id = r.started_by
    left join users sb on sb.id = r.submitted_by
    join template_versions tv on tv.id = r.template_version_id`;

export const ISSUE_SELECT = `
  select i.id, i.run_id, i.run_item_id, ri.description as item_description, i.description,
         i.status, ru.display_name as reported_by_name, i.reported_at, i.resolution,
         rv.display_name as resolved_by_name, i.resolved_at, st.name as station_name,
         r.shift_date, r.checklist_name
    from issues i
    join run_items ri on ri.id = i.run_item_id
    join checklist_runs r on r.id = i.run_id
    join stations st on st.id = r.station_id
    join users ru on ru.id = i.reported_by
    left join users rv on rv.id = i.resolved_by`;

export type StationTemplate = {
  template_id: number;
  name: string;
  shift_type: string;
  version_id: number;
  version_number: number;
  task_count: number;
};

/** The active template for a station (the pilot has one shift type: opening). */
export async function getStationTemplate(stationId: number): Promise<StationTemplate | null> {
  return queryOne<StationTemplate>(
    `select t.id as template_id, tv.name, t.shift_type, tv.id as version_id, tv.version_number,
            (select count(*)::int from template_tasks tt where tt.version_id = tv.id) as task_count
       from checklist_templates t
       join template_versions tv on tv.id = t.current_version_id
      where t.station_id = $1 and t.active
      order by t.id limit 1`,
    [stationId],
  );
}

export async function getRunForStationDate(stationId: number, shiftType: string, shiftDate: string) {
  return queryOne<RunSummary>(`${RUN_SELECT} where r.station_id = $1 and r.shift_type = $2 and r.shift_date = $3`, [
    stationId,
    shiftType,
    shiftDate,
  ]);
}

export async function getRun(runId: number, restaurantId: number) {
  return queryOne<RunSummary>(`${RUN_SELECT} where r.id = $1 and r.restaurant_id = $2`, [runId, restaurantId]);
}

export async function getRunItems(runId: number) {
  return query<RunItem>(
    `select ri.id, ri.position, ri.description, ri.required, ri.status, ri.note,
            ri.completed_at, cu.display_name as completed_by_name,
            ri.flagged_at, fu.display_name as flagged_by_name, ri.updated_at
       from run_items ri
       left join users cu on cu.id = ri.completed_by
       left join users fu on fu.id = ri.flagged_by
      where ri.run_id = $1
      order by ri.position`,
    [runId],
  );
}

export async function getRunIssues(runId: number) {
  return query<IssueRow>(`${ISSUE_SELECT} where i.run_id = $1 order by i.reported_at`, [runId]);
}

/**
 * Today's run for the user's station, created on first call. Tasks are copied
 * from the template's current version so later template edits never change
 * a run that has already started.
 */
export async function startOrResumeTodayRun(user: CurrentUser): Promise<number> {
  if (!user.stationId) throw new ChecklistError('You are not assigned to a station yet. Ask a manager to assign one.');
  const template = await getStationTemplate(user.stationId);
  if (!template) throw new ChecklistError('Your station has no checklist set up yet. Ask a manager.');
  if (template.task_count === 0) throw new ChecklistError('Your station checklist has no tasks yet. Ask a manager.');

  const today = localDate(user.timezone);

  return transaction(async (db) => {
    const inserted = await db.query<{ id: number }>(
      `insert into checklist_runs
         (restaurant_id, station_id, template_id, template_version_id, checklist_name, shift_type, shift_date, started_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (station_id, shift_type, shift_date) do nothing
       returning id`,
      [user.restaurantId, user.stationId, template.template_id, template.version_id, template.name, template.shift_type, today, user.id],
    );
    if (inserted.rows[0]) {
      const runId = inserted.rows[0].id;
      await db.query(
        `insert into run_items (run_id, template_task_id, position, description, required)
         select $1, id, position, description, required from template_tasks where version_id = $2`,
        [runId, template.version_id],
      );
      return runId;
    }
    const existing = await db.query<{ id: number }>(
      'select id from checklist_runs where station_id = $1 and shift_type = $2 and shift_date = $3',
      [user.stationId, template.shift_type, today],
    );
    return existing.rows[0].id;
  });
}

/** Lock the run and confirm this user may change it right now. */
async function lockEditableRun(db: PoolClient, user: CurrentUser, runId: number) {
  const { rows } = await db.query<{ id: number; station_id: number; status: string; shift_date: string; restaurant_id: number }>(
    'select id, station_id, status, shift_date, restaurant_id from checklist_runs where id = $1 for update',
    [runId],
  );
  const run = rows[0];
  if (!run || run.restaurant_id !== user.restaurantId || run.station_id !== user.stationId) {
    throw new ChecklistError('This checklist is not assigned to your station.');
  }
  if (run.status === 'submitted') throw new ChecklistError('This checklist has already been submitted and can no longer be changed.');
  if (run.shift_date !== localDate(user.timezone)) {
    throw new ChecklistError('This checklist was for an earlier shift and can no longer be changed.');
  }
  return run;
}

export type ItemAction =
  | { action: 'done' }
  | { action: 'undo' }
  | { action: 'block'; note: string }
  | { action: 'note'; note: string };

export async function updateRunItem(user: CurrentUser, itemId: number, change: ItemAction): Promise<RunItem> {
  await transaction(async (db) => {
    const { rows } = await db.query<{ run_id: number; status: ItemStatus; note: string | null }>(
      'select run_id, status, note from run_items where id = $1',
      [itemId],
    );
    const item = rows[0];
    if (!item) throw new ChecklistError('That task no longer exists. Refresh the page.');
    const run = await lockEditableRun(db, user, item.run_id);

    const withdrawOpenIssue = (reason: string) =>
      db.query(
        `update issues set status = 'withdrawn', resolution = $2, resolved_by = $3, resolved_at = now()
          where run_item_id = $1 and status = 'open'`,
        [itemId, reason, user.id],
      );

    switch (change.action) {
      case 'done':
        if (item.status === 'blocked') await withdrawOpenIssue('Employee marked the task done before submitting.');
        await db.query(
          `update run_items set status = 'done', completed_at = now(), completed_by = $2,
                  updated_at = now(), updated_by = $2 where id = $1`,
          [itemId, user.id],
        );
        break;
      case 'undo':
        if (item.status === 'blocked') await withdrawOpenIssue('Employee cleared the problem flag before submitting.');
        await db.query(
          `update run_items set status = 'pending', completed_at = null, completed_by = null,
                  updated_at = now(), updated_by = $2 where id = $1`,
          [itemId, user.id],
        );
        break;
      case 'block':
        await db.query(
          `update run_items set status = 'blocked', note = $3, completed_at = null, completed_by = null,
                  flagged_at = now(), flagged_by = $2, updated_at = now(), updated_by = $2 where id = $1`,
          [itemId, user.id, change.note],
        );
        if (item.status === 'blocked') {
          await db.query(`update issues set description = $2 where run_item_id = $1 and status = 'open'`, [itemId, change.note]);
        } else {
          await db.query(
            `insert into issues (restaurant_id, run_id, run_item_id, description, reported_by)
             values ($1, $2, $3, $4, $5)`,
            [run.restaurant_id, run.id, itemId, change.note, user.id],
          );
        }
        break;
      case 'note':
        if (item.status === 'blocked' && change.note.trim() === '') {
          throw new ChecklistError('A flagged task needs a short description of the problem.');
        }
        await db.query(
          `update run_items set note = nullif($3, ''), updated_at = now(), updated_by = $2 where id = $1`,
          [itemId, user.id, change.note],
        );
        if (item.status === 'blocked') {
          await db.query(`update issues set description = $2 where run_item_id = $1 and status = 'open'`, [itemId, change.note]);
        }
        break;
    }
  });

  const updated = await queryOne<RunItem>(
    `select ri.id, ri.position, ri.description, ri.required, ri.status, ri.note,
            ri.completed_at, cu.display_name as completed_by_name,
            ri.flagged_at, fu.display_name as flagged_by_name, ri.updated_at
       from run_items ri
       left join users cu on cu.id = ri.completed_by
       left join users fu on fu.id = ri.flagged_by
      where ri.id = $1`,
    [itemId],
  );
  return updated!;
}

export async function submitRun(user: CurrentUser, runId: number): Promise<'complete' | 'exceptions'> {
  return transaction(async (db) => {
    await lockEditableRun(db, user, runId);
    const { rows: items } = await db.query<{ required: boolean; status: ItemStatus }>(
      'select required, status from run_items where run_id = $1',
      [runId],
    );
    const outcome = submissionOutcome(items);
    const updated = await db.query(
      `update checklist_runs set status = 'submitted', outcome = $2, submitted_by = $3, submitted_at = now()
        where id = $1 and status = 'in_progress'`,
      [runId, outcome, user.id],
    );
    if (updated.rowCount !== 1) throw new ChecklistError('This checklist has already been submitted.');
    return outcome;
  });
}

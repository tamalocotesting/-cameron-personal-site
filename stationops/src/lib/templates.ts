import 'server-only';
import { query, queryOne, transaction } from './db';
import type { CurrentUser } from './auth';

export type TemplateListRow = {
  id: number;
  name: string;
  station_id: number;
  station_name: string;
  shift_type: string;
  active: boolean;
  version_id: number | null;
  version_number: number | null;
  version_created_at: Date | null;
  version_created_by_name: string | null;
  task_count: number;
};

export type TemplateTask = { id: number; position: number; description: string; required: boolean };

export type TemplateVersion = {
  id: number;
  version_number: number;
  name: string;
  change_note: string | null;
  created_at: Date;
  created_by_name: string | null;
  task_count: number;
  runs_using: number;
};

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export async function listTemplates(restaurantId: number) {
  return query<TemplateListRow>(
    `select t.id, coalesce(tv.name, t.name) as name, t.station_id, st.name as station_name, t.shift_type, t.active,
            tv.id as version_id, tv.version_number, tv.created_at as version_created_at,
            u.display_name as version_created_by_name,
            (select count(*)::int from template_tasks tt where tt.version_id = tv.id) as task_count
       from checklist_templates t
       join stations st on st.id = t.station_id
       left join template_versions tv on tv.id = t.current_version_id
       left join users u on u.id = tv.created_by
      where t.restaurant_id = $1
      order by st.name, t.shift_type`,
    [restaurantId],
  );
}

export async function getTemplate(templateId: number, restaurantId: number) {
  return queryOne<TemplateListRow>(
    `select t.id, coalesce(tv.name, t.name) as name, t.station_id, st.name as station_name, t.shift_type, t.active,
            tv.id as version_id, tv.version_number, tv.created_at as version_created_at,
            u.display_name as version_created_by_name,
            (select count(*)::int from template_tasks tt where tt.version_id = tv.id) as task_count
       from checklist_templates t
       join stations st on st.id = t.station_id
       left join template_versions tv on tv.id = t.current_version_id
       left join users u on u.id = tv.created_by
      where t.id = $1 and t.restaurant_id = $2`,
    [templateId, restaurantId],
  );
}

export async function getVersionTasks(versionId: number) {
  return query<TemplateTask>(
    'select id, position, description, required from template_tasks where version_id = $1 order by position',
    [versionId],
  );
}

export async function listVersions(templateId: number) {
  return query<TemplateVersion>(
    `select tv.id, tv.version_number, tv.name, tv.change_note, tv.created_at, u.display_name as created_by_name,
            (select count(*)::int from template_tasks tt where tt.version_id = tv.id) as task_count,
            (select count(*)::int from checklist_runs r where r.template_version_id = tv.id) as runs_using
       from template_versions tv
       left join users u on u.id = tv.created_by
      where tv.template_id = $1
      order by tv.version_number desc`,
    [templateId],
  );
}

export type TemplateDraft = {
  name: string;
  changeNote?: string;
  tasks: { description: string; required: boolean }[];
};

/**
 * Save a template edit as a new immutable version and make it current.
 * `baseVersionId` is the version the editor loaded; if someone else saved in
 * the meantime the save is refused rather than silently overwriting them.
 */
export async function saveTemplateVersion(
  user: CurrentUser,
  templateId: number,
  baseVersionId: number | null,
  draft: TemplateDraft,
): Promise<number> {
  return transaction(async (db) => {
    const { rows } = await db.query<{ id: number; current_version_id: number | null; restaurant_id: number }>(
      'select id, current_version_id, restaurant_id from checklist_templates where id = $1 for update',
      [templateId],
    );
    const template = rows[0];
    if (!template || template.restaurant_id !== user.restaurantId) throw new TemplateError('Checklist template not found.');
    if (template.current_version_id !== baseVersionId) {
      throw new TemplateError('Someone else saved this checklist while you were editing. Reload the page to see their changes, then make yours again.');
    }

    const next = await db.query<{ n: number }>(
      'select coalesce(max(version_number), 0) + 1 as n from template_versions where template_id = $1',
      [templateId],
    );
    const version = await db.query<{ id: number }>(
      `insert into template_versions (template_id, version_number, name, change_note, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [templateId, next.rows[0].n, draft.name, draft.changeNote || null, user.id],
    );
    const versionId = version.rows[0].id;
    for (const [i, task] of draft.tasks.entries()) {
      await db.query('insert into template_tasks (version_id, position, description, required) values ($1, $2, $3, $4)', [
        versionId,
        i + 1,
        task.description,
        task.required,
      ]);
    }
    await db.query('update checklist_templates set current_version_id = $2, name = $3 where id = $1', [
      templateId,
      versionId,
      draft.name,
    ]);
    return versionId;
  });
}

export async function createTemplate(user: CurrentUser, stationId: number, name: string): Promise<number> {
  return transaction(async (db) => {
    const station = await db.query('select id from stations where id = $1 and restaurant_id = $2', [stationId, user.restaurantId]);
    if (!station.rows[0]) throw new TemplateError('Station not found.');
    const existing = await db.query(`select id from checklist_templates where station_id = $1 and shift_type = 'opening'`, [stationId]);
    if (existing.rows[0]) throw new TemplateError('That station already has an opening checklist. Edit the existing one instead.');
    const t = await db.query<{ id: number }>(
      `insert into checklist_templates (restaurant_id, station_id, name, shift_type) values ($1, $2, $3, 'opening') returning id`,
      [user.restaurantId, stationId, name],
    );
    const v = await db.query<{ id: number }>(
      `insert into template_versions (template_id, version_number, name, change_note, created_by)
       values ($1, 1, $2, 'Created', $3) returning id`,
      [t.rows[0].id, name, user.id],
    );
    await db.query('update checklist_templates set current_version_id = $2 where id = $1', [t.rows[0].id, v.rows[0].id]);
    return t.rows[0].id;
  });
}

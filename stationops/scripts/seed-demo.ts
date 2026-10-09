/**
 * Create the clearly-labelled demonstration environment.
 *
 *   npm run db:seed-demo            # refuses if demo data already exists
 *   npm run db:seed-demo -- --reset # deletes the demo restaurant and recreates it
 *
 * Passwords come from DEMO_MANAGER_PASSWORD / DEMO_EMPLOYEE_PASSWORD. If they
 * are not set, random passwords are generated and printed once. No password is
 * ever written into source code.
 *
 * Everything created here is fictional and labelled "Sample" / "Demo".
 */
import './_env';
import type { PoolClient } from 'pg';
import { createPool, transaction } from '../src/lib/db';
import { generatePassword, hashPassword, PASSWORD_MIN_LENGTH } from '../src/lib/passwords';
import { addDays, localDate } from '../src/lib/time';

const TIMEZONE = process.env.DEMO_TIMEZONE || 'America/Indiana/Indianapolis';

export const DEMO_TASKS: { description: string; required: boolean }[] = [
  { description: 'Sanitize preparation surfaces.', required: true },
  { description: 'Verify refrigerator temperatures.', required: true },
  { description: 'Confirm ingredient availability.', required: true },
  { description: 'Prepare the workstation.', required: true },
  { description: 'Verify food labels and dates.', required: true },
  { description: 'Confirm required equipment is functioning.', required: true },
  { description: 'Notify management of shortages or issues.', required: false },
  { description: 'Complete station readiness inspection.', required: true },
];

export const DEMO_USERNAMES = { manager: 'demo.manager', alex: 'demo.alex', jordan: 'demo.jordan' } as const;

async function deleteDemo(db: PoolClient) {
  const { rows } = await db.query<{ id: number }>('select id from restaurants where is_demo');
  for (const { id } of rows) {
    await db.query('delete from issues where restaurant_id = $1', [id]);
    await db.query('delete from checklist_runs where restaurant_id = $1', [id]);
    await db.query('delete from measurement_periods where restaurant_id = $1', [id]);
    await db.query('update checklist_templates set current_version_id = null where restaurant_id = $1', [id]);
    await db.query(
      `delete from template_tasks where version_id in (select tv.id from template_versions tv
         join checklist_templates t on t.id = tv.template_id where t.restaurant_id = $1)`,
      [id],
    );
    await db.query(
      'delete from template_versions where template_id in (select id from checklist_templates where restaurant_id = $1)',
      [id],
    );
    await db.query('delete from checklist_templates where restaurant_id = $1', [id]);
    await db.query('delete from sessions where user_id in (select id from users where restaurant_id = $1)', [id]);
    await db.query('delete from users where restaurant_id = $1', [id]);
    await db.query('delete from stations where restaurant_id = $1', [id]);
    await db.query('delete from restaurants where id = $1', [id]);
  }
}

type SampleRun = {
  daysAgo: number;
  by: 'alex' | 'jordan';
  submitted: boolean;
  /** position → item override; anything not listed is done. */
  items?: Record<number, { status: 'pending' | 'blocked'; note?: string; resolution?: string }>;
};

const SAMPLE_RUNS: SampleRun[] = [
  { daysAgo: 7, by: 'alex', submitted: true },
  { daysAgo: 6, by: 'jordan', submitted: true },
  {
    daysAgo: 5,
    by: 'alex',
    submitted: true,
    items: {
      2: {
        status: 'blocked',
        note: 'SAMPLE: Walk-in cooler read 44°F at 6:10 AM, above the 41°F limit. Moved cream cheese to the reach-in.',
        resolution: 'SAMPLE: Technician reset the thermostat; cooler read 38°F at 7:30 AM.',
      },
    },
  },
  // daysAgo 4: deliberately no run, so history shows a missed day.
  { daysAgo: 3, by: 'alex', submitted: true },
  {
    daysAgo: 2,
    by: 'jordan',
    submitted: true,
    items: {
      3: { status: 'blocked', note: 'SAMPLE: Only 6 everything bagels on hand for opening. Need a second bake.' },
      5: { status: 'pending' },
    },
  },
  { daysAgo: 1, by: 'jordan', submitted: false, items: { 6: { status: 'pending' }, 7: { status: 'pending' }, 8: { status: 'pending' } } },
];

export async function seedDemo(opts: { reset: boolean; managerPassword: string; employeePassword: string; databaseUrl?: string }) {
  const pool = createPool(opts.databaseUrl);
  try {
    await transaction(async (db) => {
      const real = await db.query('select id from restaurants where not is_demo');
      if (real.rows[0]) throw new Error('A real restaurant is set up in this database. Demo data must live in a separate database.');
      const existing = await db.query('select id from restaurants where is_demo');
      if (existing.rows[0] && !opts.reset) throw new Error('Demo data already exists. Re-run with --reset to recreate it.');
      await deleteDemo(db);

      const r = await db.query<{ id: number }>(
        `insert into restaurants (name, timezone, is_demo) values ('Sample Bagel Co. (Demo)', $1, true) returning id`,
        [TIMEZONE],
      );
      const restaurantId = r.rows[0].id;
      const s = await db.query<{ id: number }>(
        `insert into stations (restaurant_id, name) values ($1, 'Bagel Prep Station') returning id`,
        [restaurantId],
      );
      const stationId = s.rows[0].id;

      const managerHash = await hashPassword(opts.managerPassword);
      const employeeHash = await hashPassword(opts.employeePassword);
      const addUser = async (username: string, name: string, role: string, station: number | null, hash: string) =>
        (
          await db.query<{ id: number }>(
            `insert into users (restaurant_id, username, display_name, role, station_id, password_hash)
             values ($1, $2, $3, $4, $5, $6) returning id`,
            [restaurantId, username, name, role, station, hash],
          )
        ).rows[0].id;
      const managerId = await addUser(DEMO_USERNAMES.manager, 'Morgan Demo (Manager)', 'manager', null, managerHash);
      const users = {
        alex: await addUser(DEMO_USERNAMES.alex, 'Alex Demo', 'employee', stationId, employeeHash),
        jordan: await addUser(DEMO_USERNAMES.jordan, 'Jordan Demo', 'employee', stationId, employeeHash),
      };

      const t = await db.query<{ id: number }>(
        `insert into checklist_templates (restaurant_id, station_id, name, shift_type) values ($1, $2, $3, 'opening') returning id`,
        [restaurantId, stationId, 'Bagel Preparation Station — Opening'],
      );
      const templateId = t.rows[0].id;
      const v = await db.query<{ id: number }>(
        `insert into template_versions (template_id, version_number, name, change_note, created_by)
         values ($1, 1, 'Bagel Preparation Station — Opening', 'SAMPLE tasks. Replace with manager-approved tasks before real use.', $2)
         returning id`,
        [templateId, managerId],
      );
      const versionId = v.rows[0].id;
      const taskIds: number[] = [];
      for (const [i, task] of DEMO_TASKS.entries()) {
        const row = await db.query<{ id: number }>(
          'insert into template_tasks (version_id, position, description, required) values ($1, $2, $3, $4) returning id',
          [versionId, i + 1, task.description, task.required],
        );
        taskIds.push(row.rows[0].id);
      }
      await db.query('update checklist_templates set current_version_id = $2 where id = $1', [templateId, versionId]);

      const today = localDate(TIMEZONE);
      // Local wall-clock time on a shift date → timestamptz, computed by Postgres in the restaurant zone.
      const at = async (date: string, hhmm: string) =>
        (await db.query<{ t: Date }>(`select ($1::date + $2::time) at time zone $3 as t`, [date, hhmm, TIMEZONE])).rows[0].t;
      const clock = (minutes: number) => `${String(6 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

      for (const sample of SAMPLE_RUNS) {
        const date = addDays(today, -sample.daysAgo);
        const by = users[sample.by];
        const started = await at(date, clock(2));
        const run = await db.query<{ id: number }>(
          `insert into checklist_runs (restaurant_id, station_id, template_id, template_version_id, checklist_name,
                                       shift_type, shift_date, started_by, started_at, is_sample)
           values ($1, $2, $3, $4, 'Bagel Preparation Station — Opening', 'opening', $5, $6, $7, true) returning id`,
          [restaurantId, stationId, templateId, versionId, date, by, started],
        );
        const runId = run.rows[0].id;
        const statuses: { required: boolean; status: string }[] = [];
        for (const [i, task] of DEMO_TASKS.entries()) {
          const position = i + 1;
          const override = sample.items?.[position];
          const status = override?.status ?? 'done';
          const stamp = await at(date, clock(4 + position * 3));
          statuses.push({ required: task.required, status });
          const item = await db.query<{ id: number }>(
            `insert into run_items (run_id, template_task_id, position, description, required, status, note,
                                    completed_at, completed_by, flagged_at, flagged_by, updated_at, updated_by)
             values ($1, $2, $3, $4, $5, $6, $7,
                     case when $6 = 'done' then $8::timestamptz end, case when $6 = 'done' then $9::int end,
                     case when $6 = 'blocked' then $8::timestamptz end, case when $6 = 'blocked' then $9::int end,
                     case when $6 <> 'pending' then $8::timestamptz end, case when $6 <> 'pending' then $9::int end)
             returning id`,
            [runId, taskIds[i], position, task.description, task.required, status, override?.note ?? null, stamp, by],
          );
          if (status === 'blocked') {
            await db.query(
              `insert into issues (restaurant_id, run_id, run_item_id, description, reported_by, reported_at,
                                   status, resolution, resolved_by, resolved_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                restaurantId,
                runId,
                item.rows[0].id,
                override!.note,
                by,
                stamp,
                override!.resolution ? 'resolved' : 'open',
                override!.resolution ?? null,
                override!.resolution ? managerId : null,
                override!.resolution ? await at(date, '07:35') : null,
              ],
            );
          }
        }
        if (sample.submitted) {
          const outcome = statuses.every((x) => !x.required || x.status === 'done') ? 'complete' : 'exceptions';
          await db.query(
            `update checklist_runs set status = 'submitted', outcome = $2, submitted_by = $3, submitted_at = $4 where id = $1`,
            [runId, outcome, by, await at(date, clock(32))],
          );
        }
      }
    }, pool);
  } finally {
    await pool.end();
  }
}

async function main() {
  const reset = process.argv.includes('--reset');
  const managerPassword = process.env.DEMO_MANAGER_PASSWORD || generatePassword();
  const employeePassword = process.env.DEMO_EMPLOYEE_PASSWORD || generatePassword();
  for (const p of [managerPassword, employeePassword]) {
    if (p.length < PASSWORD_MIN_LENGTH) throw new Error(`Demo passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  await seedDemo({ reset, managerPassword, employeePassword });

  console.log('Demo environment created: "Sample Bagel Co. (Demo)" — all records are sample data.\n');
  console.log(`  Manager:    ${DEMO_USERNAMES.manager}  password: ${process.env.DEMO_MANAGER_PASSWORD ? '(from DEMO_MANAGER_PASSWORD)' : managerPassword}`);
  console.log(`  Employee:   ${DEMO_USERNAMES.alex}     password: ${process.env.DEMO_EMPLOYEE_PASSWORD ? '(from DEMO_EMPLOYEE_PASSWORD)' : employeePassword}`);
  console.log(`  Employee:   ${DEMO_USERNAMES.jordan}   password: (same as demo.alex)`);
}

if (process.argv[1]?.endsWith('seed-demo.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

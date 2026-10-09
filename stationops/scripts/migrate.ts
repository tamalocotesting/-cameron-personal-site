/**
 * Apply any SQL migrations in db/migrations that have not run yet.
 * Safe to run on every deploy.  Usage: npm run db:migrate
 */
import './_env';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createPool, transaction } from '../src/lib/db';

export async function migrate(databaseUrl?: string, log = console.log) {
  const pool = createPool(databaseUrl);
  try {
    await pool.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const dir = path.join(process.cwd(), 'db', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await pool.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await transaction(async (db) => {
        await db.query(sql);
        await db.query('insert into schema_migrations (name) values ($1)', [file]);
      }, pool);
      log(`applied ${file}`);
    }
    log('database is up to date');
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.BSB_DATA_DIR ? resolve(process.env.BSB_DATA_DIR) : join(ROOT, 'data');
export const DB_PATH = process.env.BSB_DB_PATH ? resolve(process.env.BSB_DB_PATH) : join(DATA_DIR, 'bsbagels.sqlite');

export type DB = DatabaseSync;

let shared: DatabaseSync | null = null;

export function openDb(path = DB_PATH): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(ROOT, 'server', 'schema.sql'), 'utf8'));
  return db;
}

export function getDb(): DatabaseSync {
  if (!shared) shared = openDb();
  return shared;
}

export function setDb(db: DatabaseSync): void {
  shared = db;
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function all<T = Record<string, unknown>>(db: DatabaseSync, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}
export function one<T = Record<string, unknown>>(db: DatabaseSync, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(db: DatabaseSync, sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...(params as never[]));
}

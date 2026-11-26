import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DATA_DIR, DB_PATH, openDb, setDb, type DB } from './db.ts';

export const BACKUP_DIR = join(DATA_DIR, 'backups');
const NAME = /^bsbagels-\d{8}-\d{6}(-[a-z0-9-]+)?\.sqlite$/;

export function createBackup(db: DB, label = ''): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const name = `bsbagels-${ts}${safe ? '-' + safe : ''}.sqlite`;
  db.exec(`VACUUM INTO '${join(BACKUP_DIR, name).replace(/'/g, "''")}'`);
  return name;
}

export function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter((f) => NAME.test(f)).map((f) => ({ name: f, bytes: statSync(join(BACKUP_DIR, f)).size, created: statSync(join(BACKUP_DIR, f)).mtime.toISOString() })).sort((a, b) => b.name.localeCompare(a.name));
}

export function backupPath(name: string): string {
  if (!NAME.test(name) || basename(name) !== name) throw new Error('Invalid backup name');
  const p = join(BACKUP_DIR, name);
  if (!existsSync(p)) throw new Error('Backup not found');
  return p;
}

/** Validate a candidate database file: integrity check + required tables. */
export function validateDbFile(path: string) {
  const d = new DatabaseSync(path, { readOnly: true });
  try {
    const ok = (d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    if (ok !== 'ok') throw new Error(`Integrity check failed: ${ok}`);
    const tables = new Set((d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name));
    for (const t of ['users', 'bagel_day', 'bagel_daily', 'daily_sales', 'audit_log', 'assumptions']) if (!tables.has(t)) throw new Error(`Missing table ${t}`);
    const users = (d.prepare("SELECT count(*) n FROM users WHERE role='owner' AND active=1").get() as { n: number }).n;
    if (!users) throw new Error('Backup has no active owner account');
  } finally { d.close(); }
}

/** Restore: snapshot current DB first (so restore is reversible), then swap files and reopen. */
export function restoreBackup(current: DB, name: string): { safetyBackup: string; db: DB } {
  const src = backupPath(name);
  validateDbFile(src);
  const safety = createBackup(current, 'pre-restore');
  current.close();
  for (const s of ['-wal', '-shm']) rmSync(DB_PATH + s, { force: true });
  copyFileSync(src, DB_PATH);
  const db = openDb();
  setDb(db);
  return { safetyBackup: safety, db };
}

/** Tables a manager may export as CSV. Users/sessions/audit are owner-only via the JSON export. */
export const EXPORTABLE = ['bagel_day', 'bagel_daily', 'daily_sales', 'item_monthly', 'item_daily', 'modifier_daily', 'assumptions', 'inventory_counts', 'catering_orders', 'waste_log', 'handoffs', 'ticket_status', 'plan_adjustments', 'forecast_snapshots', 'recipes', 'recipe_steps', 'recipe_components', 'sources'] as const;

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Spreadsheet formula-injection guard for text cells (numbers like -5 are left alone).
    if (typeof v === 'string' && /^[=+\-@\t]/.test(s) && isNaN(+s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

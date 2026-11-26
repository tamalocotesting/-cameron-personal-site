import { createApp } from './app.ts';
import { getDb, one, DB_PATH } from './db.ts';
import { existsSync } from 'node:fs';
import { createBackup, listBackups, BACKUP_DIR } from './backup.ts';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Run "npm run seed" first (see docs/SETUP.md).`);
  process.exit(1);
}
const db = getDb();
if (!one(db, "SELECT 1 FROM users WHERE role='owner' AND active=1")) console.warn('Warning: no active owner account.');

// Daily automatic backup (keeps the newest 30 automatic snapshots).
function autoBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (!listBackups().some((b) => b.name.includes(today) && b.name.includes('-auto'))) createBackup(getDb(), 'auto');
    for (const b of listBackups().filter((x) => x.name.endsWith('-auto.sqlite')).slice(30)) rmSync(join(BACKUP_DIR, b.name));
  } catch (e) { console.error('auto backup failed', e); }
}
autoBackup();
setInterval(autoBackup, 6 * 3600_000).unref();

const port = +(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
createApp().listen(port, host, () => console.log(`The Rail listening on http://${host}:${port}`));

import { scryptSync, randomBytes, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import type { DB } from './db.ts';
import { one, run } from './db.ts';

export type Role = 'crew' | 'lead' | 'manager' | 'owner';
export const ROLE_RANK: Record<Role, number> = { crew: 1, lead: 2, manager: 3, owner: 4 };
export const atLeast = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

export interface SessionUser { id: number; username: string; display_name: string; role: Role; lang: 'en' | 'es'; station: string | null }

const N = 16384;
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(secret, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifySecret(secret: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const h = scryptSync(secret, Buffer.from(salt, 'base64'), 32, { N: +n, r: 8, p: 1 });
  const expected = Buffer.from(hash, 'base64');
  return h.length === expected.length && timingSafeEqual(h, expected);
}

/** Crew & leads use numeric PINs on the shared tablet; managers & owners need real passwords. */
export function validateSecret(role: Role, secret: string): string | null {
  if (role === 'crew' || role === 'lead') return /^\d{4,8}$/.test(secret) ? null : 'PIN must be 4–8 digits';
  if (secret.length < 10) return 'Password must be at least 10 characters';
  return null;
}

export const randomPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const randomPassword = () => randomBytes(12).toString('base64url');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SESSION_HOURS: Record<Role, number> = { crew: 14, lead: 14, manager: 12, owner: 12 };

export function createSession(db: DB, user: SessionUser) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(18).toString('base64url');
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_HOURS[user.role] * 3600_000);
  run(db, 'INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES (?,?,?,?,?)', sha(token), user.id, csrf, now.toISOString(), exp.toISOString());
  run(db, "DELETE FROM sessions WHERE expires_at < ?", now.toISOString());
  return { token, csrf, expires: exp };
}

export function sessionUser(db: DB, token: string | undefined): (SessionUser & { csrf: string }) | null {
  if (!token) return null;
  const row = one<SessionUser & { csrf: string; expires_at: string; active: number }>(db,
    `SELECT u.id,u.username,u.display_name,u.role,u.lang,u.station,u.active,s.csrf,s.expires_at
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, sha(token));
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role, lang: row.lang, station: row.station, csrf: row.csrf };
}

export function destroySession(db: DB, token: string) {
  run(db, 'DELETE FROM sessions WHERE token_hash=?', sha(token));
}

const MAX_FAILS = 5;
const LOCK_MIN = 10;
export function login(db: DB, username: string, secret: string): { user?: SessionUser; error?: string } {
  const u = one<SessionUser & { secret_hash: string; active: number; failed_attempts: number; locked_until: string | null }>(db,
    'SELECT * FROM users WHERE username=?', username.trim());
  if (!u || !u.active) {
    // equalize timing
    verifySecret(secret, hashSecret('x'.repeat(8)));
    return { error: 'Unknown user or wrong PIN/password' };
  }
  if (u.locked_until && u.locked_until > new Date().toISOString()) return { error: 'Too many attempts — try again in a few minutes' };
  if (!verifySecret(secret, u.secret_hash)) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000).toISOString() : null;
    run(db, 'UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?', lock ? 0 : fails, lock, u.id);
    return { error: 'Unknown user or wrong PIN/password' };
  }
  run(db, 'UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?', u.id);
  return { user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role, lang: u.lang, station: u.station } };
}

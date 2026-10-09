import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query, queryOne } from './db';
import { hashPassword, verifyPassword } from './passwords';

export const SESSION_COOKIE = 'stationops_session';
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export type Role = 'employee' | 'manager';

export type CurrentUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  restaurantId: number;
  restaurantName: string;
  restaurantIsDemo: boolean;
  timezone: string;
  stationId: number | null;
  stationName: string | null;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Used when the username does not exist, so a failed lookup costs the same as
// a wrong password and response time does not reveal which usernames exist.
let dummyHash: Promise<string> | null = null;

export type LoginResult =
  | { ok: true; role: Role }
  | { ok: false; error: string };

export async function login(username: string, password: string): Promise<LoginResult> {
  const user = await queryOne<{
    id: number;
    role: Role;
    password_hash: string;
    active: boolean;
    failed_logins: number;
    locked_until: Date | null;
  }>(
    `select id, role, password_hash, active, failed_logins, locked_until
       from users where lower(username) = lower($1)`,
    [username.trim()],
  );

  const generic = 'That username and password do not match. Check both and try again.';

  if (!user) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verifyPassword(password, await dummyHash);
    return { ok: false, error: generic };
  }

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
    return {
      ok: false,
      error: `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask a manager to reset your password.`,
    };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const failures = user.failed_logins + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await query(
      `update users set failed_logins = $2,
              locked_until = case when $3 then now() + make_interval(mins => $4) else locked_until end
        where id = $1`,
      [user.id, lock ? 0 : failures, lock, LOCKOUT_MINUTES],
    );
    return { ok: false, error: generic };
  }

  if (!user.active) {
    return { ok: false, error: 'This account has been turned off. Ask a manager to reactivate it.' };
  }

  await query('update users set failed_logins = 0, locked_until = null where id = $1', [user.id]);
  await query('delete from sessions where expires_at < now()');

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [
    hashToken(token),
    user.id,
    expires,
  ]);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true',
    path: '/',
    expires,
  });

  return { ok: true, role: user.role };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query('delete from sessions where token_hash = $1', [hashToken(token)]);
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<{
    id: number;
    username: string;
    display_name: string;
    role: Role;
    restaurant_id: number;
    restaurant_name: string;
    is_demo: boolean;
    timezone: string;
    station_id: number | null;
    station_name: string | null;
  }>(
    `select u.id, u.username, u.display_name, u.role, u.restaurant_id,
            r.name as restaurant_name, r.is_demo, r.timezone,
            u.station_id, st.name as station_name
       from sessions s
       join users u on u.id = s.user_id
       join restaurants r on r.id = u.restaurant_id
       left join stations st on st.id = u.station_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`,
    [hashToken(token)],
  );
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    restaurantIsDemo: row.is_demo,
    timezone: row.timezone,
    stationId: row.station_id,
    stationName: row.station_name,
  };
});

/** Pages: send signed-out visitors to the login screen. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Pages: managers only. Employees are sent to the access-denied screen. */
export async function requireManager(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'manager') redirect('/denied');
  return user;
}

export class AuthError extends Error {
  constructor(message = 'You are not allowed to do that.') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Server actions / route handlers: throw instead of redirecting. */
export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Your session has ended. Sign in again.');
  return user;
}

export async function assertManager(): Promise<CurrentUser> {
  const user = await assertUser();
  if (user.role !== 'manager') throw new AuthError('Only managers can do that.');
  return user;
}

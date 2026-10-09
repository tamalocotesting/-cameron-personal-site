'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuthError, assertManager } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hashPassword, PASSWORD_MIN_LENGTH } from '@/lib/passwords';

export type StaffState = { ok?: boolean; error?: string; message?: string };

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(200, 'That password is too long.');

const addSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3–40 characters using letters, numbers, dot, dash or underscore.'),
  displayName: z.string().trim().min(2, 'Enter the person’s name.').max(80),
  role: z.enum(['employee', 'manager']),
  stationId: z.string().optional(),
  password,
});

function fail(err: unknown): StaffState {
  if (err instanceof AuthError) return { error: err.message };
  console.error(err);
  return { error: 'Could not save. Try again.' };
}

async function validStation(restaurantId: number, raw: string | undefined): Promise<number | null | 'invalid'> {
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return 'invalid';
  const row = await queryOne('select id from stations where id = $1 and restaurant_id = $2', [id, restaurantId]);
  return row ? id : 'invalid';
}

export async function addStaffAction(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await assertManager();
    const v = parsed.data;
    const station = await validStation(user.restaurantId, v.stationId);
    if (station === 'invalid') return { error: 'Choose a valid station.' };
    if (v.role === 'employee' && station === null) return { error: 'Employees need a station so they see the right checklist.' };
    const taken = await queryOne('select id from users where lower(username) = $1', [v.username]);
    if (taken) return { error: `The username “${v.username}” is already taken.` };
    await query(
      `insert into users (restaurant_id, username, display_name, role, station_id, password_hash)
       values ($1, $2, $3, $4, $5, $6)`,
      [user.restaurantId, v.username, v.displayName, v.role, station, await hashPassword(v.password)],
    );
    revalidatePath('/manager/staff');
    return { ok: true, message: `Added ${v.displayName}. Share the username and password with them privately.` };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  userId: z.coerce.number().int().positive(),
  stationId: z.string().optional(),
  active: z.enum(['true', 'false']),
  newPassword: z.union([z.literal(''), password]).optional(),
});

export async function updateStaffAction(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await assertManager();
    const v = parsed.data;
    const target = await queryOne<{ id: number; role: string }>('select id, role from users where id = $1 and restaurant_id = $2', [
      v.userId,
      user.restaurantId,
    ]);
    if (!target) return { error: 'That person was not found.' };
    const active = v.active === 'true';
    if (target.id === user.id && !active) return { error: 'You cannot turn off your own account.' };
    const station = await validStation(user.restaurantId, v.stationId);
    if (station === 'invalid') return { error: 'Choose a valid station.' };
    if (target.role === 'employee' && station === null) return { error: 'Employees need a station.' };

    await query('update users set station_id = $2, active = $3 where id = $1', [target.id, station, active]);
    if (!active) await query('delete from sessions where user_id = $1', [target.id]);
    if (v.newPassword) {
      await query('update users set password_hash = $2, failed_logins = 0, locked_until = null where id = $1', [
        target.id,
        await hashPassword(v.newPassword),
      ]);
      // Sign the person out everywhere so the old password's sessions end.
      if (target.id !== user.id) await query('delete from sessions where user_id = $1', [target.id]);
    }
    revalidatePath('/manager/staff');
    return { ok: true, message: v.newPassword ? 'Saved. The new password works now.' : 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

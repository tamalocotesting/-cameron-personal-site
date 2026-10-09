'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuthError, assertManager } from '@/lib/auth';
import { query } from '@/lib/db';

export type PeriodState = { ok?: boolean; error?: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter start and end dates.');

const schema = z
  .object({
    label: z.string().trim().min(2, 'Give the period a label.').max(80),
    kind: z.enum(['baseline', 'pilot']),
    startDate: date,
    endDate: date,
    expectedRuns: z.coerce.number({ message: 'Enter the expected number of checklists.' }).int('Expected checklists must be a whole number.').min(1, 'Expected checklists must be at least 1.').max(10000),
    source: z.enum(['app', 'manual']),
    manualCompleted: z.string().trim().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date.' });

export async function addPeriodAction(_prev: PeriodState, formData: FormData): Promise<PeriodState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  let manual: number | null = null;
  if (v.source === 'manual') {
    manual = Number(v.manualCompleted);
    if (v.manualCompleted === '' || !Number.isInteger(manual) || manual < 0) {
      return { error: 'Enter how many checklists were completed (from your paper records), or choose “From StationOps records”.' };
    }
  }
  try {
    const user = await assertManager();
    await query(
      `insert into measurement_periods (restaurant_id, label, kind, start_date, end_date, expected_runs, manual_completed_runs, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [user.restaurantId, v.label, v.kind, v.startDate, v.endDate, v.expectedRuns, manual, v.notes || null, user.id],
    );
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    console.error(err);
    return { error: 'Could not save the period. Try again.' };
  }
  revalidatePath('/manager/pilot');
  return { ok: true };
}

export async function deletePeriodAction(formData: FormData): Promise<void> {
  const user = await assertManager();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) return;
  await query('delete from measurement_periods where id = $1 and restaurant_id = $2', [id, user.restaurantId]);
  revalidatePath('/manager/pilot');
}

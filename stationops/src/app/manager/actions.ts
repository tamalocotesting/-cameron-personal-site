'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuthError, assertManager } from '@/lib/auth';
import { query } from '@/lib/db';

export type FormState = { ok?: boolean; error?: string; message?: string };

function fail(err: unknown): FormState {
  if (err instanceof AuthError) return { error: err.message };
  console.error(err);
  return { error: 'Something went wrong while saving. Try again.' };
}

const resolveSchema = z.object({
  issueId: z.coerce.number().int().positive(),
  resolution: z.string().trim().min(3, 'Describe what was done (at least a few words).').max(1000, 'Keep it under 1,000 characters.'),
});

export async function resolveIssueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await assertManager();
    const parsed = resolveSchema.safeParse({ issueId: formData.get('issueId'), resolution: formData.get('resolution') });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const rows = await query(
      `update issues set status = 'resolved', resolution = $3, resolved_by = $4, resolved_at = now()
        where id = $1 and restaurant_id = $2 and status = 'open' returning id`,
      [parsed.data.issueId, user.restaurantId, parsed.data.resolution, user.id],
    );
    if (rows.length === 0) return { error: 'This issue was already resolved or no longer exists. Refresh the page.' };
    revalidatePath('/manager', 'layout');
    return { ok: true, message: 'Resolution saved.' };
  } catch (err) {
    return fail(err);
  }
}

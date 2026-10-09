'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuthError, assertUser } from '@/lib/auth';
import { ChecklistError, startOrResumeTodayRun, submitRun, updateRunItem, type RunItem } from '@/lib/checklists';

const NOTE_MAX = 500;

const changeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('done') }),
  z.object({ action: z.literal('undo') }),
  z.object({
    action: z.literal('block'),
    note: z.string().trim().min(3, 'Describe the problem in a few words so a manager can act on it.').max(NOTE_MAX, `Keep it under ${NOTE_MAX} characters.`),
  }),
  z.object({ action: z.literal('note'), note: z.string().trim().max(NOTE_MAX, `Keep notes under ${NOTE_MAX} characters.`) }),
]);

export type ItemResult = { ok: true; item: RunItem } | { ok: false; error: string };

function friendly(err: unknown): string {
  if (err instanceof ChecklistError || err instanceof AuthError) return err.message;
  console.error(err);
  return 'Could not save. Check your connection and try again.';
}

export async function updateItemAction(itemId: number, change: unknown): Promise<ItemResult> {
  const parsed = changeSchema.safeParse(change);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, error: 'Unknown task.' };
  try {
    const user = await assertUser();
    const item = await updateRunItem(user, itemId, parsed.data);
    revalidatePath('/manager');
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: friendly(err) };
  }
}

export async function startChecklistAction(): Promise<{ error: string } | void> {
  try {
    const user = await assertUser();
    await startOrResumeTodayRun(user);
  } catch (err) {
    return { error: friendly(err) };
  }
  redirect('/station/checklist');
}

export async function submitChecklistAction(runId: number): Promise<{ error: string } | void> {
  try {
    const user = await assertUser();
    await submitRun(user, runId);
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath('/manager');
  redirect('/station/checklist?submitted=1');
}

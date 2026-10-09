'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuthError, assertManager } from '@/lib/auth';
import { TemplateError, createTemplate, saveTemplateVersion } from '@/lib/templates';

const TASK_LIMIT = 40;

const draftSchema = z.object({
  templateId: z.number().int().positive(),
  baseVersionId: z.number().int().positive().nullable(),
  name: z.string().trim().min(3, 'Give the checklist a name (at least 3 characters).').max(120, 'Keep the name under 120 characters.'),
  changeNote: z.string().trim().max(300, 'Keep the change note under 300 characters.').optional(),
  tasks: z
    .array(
      z.object({
        description: z.string().trim().min(3, 'Each task needs a description of at least 3 characters.').max(300, 'Keep each task under 300 characters.'),
        required: z.boolean(),
      }),
    )
    .min(1, 'A checklist needs at least one task.')
    .max(TASK_LIMIT, `A checklist can have at most ${TASK_LIMIT} tasks.`),
});

export type SaveResult = { ok: true; versionNumber: number } | { ok: false; error: string };

export async function saveTemplateAction(input: unknown): Promise<SaveResult> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  try {
    const user = await assertManager();
    const d = parsed.data;
    await saveTemplateVersion(user, d.templateId, d.baseVersionId, { name: d.name, changeNote: d.changeNote, tasks: d.tasks });
    revalidatePath('/manager/templates', 'layout');
  } catch (err) {
    if (err instanceof TemplateError || err instanceof AuthError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: 'Could not save the checklist. Try again.' };
  }
  redirect(`/manager/templates/${parsed.data.templateId}?saved=1`);
}

const createSchema = z.object({
  stationId: z.coerce.number().int().positive('Choose a station.'),
  name: z.string().trim().min(3, 'Give the checklist a name (at least 3 characters).').max(120),
});

export async function createTemplateAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const parsed = createSchema.safeParse({ stationId: formData.get('stationId'), name: formData.get('name') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let id: number;
  try {
    const user = await assertManager();
    id = await createTemplate(user, parsed.data.stationId, parsed.data.name);
  } catch (err) {
    if (err instanceof TemplateError || err instanceof AuthError) return { error: err.message };
    console.error(err);
    return { error: 'Could not create the checklist. Try again.' };
  }
  redirect(`/manager/templates/${id}`);
}

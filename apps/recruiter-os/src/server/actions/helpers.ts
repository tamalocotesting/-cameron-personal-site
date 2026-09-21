'use server';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { isAppError, ValidationError, BlockedError } from '@/server/authz/errors';
import { redactError } from '@/lib/redact';
import type { ActionState } from '@/components/ui/form';

/**
 * One wrapper for every server action.
 *
 * It turns a thrown domain error into a state the UI can EXPLAIN: a blocked
 * send says which configuration or permission blocked it, a validation error
 * keeps its per-field messages, and anything unexpected is logged with the
 * applicant content stripped out and reported as a generic failure rather than
 * leaking an internal message to the browser.
 */
export async function runAction(
  fn: () => Promise<{ message: string; revalidate?: string[] }>,
): Promise<ActionState> {
  try {
    const result = await fn();
    for (const path of result.revalidate ?? []) revalidatePath(path);
    return { status: 'ok', message: result.message };
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || 'form';
        fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
      }
      return { status: 'error', message: 'Check the highlighted fields.', fieldErrors };
    }
    if (error instanceof ValidationError) {
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof BlockedError) {
      return { status: 'blocked', message: error.message };
    }
    if (isAppError(error)) {
      return { status: 'error', message: error.message };
    }
    const info = redactError(error);
    console.error('[action] unexpected failure', info);
    return {
      status: 'error',
      message: 'Something went wrong on the server. Nothing was changed. Try again, or reload the page.',
    };
  }
}

export async function formString(data: FormData, key: string): Promise<string> {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

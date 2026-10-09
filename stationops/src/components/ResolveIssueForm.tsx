'use client';

import { useFormAction } from '@/components/useFormAction';
import { resolveIssueAction, type FormState } from '@/app/manager/actions';

export function ResolveIssueForm({ issueId }: { issueId: number }) {
  const [state, onSubmit, pending] = useFormAction(resolveIssueAction, {});
  if (state.ok) return <p role="status" className="text-sm font-semibold text-done">{state.message}</p>;
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="issueId" value={issueId} />
      <label htmlFor={`resolution-${issueId}`} className="block text-sm font-semibold">
        Resolution
      </label>
      <textarea
        id={`resolution-${issueId}`}
        name="resolution"
        rows={2}
        maxLength={1000}
        required
        placeholder="What was done, and by whom?"
        className="block w-full rounded-lg border border-line px-3 py-2 text-sm"
      />
      {state.error && (
        <p role="alert" className="text-sm font-medium text-blocked">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? 'Saving…' : 'Mark resolved'}
      </button>
    </form>
  );
}

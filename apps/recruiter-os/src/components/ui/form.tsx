'use client';
import * as React from 'react';
import { useActionState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { Button, Notice } from './index';
import { cn } from '@/lib/utils';

/**
 * Every mutation in the workspace goes through a server action wrapped in this
 * form, which gives each one the same four things: a pending state, a visible
 * success confirmation, a readable failure that says WHY (including a blocked
 * configuration or a missing permission), and recoverability — a failed
 * submission never loses what was typed.
 */

export type ActionState = {
  status: 'idle' | 'ok' | 'error' | 'blocked';
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const idleState: ActionState = { status: 'idle' };

export function ActionForm({
  action,
  children = null,
  submitLabel,
  submitVariant = 'primary',
  pendingLabel,
  onSuccess,
  className,
  footer,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children?: React.ReactNode | ((state: ActionState) => React.ReactNode);
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary' | 'danger' | 'ready';
  pendingLabel?: string;
  onSuccess?: () => void;
  className?: string;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  React.useEffect(() => {
    if (state.status === 'ok') onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className={cn('space-y-3', className)}>
      {typeof children === 'function' ? children(state) : children}

      {state.status === 'error' ? (
        <Notice tone="review" icon={<AlertTriangle size={14} />} title="That did not save">
          {state.message ?? 'Something went wrong.'}
        </Notice>
      ) : null}
      {state.status === 'blocked' ? (
        <Notice tone="pending" icon={<AlertTriangle size={14} />} title="Blocked">
          {state.message}
        </Notice>
      ) : null}
      {state.status === 'ok' ? (
        <Notice tone="ready" icon={<Check size={14} />}>
          {state.message ?? 'Saved.'}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant={submitVariant} disabled={pending}>
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              {pendingLabel ?? 'Saving…'}
            </>
          ) : (
            submitLabel
          )}
        </Button>
        {footer}
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? 'Saving' : state.status === 'ok' ? 'Saved' : ''}
      </p>
    </form>
  );
}

export function FieldError({ state, name }: { state: ActionState; name: string }) {
  const errors = state.fieldErrors?.[name];
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-[12px] font-medium text-review">
      {errors.join(' ')}
    </p>
  );
}

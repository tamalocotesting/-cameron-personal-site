'use client';

import { useActionState, useTransition, type FormEvent } from 'react';

/**
 * useActionState, submitted through onSubmit instead of the form `action`
 * prop. React 19 resets a form after an action-prop submission, which would
 * wipe everything a manager typed whenever validation fails. Forms using this
 * hook keep their values and reset themselves only on success.
 */
export function useFormAction<S extends object>(action: (prev: Awaited<S>, formData: FormData) => Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  const [, startTransition] = useTransition();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return [state, onSubmit, pending] as const;
}

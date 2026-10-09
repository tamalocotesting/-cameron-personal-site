'use client';

import { useState, useTransition } from 'react';
import { startChecklistAction } from './actions';
import { ErrorNote } from '@/components/ui';

export function StartButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await startChecklistAction();
            if (result?.error) setError(result.error);
          })
        }
        className="w-full rounded-xl bg-navy-900 px-5 py-4 text-lg font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
      >
        {pending ? 'Opening…' : label}
      </button>
    </div>
  );
}

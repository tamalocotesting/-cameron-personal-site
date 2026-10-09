'use client';

import { useFormAction } from '@/components/useFormAction';
import { useEffect, useRef, useState } from 'react';
import { addPeriodAction, type PeriodState } from './actions';

export function PeriodForm() {
  const [state, onSubmit, pending] = useFormAction(addPeriodAction, {});
  const [source, setSource] = useState<'app' | 'manual'>('app');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  const field = 'block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm';

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" aria-label="Add measurement period">
      <div className="sm:col-span-2">
        <label htmlFor="label" className="mb-1 block text-xs font-semibold">Label</label>
        <input id="label" name="label" required maxLength={80} placeholder="e.g. Paper checklist baseline" className={field} />
      </div>
      <div>
        <label htmlFor="kind" className="mb-1 block text-xs font-semibold">Type</label>
        <select id="kind" name="kind" className={field}>
          <option value="baseline">Baseline (before the pilot)</option>
          <option value="pilot">Pilot (using StationOps)</option>
        </select>
      </div>
      <div>
        <label htmlFor="expectedRuns" className="mb-1 block text-xs font-semibold">Expected checklists</label>
        <input id="expectedRuns" name="expectedRuns" type="number" min={1} step={1} required className={field} aria-describedby="expected-help" />
        <p id="expected-help" className="mt-1 text-xs text-muted">From the shift schedule: opening shifts × stations in the period.</p>
      </div>
      <div>
        <label htmlFor="startDate" className="mb-1 block text-xs font-semibold">Start date</label>
        <input id="startDate" name="startDate" type="date" required className={field} />
      </div>
      <div>
        <label htmlFor="endDate" className="mb-1 block text-xs font-semibold">End date</label>
        <input id="endDate" name="endDate" type="date" required className={field} />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-semibold">Completed count comes from</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="source" value="app" checked={source === 'app'} onChange={() => setSource('app')} />
            StationOps records
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="source" value="manual" checked={source === 'manual'} onChange={() => setSource('manual')} />
            Entered manually (e.g. paper checklists)
          </label>
        </div>
      </fieldset>
      {source === 'manual' && (
        <div>
          <label htmlFor="manualCompleted" className="mb-1 block text-xs font-semibold">Fully completed checklists</label>
          <input id="manualCompleted" name="manualCompleted" type="number" min={0} step={1} required className={field} />
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor="notes" className="mb-1 block text-xs font-semibold">Notes (optional)</label>
        <input id="notes" name="notes" maxLength={500} placeholder="Where the numbers came from" className={field} />
      </div>
      {state.error && <p role="alert" className="text-sm font-medium text-blocked sm:col-span-2">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm font-semibold text-done sm:col-span-2">Period added.</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          Add period
        </button>
      </div>
    </form>
  );
}

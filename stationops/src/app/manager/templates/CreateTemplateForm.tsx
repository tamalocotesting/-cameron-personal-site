'use client';

import { useFormAction } from '@/components/useFormAction';
import { createTemplateAction } from './actions';

export function CreateTemplateForm({ stations }: { stations: { id: number; name: string }[] }) {
  const [state, onSubmit, pending] = useFormAction(createTemplateAction, {});
  const field = 'block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm';
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <div>
        <label htmlFor="stationId" className="mb-1 block text-xs font-semibold">Station</label>
        <select id="stationId" name="stationId" className={field} required>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="name" className="mb-1 block text-xs font-semibold">Checklist name</label>
        <input id="name" name="name" required maxLength={120} placeholder="e.g. Grill Station — Opening" className={field} />
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        Create
      </button>
      {state.error && <p role="alert" className="text-sm font-medium text-blocked sm:col-span-3">{state.error}</p>}
    </form>
  );
}

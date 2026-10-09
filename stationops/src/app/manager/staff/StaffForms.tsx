'use client';

import { useFormAction } from '@/components/useFormAction';
import { useEffect, useRef } from 'react';
import { addStaffAction, updateStaffAction, type StaffState } from './actions';

type Station = { id: number; name: string };
const field = 'block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm';

function Feedback({ state }: { state: StaffState }) {
  if (state.error) return <p role="alert" className="text-sm font-medium text-blocked">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm font-semibold text-done">{state.message}</p>;
  return null;
}

export function AddStaffForm({ stations }: { stations: Station[] }) {
  const [state, onSubmit, pending] = useFormAction(addStaffAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" aria-label="Add a person">
      <div>
        <label htmlFor="new-name" className="mb-1 block text-xs font-semibold">Name</label>
        <input id="new-name" name="displayName" required maxLength={80} className={field} />
      </div>
      <div>
        <label htmlFor="new-username" className="mb-1 block text-xs font-semibold">Username</label>
        <input id="new-username" name="username" required autoCapitalize="none" spellCheck={false} maxLength={40} className={field} />
      </div>
      <div>
        <label htmlFor="new-role" className="mb-1 block text-xs font-semibold">Role</label>
        <select id="new-role" name="role" className={field}>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <div>
        <label htmlFor="new-station" className="mb-1 block text-xs font-semibold">Station</label>
        <select id="new-station" name="stationId" className={field}>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value="">None (managers only)</option>
        </select>
      </div>
      <div>
        <label htmlFor="new-password" className="mb-1 block text-xs font-semibold">Temporary password</label>
        <input id="new-password" name="password" type="text" autoComplete="new-password" required minLength={8} className={field} />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
        <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          Add person
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function EditStaffForm({
  person,
  stations,
  isSelf,
}: {
  person: { id: number; station_id: number | null; active: boolean; display_name: string };
  stations: Station[];
  isSelf: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(updateStaffAction, {});
  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="userId" value={person.id} />
      <div>
        <label htmlFor={`station-${person.id}`} className="mb-1 block text-xs font-semibold">Station</label>
        <select id={`station-${person.id}`} name="stationId" defaultValue={person.station_id ?? ''} className={field}>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value="">None</option>
        </select>
      </div>
      <div>
        <label htmlFor={`active-${person.id}`} className="mb-1 block text-xs font-semibold">Access</label>
        <select id={`active-${person.id}`} name="active" defaultValue={String(person.active)} disabled={isSelf} className={field}>
          <option value="true">Active</option>
          <option value="false">Turned off</option>
        </select>
        {isSelf && <input type="hidden" name="active" value="true" />}
      </div>
      <div>
        <label htmlFor={`pw-${person.id}`} className="mb-1 block text-xs font-semibold">New password (optional)</label>
        <input id={`pw-${person.id}`} name="newPassword" type="text" autoComplete="new-password" minLength={8} className={field} />
      </div>
      <button type="submit" disabled={pending} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-60">
        Save
      </button>
      <div className="sm:col-span-4">
        <Feedback state={state} />
      </div>
    </form>
  );
}

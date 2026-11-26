let csrf = '';
export const setCsrf = (c: string) => { csrf = c; };

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(csrf ? { 'x-csrf': csrf } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

export type Kind = 'verified' | 'forecast' | 'assumption' | 'missing' | 'known';
export interface Figure { value: number | null; kind: Kind; lo?: number; hi?: number; unit?: string; basis: string }
export interface User { id: number; username: string; display_name: string; role: 'crew' | 'lead' | 'manager' | 'owner'; lang: 'en' | 'es'; station: string | null }
export const RANK = { crew: 1, lead: 2, manager: 3, owner: 4 } as const;
export const can = (u: User | null, min: keyof typeof RANK) => !!u && RANK[u.role] >= RANK[min];

/** Offline resilience for the kitchen tablet: remember the last plan per date. */
export function cachePlan(date: string, plan: unknown) { try { localStorage.setItem(`plan:${date}`, JSON.stringify({ at: Date.now(), plan })); } catch { /* ignore */ } }
export function cachedPlan(date: string): { at: number; plan: any } | null { try { const s = localStorage.getItem(`plan:${date}`); return s ? JSON.parse(s) : null; } catch { return null; } }

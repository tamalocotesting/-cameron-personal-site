import type { RunState } from '@/lib/progress';
import { RUN_STATE_LABEL } from '@/lib/progress';

const STATE_STYLE: Record<RunState, string> = {
  not_started: 'bg-slate-100 text-slate-700 ring-slate-300',
  in_progress: 'bg-warn-soft text-warn ring-warn/30',
  complete: 'bg-done-soft text-done ring-done/30',
  exceptions: 'bg-blocked-soft text-blocked ring-blocked/30',
};

export function RunStateBadge({ state }: { state: RunState }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATE_STYLE[state]}`}>
      {RUN_STATE_LABEL[state]}
    </span>
  );
}

export function Badge({ tone, children }: { tone: 'done' | 'warn' | 'blocked' | 'neutral'; children: React.ReactNode }) {
  const style = {
    done: 'bg-done-soft text-done ring-done/30',
    warn: 'bg-warn-soft text-warn ring-warn/30',
    blocked: 'bg-blocked-soft text-blocked ring-blocked/30',
    neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${style}`}>{children}</span>
  );
}

export function ProgressBar({ percent, label }: { percent: number | null; label: string }) {
  const value = percent ?? 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <div className="h-full rounded-full bg-done transition-[width]" style={{ width: `${value}%` }} />
    </div>
  );
}

export function SampleBanner() {
  return (
    <div className="bg-warn-soft px-4 py-2 text-center text-xs font-semibold text-warn">
      Demo environment — every restaurant, person and record here is sample data.
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-line bg-white ${className}`}>{children}</section>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-blocked/30 bg-blocked-soft px-4 py-3 text-sm font-medium text-blocked">
      {children}
    </p>
  );
}

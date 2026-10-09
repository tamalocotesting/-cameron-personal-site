/** Pure checklist math, shared by the server and the browser. */

export type ItemStatus = 'pending' | 'done' | 'blocked';

export type ProgressItem = { required: boolean; status: ItemStatus };

export type Progress = {
  total: number;
  answered: number;
  done: number;
  blocked: number;
  requiredTotal: number;
  requiredDone: number;
  requiredOpen: number;
  requiredBlocked: number;
  /** Required tasks done ÷ required tasks, 0–100. Null when nothing is required. */
  percent: number | null;
  /** True only when every required task is done (none pending, none blocked). */
  allRequiredDone: boolean;
};

export function computeProgress(items: ProgressItem[]): Progress {
  const required = items.filter((i) => i.required);
  const requiredDone = required.filter((i) => i.status === 'done').length;
  const requiredBlocked = required.filter((i) => i.status === 'blocked').length;
  return {
    total: items.length,
    answered: items.filter((i) => i.status !== 'pending').length,
    done: items.filter((i) => i.status === 'done').length,
    blocked: items.filter((i) => i.status === 'blocked').length,
    requiredTotal: required.length,
    requiredDone,
    requiredOpen: required.length - requiredDone - requiredBlocked,
    requiredBlocked,
    percent: required.length === 0 ? null : Math.round((requiredDone / required.length) * 100),
    allRequiredDone: requiredDone === required.length,
  };
}

/** The outcome recorded at submission. "complete" is never given while a required task is open or blocked. */
export function submissionOutcome(items: ProgressItem[]): 'complete' | 'exceptions' {
  return computeProgress(items).allRequiredDone ? 'complete' : 'exceptions';
}

export type RunState = 'not_started' | 'in_progress' | 'complete' | 'exceptions';

export const RUN_STATE_LABEL: Record<RunState, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  exceptions: 'Submitted with exceptions',
};

export function runState(run: { status: string; outcome: string | null } | null): RunState {
  if (!run) return 'not_started';
  if (run.status !== 'submitted') return 'in_progress';
  return run.outcome === 'complete' ? 'complete' : 'exceptions';
}

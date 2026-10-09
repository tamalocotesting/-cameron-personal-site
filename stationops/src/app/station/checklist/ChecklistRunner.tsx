'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { RunItem } from '@/lib/checklists';
import { computeProgress } from '@/lib/progress';
import { ErrorNote, ProgressBar } from '@/components/ui';
import { submitChecklistAction, updateItemAction } from '../actions';

type Change = { action: 'done' } | { action: 'undo' } | { action: 'block'; note: string } | { action: 'note'; note: string };

function timeLabel(value: Date | string | null, timeZone: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function ChecklistRunner({
  runId,
  initialItems,
  timeZone,
  readOnly,
}: {
  runId: number;
  initialItems: RunItem[];
  timeZone: string;
  readOnly: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const progress = computeProgress(items);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const replace = (item: RunItem) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));

  const openRequired = items.filter((i) => i.required && i.status === 'pending');
  const flagged = items.filter((i) => i.status === 'blocked');

  return (
    <>
      <ol className="space-y-3" aria-label="Checklist tasks">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} timeZone={timeZone} readOnly={readOnly} onSaved={replace} />
        ))}
      </ol>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto max-w-2xl space-y-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <ProgressBar percent={progress.percent} label="Required tasks done" />
              <span className="shrink-0 text-sm font-semibold tabular-nums" aria-live="polite">
                {progress.requiredDone}/{progress.requiredTotal} required
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                dialogRef.current?.showModal();
              }}
              className="w-full rounded-xl bg-navy-900 px-5 py-3.5 text-base font-semibold text-white hover:bg-navy-800"
            >
              Review and submit
            </button>
          </div>
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="submit-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 backdrop:bg-navy-950/60"
      >
        <div className="space-y-4 p-5">
          <h2 id="submit-title" className="text-lg font-bold">
            {progress.allRequiredDone && flagged.length === 0 ? 'Submit checklist?' : 'Submit with exceptions?'}
          </h2>
          {progress.allRequiredDone && flagged.length === 0 ? (
            <p className="text-muted">All {progress.requiredTotal} required tasks are done.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted">This checklist is not fully complete. It will be sent to your manager with these exceptions:</p>
              {openRequired.length > 0 && (
                <div>
                  <p className="font-semibold text-warn">Required tasks not done ({openRequired.length})</p>
                  <ul className="mt-1 list-disc pl-5">
                    {openRequired.map((i) => (
                      <li key={i.id}>{i.description}</li>
                    ))}
                  </ul>
                </div>
              )}
              {flagged.length > 0 && (
                <div>
                  <p className="font-semibold text-blocked">Flagged problems ({flagged.length})</p>
                  <ul className="mt-1 list-disc pl-5">
                    {flagged.map((i) => (
                      <li key={i.id}>
                        {i.description} — <span className="italic">{i.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="text-sm text-muted">After you submit, the checklist can no longer be changed.</p>
          {submitError && <ErrorNote>{submitError}</ErrorNote>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-xl border border-line px-5 py-3 font-semibold"
            >
              Go back
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                startSubmit(async () => {
                  const result = await submitChecklistAction(runId);
                  if (result?.error) setSubmitError(result.error);
                })
              }
              className="rounded-xl bg-navy-900 px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : progress.allRequiredDone && flagged.length === 0 ? 'Submit' : 'Submit with exceptions'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function ItemCard({
  item,
  timeZone,
  readOnly,
  onSaved,
}: {
  item: RunItem;
  timeZone: string;
  readOnly: boolean;
  onSaved: (item: RunItem) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'flag' | 'note'>('idle');
  const [draft, setDraft] = useState(item.note ?? '');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(t);
  }, [savedFlash]);

  const save = (change: Change, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await updateItemAction(item.id, change);
      if (result.ok) {
        onSaved(result.item);
        setDraft(result.item.note ?? '');
        setSavedFlash(true);
        after?.();
      } else {
        setError(result.error);
      }
    });

  const done = item.status === 'done';
  const blocked = item.status === 'blocked';
  const descId = `task-${item.id}-desc`;

  return (
    <li
      className={`rounded-2xl border bg-white p-4 ${
        blocked ? 'border-blocked/50 ring-1 ring-blocked/20' : done ? 'border-done/40' : 'border-line'
      }`}
      data-testid="task"
      data-status={item.status}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-describedby={descId}
          aria-label={done ? `Mark task ${item.position} not done` : `Mark task ${item.position} done`}
          disabled={readOnly || pending}
          onClick={() => save(done ? { action: 'undo' } : { action: 'done' })}
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl border-2 text-2xl font-bold disabled:cursor-not-allowed ${
            done ? 'border-done bg-done text-white' : 'border-slate-400 bg-white text-transparent hover:border-done'
          } ${pending ? 'opacity-60' : ''}`}
        >
          <span aria-hidden>✓</span>
        </button>
        <div className="min-w-0 flex-1">
          <p id={descId} className={`text-base font-semibold leading-snug ${done ? 'text-muted line-through decoration-done/60' : ''}`}>
            <span className="text-muted">{item.position}.</span> {item.description}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className={item.required ? 'font-semibold text-navy-700' : ''}>{item.required ? 'Required' : 'Optional'}</span>
            {done && item.completed_at && (
              <span suppressHydrationWarning>
                Done {timeLabel(item.completed_at, timeZone)} · {item.completed_by_name}
              </span>
            )}
            {blocked && item.flagged_at && (
              <span className="font-semibold text-blocked" suppressHydrationWarning>
                Flagged {timeLabel(item.flagged_at, timeZone)} · {item.flagged_by_name}
              </span>
            )}
            {pending && <span>Saving…</span>}
            {savedFlash && !pending && (
              <span className="text-done" role="status">
                Saved
              </span>
            )}
          </div>
        </div>
      </div>

      {blocked && mode !== 'flag' && (
        <div className="mt-3 rounded-xl bg-blocked-soft px-4 py-3 text-sm">
          <p className="font-semibold text-blocked">Problem reported</p>
          <p className="mt-0.5 whitespace-pre-wrap">{item.note}</p>
        </div>
      )}
      {!blocked && item.note && mode !== 'note' && (
        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas px-4 py-2.5 text-sm">
          <span className="font-semibold">Note: </span>
          {item.note}
        </p>
      )}

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {!readOnly && mode !== 'idle' && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(mode === 'flag' ? { action: 'block', note: draft } : { action: 'note', note: draft }, () => setMode('idle'));
          }}
        >
          <label htmlFor={`note-${item.id}`} className="block text-sm font-semibold">
            {mode === 'flag' ? 'What is the problem?' : 'Note'}
          </label>
          <textarea
            id={`note-${item.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={500}
            required={mode === 'flag'}
            placeholder={mode === 'flag' ? 'e.g. Walk-in cooler reads 44°F' : 'Optional note for this task'}
            className="block w-full rounded-lg border border-line px-3 py-2 text-base"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${
                mode === 'flag' ? 'bg-blocked' : 'bg-navy-900'
              }`}
            >
              {mode === 'flag' ? (blocked ? 'Update problem' : 'Flag problem') : 'Save note'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('idle');
                setDraft(item.note ?? '');
                setError(null);
              }}
              className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!readOnly && mode === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {blocked ? (
            <>
              <button
                type="button"
                onClick={() => setMode('flag')}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold"
              >
                Edit problem
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => save({ action: 'undo' })}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold"
              >
                Clear flag
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(item.note ?? '');
                  setMode('flag');
                }}
                className="rounded-lg border border-blocked/40 px-3 py-2 text-sm font-semibold text-blocked"
              >
                Report a problem
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(item.note ?? '');
                  setMode('note');
                }}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold"
              >
                {item.note ? 'Edit note' : 'Add note'}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

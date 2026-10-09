'use client';

import { useState, useTransition } from 'react';
import { ErrorNote } from '@/components/ui';
import { saveTemplateAction } from '../actions';

type DraftTask = { key: string; description: string; required: boolean };

let keySeq = 0;
const newKey = () => `t${++keySeq}`;

export function TemplateEditor({
  templateId,
  baseVersionId,
  initialName,
  initialTasks,
}: {
  templateId: number;
  baseVersionId: number | null;
  initialName: string;
  initialTasks: { description: string; required: boolean }[];
}) {
  const [name, setName] = useState(initialName);
  const [tasks, setTasks] = useState<DraftTask[]>(() => initialTasks.map((t) => ({ ...t, key: newKey() })));
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const dirty =
    name !== initialName ||
    tasks.length !== initialTasks.length ||
    tasks.some((t, i) => t.description !== initialTasks[i]?.description || t.required !== initialTasks[i]?.required);

  const update = (key: string, patch: Partial<DraftTask>) => setTasks((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const move = (index: number, delta: number) =>
    setTasks((ts) => {
      const next = [...ts];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });

  const save = () =>
    startSave(async () => {
      setError(null);
      const result = await saveTemplateAction({
        templateId,
        baseVersionId,
        name,
        changeNote: changeNote || undefined,
        tasks: tasks.map(({ description, required }) => ({ description, required })),
      });
      if (result && !result.ok) setError(result.error);
    });

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="template-name" className="mb-1 block text-sm font-semibold">Checklist name</label>
        <input
          id="template-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          className="block w-full rounded-lg border border-line bg-white px-3 py-2.5"
        />
      </div>

      <ol className="space-y-2" aria-label="Tasks">
        {tasks.map((task, index) => (
          <li key={task.key} className="rounded-xl border border-line bg-white p-3" data-testid="template-task">
            <div className="flex items-start gap-2">
              <span className="mt-2.5 w-6 shrink-0 text-right text-sm font-semibold text-muted">{index + 1}.</span>
              <div className="min-w-0 flex-1 space-y-2">
                <label htmlFor={`task-${task.key}`} className="sr-only">Task {index + 1} description</label>
                <textarea
                  id={`task-${task.key}`}
                  value={task.description}
                  rows={2}
                  maxLength={300}
                  onChange={(e) => update(task.key, { description: e.target.value })}
                  className="block w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="mr-auto flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={task.required}
                      onChange={(e) => update(task.key, { required: e.target.checked })}
                      className="size-5 accent-[var(--color-navy-700)]"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move task ${index + 1} up`}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
                  >
                    ↑ Up
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === tasks.length - 1}
                    aria-label={`Move task ${index + 1} down`}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
                  >
                    ↓ Down
                  </button>
                  <button
                    type="button"
                    onClick={() => setTasks((ts) => ts.filter((t) => t.key !== task.key))}
                    aria-label={`Remove task ${index + 1}`}
                    className="rounded-lg border border-blocked/40 px-3 py-1.5 text-sm font-semibold text-blocked"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setTasks((ts) => [...ts, { key: newKey(), description: '', required: true }])}
        className="w-full rounded-xl border-2 border-dashed border-line px-4 py-3 text-sm font-semibold text-navy-700 hover:border-navy-600"
      >
        + Add task
      </button>

      <div className="space-y-3 rounded-xl border border-line bg-white p-4">
        <div>
          <label htmlFor="change-note" className="mb-1 block text-sm font-semibold">What changed? (optional)</label>
          <input
            id="change-note"
            value={changeNote}
            maxLength={300}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="e.g. Added sanitizer test strip check"
            className="block w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </div>
        <p className="text-sm text-muted">
          Saving creates a new version. It applies to checklists started from now on. Today’s checklist, if it has already been started, and all past
          checklists keep their original tasks.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg bg-navy-900 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : dirty ? 'Save new version' : 'No changes to save'}
        </button>
      </div>
    </div>
  );
}

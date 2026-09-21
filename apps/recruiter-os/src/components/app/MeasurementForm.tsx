'use client';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import { recordMeasurementAction } from '@/server/actions/workspace-actions';

/**
 * Baseline / observation entry.
 *
 * Small on purpose: a task type, a period, a sample count, a comparable mean,
 * and the methodology. Nothing here estimates anything.
 */
export function MeasurementForm() {
  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <p className="mb-2 text-[13px] font-semibold text-ink">Record a measurement</p>
      <ActionForm action={recordMeasurementAction} submitLabel="Record measurement">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Task type" htmlFor="m-task" required hint="e.g. prepare-case-file, first-contact">
            <Input id="m-task" name="taskType" required />
          </Field>
          <Field label="Measurement" htmlFor="m-kind" required>
            <Select id="m-kind" name="measurementKind" required defaultValue="baseline">
              <option value="baseline">Baseline (before)</option>
              <option value="observation">Observation (with RecruiterOS)</option>
            </Select>
          </Field>
          <Field label="Period start" htmlFor="m-start" required>
            <Input id="m-start" name="periodStart" type="date" required />
          </Field>
          <Field label="Period end" htmlFor="m-end" required>
            <Input id="m-end" name="periodEnd" type="date" required />
          </Field>
          <Field label="Sample count" htmlFor="m-sample" required>
            <Input id="m-sample" name="sampleCount" type="number" min={1} required />
          </Field>
          <Field label="Mean minutes per unit" htmlFor="m-mean" required>
            <Input id="m-mean" name="meanMinutes" type="number" step="0.1" min={0} required />
          </Field>
        </div>
        <Field label="Methodology" htmlFor="m-method" required hint="How the time was measured, and by whom.">
          <Textarea id="m-method" name="methodology" rows={3} required />
        </Field>
      </ActionForm>
    </div>
  );
}

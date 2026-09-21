'use client';
import { Field, Input, Textarea } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import { duplicateIntakeVersionAction, publishIntakeVersionAction } from '@/server/actions/workspace-actions';

export function IntakeVersionForms({
  versionId,
  state,
  greeting,
  completionText,
  handoffText,
}: {
  versionId: string;
  state: string;
  greeting: string;
  completionText: string;
  handoffText: string;
}) {
  return (
    <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-2">
      {state !== 'PUBLISHED' && state !== 'RETIRED' ? (
        <ActionForm action={publishIntakeVersionAction} submitLabel="Approve and publish" submitVariant="ready">
          <input type="hidden" name="intakeVersionId" value={versionId} />
          <Field
            label="Approval note"
            htmlFor={`approve-${versionId}`}
            required
            hint="Who reviewed this and on what basis. Recorded in the audit trail."
          >
            <Input id={`approve-${versionId}`} name="approvalNote" required />
          </Field>
        </ActionForm>
      ) : null}

      <ActionForm action={duplicateIntakeVersionAction} submitLabel="Create a new draft from this version">
        <input type="hidden" name="intakeVersionId" value={versionId} />
        <Field label="Greeting" htmlFor={`greeting-${versionId}`}>
          <Textarea id={`greeting-${versionId}`} name="greeting" rows={3} defaultValue={greeting} />
        </Field>
        <Field label="Completion text" htmlFor={`completion-${versionId}`}>
          <Textarea id={`completion-${versionId}`} name="completionText" rows={2} defaultValue={completionText} />
        </Field>
        <Field label="Handoff text" htmlFor={`handoff-${versionId}`}>
          <Textarea id={`handoff-${versionId}`} name="handoffText" rows={2} defaultValue={handoffText} />
        </Field>
      </ActionForm>
    </div>
  );
}

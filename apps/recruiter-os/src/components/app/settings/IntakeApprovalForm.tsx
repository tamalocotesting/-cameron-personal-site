'use client';
import { Field, Textarea } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import { recordIntakeApprovalAction } from '@/server/actions/workspace-actions';

export function IntakeApprovalForm() {
  return (
    <ActionForm action={recordIntakeApprovalAction} submitLabel="Record approval">
      <Field
        label="What was approved, by whom, and when"
        htmlFor="approval-note"
        required
        hint="Written into the audit trail as an internal record."
      >
        <Textarea id="approval-note" name="note" rows={3} required />
      </Field>
    </ActionForm>
  );
}

'use client';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, FieldError } from '@/components/ui/form';
import { createTemplateDraftAction, publishTemplateAction } from '@/server/actions/workspace-actions';

export function TemplateForms({
  mode,
  templateVersionId,
}: {
  mode: 'create' | 'publish';
  templateVersionId?: string;
}) {
  if (mode === 'publish' && templateVersionId) {
    return (
      <ActionForm action={publishTemplateAction} submitLabel="Approve and publish" submitVariant="ready">
        <input type="hidden" name="templateVersionId" value={templateVersionId} />
      </ActionForm>
    );
  }

  return (
    <ActionForm action={createTemplateDraftAction} submitLabel="Save draft">
      {(state) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Key" htmlFor="t-key" required hint="Stable identifier the code refers to.">
              <Input id="t-key" name="templateKey" required />
              <FieldError state={state} name="templateKey" />
            </Field>
            <Field label="Name" htmlFor="t-name" required>
              <Input id="t-name" name="name" required />
            </Field>
          </div>
          <Field label="Kind" htmlFor="t-kind" required>
            <Select id="t-kind" name="kind" required defaultValue="RECRUITER_MANUAL">
              <option value="ACKNOWLEDGMENT">Acknowledgment</option>
              <option value="INTAKE_INVITATION">Intake invitation</option>
              <option value="APPOINTMENT_REMINDER">Appointment reminder</option>
              <option value="RECRUITER_MANUAL">Recruiter-sent only</option>
            </Select>
          </Field>
          <Field
            label="Body"
            htmlFor="t-body"
            required
            hint="Use {{placeholder}} form. {{first_name}} is always available."
          >
            <Textarea id="t-body" name="body" rows={4} required />
            <FieldError state={state} name="body" />
          </Field>
          <Field label="Declared placeholders" htmlFor="t-placeholders" hint="Comma separated.">
            <Input id="t-placeholders" name="placeholders" />
            <FieldError state={state} name="placeholders" />
          </Field>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="automatable" className="mt-1" />
            <span>Allow automation (only takes effect for the three allowlisted kinds).</span>
          </label>
        </>
      )}
    </ActionForm>
  );
}

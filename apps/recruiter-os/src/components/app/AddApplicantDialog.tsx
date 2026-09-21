'use client';
import { UserPlus } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, FieldError } from '@/components/ui/form';
import { addApplicantAction } from '@/server/actions/workspace-actions';

export function AddApplicantDialog({
  members,
  defaultTimezone,
}: {
  members: Array<{ id: string; displayName: string }>;
  defaultTimezone: string;
}) {
  return (
    <Dialog
      title="Add an applicant"
      description="Creates a case with an accountable owner and a dated next step, the same way a web inquiry does."
      trigger={(open) => (
        <Button size="md" variant="primary" onClick={open}>
          <UserPlus size={14} aria-hidden="true" /> Add applicant
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={addApplicantAction} submitLabel="Create case" onSuccess={close}>
          {(state) => (
            <>
              <Field label="Name" htmlFor="add-name" required>
                <Input id="add-name" name="displayName" required />
                <FieldError state={state} name="displayName" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone" htmlFor="add-phone" hint="10-digit US number.">
                  <Input id="add-phone" name="phone" inputMode="tel" />
                  <FieldError state={state} name="phone" />
                </Field>
                <Field label="Email" htmlFor="add-email">
                  <Input id="add-email" name="email" type="email" />
                  <FieldError state={state} name="email" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="General location" htmlFor="add-location">
                  <Input id="add-location" name="generalLocation" />
                </Field>
                <Field label="Timezone" htmlFor="add-tz">
                  <Input id="add-tz" name="timezone" defaultValue={defaultTimezone} />
                </Field>
              </div>
              <Field label="Owner" htmlFor="add-owner" hint="Leave on routing to use the configured rule.">
                <Select id="add-owner" name="ownerMemberId" defaultValue="">
                  <option value="">Use configured routing</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How they got in touch" htmlFor="add-origin" required>
                <Select id="add-origin" name="originKind" required defaultValue="manual">
                  <option value="manual">Added by a recruiter</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="referral">Referral</option>
                  <option value="event">Event</option>
                </Select>
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

'use client';
import { Field, Input, Notice } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import {
  approveRetentionPolicyAction,
  createRetentionPolicyAction,
  runRetentionAction,
} from '@/server/actions/workspace-actions';

export function RetentionForms({
  mode = 'manage',
  policyId,
  approved,
  enabled,
  mayRun,
}: {
  mode?: 'create' | 'manage';
  policyId?: string;
  approved?: boolean;
  enabled?: boolean;
  mayRun: boolean;
}) {
  if (mode === 'create') {
    return (
      <ActionForm action={createRetentionPolicyAction} submitLabel="Create policy">
        <Field label="Name" htmlFor="rp-name" required>
          <Input id="rp-name" name="name" required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Delete closed cases after (days)" htmlFor="rp-closed" hint="Blank keeps them indefinitely.">
            <Input id="rp-closed" name="closedCaseRetentionDays" type="number" min={1} />
          </Field>
          <Field label="Delete briefs after (days)" htmlFor="rp-brief">
            <Input id="rp-brief" name="briefRetentionDays" type="number" min={1} />
          </Field>
          <Field label="Delete stored provider payloads after (days)" htmlFor="rp-webhook">
            <Input id="rp-webhook" name="webhookPayloadRetentionDays" type="number" min={1} />
          </Field>
          <Field label="Minimize audit metadata after (days)" htmlFor="rp-audit">
            <Input id="rp-audit" name="auditMetadataRetentionDays" type="number" min={1} />
          </Field>
        </div>
      </ActionForm>
    );
  }

  if (!policyId) return null;

  return (
    <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-3">
      <ActionForm action={approveRetentionPolicyAction} submitLabel={enabled ? 'Disable' : 'Approve and enable'}>
        <input type="hidden" name="policyId" value={policyId} />
        <input type="hidden" name="enable" value={enabled ? 'false' : 'true'} />
      </ActionForm>

      {mayRun ? (
        <>
          <ActionForm action={runRetentionAction} submitLabel="Preview (dry run)">
            <input type="hidden" name="policyId" value={policyId} />
            <input type="hidden" name="mode" value="preview" />
          </ActionForm>

          {approved && enabled ? (
            <ActionForm action={runRetentionAction} submitLabel="Execute deletion" submitVariant="danger">
              <input type="hidden" name="policyId" value={policyId} />
              <input type="hidden" name="mode" value="execute" />
            </ActionForm>
          ) : (
            <Notice tone="pending">Execution needs an approved, enabled policy.</Notice>
          )}
        </>
      ) : (
        <Notice tone="neutral">Running retention needs the retention-admin grant.</Notice>
      )}
    </div>
  );
}

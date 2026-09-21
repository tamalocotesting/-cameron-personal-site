'use client';
import { Field, Input } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import {
  checkIntegrationAction,
  setIntegrationEnabledAction,
  updateIntegrationSettingsAction,
} from '@/server/actions/workspace-actions';

/** Non-secret settings per provider. Anything credential-shaped is refused server-side. */
const SETTING_FIELDS: Record<string, Array<{ key: string; label: string; hint?: string }>> = {
  twilio: [
    { key: 'fromNumber', label: 'Sending number', hint: 'E.164, e.g. +15125550100.' },
    { key: 'inboundNumber', label: 'Inbound number' },
    { key: 'forwardTo', label: 'Forward inbound calls to', hint: 'The recruiter line.' },
    { key: 'fallbackForwardTo', label: 'Fallback forward number' },
  ],
  simulator: [
    { key: 'fromNumber', label: 'Simulated sending number' },
    { key: 'inboundNumber', label: 'Simulated inbound number' },
    { key: 'forwardTo', label: 'Simulated forward target' },
  ],
  'https-webhook': [{ key: 'url', label: 'Destination URL', hint: 'Must be in the allowlist and https.' }],
};

export function IntegrationForms({
  kind,
  provider,
  enabled,
  settings,
}: {
  kind: string;
  provider: string;
  enabled: boolean;
  settings: Record<string, string>;
}) {
  const fields = SETTING_FIELDS[provider] ?? [];
  return (
    <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-3">
      <ActionForm
        action={setIntegrationEnabledAction}
        submitLabel={enabled ? 'Disable for this organization' : 'Enable for this organization'}
        submitVariant={enabled ? 'secondary' : 'primary'}
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      </ActionForm>

      <ActionForm action={checkIntegrationAction} submitLabel="Run a check now">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="provider" value={provider} />
      </ActionForm>

      {fields.length ? (
        <ActionForm action={updateIntegrationSettingsAction} submitLabel="Save configuration">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="provider" value={provider} />
          {fields.map((field) => (
            <Field key={field.key} label={field.label} htmlFor={`${provider}-${field.key}`} hint={field.hint}>
              <Input
                id={`${provider}-${field.key}`}
                name={`setting.${field.key}`}
                defaultValue={settings[field.key] ?? ''}
              />
            </Field>
          ))}
        </ActionForm>
      ) : null}
    </div>
  );
}

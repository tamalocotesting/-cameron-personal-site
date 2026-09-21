import { AlertTriangle, CircleDashed, FlaskConical, Radio, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Notice, type BadgeTone } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { listIntegrations } from '@/server/services/settings';
import { formatInZone } from '@/lib/time';
import { env, isDemoMode } from '@/env';
import { IntegrationForms } from '@/components/app/settings/IntegrationForms';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const STATUS_META: Record<string, { tone: BadgeTone; icon: React.ReactNode; label: string }> = {
  DISABLED: { tone: 'neutral', icon: <CircleDashed size={12} />, label: 'Disabled' },
  DEMO: { tone: 'pending', icon: <FlaskConical size={12} />, label: 'Demo' },
  CONFIGURED_UNVERIFIED: { tone: 'pending', icon: <AlertTriangle size={12} />, label: 'Configured but unverified' },
  HEALTHY: { tone: 'ready', icon: <ShieldCheck size={12} />, label: 'Healthy' },
  ERROR: { tone: 'review', icon: <XCircle size={12} />, label: 'Error' },
};

/** Which environment variables each provider needs. Names only, never values. */
const REQUIRED_ENV: Record<string, string[]> = {
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WEBHOOK_BASE_URL'],
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
  'https-webhook': ['OUTBOUND_WEBHOOK_ALLOWED_ORIGINS', 'OUTBOUND_WEBHOOK_SIGNING_SECRET'],
  smtp: ['SMTP_HOST', 'SMTP_PORT'],
};

const PRESENT: Record<string, boolean> = {
  TWILIO_ACCOUNT_SID: Boolean(env.TWILIO_ACCOUNT_SID),
  TWILIO_AUTH_TOKEN: Boolean(env.TWILIO_AUTH_TOKEN),
  TWILIO_WEBHOOK_BASE_URL: Boolean(env.TWILIO_WEBHOOK_BASE_URL),
  ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
  ANTHROPIC_MODEL: Boolean(env.ANTHROPIC_MODEL),
  OUTBOUND_WEBHOOK_ALLOWED_ORIGINS: env.outboundWebhookAllowedOrigins.length > 0,
  OUTBOUND_WEBHOOK_SIGNING_SECRET: Boolean(env.OUTBOUND_WEBHOOK_SIGNING_SECRET),
  SMTP_HOST: Boolean(env.SMTP_HOST),
  SMTP_PORT: true,
};

export default async function IntegrationsSettingsPage() {
  const ctx = await requireStaffContext();
  const integrations = await listIntegrations(ctx.member.organizationId);
  const configs = await prisma.integrationConfig.findMany({
    where: { organizationId: ctx.member.organizationId },
    select: { kind: true, provider: true, settings: true },
  });

  return (
    <div className="space-y-3">
      {isDemoMode ? (
        <Notice tone="pending" icon={<FlaskConical size={14} />} title="Demo mode blocks every real provider">
          Even with credentials present in the environment, outbound messaging and external AI calls are
          refused. Switch APP_MODE to LIVE and enable a provider per organization to use one.
        </Notice>
      ) : (
        <Notice tone="accent" icon={<Radio size={14} />}>
          Live mode. A provider is used only after this organization enables it AND its server
          credentials are present. Anything missing produces an explicit blocked state, never a
          simulated success.
        </Notice>
      )}

      <Notice tone="neutral">
        Credentials are never stored here or returned to this page. The app holds only the NAMES of the
        environment variables a provider needs.
      </Notice>

      {integrations.map((integration) => {
        const meta = STATUS_META[integration.status] ?? STATUS_META.DISABLED!;
        const required = REQUIRED_ENV[integration.provider] ?? [];
        const config = configs.find((c) => c.kind === integration.kind && c.provider === integration.provider);
        const settings = (config?.settings ?? {}) as Record<string, string>;

        return (
          <Card key={`${integration.kind}-${integration.provider}`}>
            <CardHeader
              title={`${integration.kind.replace('_', ' ')} — ${integration.provider}`}
              description={integration.detail}
              actions={
                <Badge tone={meta.tone} icon={meta.icon}>
                  {meta.label}
                </Badge>
              }
            />
            <CardBody className="space-y-3">
              {integration.lastCheckedAt ? (
                <p className="text-[12.5px] text-ink-faint">
                  Last check ran {formatInZone(integration.lastCheckedAt, ctx.timezone)}.
                </p>
              ) : (
                <p className="text-[12.5px] text-ink-faint">
                  No check has run. A “Healthy” label requires an actual successful check.
                </p>
              )}

              {required.length ? (
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-ink-faint">Server configuration</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {required.map((name) => (
                      <li key={name}>
                        <Badge tone={PRESENT[name] ? 'ready' : 'review'}>
                          {name} {PRESENT[name] ? 'present' : 'missing'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <IntegrationForms
                kind={integration.kind}
                provider={integration.provider}
                enabled={integration.enabled}
                settings={settings}
              />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

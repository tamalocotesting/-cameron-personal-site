import 'server-only';
import { IntegrationKind, IntegrationStatus, type IntegrationConfig } from '@prisma/client';
import { prisma } from '@/server/db';
import { env, isDemoMode } from '@/env';
import type { ProviderResolution, SmsProvider, VoiceProvider } from './types';
import { SimulatorSmsProvider } from './sms/simulator';
import { TwilioSmsProvider } from './sms/twilio';
import { SimulatorVoiceProvider } from './voice/simulator';
import { TwilioVoiceProvider } from './voice/twilio';

/**
 * The single gate between the domain and the outside world.
 *
 * Three conditions must ALL hold before a real provider is handed out:
 *   1. The application is in LIVE mode.
 *   2. The organization's data scope is LIVE (a demo organization can never
 *      reach a real carrier, whatever its settings say).
 *   3. The organization has explicitly enabled that provider AND the
 *      credentials it needs are present.
 *
 * If any of those is missing the caller gets an explicit unavailable result
 * with the reason. It never silently falls back to the simulator — a
 * simulated send presented as a real one is the exact failure this design
 * exists to prevent.
 */

export type ResolvedIntegration = {
  config: IntegrationConfig | null;
  status: IntegrationStatus;
  detail: string;
};

const simulatorSms = new SimulatorSmsProvider();
const simulatorVoice = new SimulatorVoiceProvider();

async function loadConfig(organizationId: string, kind: IntegrationKind) {
  return prisma.integrationConfig.findMany({
    where: { organizationId, kind },
    orderBy: { createdAt: 'asc' },
  });
}

async function organizationScope(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { dataScope: true },
  });
  return org?.dataScope ?? 'DEMO';
}

export async function resolveSmsProvider(
  organizationId: string,
): Promise<ProviderResolution<SmsProvider>> {
  const [configs, scope] = await Promise.all([
    loadConfig(organizationId, IntegrationKind.SMS),
    organizationScope(organizationId),
  ]);

  const simulator = configs.find((c) => c.provider === 'simulator');
  const twilioConfig = configs.find((c) => c.provider === 'twilio');

  // Demo application mode, or a demo-scoped organization: simulator only.
  if (isDemoMode || scope === 'DEMO') {
    if (!simulator?.enabled) {
      return {
        available: false,
        status: 'DISABLED',
        reason:
          'The local telecom simulator is not enabled for this organization. Enable it in Settings → Integrations.',
      };
    }
    return { available: true, provider: simulatorSms, simulated: true };
  }

  if (!twilioConfig?.enabled) {
    return {
      available: false,
      status: 'DISABLED',
      reason:
        'No SMS provider is enabled for this organization. An administrator must enable one in Settings → Integrations.',
    };
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return {
      available: false,
      status: 'CONFIGURED_UNVERIFIED',
      reason:
        'Twilio is enabled for this organization but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured on the server.',
    };
  }
  const settings = (twilioConfig.settings ?? {}) as { fromNumber?: string };
  if (!settings.fromNumber) {
    return {
      available: false,
      status: 'CONFIGURED_UNVERIFIED',
      reason: 'Twilio is enabled but no sending number is configured for this organization.',
    };
  }

  return {
    available: true,
    provider: new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, settings.fromNumber),
    simulated: false,
  };
}

export async function resolveVoiceProvider(
  organizationId: string,
): Promise<ProviderResolution<VoiceProvider>> {
  const [configs, scope] = await Promise.all([
    loadConfig(organizationId, IntegrationKind.VOICE),
    organizationScope(organizationId),
  ]);

  const simulator = configs.find((c) => c.provider === 'simulator');
  const twilioConfig = configs.find((c) => c.provider === 'twilio');

  if (isDemoMode || scope === 'DEMO') {
    if (!simulator?.enabled) {
      return { available: false, status: 'DISABLED', reason: 'The voice simulator is not enabled.' };
    }
    return { available: true, provider: simulatorVoice, simulated: true };
  }

  if (!twilioConfig?.enabled) {
    return { available: false, status: 'DISABLED', reason: 'No voice provider is enabled.' };
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return {
      available: false,
      status: 'CONFIGURED_UNVERIFIED',
      reason: 'Twilio Voice is enabled but server credentials are not configured.',
    };
  }
  const settings = (twilioConfig.settings ?? {}) as { inboundNumber?: string };
  if (!settings.inboundNumber) {
    return {
      available: false,
      status: 'CONFIGURED_UNVERIFIED',
      reason: 'Twilio Voice is enabled but no inbound number is configured.',
    };
  }
  return {
    available: true,
    provider: new TwilioVoiceProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN),
    simulated: false,
  };
}

/**
 * The status shown in Settings → Integrations.
 *
 * HEALTHY is only ever returned when a real check has run and recorded
 * `lastCheckedAt`. "Credentials look present" is CONFIGURED_UNVERIFIED, which
 * is a different and honest thing to say.
 */
export function describeStatus(config: IntegrationConfig | null, demoScope: boolean): {
  status: IntegrationStatus;
  detail: string;
} {
  if (!config || !config.enabled) {
    return { status: IntegrationStatus.DISABLED, detail: 'Not enabled for this organization.' };
  }
  if (config.provider === 'simulator' || config.provider === 'local-rules') {
    return {
      status: IntegrationStatus.DEMO,
      detail: 'Simulated provider. Exercises the real database, queue and state machine.',
    };
  }
  if (demoScope || isDemoMode) {
    return {
      status: IntegrationStatus.DEMO,
      detail:
        'A live provider is configured but the application is in DEMO mode, so it is blocked. Nothing is sent.',
    };
  }
  if (config.status === IntegrationStatus.ERROR) {
    return { status: IntegrationStatus.ERROR, detail: config.statusDetail ?? 'Last check failed.' };
  }
  if (!config.lastCheckedAt) {
    return {
      status: IntegrationStatus.CONFIGURED_UNVERIFIED,
      detail: 'Configured, but no successful check has run yet.',
    };
  }
  if (config.status === IntegrationStatus.HEALTHY) {
    return {
      status: IntegrationStatus.HEALTHY,
      detail: config.statusDetail ?? `Verified ${config.lastCheckedAt.toISOString()}.`,
    };
  }
  return {
    status: IntegrationStatus.CONFIGURED_UNVERIFIED,
    detail: config.statusDetail ?? 'Configured; awaiting verification.',
  };
}

export { simulatorSms, simulatorVoice };

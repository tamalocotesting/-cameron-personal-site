import 'server-only';
import { IntegrationKind } from '@prisma/client';
import { prisma } from '@/server/db';
import { env, isDemoMode } from '@/env';
import type { AiBriefProvider } from './types';
import { LocalRulesBriefProvider } from './local-rules';
import { AnthropicBriefProvider } from './anthropic';
import type { ProviderResolution } from '../types';

const localProvider = new LocalRulesBriefProvider();

/**
 * Brief preparation provider resolution.
 *
 * In DEMO mode the local rules adapter is the ONLY option, even if an API key
 * happens to be present in the environment. That is deliberate: a demo
 * deployment must not be able to send fictional-but-realistic applicant text
 * to an external service by accident.
 */
export async function resolveBriefProvider(
  organizationId: string,
): Promise<ProviderResolution<AiBriefProvider>> {
  const [settings, configs, org] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
    prisma.integrationConfig.findMany({ where: { organizationId, kind: IntegrationKind.AI_BRIEF } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { dataScope: true } }),
  ]);

  if (!settings?.aiPreparationEnabled) {
    return {
      available: false,
      status: 'DISABLED',
      reason: 'AI brief preparation is turned off for this organization.',
    };
  }

  const wantsAnthropic = settings.aiProvider === 'anthropic';
  const anthropicConfig = configs.find((c) => c.provider === 'anthropic');

  if (isDemoMode || org?.dataScope === 'DEMO' || !wantsAnthropic) {
    const localConfig = configs.find((c) => c.provider === 'local-rules');
    if (localConfig && !localConfig.enabled) {
      return { available: false, status: 'DISABLED', reason: 'Local brief preparation is disabled.' };
    }
    return { available: true, provider: localProvider, simulated: true };
  }

  if (!anthropicConfig?.enabled) {
    return {
      available: false,
      status: 'DISABLED',
      reason: 'The Anthropic provider is not enabled for this organization.',
    };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return {
      available: false,
      status: 'CONFIGURED_UNVERIFIED',
      reason: 'ANTHROPIC_API_KEY is not configured on the server.',
    };
  }
  if (!env.ANTHROPIC_MODEL) {
    return {
      available: false,
      status: 'CONFIGURED_UNVERIFIED',
      reason: 'ANTHROPIC_MODEL is not configured. The model id is configuration, not a default.',
    };
  }

  return {
    available: true,
    provider: new AnthropicBriefProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL),
    simulated: false,
  };
}

export { localProvider as localBriefProvider };

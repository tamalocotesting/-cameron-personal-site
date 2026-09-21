import 'server-only';
import {
  ConsentPurpose,
  ContactChannel,
  DefinitionState,
  IntakePathway,
  IntegrationKind,
  IntegrationStatus,
  QuestionType,
  TemplateKind,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { isValidTimeZone } from '@/lib/time';
import { assertTransition, definitionTransitions } from '@/server/domain/state-machines';
import { ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import { requireOrganizationAdmin, type ActorContext } from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { describeStatus } from '@/server/providers/registry';
import { resolveSmsProvider, resolveVoiceProvider } from '@/server/providers/registry';
import { resolveBriefProvider } from '@/server/providers/ai/registry';
import { outboundWebhookEnabled } from '@/server/providers/webhook/outbound';
import { env, isDemoMode } from '@/env';

/**
 * Organization settings, intake question sets, templates and integrations.
 *
 * Two things this file is careful about:
 *   * A published question set or template version is IMMUTABLE. Editing one
 *     creates a new draft version; existing intake sessions keep the version
 *     they started on unless someone migrates them explicitly.
 *   * Recording an organization's approval is exactly that — an internal
 *     record. It is not, and is never described as, official authorization to
 *     collect anything from real applicants.
 */

export const settingsInput = z.object({
  defaultTimezone: z.string().min(1),
  quietHoursStartMinute: z.number().int().min(0).max(1439),
  quietHoursEndMinute: z.number().int().min(0).max(1439),
  unknownTimezonePolicy: z.enum(['BLOCK', 'REVIEW']),
  routingStrategy: z.enum(['ROUND_ROBIN', 'FALLBACK_ONLY']),
  seatLimit: z.number().int().min(1).max(500),
  minimumIntakeAge: z.number().int().min(0).max(99).nullable(),
  youthPolicyNote: z.string().max(1000).nullable(),
  citizenshipQuestionsEnabled: z.boolean(),
  aiPreparationEnabled: z.boolean(),
  aiProvider: z.enum(['local-rules', 'anthropic']),
  aiApprovedCategories: z.array(
    z.enum(['intake_answers', 'applicant_messages', 'recruiter_messages', 'call_outcomes', 'staff_notes']),
  ),
  automationEnabled: z.boolean(),
  textBackEnabled: z.boolean(),
  textBackWindowMinutes: z.number().int().min(1).max(240),
  textBackMaxQuestions: z.number().int().min(1).max(30),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export async function updateSettings(ctx: ActorContext, input: z.infer<typeof settingsInput>) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  if (!isValidTimeZone(input.defaultTimezone)) {
    throw new ValidationError('That is not a recognised timezone.', { defaultTimezone: ['Unknown IANA timezone.'] });
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.organizationSettings.findUnique({ where: { organizationId } });
    if (!current) throw new NotFoundError('Organization settings');
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed these settings. Reload and try again.');
    }
    const { expectedVersion: _ignored, ...data } = input;
    const updated = await tx.organizationSettings.update({
      where: { organizationId },
      data: { ...data, version: { increment: 1 } },
    });
    await auditSecurity(tx, ctx, {
      action: 'settings.updated',
      subjectType: 'organization_settings',
      subjectId: updated.id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  });
}

export async function getSettings(organizationId: string) {
  return prisma.organizationSettings.findUnique({ where: { organizationId } });
}

/**
 * Record that the organization approved its question set and consent text.
 *
 * This is an internal governance record. The UI states plainly that a toggle
 * here does not create official authorization of any kind.
 */
export async function recordIntakeApproval(ctx: ActorContext, input: { note: string }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.organizationSettings.update({
      where: { organizationId },
      data: {
        intakeApprovalRecordedAt: now(),
        intakeApprovalRecordedBy: staff.member.id,
        intakeApprovalNote: input.note,
        version: { increment: 1 },
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'settings.intake_approval_recorded',
      subjectType: 'organization_settings',
      subjectId: updated.id,
      metadata: { note: input.note },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Intake question sets
// ---------------------------------------------------------------------------

export const questionInput = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores.'),
  order: z.number().int().min(0),
  pathway: z.nativeEnum(IntakePathway),
  type: z.nativeEnum(QuestionType),
  prompt: z.string().min(3).max(400),
  helpText: z.string().max(400).nullable().default(null),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(120)).max(20).default([]),
  consentPurpose: z.nativeEnum(ConsentPurpose).nullable().default(null),
  disclosureKey: z.string().max(60).nullable().default(null),
  disclosureText: z.string().max(1000).nullable().default(null),
  sensitiveCategory: z.string().max(60).nullable().default(null),
});

export const draftVersionInput = z.object({
  definitionKey: z.string().min(1).default('default'),
  greeting: z.string().min(10).max(1200),
  completionText: z.string().min(10).max(1200),
  handoffText: z.string().min(10).max(1200),
  questions: z.array(questionInput).min(1).max(40),
});

/**
 * Create a new DRAFT version. Publishing never mutates an existing published
 * version, so anything already in flight keeps the text the applicant saw.
 */
export async function createDraftIntakeVersion(ctx: ActorContext, input: z.infer<typeof draftVersionInput>) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId } });

  // Citizenship questions stay off unless the organization turned them on.
  const citizenship = input.questions.filter((q) => q.sensitiveCategory === 'citizenship');
  if (citizenship.length && !settings?.citizenshipQuestionsEnabled) {
    throw new ValidationError(
      'Citizenship questions are disabled for this organization. Enable them in Settings → Organization first — they are off by default.',
      { questions: ['Citizenship question present but not enabled.'] },
    );
  }
  const forbidden = input.questions.filter((q) =>
    /ssn|social security|date of birth|birthdate|passport|driver.?s licen|medical history|diagnos|arrest|convict/i.test(
      `${q.key} ${q.prompt}`,
    ),
  );
  if (forbidden.length) {
    throw new ValidationError(
      'This build does not collect SSNs, exact dates of birth, government identifiers, documents, or medical/legal histories through intake.',
      { questions: forbidden.map((q) => q.key) },
    );
  }

  return prisma.$transaction(async (tx) => {
    const definition = await tx.intakeDefinition.upsert({
      where: { organizationId_key: { organizationId, key: input.definitionKey } },
      create: { organizationId, key: input.definitionKey, name: 'Applicant intake' },
      update: {},
    });
    const latest = await tx.intakeVersion.findFirst({
      where: { organizationId, definitionId: definition.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = await tx.intakeVersion.create({
      data: {
        organizationId,
        definitionId: definition.id,
        version: (latest?.version ?? 0) + 1,
        state: DefinitionState.DRAFT,
        greeting: input.greeting,
        completionText: input.completionText,
        handoffText: input.handoffText,
      },
    });
    for (const question of input.questions) {
      await tx.intakeQuestion.create({
        data: { organizationId, intakeVersionId: version.id, ...question },
      });
    }
    await auditSecurity(tx, ctx, {
      action: 'intake.version_drafted',
      subjectType: 'intake_version',
      subjectId: version.id,
      metadata: { version: version.version, questionCount: input.questions.length },
    });
    return version;
  });
}

export async function publishIntakeVersion(
  ctx: ActorContext,
  input: { intakeVersionId: string; approvalNote: string },
) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const version = await tx.intakeVersion.findFirst({
      where: { id: input.intakeVersionId, organizationId },
    });
    if (!version) throw new NotFoundError('Intake version');
    assertTransition(definitionTransitions, version.state, DefinitionState.PUBLISHED, 'Intake version');

    // Exactly one published version per definition, enforced by a partial
    // unique index as well as here.
    await tx.intakeVersion.updateMany({
      where: {
        organizationId,
        definitionId: version.definitionId,
        state: DefinitionState.PUBLISHED,
      },
      data: { state: DefinitionState.RETIRED, retiredAt: now() },
    });

    const published = await tx.intakeVersion.update({
      where: { id: version.id },
      data: {
        state: DefinitionState.PUBLISHED,
        approvedByMemberId: staff.member.id,
        approvedAt: now(),
        approvalNote: input.approvalNote,
        publishedAt: now(),
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'intake.version_published',
      subjectType: 'intake_version',
      subjectId: published.id,
      metadata: { version: published.version, approvalNote: input.approvalNote },
    });
    return published;
  });
}

export async function listIntakeVersions(organizationId: string) {
  return prisma.intakeVersion.findMany({
    where: { organizationId },
    include: { questions: { orderBy: { order: 'asc' } }, definition: true },
    orderBy: [{ definitionId: 'asc' }, { version: 'desc' }],
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templateVersionInput = z.object({
  templateKey: z.string().min(1).max(60),
  kind: z.nativeEnum(TemplateKind),
  channel: z.nativeEnum(ContactChannel).default(ContactChannel.SMS),
  name: z.string().min(3).max(120),
  body: z.string().min(5).max(900),
  placeholders: z.array(z.string().max(40)).max(10).default([]),
  automatable: z.boolean().default(false),
});

export async function createTemplateDraft(ctx: ActorContext, input: z.infer<typeof templateVersionInput>) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;

  const declared = new Set(input.placeholders);
  const used = [...input.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
  const unknown = used.filter((u) => !declared.has(u) && u !== 'first_name');
  if (unknown.length) {
    throw new ValidationError(`The template uses undeclared placeholders: ${unknown.join(', ')}.`, {
      placeholders: unknown,
    });
  }
  if (/\b(guarantee|guaranteed|you will qualify|approved|eligible|waiver)\b/i.test(input.body)) {
    throw new ValidationError(
      'Templates must not promise eligibility, jobs, waivers or benefits. Rewrite without that language.',
      { body: ['Remove the promise.'] },
    );
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.messageTemplate.upsert({
      where: { organizationId_key: { organizationId, key: input.templateKey } },
      create: {
        organizationId,
        key: input.templateKey,
        kind: input.kind,
        channel: input.channel,
        name: input.name,
        automatable: input.automatable,
      },
      update: { name: input.name, automatable: input.automatable },
    });
    const latest = await tx.templateVersion.findFirst({
      where: { organizationId, templateId: template.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = await tx.templateVersion.create({
      data: {
        organizationId,
        templateId: template.id,
        version: (latest?.version ?? 0) + 1,
        state: DefinitionState.DRAFT,
        body: input.body,
        placeholders: input.placeholders,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'template.version_drafted',
      subjectType: 'template_version',
      subjectId: version.id,
      metadata: { templateKey: input.templateKey, version: version.version },
    });
    return version;
  });
}

export async function publishTemplateVersion(ctx: ActorContext, input: { templateVersionId: string }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const version = await tx.templateVersion.findFirst({
      where: { id: input.templateVersionId, organizationId },
    });
    if (!version) throw new NotFoundError('Template version');
    assertTransition(definitionTransitions, version.state, DefinitionState.PUBLISHED, 'Template version');
    await tx.templateVersion.updateMany({
      where: { organizationId, templateId: version.templateId, state: DefinitionState.PUBLISHED },
      data: { state: DefinitionState.RETIRED },
    });
    const published = await tx.templateVersion.update({
      where: { id: version.id },
      data: {
        state: DefinitionState.PUBLISHED,
        approvedByMemberId: staff.member.id,
        approvedAt: now(),
        publishedAt: now(),
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'template.version_published',
      subjectType: 'template_version',
      subjectId: published.id,
      metadata: { version: published.version },
    });
    return published;
  });
}

export async function listTemplates(organizationId: string) {
  return prisma.messageTemplate.findMany({
    where: { organizationId },
    include: { versions: { orderBy: { version: 'desc' } } },
    orderBy: { key: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export type IntegrationView = {
  kind: IntegrationKind;
  provider: string;
  enabled: boolean;
  status: IntegrationStatus;
  detail: string;
  lastCheckedAt: Date | null;
  /** Names of the environment variables it needs. Never the values. */
  secretRefs: string[];
  configurable: boolean;
};

export async function listIntegrations(organizationId: string): Promise<IntegrationView[]> {
  const [configs, org] = await Promise.all([
    prisma.integrationConfig.findMany({ where: { organizationId }, orderBy: [{ kind: 'asc' }, { provider: 'asc' }] }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { dataScope: true } }),
  ]);
  const demoScope = org?.dataScope === 'DEMO';

  return configs.map((config) => {
    const described = describeStatus(config, demoScope);
    return {
      kind: config.kind,
      provider: config.provider,
      enabled: config.enabled,
      status: described.status,
      detail: described.detail,
      lastCheckedAt: config.lastCheckedAt,
      // Secrets live in the environment; only their NAMES are shown.
      secretRefs: config.secretRefs,
      configurable: !isDemoMode || config.provider === 'simulator' || config.provider === 'local-rules',
    };
  });
}

export async function setIntegrationEnabled(
  ctx: ActorContext,
  input: { kind: IntegrationKind; provider: string; enabled: boolean },
) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const config = await tx.integrationConfig.findUnique({
      where: {
        organizationId_kind_provider: { organizationId, kind: input.kind, provider: input.provider },
      },
    });
    if (!config) throw new NotFoundError('Integration');
    const updated = await tx.integrationConfig.update({
      where: { id: config.id },
      data: {
        enabled: input.enabled,
        // Enabling does not make it healthy. A check has to run.
        status: input.enabled ? IntegrationStatus.CONFIGURED_UNVERIFIED : IntegrationStatus.DISABLED,
        statusDetail: input.enabled ? 'Enabled; awaiting a verification check.' : 'Disabled.',
        lastCheckedAt: null,
        version: { increment: 1 },
      },
    });
    await auditSecurity(tx, ctx, {
      action: input.enabled ? 'integration.enabled' : 'integration.disabled',
      subjectType: 'integration_config',
      subjectId: config.id,
      metadata: { kind: input.kind, provider: input.provider },
    });
    return updated;
  });
}

/**
 * Run an actual check. This is the ONLY path that can produce a HEALTHY
 * status: the label means "a real check succeeded at this time", not
 * "credentials appear to be present".
 */
export async function checkIntegrationHealth(
  ctx: ActorContext,
  input: { kind: IntegrationKind; provider: string },
) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;

  let result: { ok: boolean; detail: string };
  let checkKind = 'none';

  switch (input.kind) {
    case IntegrationKind.SMS: {
      const resolved = await resolveSmsProvider(organizationId);
      result = resolved.available
        ? await resolved.provider.checkHealth(organizationId)
        : { ok: false, detail: resolved.reason };
      checkKind = 'sms.account_fetch';
      break;
    }
    case IntegrationKind.VOICE: {
      const resolved = await resolveVoiceProvider(organizationId);
      result = resolved.available
        ? await resolved.provider.checkHealth(organizationId)
        : { ok: false, detail: resolved.reason };
      checkKind = 'voice.account_fetch';
      break;
    }
    case IntegrationKind.AI_BRIEF: {
      const resolved = await resolveBriefProvider(organizationId);
      result = resolved.available
        ? await resolved.provider.checkHealth()
        : { ok: false, detail: resolved.reason };
      checkKind = 'ai.model_retrieve';
      break;
    }
    case IntegrationKind.OUTBOUND_WEBHOOK: {
      result = outboundWebhookEnabled()
        ? {
            ok: true,
            detail:
              'A destination allowlist and signing secret are configured. Delivery is still only confirmed by an actual send.',
          }
        : { ok: false, detail: 'No allowlisted destination or signing secret.' };
      checkKind = 'webhook.config';
      break;
    }
    case IntegrationKind.EMAIL: {
      result = env.SMTP_HOST
        ? { ok: true, detail: `SMTP host configured (${env.SMTP_HOST}:${env.SMTP_PORT}).` }
        : { ok: false, detail: 'SMTP_HOST is not configured; invitations and resets cannot be sent.' };
      checkKind = 'email.config';
      break;
    }
  }

  return prisma.$transaction(async (tx) => {
    const config = await tx.integrationConfig.findUnique({
      where: {
        organizationId_kind_provider: { organizationId, kind: input.kind, provider: input.provider },
      },
    });
    if (!config) throw new NotFoundError('Integration');
    const updated = await tx.integrationConfig.update({
      where: { id: config.id },
      data: {
        status: result.ok
          ? config.provider === 'simulator' || config.provider === 'local-rules'
            ? IntegrationStatus.DEMO
            : IntegrationStatus.HEALTHY
          : IntegrationStatus.ERROR,
        statusDetail: result.detail,
        lastCheckedAt: now(),
        lastCheckKind: checkKind,
        version: { increment: 1 },
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'integration.checked',
      subjectType: 'integration_config',
      subjectId: config.id,
      metadata: { kind: input.kind, provider: input.provider, ok: result.ok, checkKind },
    });
    void staff;
    return updated;
  });
}

export async function updateIntegrationSettings(
  ctx: ActorContext,
  input: { kind: IntegrationKind; provider: string; settings: Record<string, string> },
) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;

  // Non-secret configuration only. Anything that looks like a credential is
  // refused: secrets belong in the environment or a secret manager.
  const secretish = Object.keys(input.settings).filter((k) =>
    /secret|token|password|key|sid/i.test(k),
  );
  if (secretish.length) {
    throw new ValidationError(
      `These belong in the server environment, not in settings: ${secretish.join(', ')}. The app stores only a reference by name.`,
      { settings: secretish },
    );
  }

  return prisma.$transaction(async (tx) => {
    const config = await tx.integrationConfig.findUnique({
      where: {
        organizationId_kind_provider: { organizationId, kind: input.kind, provider: input.provider },
      },
    });
    if (!config) throw new NotFoundError('Integration');
    const updated = await tx.integrationConfig.update({
      where: { id: config.id },
      data: {
        settings: input.settings,
        status: IntegrationStatus.CONFIGURED_UNVERIFIED,
        statusDetail: 'Configuration changed; awaiting a verification check.',
        lastCheckedAt: null,
        version: { increment: 1 },
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'integration.settings_updated',
      subjectType: 'integration_config',
      subjectId: config.id,
      metadata: { kind: input.kind, provider: input.provider, fields: Object.keys(input.settings) },
    });
    void staff;
    return updated;
  });
}

export async function listAuditHistory(
  organizationId: string,
  options: { page?: number; pageSize?: number; category?: 'SECURITY' | 'OPERATIONAL' } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, options.pageSize ?? 50);
  const where = {
    organizationId,
    ...(options.category ? { category: options.category } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getCommercialMetadata(organizationId: string) {
  return prisma.commercialMetadata.findUnique({ where: { organizationId } });
}

export const commercialInput = z.object({
  implementationFeeCents: z.number().int().min(0).nullable(),
  monthlyFeeCents: z.number().int().min(0).nullable(),
  licensedSeats: z.number().int().min(1).nullable(),
  contractStart: z.coerce.date().nullable(),
  contractEnd: z.coerce.date().nullable(),
  note: z.string().max(1000).nullable(),
});

export async function updateCommercialMetadata(ctx: ActorContext, input: z.infer<typeof commercialInput>) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const record = await tx.commercialMetadata.upsert({
      where: { organizationId },
      create: { organizationId, ...input },
      update: input,
    });
    await auditSecurity(tx, ctx, {
      action: 'commercial.updated',
      subjectType: 'commercial_metadata',
      subjectId: record.id,
      metadata: { fields: Object.keys(input) },
    });
    void staff;
    return record;
  });
}

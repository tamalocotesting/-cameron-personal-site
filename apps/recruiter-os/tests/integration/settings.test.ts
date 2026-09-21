import { beforeEach, describe, expect, it } from 'vitest';
import { IntakePathway, IntegrationKind, QuestionType } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock } from '@/server/clock';
import {
  checkIntegrationHealth,
  createDraftIntakeVersion,
  createTemplateDraft,
  listIntegrations,
  publishIntakeVersion,
  publishTemplateVersion,
  recordIntakeApproval,
  setIntegrationEnabled,
  updateIntegrationSettings,
  updateSettings,
} from '@/server/services/settings';
import { resolveSmsProvider } from '@/server/providers/registry';
import { resolveBriefProvider } from '@/server/providers/ai/registry';
import { assertDestinationAllowed, outboundWebhookEnabled } from '@/server/providers/webhook/outbound';
import { createWorkspace, type Workspace } from '../setup/factories';

/**
 * Settings, the question-set lifecycle and the honesty of the integration
 * status labels.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');
let workspace: Workspace;

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
});

describe('organization settings', () => {
  it('refuses a change from a non-administrator', async () => {
    const settings = await prisma.organizationSettings.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    await expect(
      updateSettings(workspace.recruiterCtx, {
        defaultTimezone: 'America/Chicago',
        quietHoursStartMinute: 1260,
        quietHoursEndMinute: 480,
        unknownTimezonePolicy: 'BLOCK',
        routingStrategy: 'ROUND_ROBIN',
        seatLimit: 5,
        minimumIntakeAge: null,
        youthPolicyNote: null,
        citizenshipQuestionsEnabled: false,
        textBackEnabled: false,
        textBackWindowMinutes: 15,
        textBackMaxQuestions: 8,
        aiPreparationEnabled: true,
        aiProvider: 'local-rules',
        aiApprovedCategories: ['intake_answers'],
        automationEnabled: true,
        expectedVersion: settings.version,
      }),
    ).rejects.toThrow(/organization administrator/);
  });

  it('refuses an unknown timezone and a stale version', async () => {
    const settings = await prisma.organizationSettings.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    const base = {
      quietHoursStartMinute: 1260,
      quietHoursEndMinute: 480,
      unknownTimezonePolicy: 'BLOCK' as const,
      routingStrategy: 'ROUND_ROBIN' as const,
      seatLimit: 5,
      minimumIntakeAge: null,
      youthPolicyNote: null,
      citizenshipQuestionsEnabled: false,
      aiPreparationEnabled: true,
      aiProvider: 'local-rules' as const,
      aiApprovedCategories: ['intake_answers' as const],
      automationEnabled: true,
      textBackEnabled: false,
      textBackWindowMinutes: 15,
      textBackMaxQuestions: 8,
    };

    await expect(
      updateSettings(workspace.adminCtx, {
        ...base,
        defaultTimezone: 'Mars/Olympus_Mons',
        expectedVersion: settings.version,
      }),
    ).rejects.toThrow(/timezone/i);

    await updateSettings(workspace.adminCtx, {
      ...base,
      defaultTimezone: 'America/Denver',
      expectedVersion: settings.version,
    });
    // A second save with the old version number is a conflict, not a
    // silent overwrite.
    await expect(
      updateSettings(workspace.adminCtx, {
        ...base,
        defaultTimezone: 'America/New_York',
        expectedVersion: settings.version,
      }),
    ).rejects.toThrow(/Someone else changed/);
  });

  it('records an approval as an internal record and says nothing more', async () => {
    const updated = await recordIntakeApproval(workspace.adminCtx, {
      note: 'Reviewed by the station on 15 June.',
    });
    expect(updated.intakeApprovalRecordedAt).not.toBeNull();
    expect(updated.intakeApprovalRecordedBy).toBe(workspace.admin.member.id);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'settings.intake_approval_recorded' },
    });
    expect(audit.category).toBe('SECURITY');
  });
});

describe('the intake question-set lifecycle', () => {
  const baseDraft = {
    definitionKey: 'default',
    greeting: 'This is an automated intake assistant. A recruiter reads what you write.',
    completionText: 'Thanks — a recruiter will pick this up.',
    handoffText: 'That is one for a recruiter. I have stopped the questions.',
    questions: [
      {
        key: 'full_name',
        order: 0,
        pathway: IntakePathway.CALLBACK_REQUEST,
        type: QuestionType.SHORT_TEXT,
        prompt: 'What name should the recruiter ask for?',
        helpText: null,
        required: true,
        options: [],
        consentPurpose: null,
        disclosureKey: null,
        disclosureText: null,
        sensitiveCategory: null,
      },
    ],
  };

  it('refuses a citizenship question unless the organization enabled it', async () => {
    await expect(
      createDraftIntakeVersion(workspace.adminCtx, {
        ...baseDraft,
        questions: [
          {
            ...baseDraft.questions[0]!,
            key: 'citizenship_status',
            prompt: 'What is your status?',
            sensitiveCategory: 'citizenship',
          },
        ],
      }),
    ).rejects.toThrow(/Citizenship questions are disabled/);
  });

  it('refuses questions this build does not collect', async () => {
    for (const prompt of [
      'What is your Social Security number?',
      'What is your exact date of birth?',
      'Please describe your medical history',
      'Have you ever been arrested?',
    ]) {
      await expect(
        createDraftIntakeVersion(workspace.adminCtx, {
          ...baseDraft,
          questions: [{ ...baseDraft.questions[0]!, key: 'bad_question', prompt }],
        }),
      ).rejects.toThrow(/does not collect/);
    }
  });

  it('publishes a new version without mutating the old one', async () => {
    const original = await prisma.intakeVersion.findFirstOrThrow({
      where: { id: workspace.version.id },
      include: { questions: true },
    });

    const draft = await createDraftIntakeVersion(workspace.adminCtx, baseDraft);
    expect(draft.state).toBe('DRAFT');
    expect(draft.version).toBe(2);

    const published = await publishIntakeVersion(workspace.adminCtx, {
      intakeVersionId: draft.id,
      approvalNote: 'Reviewed by the station.',
    });
    expect(published.state).toBe('PUBLISHED');
    expect(published.approvedByMemberId).toBe(workspace.admin.member.id);

    const afterwards = await prisma.intakeVersion.findFirstOrThrow({
      where: { id: workspace.version.id },
      include: { questions: true },
    });
    // The previously published version is retired, not edited.
    expect(afterwards.state).toBe('RETIRED');
    expect(afterwards.greeting).toBe(original.greeting);
    expect(afterwards.questions).toHaveLength(original.questions.length);

    // And exactly one published version exists, enforced by a unique index.
    const publishedCount = await prisma.intakeVersion.count({
      where: { organizationId: workspace.organization.id, state: 'PUBLISHED' },
    });
    expect(publishedCount).toBe(1);
  });

  it('cannot store a published version with no approver', async () => {
    await expect(
      prisma.intakeVersion.create({
        data: {
          organizationId: workspace.organization.id,
          definitionId: workspace.version.definitionId,
          version: 99,
          state: 'PUBLISHED',
          greeting: 'x'.repeat(20),
          completionText: 'y'.repeat(20),
          handoffText: 'z'.repeat(20),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('templates', () => {
  it('refuses a template that promises an outcome', async () => {
    await expect(
      createTemplateDraft(workspace.adminCtx, {
        templateKey: 'bad_promise',
        kind: 'RECRUITER_MANUAL',
        channel: 'SMS',
        name: 'Overpromise',
        body: 'Hi {{first_name}}, you will qualify for this — guaranteed.',
        placeholders: [],
        automatable: false,
      }),
    ).rejects.toThrow(/must not promise/);
  });

  it('refuses an undeclared placeholder', async () => {
    await expect(
      createTemplateDraft(workspace.adminCtx, {
        templateKey: 'bad_placeholder',
        kind: 'RECRUITER_MANUAL',
        channel: 'SMS',
        name: 'Unknown variable',
        body: 'Hi {{first_name}}, see {{mystery}}.',
        placeholders: [],
        automatable: false,
      }),
    ).rejects.toThrow(/undeclared placeholders/);
  });

  it('publishes a new version and retires the old one', async () => {
    const draft = await createTemplateDraft(workspace.adminCtx, {
      templateKey: 'acknowledgment',
      kind: 'ACKNOWLEDGMENT',
      channel: 'SMS',
      name: 'Acknowledgment v2',
      body: 'Hi {{first_name}} — we have your details and a recruiter will be in touch.',
      placeholders: [],
      automatable: true,
    });
    await publishTemplateVersion(workspace.adminCtx, { templateVersionId: draft.id });

    const versions = await prisma.templateVersion.findMany({
      where: { organizationId: workspace.organization.id, templateId: draft.templateId },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((v) => v.state)).toEqual(['RETIRED', 'PUBLISHED']);
  });
});

describe('integration status labels are honest', () => {
  it('never reports healthy without a check having run', async () => {
    await prisma.integrationConfig.create({
      data: {
        organizationId: workspace.organization.id,
        kind: IntegrationKind.SMS,
        provider: 'twilio',
        enabled: false,
        status: 'DISABLED',
        settings: {},
      },
    });

    let list = await listIntegrations(workspace.organization.id);
    const twilio = () => list.find((i) => i.kind === 'SMS' && i.provider === 'twilio')!;
    expect(twilio().status).toBe('DISABLED');

    await setIntegrationEnabled(workspace.adminCtx, {
      kind: IntegrationKind.SMS,
      provider: 'twilio',
      enabled: true,
    });
    list = await listIntegrations(workspace.organization.id);
    // Enabling is not verification. The demo organization also cannot reach a
    // real provider at all, and the label says so.
    expect(['DEMO', 'CONFIGURED_UNVERIFIED']).toContain(twilio().status);
    expect(twilio().lastCheckedAt).toBeNull();
  });

  it('reports the simulator as DEMO even after a successful check', async () => {
    const checked = await checkIntegrationHealth(workspace.adminCtx, {
      kind: IntegrationKind.SMS,
      provider: 'simulator',
    });
    expect(checked.status).toBe('DEMO');
    expect(checked.lastCheckedAt).not.toBeNull();
    expect(checked.statusDetail).toMatch(/no real messages|Simulator/i);
  });

  it('records an error when a check fails', async () => {
    await prisma.integrationConfig.updateMany({
      where: { organizationId: workspace.organization.id, kind: 'AI_BRIEF', provider: 'local-rules' },
      data: { enabled: false },
    });
    await prisma.organizationSettings.update({
      where: { organizationId: workspace.organization.id },
      data: { aiPreparationEnabled: false },
    });
    const checked = await checkIntegrationHealth(workspace.adminCtx, {
      kind: IntegrationKind.AI_BRIEF,
      provider: 'local-rules',
    });
    expect(checked.status).toBe('ERROR');
    expect(checked.statusDetail).toMatch(/turned off/i);
  });

  it('refuses to store anything credential-shaped in settings', async () => {
    await expect(
      updateIntegrationSettings(workspace.adminCtx, {
        kind: IntegrationKind.SMS,
        provider: 'simulator',
        settings: { authToken: 'secret', fromNumber: '+15125550100' },
      }),
    ).rejects.toThrow(/belong in the server environment/);
  });

  it('resets a configuration change back to unverified', async () => {
    await checkIntegrationHealth(workspace.adminCtx, { kind: IntegrationKind.SMS, provider: 'simulator' });
    const updated = await updateIntegrationSettings(workspace.adminCtx, {
      kind: IntegrationKind.SMS,
      provider: 'simulator',
      settings: { fromNumber: '+15125550111' },
    });
    expect(updated.status).toBe('CONFIGURED_UNVERIFIED');
    expect(updated.lastCheckedAt).toBeNull();
  });
});

describe('demo mode blocks real providers outright', () => {
  it('hands out the simulator even when a live provider is enabled', async () => {
    await prisma.integrationConfig.create({
      data: {
        organizationId: workspace.organization.id,
        kind: IntegrationKind.SMS,
        provider: 'twilio',
        enabled: true,
        status: 'CONFIGURED_UNVERIFIED',
        settings: { fromNumber: '+15125550100' },
      },
    });
    const resolved = await resolveSmsProvider(workspace.organization.id);
    expect(resolved.available).toBe(true);
    if (!resolved.available) return;
    expect(resolved.provider.name).toBe('simulator');
    expect(resolved.simulated).toBe(true);
  });

  it('keeps brief preparation on the local adapter even if Anthropic is enabled', async () => {
    await prisma.organizationSettings.update({
      where: { organizationId: workspace.organization.id },
      data: { aiProvider: 'anthropic' },
    });
    await prisma.integrationConfig.create({
      data: {
        organizationId: workspace.organization.id,
        kind: IntegrationKind.AI_BRIEF,
        provider: 'anthropic',
        enabled: true,
        status: 'CONFIGURED_UNVERIFIED',
        settings: {},
      },
    });
    const resolved = await resolveBriefProvider(workspace.organization.id);
    expect(resolved.available).toBe(true);
    if (!resolved.available) return;
    expect(resolved.provider.name).toBe('local-rules');
    expect(resolved.provider.rulesBased).toBe(true);
  });

  it('reports an explicit unavailable state rather than falling back', async () => {
    await prisma.integrationConfig.updateMany({
      where: { organizationId: workspace.organization.id, kind: 'SMS', provider: 'simulator' },
      data: { enabled: false },
    });
    const resolved = await resolveSmsProvider(workspace.organization.id);
    expect(resolved.available).toBe(false);
    if (resolved.available) return;
    expect(resolved.status).toBe('DISABLED');
    expect(resolved.reason).toMatch(/not enabled/i);
  });
});

describe('the outbound webhook adapter is disabled until configured', () => {
  it('refuses every destination when no allowlist exists', async () => {
    expect(outboundWebhookEnabled()).toBe(false);
    await expect(assertDestinationAllowed('https://example.test/hook')).rejects.toThrow(/disabled/i);
  });
});

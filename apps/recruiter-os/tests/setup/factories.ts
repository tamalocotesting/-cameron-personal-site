import { randomUUID } from 'node:crypto';
import {
  ConsentAction,
  ConsentPurpose,
  ContactChannel,
  DefinitionState,
  GrantType,
  IntakePathway,
  IntegrationKind,
  IntegrationStatus,
  QuestionType,
  StaffRole,
  TemplateKind,
} from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import type { StaffContext } from '@/server/authz/policy';

/**
 * Test fixtures.
 *
 * These build REAL rows through Prisma — no mocks, no in-memory doubles — so a
 * test that passes here exercises the same constraints production would.
 */

export const OFFICE_NUMBER = '+15125550100';

export async function createOrganization(
  options: { slug?: string; timezone?: string; textBack?: boolean } = {},
) {
  const slug = options.slug ?? `org-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Test ${slug}`, slug, dataScope: 'DEMO' },
  });
  await prisma.organizationSettings.create({
    data: {
      organizationId: organization.id,
      defaultTimezone: options.timezone ?? 'America/Chicago',
      quietHoursStartMinute: 21 * 60,
      quietHoursEndMinute: 8 * 60,
      aiPreparationEnabled: true,
      aiProvider: 'local-rules',
      automationEnabled: true,
      // Off unless a test opts in, exactly as a real organization gets it.
      textBackEnabled: options.textBack ?? false,
      textBackMaxQuestions: 4,
    },
  });
  await prisma.integrationConfig.createMany({
    data: [
      {
        organizationId: organization.id,
        kind: IntegrationKind.SMS,
        provider: 'simulator',
        enabled: true,
        status: IntegrationStatus.DEMO,
        settings: { fromNumber: OFFICE_NUMBER, inboundNumber: OFFICE_NUMBER },
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.VOICE,
        provider: 'simulator',
        enabled: true,
        status: IntegrationStatus.DEMO,
        settings: { inboundNumber: OFFICE_NUMBER, forwardTo: '+15125550190' },
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.AI_BRIEF,
        provider: 'local-rules',
        enabled: true,
        status: IntegrationStatus.DEMO,
        settings: {},
      },
    ],
  });
  return organization;
}

export async function createMember(
  organizationId: string,
  options: { role?: StaffRole; name?: string; active?: boolean } = {},
) {
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      id,
      name: options.name ?? `Member ${id.slice(0, 6)}`,
      email: `${id.slice(0, 8)}@test.invalid`,
      emailVerified: true,
    },
  });
  const member = await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId,
      userId: user.id,
      role: options.role === StaffRole.ORG_ADMIN ? 'owner' : 'member',
      staffRole: options.role ?? StaffRole.RECRUITER,
      displayName: user.name,
      active: options.active ?? true,
    },
  });
  return { user, member };
}

/** A StaffContext identical in shape to the one a real request produces. */
export function staffContext(
  member: { id: string; organizationId: string; staffRole: StaffRole; displayName: string },
  organization: { id: string; name: string; slug: string; dataScope: 'DEMO' | 'LIVE' },
  timezone = 'America/Chicago',
): StaffContext {
  return {
    kind: 'staff',
    identity: {
      userId: `user-${member.id}`,
      sessionId: `session-${member.id}`,
      email: `${member.id}@test.invalid`,
      name: member.displayName,
    },
    member: {
      id: member.id,
      organizationId: member.organizationId,
      staffRole: member.staffRole,
      displayName: member.displayName,
      active: true,
    },
    organization,
    timezone,
    cache: {},
  };
}

export async function publishIntakeSet(organizationId: string, approverMemberId: string) {
  const definition = await prisma.intakeDefinition.create({
    data: { organizationId, key: 'default', name: 'Applicant intake' },
  });
  const version = await prisma.intakeVersion.create({
    data: {
      organizationId,
      definitionId: definition.id,
      version: 1,
      state: DefinitionState.PUBLISHED,
      greeting: 'This is an automated intake assistant. A recruiter reads what you write.',
      completionText: 'Thanks — a recruiter will pick this up.',
      handoffText: 'That is one for a recruiter. I have stopped the questions and passed it on.',
      approvedByMemberId: approverMemberId,
      approvedAt: now(),
      publishedAt: now(),
    },
  });

  const questions: Array<{
    key: string;
    order: number;
    pathway: IntakePathway;
    type: QuestionType;
    prompt: string;
    required?: boolean;
    options?: string[];
    consentPurpose?: ConsentPurpose;
  }> = [
    {
      key: 'full_name',
      order: 0,
      pathway: IntakePathway.CALLBACK_REQUEST,
      type: QuestionType.SHORT_TEXT,
      prompt: 'What name should the recruiter ask for?',
      required: true,
    },
    {
      key: 'phone',
      order: 1,
      pathway: IntakePathway.CALLBACK_REQUEST,
      type: QuestionType.PHONE,
      prompt: 'What number should they call?',
      required: true,
    },
    {
      key: 'availability',
      order: 2,
      pathway: IntakePathway.CALLBACK_REQUEST,
      type: QuestionType.SHORT_TEXT,
      prompt: 'When are you usually free to talk?',
      required: true,
    },
    {
      key: 'callback_call_consent',
      order: 3,
      pathway: IntakePathway.CALLBACK_REQUEST,
      type: QuestionType.CONSENT,
      prompt: 'Is it alright for a recruiter to call you?',
      required: true,
      consentPurpose: ConsentPurpose.CALLBACK_CALL,
    },
    {
      key: 'callback_sms_consent',
      order: 4,
      pathway: IntakePathway.CALLBACK_REQUEST,
      type: QuestionType.CONSENT,
      prompt: 'Separately — would you like text messages as well?',
      required: false,
      consentPurpose: ConsentPurpose.RECRUITER_SMS,
    },
    {
      key: 'full_name',
      order: 0,
      pathway: IntakePathway.FULL_INTAKE,
      type: QuestionType.SHORT_TEXT,
      prompt: 'What name should the recruiter ask for?',
      required: true,
    },
    {
      key: 'phone',
      order: 1,
      pathway: IntakePathway.FULL_INTAKE,
      type: QuestionType.PHONE,
      prompt: 'What is the best phone number for you?',
      required: true,
    },
    {
      key: 'general_location',
      order: 2,
      pathway: IntakePathway.FULL_INTAKE,
      type: QuestionType.SHORT_TEXT,
      prompt: 'Which town or area are you in?',
      required: false,
    },
    {
      key: 'timeline',
      order: 3,
      pathway: IntakePathway.FULL_INTAKE,
      type: QuestionType.SINGLE_SELECT,
      prompt: 'Roughly what timeframe do you have in mind?',
      required: false,
      options: ['As soon as possible', 'Within 3 months', 'Not sure'],
    },
    {
      key: 'anything_else',
      order: 4,
      pathway: IntakePathway.FULL_INTAKE,
      type: QuestionType.LONG_TEXT,
      prompt: 'Anything else you want the recruiter to know?',
      required: false,
    },
  ];

  for (const question of questions) {
    await prisma.intakeQuestion.create({
      data: {
        organizationId,
        intakeVersionId: version.id,
        key: question.key,
        order: question.order,
        pathway: question.pathway,
        type: question.type,
        prompt: question.prompt,
        required: question.required ?? false,
        options: question.options ?? [],
        consentPurpose: question.consentPurpose ?? null,
        disclosureKey: question.consentPurpose ? question.key : null,
        disclosureText: question.consentPurpose ? 'Disclosure text for the test fixture.' : null,
      },
    });
  }

  return version;
}

export async function publishTemplates(organizationId: string, approverMemberId: string) {
  const templates = [
    { key: 'acknowledgment', kind: TemplateKind.ACKNOWLEDGMENT, body: 'Hi {{first_name}} — we have your details. Reply STOP to stop texts.', automatable: true },
    { key: 'intake_invitation', kind: TemplateKind.INTAKE_INVITATION, body: 'Hi {{first_name}} — your link: {{link}}', automatable: true, placeholders: ['link'] },
    { key: 'appointment_reminder', kind: TemplateKind.APPOINTMENT_REMINDER, body: 'Hi {{first_name}} — reminder for {{when}}.', automatable: true, placeholders: ['when'] },
    {
      key: 'missed_call_reply',
      kind: TemplateKind.MISSED_CALL_REPLY,
      body:
        'You just called the recruiting office and we could not pick up. A recruiter will call you back. ' +
        'Reply GO to answer a few questions by text, CALL to just wait for the call, or STOP to stop texts.',
      automatable: true,
    },
    { key: 'intake_sms_prompt', kind: TemplateKind.INTAKE_SMS_PROMPT, body: '{{text}}', automatable: true, placeholders: ['text'] },
  ];
  for (const template of templates) {
    const record = await prisma.messageTemplate.create({
      data: {
        organizationId,
        key: template.key,
        kind: template.kind,
        channel: ContactChannel.SMS,
        name: template.key,
        automatable: template.automatable,
      },
    });
    await prisma.templateVersion.create({
      data: {
        organizationId,
        templateId: record.id,
        version: 1,
        state: DefinitionState.PUBLISHED,
        body: template.body,
        placeholders: template.placeholders ?? [],
        approvedByMemberId: approverMemberId,
        approvedAt: now(),
        publishedAt: now(),
      },
    });
  }
}

export async function grantPermission(
  organizationId: string,
  subjectMemberId: string,
  grant: GrantType,
  options: { applicantId?: string; teamId?: string; expiresAt?: Date } = {},
) {
  return prisma.permissionGrant.create({
    data: {
      organizationId,
      subjectMemberId,
      grant,
      applicantId: options.applicantId ?? null,
      teamId: options.teamId ?? null,
      reason: 'test fixture',
      // Explicit, so the grant window agrees with the application clock.
      startsAt: now(),
      expiresAt: options.expiresAt ?? null,
    },
  });
}

export async function grantConsent(
  organizationId: string,
  applicantId: string,
  purpose: ConsentPurpose,
  contactValue: string,
  action: ConsentAction = ConsentAction.GRANTED,
) {
  const channel =
    purpose === ConsentPurpose.EMAIL_UPDATES
      ? ContactChannel.EMAIL
      : purpose === ConsentPurpose.CALLBACK_CALL
        ? ContactChannel.PHONE_CALL
        : ContactChannel.SMS;
  const event = await prisma.consentEvent.create({
    data: {
      organizationId,
      applicantId,
      channel,
      purpose,
      contactValue,
      action,
      disclosureKey: purpose.toLowerCase(),
      disclosureVersion: 1,
      disclosureText: 'Test disclosure.',
      source: 'test',
    },
  });
  await prisma.channelPermission.upsert({
    where: {
      organizationId_applicantId_channel_purpose_contactValue: {
        organizationId,
        applicantId,
        channel,
        purpose,
        contactValue,
      },
    },
    create: {
      organizationId,
      applicantId,
      channel,
      purpose,
      contactValue,
      granted: action === ConsentAction.GRANTED,
      suppressed: action === ConsentAction.SUPPRESSED,
      lastEventId: event.id,
    },
    update: {
      granted: action === ConsentAction.GRANTED,
      suppressed: action === ConsentAction.SUPPRESSED,
      lastEventId: event.id,
    },
  });
}

/** A fully wired organization: settings, integrations, intake set, templates. */
export async function createWorkspace(
  options: { slug?: string; timezone?: string; textBack?: boolean } = {},
) {
  const organization = await createOrganization(options);
  const admin = await createMember(organization.id, { role: StaffRole.ORG_ADMIN, name: 'Priya Admin' });
  const recruiter = await createMember(organization.id, { role: StaffRole.RECRUITER, name: 'Austin Recruiter' });
  const manager = await createMember(organization.id, { role: StaffRole.MANAGER, name: 'Dana Manager' });

  const team = await prisma.team.create({
    data: { organizationId: organization.id, name: 'Test team', managerMemberId: manager.member.id },
  });
  for (const m of [admin, recruiter, manager]) {
    await prisma.teamMember.create({
      data: { organizationId: organization.id, teamId: team.id, memberId: m.member.id },
    });
  }
  await prisma.organizationSettings.update({
    where: { organizationId: organization.id },
    data: { fallbackOwnerMemberId: recruiter.member.id },
  });

  const version = await publishIntakeSet(organization.id, admin.member.id);
  await publishTemplates(organization.id, admin.member.id);

  const orgRef = {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    dataScope: 'DEMO' as const,
  };

  return {
    organization,
    orgRef,
    team,
    admin,
    recruiter,
    manager,
    version,
    recruiterCtx: staffContext(recruiter.member, orgRef, options.timezone ?? 'America/Chicago'),
    managerCtx: staffContext(manager.member, orgRef, options.timezone ?? 'America/Chicago'),
    adminCtx: staffContext(admin.member, orgRef, options.timezone ?? 'America/Chicago'),
  };
}

export type Workspace = Awaited<ReturnType<typeof createWorkspace>>;

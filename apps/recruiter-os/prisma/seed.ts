import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  AppointmentMedium,
  AppointmentOutcome,
  AppointmentState,
  CallDirection,
  CallOutcome,
  CaseStatus,
  ConsentAction,
  ConsentPurpose,
  ContactChannel,
  DefinitionState,
  GrantType,
  IntakePathway,
  IntakeSessionStatus,
  IntegrationKind,
  IntegrationStatus,
  MessageAuthorKind,
  MessageDirection,
  MessageState,
  MetricEventKind,
  ReviewFlagKind,
  StaffRole,
  TaskStatus,
  TaskType,
  TemplateKind,
} from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '../src/server/db';
import { env } from '../src/env';
import { now } from '../src/server/clock';
import { contentHash, generateToken, hashToken } from '../src/lib/crypto';
import { GREETING, COMPLETION_TEXT, HANDOFF_TEXT, QUESTIONS, TEMPLATES } from './seed-data';
import { prepareBrief } from '../src/server/services/briefs';
import { systemContext } from '../src/server/authz/policy';
import { ensureNextStep } from '../src/server/services/tasks';

/**
 * Fictional demonstration data.
 *
 * Everything here is invented. Phone numbers are in the 555 range and email
 * addresses use .invalid, both of which are reserved and undeliverable, so a
 * misconfiguration cannot reach a real person.
 *
 * Dates are anchored RELATIVE TO THE DEMO CLOCK, so "Today" is useful whenever
 * the app starts. Re-running the seed rebuilds the demo organizations from
 * scratch, which makes it idempotent; it refuses to run in LIVE mode and never
 * touches an organization whose data scope is LIVE.
 */

const DEMO_PASSWORD = 'demo-password-not-for-live-use';

const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

async function main() {
  if (env.APP_MODE !== 'DEMO') {
    throw new Error(
      'The seed refuses to run unless APP_MODE=DEMO. Demo accounts must never exist in a live deployment.',
    );
  }

  const at = now();
  const reset = process.argv.includes('--reset');
  console.log(`[seed] mode=${env.APP_MODE} clock=${at.toISOString()}${reset ? ' (reset requested)' : ''}`);

  // ---- clear the demo dataset only ---------------------------------------
  const existing = await prisma.organization.findMany({
    where: { dataScope: 'DEMO' },
    select: { id: true, slug: true },
  });
  if (existing.length) {
    console.log(`[seed] removing ${existing.length} existing demo organization(s): ${existing.map((o) => o.slug).join(', ')}`);
    const ids = existing.map((o) => o.id);
    // Order matters only where a Restrict relation would block the delete.
    await prisma.task.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.appointment.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.applicant.updateMany({
      where: { organizationId: { in: ids } },
      data: { ownerMemberId: null, teamId: null, status: CaseStatus.CLOSED, closureReason: 'OTHER', closedAt: at },
    });
    await prisma.team.updateMany({ where: { organizationId: { in: ids } }, data: { managerMemberId: null } });
    await prisma.permissionGrant.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.applicant.deleteMany({ where: { organizationId: { in: ids } } });
    const users = await prisma.user.findMany({
      where: { members: { some: { organizationId: { in: ids } } } },
      select: { id: true },
    });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    // Sweep any identity left behind by an interrupted earlier run: a user
    // with no membership at all cannot sign in to anything.
    await prisma.user.deleteMany({ where: { members: { none: {} } } });
    await prisma.metricEvent.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.webhookReceipt.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.outboxRecord.deleteMany({ where: { organizationId: { in: ids } } });
  }

  // Orphaned identities from an interrupted run would collide on email.
  await prisma.user.deleteMany({ where: { members: { none: {} } } });

  const central = await buildOrganization({
    name: 'Central Recruiting Station (Demo)',
    slug: 'central-demo',
    timezone: 'America/Chicago',
    at,
  });

  // A second organization exists purely so isolation can be demonstrated and
  // tested: nothing in Central may ever read anything in Northside.
  const northside = await buildOrganization({
    name: 'Northside Recruiting Station (Demo)',
    slug: 'northside-demo',
    timezone: 'America/Denver',
    at,
  });

  await seedCentralCases(central, at);
  await seedNorthsideCases(northside, at);

  console.log('');
  console.log('[seed] done.');
  console.log(`[seed] sign in at ${env.PUBLIC_APP_URL}/login`);
  console.log('[seed] demo accounts (password for all of them: ' + DEMO_PASSWORD + '):');
  console.log('         austin.reyes@central.invalid    recruiter  — the primary demonstration recruiter');
  console.log('         marcus.hale@central.invalid     recruiter  — away this week, so coverage applies');
  console.log('         dana.whitfield@central.invalid  manager    — team metadata, no conversation content');
  console.log('         priya.nandi@central.invalid     org admin  — settings and integrations, no case content');
  console.log('         jordan.kim@northside.invalid    recruiter  — the other organization, for isolation');
  console.log(`[seed] public intake preview: ${env.PUBLIC_APP_URL}/intake/central-demo`);
}

// ---------------------------------------------------------------------------
// Organization scaffolding
// ---------------------------------------------------------------------------

type BuiltOrg = Awaited<ReturnType<typeof buildOrganization>>;

async function buildOrganization(input: { name: string; slug: string; timezone: string; at: Date }) {
  const organization = await prisma.organization.create({
    data: { name: input.name, slug: input.slug, dataScope: 'DEMO' },
  });

  await prisma.organizationSettings.create({
    data: {
      organizationId: organization.id,
      defaultTimezone: input.timezone,
      quietHoursStartMinute: 21 * 60,
      quietHoursEndMinute: 8 * 60,
      unknownTimezonePolicy: 'BLOCK',
      routingStrategy: 'ROUND_ROBIN',
      seatLimit: 5,
      aiPreparationEnabled: true,
      aiProvider: 'local-rules',
      aiApprovedCategories: ['intake_answers', 'applicant_messages', 'recruiter_messages', 'call_outcomes'],
      automationEnabled: true,
      // On in the demo so the missed-call-to-morning-brief path can be walked
      // end to end. It is OFF by default everywhere else: whether to text
      // somebody who called you is a deployment decision, not a default.
      textBackEnabled: true,
      textBackWindowMinutes: 15,
      textBackMaxQuestions: 6,
      citizenshipQuestionsEnabled: false,
      // Youth policy is deliberately unset: it is a deployment decision, and
      // the product refuses to invent a universal rule.
      minimumIntakeAge: null,
      youthPolicyNote:
        'Not configured in the demo dataset. A real deployment sets this after its own organizational review.',
    },
  });

  const isCentral = input.slug === 'central-demo';
  const people = isCentral
    ? [
        { name: 'Austin Reyes', email: 'austin.reyes@central.invalid', role: StaffRole.RECRUITER, authRole: 'member' },
        { name: 'Marcus Hale', email: 'marcus.hale@central.invalid', role: StaffRole.RECRUITER, authRole: 'member' },
        { name: 'Dana Whitfield', email: 'dana.whitfield@central.invalid', role: StaffRole.MANAGER, authRole: 'member' },
        { name: 'Priya Nandi', email: 'priya.nandi@central.invalid', role: StaffRole.ORG_ADMIN, authRole: 'owner' },
      ]
    : [{ name: 'Jordan Kim', email: 'jordan.kim@northside.invalid', role: StaffRole.RECRUITER, authRole: 'owner' }];

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const members: Record<string, string> = {};

  for (const person of people) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: person.name,
        email: person.email,
        emailVerified: true,
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
      },
    });
    const member = await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        role: person.authRole,
        staffRole: person.role,
        displayName: person.name,
        active: true,
      },
    });
    members[person.email] = member.id;

    // Office hours, used to refuse appointments outside declared availability.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await prisma.availabilityWindow.create({
        data: {
          organizationId: organization.id,
          memberId: member.id,
          weekday,
          startMinute: 8 * 60,
          endMinute: 18 * 60,
          timezone: input.timezone,
        },
      });
    }
  }

  const primaryEmail = isCentral ? 'austin.reyes@central.invalid' : 'jordan.kim@northside.invalid';
  await prisma.organizationSettings.update({
    where: { organizationId: organization.id },
    data: { fallbackOwnerMemberId: members[primaryEmail] },
  });

  // ---- team -------------------------------------------------------------
  const team = await prisma.team.create({
    data: {
      organizationId: organization.id,
      name: isCentral ? 'Central floor team' : 'Northside team',
      managerMemberId: isCentral ? members['dana.whitfield@central.invalid'] : null,
    },
  });
  for (const memberId of Object.values(members)) {
    await prisma.teamMember.create({
      data: { organizationId: organization.id, teamId: team.id, memberId },
    });
  }

  // ---- intake question set ----------------------------------------------
  const definition = await prisma.intakeDefinition.create({
    data: { organizationId: organization.id, key: 'default', name: 'Applicant intake' },
  });
  const version = await prisma.intakeVersion.create({
    data: {
      organizationId: organization.id,
      definitionId: definition.id,
      version: 1,
      state: DefinitionState.PUBLISHED,
      greeting: GREETING,
      completionText: COMPLETION_TEXT,
      handoffText: HANDOFF_TEXT,
      approvedByMemberId: members[isCentral ? 'priya.nandi@central.invalid' : primaryEmail],
      approvedAt: input.at,
      approvalNote: 'Seeded demo question set. Reviewed as fictional demonstration content only.',
      publishedAt: input.at,
    },
  });
  for (const question of QUESTIONS) {
    await prisma.intakeQuestion.create({
      data: {
        organizationId: organization.id,
        intakeVersionId: version.id,
        key: question.key,
        order: question.order,
        pathway: question.pathway,
        type: question.type,
        prompt: question.prompt,
        helpText: question.helpText ?? null,
        required: question.required ?? false,
        options: question.options ?? [],
        consentPurpose: question.consentPurpose ?? null,
        disclosureKey: question.disclosureKey ?? null,
        disclosureText: question.disclosureText ?? null,
      },
    });
  }

  // ---- templates --------------------------------------------------------
  for (const template of TEMPLATES) {
    const record = await prisma.messageTemplate.create({
      data: {
        organizationId: organization.id,
        key: template.key,
        kind: template.kind as TemplateKind,
        channel: ContactChannel.SMS,
        name: template.name,
        automatable: template.automatable,
      },
    });
    await prisma.templateVersion.create({
      data: {
        organizationId: organization.id,
        templateId: record.id,
        version: 1,
        state: DefinitionState.PUBLISHED,
        body: template.body,
        placeholders: template.placeholders,
        approvedByMemberId: members[isCentral ? 'priya.nandi@central.invalid' : primaryEmail],
        approvedAt: input.at,
        publishedAt: input.at,
      },
    });
  }

  // ---- integrations -----------------------------------------------------
  const officeNumber = isCentral ? '+15125550100' : '+13035550100';
  await prisma.integrationConfig.createMany({
    data: [
      {
        organizationId: organization.id,
        kind: IntegrationKind.SMS,
        provider: 'simulator',
        enabled: true,
        status: IntegrationStatus.DEMO,
        statusDetail: 'Local telecom simulator. Exercises the real queue and state machine; sends nothing.',
        settings: { fromNumber: officeNumber, inboundNumber: officeNumber },
        lastCheckedAt: input.at,
        lastCheckKind: 'seed',
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.SMS,
        provider: 'twilio',
        enabled: false,
        status: IntegrationStatus.DISABLED,
        statusDetail: 'Not enabled. Needs LIVE mode, organization enablement and server credentials.',
        secretRefs: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
        settings: {},
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.VOICE,
        provider: 'simulator',
        enabled: true,
        status: IntegrationStatus.DEMO,
        statusDetail: 'Voice simulator. No recording, no transcription, no voice agent.',
        settings: { inboundNumber: officeNumber, forwardTo: '+15125550190', fallbackForwardTo: '+15125550191' },
        lastCheckedAt: input.at,
        lastCheckKind: 'seed',
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.VOICE,
        provider: 'twilio',
        enabled: false,
        status: IntegrationStatus.DISABLED,
        statusDetail: 'Not enabled.',
        secretRefs: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
        settings: {},
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.AI_BRIEF,
        provider: 'local-rules',
        enabled: true,
        status: IntegrationStatus.DEMO,
        statusDetail: 'Deterministic rules-based preparation. No external request is made.',
        settings: {},
        lastCheckedAt: input.at,
        lastCheckKind: 'seed',
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.AI_BRIEF,
        provider: 'anthropic',
        enabled: false,
        status: IntegrationStatus.DISABLED,
        statusDetail: 'Not enabled. Needs LIVE mode, organization enablement, ANTHROPIC_API_KEY and ANTHROPIC_MODEL.',
        secretRefs: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
        settings: {},
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.OUTBOUND_WEBHOOK,
        provider: 'https-webhook',
        enabled: false,
        status: IntegrationStatus.DISABLED,
        statusDetail: 'Disabled until a destination is allowlisted and a signing secret is configured.',
        secretRefs: ['OUTBOUND_WEBHOOK_ALLOWED_ORIGINS', 'OUTBOUND_WEBHOOK_SIGNING_SECRET'],
        settings: {},
      },
      {
        organizationId: organization.id,
        kind: IntegrationKind.EMAIL,
        provider: 'smtp',
        enabled: true,
        status: IntegrationStatus.CONFIGURED_UNVERIFIED,
        statusDetail: 'Local Mailpit capture for invitations and password resets.',
        secretRefs: ['SMTP_HOST', 'SMTP_PORT'],
        settings: {},
      },
    ],
  });

  // ---- grants -----------------------------------------------------------
  if (isCentral) {
    // The manager gets team reports by role; conversation content is a
    // separate, explicit, expiring grant that the demo deliberately does NOT
    // hand out by default.
    await prisma.permissionGrant.create({
      data: {
        organizationId: organization.id,
        subjectMemberId: members['dana.whitfield@central.invalid']!,
        grant: GrantType.TEAM_REPORTS,
        teamId: team.id,
        grantedByMemberId: members['priya.nandi@central.invalid']!,
        startsAt: input.at,
        reason: 'Manager of the Central floor team.',
      },
    });
    await prisma.permissionGrant.create({
      data: {
        organizationId: organization.id,
        subjectMemberId: members['austin.reyes@central.invalid']!,
        grant: GrantType.EXPORT,
        grantedByMemberId: members['priya.nandi@central.invalid']!,
        startsAt: input.at,
        reason: 'Prepares handoff packages for the station.',
      },
    });
    await prisma.permissionGrant.create({
      data: {
        organizationId: organization.id,
        subjectMemberId: members['dana.whitfield@central.invalid']!,
        grant: GrantType.BASELINE_ENTRY,
        grantedByMemberId: members['priya.nandi@central.invalid']!,
        startsAt: input.at,
        reason: 'Records the station’s own time measurements.',
      },
    });
    await prisma.permissionGrant.create({
      data: {
        organizationId: organization.id,
        subjectMemberId: members['priya.nandi@central.invalid']!,
        grant: GrantType.RETENTION_ADMIN,
        grantedByMemberId: members['priya.nandi@central.invalid']!,
        startsAt: input.at,
        reason: 'Runs retention previews.',
      },
    });

    // Marcus is away, so his cases are covered — time-bounded, as always.
    await prisma.absence.create({
      data: {
        organizationId: organization.id,
        memberId: members['marcus.hale@central.invalid']!,
        startsAt: new Date(input.at.getTime() - days(1)),
        endsAt: new Date(input.at.getTime() + days(4)),
        note: 'Training week.',
      },
    });
    await prisma.coverage.create({
      data: {
        organizationId: organization.id,
        fromMemberId: members['marcus.hale@central.invalid']!,
        toMemberId: members['austin.reyes@central.invalid']!,
        startsAt: new Date(input.at.getTime() - days(1)),
        expiresAt: new Date(input.at.getTime() + days(4)),
        reason: 'Covering Marcus while he is at training.',
      },
    });

    // A retention policy that exists but is NOT approved or enabled, which is
    // the honest default: nothing is deleted until someone decides.
    await prisma.retentionPolicy.create({
      data: {
        organizationId: organization.id,
        name: 'Station default (draft)',
        closedCaseRetentionDays: 400,
        briefRetentionDays: 180,
        webhookPayloadRetentionDays: 30,
        auditMetadataRetentionDays: 730,
        enabled: false,
      },
    });

    await prisma.commercialMetadata.create({
      data: {
        organizationId: organization.id,
        implementationFeeCents: 300_000,
        monthlyFeeCents: 100_000,
        licensedSeats: 5,
        note:
          'Hypothesis under test, not established pricing. Recorded here so the shape of the model is ' +
          'visible and editable.',
      },
    });

    // A comparable baseline/observation pair, so the savings report has
    // something real to show for one task type — and nothing for the others.
    await prisma.baselineObservation.createMany({
      data: [
        {
          organizationId: organization.id,
          taskType: 'prepare-case-file',
          measurementKind: 'baseline',
          periodStart: new Date(input.at.getTime() - days(60)),
          periodEnd: new Date(input.at.getTime() - days(30)),
          sampleCount: 18,
          meanMinutes: 14.5,
          methodology:
            'Austin timed himself assembling a case file by hand from texts and notes, 18 cases over four weeks.',
          recordedByMemberId: members['dana.whitfield@central.invalid']!,
        },
        {
          organizationId: organization.id,
          taskType: 'prepare-case-file',
          measurementKind: 'observation',
          periodStart: new Date(input.at.getTime() - days(28)),
          periodEnd: input.at,
          sampleCount: 21,
          meanMinutes: 6.25,
          methodology: 'Same task, same recruiter, timed against the prepared brief, 21 cases over four weeks.',
          recordedByMemberId: members['dana.whitfield@central.invalid']!,
        },
      ],
    });
  }

  return { organization, settings: { timezone: input.timezone }, members, team, version, officeNumber };
}

// ---------------------------------------------------------------------------
// Case builders
// ---------------------------------------------------------------------------

type CaseSpec = {
  reference: string;
  displayName: string;
  phone?: string;
  email?: string;
  location?: string;
  timezone?: string;
  timezoneConfirmed?: boolean;
  status: CaseStatus;
  ownerEmail: string;
  originKind: string;
  openedHoursAgo: number;
  automationPaused?: boolean;
  automationPausedReason?: string;
};

async function createCase(org: BuiltOrg, at: Date, spec: CaseSpec) {
  const openedAt = new Date(at.getTime() - hours(spec.openedHoursAgo));
  const applicant = await prisma.applicant.create({
    data: {
      organizationId: org.organization.id,
      reference: spec.reference,
      displayName: spec.displayName,
      generalLocation: spec.location ?? null,
      timezone: spec.timezone ?? null,
      timezoneConfirmed: spec.timezoneConfirmed ?? false,
      status: spec.status,
      ownerMemberId: org.members[spec.ownerEmail]!,
      teamId: org.team.id,
      automationPaused: spec.automationPaused ?? false,
      automationPausedReason: spec.automationPausedReason ?? null,
      createdAt: openedAt,
      ...(spec.status === CaseStatus.CLOSED
        ? { closureReason: 'OTHER' as const, closedAt: at }
        : {}),
    },
  });

  if (spec.phone) {
    await prisma.contactPoint.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        channel: ContactChannel.PHONE_CALL,
        value: spec.phone,
        isPrimary: true,
        createdAt: openedAt,
      },
    });
    await prisma.contactPoint.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        channel: ContactChannel.SMS,
        value: spec.phone,
        createdAt: openedAt,
      },
    });
  }
  if (spec.email) {
    await prisma.contactPoint.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        channel: ContactChannel.EMAIL,
        value: spec.email,
        isPrimary: !spec.phone,
        createdAt: openedAt,
      },
    });
  }

  const episode = await prisma.inquiryEpisode.create({
    data: {
      organizationId: org.organization.id,
      applicantId: applicant.id,
      originKind: spec.originKind,
      openedAt,
    },
  });

  await prisma.metricEvent.create({
    data: {
      organizationId: org.organization.id,
      kind: MetricEventKind.INQUIRY_OPENED,
      applicantId: applicant.id,
      inquiryEpisodeId: episode.id,
      memberId: applicant.ownerMemberId,
      detail: spec.originKind,
      occurredAt: openedAt,
    },
  });

  return { applicant, episode, openedAt };
}

async function grantConsent(
  org: BuiltOrg,
  applicantId: string,
  purpose: ConsentPurpose,
  contactValue: string,
  occurredAt: Date,
  action: ConsentAction = ConsentAction.GRANTED,
) {
  const channel =
    purpose === ConsentPurpose.EMAIL_UPDATES
      ? ContactChannel.EMAIL
      : purpose === ConsentPurpose.CALLBACK_CALL
        ? ContactChannel.PHONE_CALL
        : ContactChannel.SMS;
  const disclosureText =
    purpose === ConsentPurpose.CALLBACK_CALL
      ? 'We will call you at the number you gave us so a recruiter can talk with you. Asking for a call does not sign you up for text messages.'
      : 'You can choose to exchange text messages with a recruiter. Message and data rates may apply. Reply STOP at any time to stop texts.';

  const event = await prisma.consentEvent.create({
    data: {
      organizationId: org.organization.id,
      applicantId,
      channel,
      purpose,
      contactValue,
      action,
      disclosureKey: purpose.toLowerCase(),
      disclosureVersion: 3,
      disclosureText,
      source: 'intake_session:seed',
      occurredAt,
    },
  });
  const suppressed = action === ConsentAction.SUPPRESSED;
  await prisma.channelPermission.upsert({
    where: {
      organizationId_applicantId_channel_purpose_contactValue: {
        organizationId: org.organization.id,
        applicantId,
        channel,
        purpose,
        contactValue,
      },
    },
    create: {
      organizationId: org.organization.id,
      applicantId,
      channel,
      purpose,
      contactValue,
      granted: action === ConsentAction.GRANTED,
      suppressed,
      suppressedAt: suppressed ? occurredAt : null,
      suppressionSource: suppressed ? 'sms_keyword:STOP' : null,
      lastEventId: event.id,
    },
    update: {
      granted: action === ConsentAction.GRANTED,
      suppressed,
      suppressedAt: suppressed ? occurredAt : null,
      suppressionSource: suppressed ? 'sms_keyword:STOP' : null,
      lastEventId: event.id,
    },
  });
}

async function addMessage(
  org: BuiltOrg,
  input: {
    applicantId: string;
    contactValue: string;
    direction: MessageDirection;
    authorKind: MessageAuthorKind;
    authorMemberId?: string | null;
    body: string;
    state: MessageState;
    occurredAt: Date;
    providerMessageId?: string | null;
    blockedReason?: string | null;
    failureCode?: string | null;
    failureDetail?: string | null;
    templateKey?: string | null;
    approvedByMemberId?: string | null;
    deliveryEvents?: Array<{ status: string; state: MessageState; rank: number; offsetSeconds: number; errorCode?: string }>;
  },
) {
  const conversation = await prisma.conversation.upsert({
    where: {
      organizationId_applicantId_channel_contactValue: {
        organizationId: org.organization.id,
        applicantId: input.applicantId,
        channel: ContactChannel.SMS,
        contactValue: input.contactValue,
      },
    },
    create: {
      organizationId: org.organization.id,
      applicantId: input.applicantId,
      channel: ContactChannel.SMS,
      contactValue: input.contactValue,
      lastEventAt: input.occurredAt,
    },
    update: { lastEventAt: input.occurredAt },
  });

  let templateVersionId: string | null = null;
  if (input.templateKey) {
    const template = await prisma.messageTemplate.findUnique({
      where: { organizationId_key: { organizationId: org.organization.id, key: input.templateKey } },
      include: { versions: { where: { state: DefinitionState.PUBLISHED }, take: 1 } },
    });
    templateVersionId = template?.versions[0]?.id ?? null;
  }

  const outbound = input.direction === MessageDirection.OUTBOUND;
  const message = await prisma.message.create({
    data: {
      organizationId: org.organization.id,
      applicantId: input.applicantId,
      conversationId: conversation.id,
      direction: input.direction,
      authorKind: input.authorKind,
      authorMemberId: input.authorMemberId ?? null,
      channel: ContactChannel.SMS,
      fromValue: outbound ? org.officeNumber : input.contactValue,
      toValue: outbound ? input.contactValue : org.officeNumber,
      body: input.body,
      state: input.state,
      // Anything past DRAFT on the way out carries the approval hash the
      // database constraint requires.
      approvedBodyHash:
        outbound && !['DRAFT', 'CANCELED', 'BLOCKED'].includes(input.state) ? contentHash(input.body) : null,
      approvedByMemberId: input.approvedByMemberId ?? null,
      approvedAt: input.approvedByMemberId ? input.occurredAt : null,
      templateVersionId,
      providerMessageId: input.providerMessageId ?? null,
      providerName: outbound ? 'simulator' : 'simulator',
      idempotencyKey: outbound ? `seed:${randomUUID()}` : null,
      blockedReason: input.blockedReason ?? null,
      failureCode: input.failureCode ?? null,
      failureDetail: input.failureDetail ?? null,
      simulated: true,
      occurredAt: input.occurredAt,
      createdAt: input.occurredAt,
    },
  });

  for (const event of input.deliveryEvents ?? []) {
    await prisma.messageDeliveryEvent.create({
      data: {
        organizationId: org.organization.id,
        messageId: message.id,
        providerStatus: event.status,
        normalizedState: event.state,
        stateRank: event.rank,
        errorCode: event.errorCode ?? null,
        providerEventId: `${message.id}-${event.status}`,
        occurredAt: new Date(input.occurredAt.getTime() + event.offsetSeconds * 1000),
      },
    });
  }

  return message;
}

async function addTask(
  org: BuiltOrg,
  input: {
    applicantId: string;
    ownerEmail: string;
    type: TaskType;
    title: string;
    reason: string;
    dueAt: Date;
    originalDueAt?: Date;
    status?: TaskStatus;
    sourceRef?: string;
    snoozes?: Array<{ from: Date; to: Date; reason: string }>;
    completion?: { at: Date; outcome: 'SPOKE_WITH_APPLICANT' | 'LEFT_VOICEMAIL' | 'NO_ANSWER' | 'SENT_MESSAGE' | 'APPOINTMENT_SET' | 'RESOLVED'; note?: string };
  },
) {
  const ownerMemberId = org.members[input.ownerEmail]!;
  const task = await prisma.task.create({
    data: {
      organizationId: org.organization.id,
      applicantId: input.applicantId,
      type: input.type,
      title: input.title,
      reason: input.reason,
      sourceRef: input.sourceRef ?? null,
      ownerMemberId,
      dueAt: input.dueAt,
      originalDueAt: input.originalDueAt ?? input.dueAt,
      status: input.completion ? TaskStatus.COMPLETED : (input.status ?? TaskStatus.OPEN),
      snoozeCount: input.snoozes?.length ?? 0,
      ...(input.completion
        ? {
            completedAt: input.completion.at,
            completedByMemberId: ownerMemberId,
            completionOutcome: input.completion.outcome,
            completionNote: input.completion.note ?? null,
          }
        : {}),
    },
  });

  for (const snooze of input.snoozes ?? []) {
    await prisma.taskSnooze.create({
      data: {
        organizationId: org.organization.id,
        taskId: task.id,
        fromDueAt: snooze.from,
        toDueAt: snooze.to,
        reason: snooze.reason,
        byMemberId: ownerMemberId,
      },
    });
  }

  if (input.completion) {
    const onTime = input.completion.at.getTime() <= (input.originalDueAt ?? input.dueAt).getTime();
    await prisma.metricEvent.create({
      data: {
        organizationId: org.organization.id,
        kind: onTime ? MetricEventKind.TASK_COMPLETED_ON_TIME : MetricEventKind.TASK_COMPLETED_LATE,
        applicantId: input.applicantId,
        memberId: ownerMemberId,
        detail: input.type,
        occurredAt: input.completion.at,
      },
    });
  }

  return task;
}

// ---------------------------------------------------------------------------
// The Central demonstration dataset
// ---------------------------------------------------------------------------

async function seedCentralCases(org: BuiltOrg, at: Date) {
  const AUSTIN = 'austin.reyes@central.invalid';
  const MARCUS = 'marcus.hale@central.invalid';
  const ctx = systemContext(org.organization.id, 'seed');

  // 1. A brand-new web inquiry nobody has touched yet.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0001',
      displayName: 'Tasha Alvarez',
      phone: '+15125550301',
      email: 'tasha.alvarez@example.invalid',
      location: 'Pflugerville',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.READY_FOR_RECRUITER,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 2,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.CALLBACK_CALL, '+15125550301', openedAt);
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550301', openedAt);
    await seedIntakeAnswers(org, applicant.id, openedAt, IntakePathway.FULL_INTAKE, {
      full_name: 'Tasha Alvarez',
      phone: '+15125550301',
      email: 'tasha.alvarez@example.invalid',
      general_location: 'Pflugerville',
      timezone: 'America/Chicago',
      contact_preference: 'A text first, then a call',
      availability: 'Weekday evenings after 6, and Saturday mornings',
      interest_area: 'Computers, cyber or intelligence',
      timeline: 'Within 3 months',
      education_status: 'Finished high school or equivalent',
      asvab_status: 'No',
      anything_else: 'I want to know what jobs involve computers and whether I can pick one before signing anything.',
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Make first contact with Tasha',
      reason: 'A new inquiry finished intake and no recruiter has reached out yet.',
      dueAt: new Date(at.getTime() + hours(2)),
    });
    // The automated acknowledgment: accepted by the carrier, and delivered.
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550301',
      direction: MessageDirection.OUTBOUND,
      authorKind: MessageAuthorKind.APPROVED_AUTOMATION,
      body:
        'Hi Tasha — this is an automated message from the recruiting office confirming we have your details. ' +
        'A recruiter will read them and get in touch. Reply STOP to stop texts.',
      state: MessageState.DELIVERED,
      occurredAt: new Date(openedAt.getTime() + 90_000),
      providerMessageId: 'SIM0000000000000000000001',
      templateKey: 'acknowledgment',
      deliveryEvents: [
        { status: 'queued', state: MessageState.PROVIDER_ACCEPTED, rank: 6, offsetSeconds: 1 },
        { status: 'sent', state: MessageState.SENT, rank: 7, offsetSeconds: 6 },
        { status: 'delivered', state: MessageState.DELIVERED, rank: 9, offsetSeconds: 22 },
      ],
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: applicant.id },
      data: {
        acknowledgedAcceptedAt: new Date(openedAt.getTime() + 91_000),
        acknowledgedDeliveredAt: new Date(openedAt.getTime() + 112_000),
      },
    });
  }

  // 2. A callback request from a missed call, with the window open now.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0002',
      displayName: 'Devon Brooks',
      phone: '+15125550302',
      location: 'Round Rock',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.READY_FOR_RECRUITER,
      ownerEmail: AUSTIN,
      originKind: 'missed_call',
      openedHoursAgo: 3,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.CALLBACK_CALL, '+15125550302', openedAt);
    await prisma.callEvent.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        direction: CallDirection.FORWARDED,
        fromValue: '+15125550302',
        toValue: org.officeNumber,
        // The parent call "completed"; the forwarded leg did not answer. Only
        // the leg outcome tells the truth, and that is what is stored.
        outcome: CallOutcome.NO_ANSWER,
        humanConnected: false,
        durationSeconds: 0,
        providerCallSid: 'SIMCA0000000001',
        providerParentCallSid: 'SIMCA0000000001P',
        providerLeg: 'dial',
        providerName: 'simulator',
        simulated: true,
        note: 'Forwarded leg reported "no-answer".',
        occurredAt: openedAt,
      },
    });
    await seedIntakeAnswers(org, applicant.id, openedAt, IntakePathway.CALLBACK_REQUEST, {
      full_name: 'Devon Brooks',
      phone: '+15125550302',
      contact_preference: 'A phone call',
      availability: 'Any weekday between 9 and 11 in the morning',
      timezone: 'America/Chicago',
      callback_call_consent: 'yes',
      // Asking for a call did NOT create SMS consent. This is the demo case
      // that shows the difference.
      callback_sms_consent: 'no',
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.CALLBACK,
      title: 'Call back Devon Brooks',
      reason: 'A callback was requested and the window they gave is open now.',
      dueAt: new Date(at.getTime() - hours(1)),
      sourceRef: 'call:SIMCA0000000001',
    });
  }

  // 3. A partial intake, paused, with a live resume credential.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0003',
      displayName: 'Priyanka Rao',
      phone: '+15125550303',
      location: 'Georgetown',
      status: CaseStatus.INTAKE_IN_PROGRESS,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 26,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.INTAKE_SMS, '+15125550303', openedAt);
    const token = generateToken(32);
    const session = await prisma.intakeSession.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        intakeVersionId: org.version.id,
        pathway: IntakePathway.FULL_INTAKE,
        status: IntakeSessionStatus.PAUSED,
        resumeTokenHash: hashToken(token),
        resumeExpiresAt: new Date(at.getTime() + hours(46)),
        currentQuestionKey: 'interest_area',
        lastActivityAt: new Date(openedAt.getTime() + hours(1)),
        createdAt: openedAt,
      },
    });
    const partial: Record<string, string> = {
      full_name: 'Priyanka Rao',
      phone: '+15125550303',
      general_location: 'Georgetown',
      contact_preference: 'Either is fine',
    };
    let order = 0;
    for (const [key, value] of Object.entries(partial)) {
      await prisma.intakeAnswer.create({
        data: {
          organizationId: org.organization.id,
          intakeSessionId: session.id,
          questionKey: key,
          questionPrompt: QUESTIONS.find((q) => q.key === key)?.prompt ?? key,
          revision: 1,
          valueText: value,
          answeredAt: new Date(openedAt.getTime() + order++ * 60_000),
        },
      });
    }
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Priyanka paused partway through intake — offer a call instead',
      reason: 'Intake was paused a day ago and has not been resumed.',
      dueAt: new Date(at.getTime() + hours(6)),
    });
    console.log(`[seed] resume link for the paused intake: ${env.PUBLIC_APP_URL}/resume?t=${token}`);
  }

  // 4. An overdue follow-up that has already been moved once.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0004',
      displayName: 'Marcus Webb',
      phone: '+15125550304',
      location: 'Austin',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.CONTACT_ATTEMPTED,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 120,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550304', openedAt);
    await grantConsent(org, applicant.id, ConsentPurpose.CALLBACK_CALL, '+15125550304', openedAt);
    const promised = new Date(at.getTime() - days(2));
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Call Marcus back as promised',
      reason: 'Promised a call two days ago and it has not happened.',
      dueAt: new Date(at.getTime() - hours(4)),
      originalDueAt: promised,
      status: TaskStatus.SNOOZED,
      snoozes: [
        {
          from: promised,
          to: new Date(at.getTime() - hours(4)),
          reason: 'Station was short-staffed; moved to the next available slot.',
        },
      ],
    });
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550304',
      direction: MessageDirection.OUTBOUND,
      authorKind: MessageAuthorKind.RECRUITER,
      authorMemberId: org.members[AUSTIN]!,
      approvedByMemberId: org.members[AUSTIN]!,
      body: 'Hi Marcus, this is Austin from the recruiting office. Is tomorrow morning still good for a call?',
      state: MessageState.DELIVERED,
      occurredAt: new Date(at.getTime() - days(3)),
      providerMessageId: 'SIM0000000000000000000004',
      deliveryEvents: [
        { status: 'sent', state: MessageState.SENT, rank: 7, offsetSeconds: 3 },
        { status: 'delivered', state: MessageState.DELIVERED, rank: 9, offsetSeconds: 15 },
      ],
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: applicant.id },
      data: { firstHumanOutreachAt: new Date(at.getTime() - days(3)) },
    });
  }

  // 5. Outreach that was delivered and never answered — waiting, with a
  //    review date so it cannot age out unnoticed.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0005',
      displayName: 'Chloe Nguyen',
      phone: '+15125550305',
      location: 'Cedar Park',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.AWAITING_APPLICANT,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 96,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550305', openedAt);
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550305',
      direction: MessageDirection.OUTBOUND,
      authorKind: MessageAuthorKind.RECRUITER,
      authorMemberId: org.members[AUSTIN]!,
      approvedByMemberId: org.members[AUSTIN]!,
      body: 'Hi Chloe, Austin from the recruiting office. Happy to answer questions whenever suits you.',
      state: MessageState.DELIVERED,
      occurredAt: new Date(at.getTime() - days(3)),
      providerMessageId: 'SIM0000000000000000000005',
      deliveryEvents: [
        { status: 'sent', state: MessageState.SENT, rank: 7, offsetSeconds: 2 },
        { status: 'delivered', state: MessageState.DELIVERED, rank: 9, offsetSeconds: 11 },
      ],
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: applicant.id },
      data: { firstHumanOutreachAt: new Date(at.getTime() - days(3)) },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Review — waiting on Chloe',
      reason: 'Waiting states still need a review date so the case does not age out unnoticed.',
      dueAt: new Date(at.getTime() + days(1)),
    });
  }

  // 6. A confirmed appointment tomorrow, with live reminders.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0006',
      displayName: 'Jaylen Foster',
      phone: '+15125550306',
      location: 'Austin',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.APPOINTMENT_SCHEDULED,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 72,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550306', openedAt);
    await grantConsent(org, applicant.id, ConsentPurpose.APPOINTMENT_REMINDER_SMS, '+15125550306', openedAt);
    const startsAt = new Date(at.getTime() + hours(26));
    const appointment = await prisma.appointment.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        recruiterMemberId: org.members[AUSTIN]!,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hours(1)),
        timezone: 'America/Chicago',
        medium: AppointmentMedium.IN_PERSON,
        locationDetail: 'Central station, front office',
        purpose: 'Initial conversation',
        state: AppointmentState.CONFIRMED,
        confirmedAt: new Date(at.getTime() - hours(20)),
        confirmTokenHash: hashToken(generateToken(32)),
        confirmExpiresAt: startsAt,
      },
    });
    await prisma.appointmentReminder.create({
      data: {
        organizationId: org.organization.id,
        appointmentId: appointment.id,
        sendAt: new Date(startsAt.getTime() - hours(24)),
        status: 'pending',
      },
    });
    await prisma.appointmentReminder.create({
      data: {
        organizationId: org.organization.id,
        appointmentId: appointment.id,
        sendAt: new Date(startsAt.getTime() - hours(2)),
        status: 'pending',
      },
    });
    await prisma.metricEvent.create({
      data: {
        organizationId: org.organization.id,
        kind: MetricEventKind.APPOINTMENT_SCHEDULED,
        applicantId: applicant.id,
        memberId: org.members[AUSTIN]!,
        occurredAt: new Date(at.getTime() - hours(21)),
      },
    });
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550306',
      direction: MessageDirection.INBOUND,
      authorKind: MessageAuthorKind.APPLICANT,
      body: 'Yes tomorrow at 10 works for me, see you then.',
      state: MessageState.RECEIVED,
      occurredAt: new Date(at.getTime() - hours(20)),
      providerMessageId: 'SIMIN000000000000000000006',
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: applicant.id },
      data: {
        firstHumanOutreachAt: new Date(at.getTime() - hours(26)),
        firstTwoWayHumanAt: new Date(at.getTime() - hours(20)),
      },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.APPOINTMENT_PREP,
      title: 'Prepare for Jaylen’s appointment',
      reason: 'An appointment is scheduled and needs preparation before it happens.',
      dueAt: new Date(startsAt.getTime() - hours(3)),
      sourceRef: `appointment:${appointment.id}`,
    });
  }

  // 7. A completed appointment with a recorded outcome.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0007',
      displayName: 'Sofia Marino',
      phone: '+15125550307',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.TWO_WAY_CONVERSATION,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 240,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550307', openedAt);
    const startsAt = new Date(at.getTime() - days(2));
    await prisma.appointment.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        recruiterMemberId: org.members[AUSTIN]!,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hours(1)),
        timezone: 'America/Chicago',
        medium: AppointmentMedium.IN_PERSON,
        purpose: 'Initial conversation',
        state: AppointmentState.COMPLETED,
        outcome: AppointmentOutcome.ATTENDED,
        outcomeNote: 'Came in, went through the process, wants to talk again after speaking to family.',
        outcomeRecordedByMemberId: org.members[AUSTIN]!,
        outcomeRecordedAt: new Date(startsAt.getTime() + hours(2)),
      },
    });
    await prisma.metricEvent.createMany({
      data: [
        {
          organizationId: org.organization.id,
          kind: MetricEventKind.APPOINTMENT_SCHEDULED,
          applicantId: applicant.id,
          memberId: org.members[AUSTIN]!,
          occurredAt: new Date(at.getTime() - days(5)),
        },
        {
          organizationId: org.organization.id,
          kind: MetricEventKind.APPOINTMENT_COMPLETED,
          applicantId: applicant.id,
          memberId: org.members[AUSTIN]!,
          occurredAt: new Date(startsAt.getTime() + hours(2)),
        },
      ],
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: applicant.id },
      data: {
        firstHumanOutreachAt: new Date(at.getTime() - days(9)),
        firstTwoWayHumanAt: new Date(at.getTime() - days(9) + hours(3)),
      },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Check back with Sofia after she has spoken to her family',
      reason: 'She asked for a week; this is the review date.',
      dueAt: new Date(at.getTime() + days(4)),
    });
  }

  // 8. A no-show.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0008',
      displayName: 'Tyler Boone',
      phone: '+15125550308',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.CONTACT_ATTEMPTED,
      ownerEmail: MARCUS,
      originKind: 'web_intake',
      openedHoursAgo: 200,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550308', openedAt);
    const startsAt = new Date(at.getTime() - days(1));
    await prisma.appointment.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        recruiterMemberId: org.members[MARCUS]!,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hours(1)),
        timezone: 'America/Chicago',
        medium: AppointmentMedium.PHONE,
        purpose: 'Phone conversation',
        state: AppointmentState.NO_SHOW,
        outcome: AppointmentOutcome.NO_SHOW,
        outcomeNote: 'No answer at the agreed time; left a voicemail.',
        outcomeRecordedByMemberId: org.members[MARCUS]!,
        outcomeRecordedAt: new Date(startsAt.getTime() + hours(1)),
      },
    });
    await prisma.metricEvent.create({
      data: {
        organizationId: org.organization.id,
        kind: MetricEventKind.APPOINTMENT_NO_SHOW,
        applicantId: applicant.id,
        memberId: org.members[MARCUS]!,
        occurredAt: new Date(startsAt.getTime() + hours(1)),
      },
    });
    // Marcus is away; Austin holds this through coverage, and the task shows
    // in Austin's queue because of the coverage grant, not because ownership
    // silently moved.
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: MARCUS,
      type: TaskType.CALLBACK,
      title: 'Try Tyler again after the missed appointment',
      reason: 'Did not attend the agreed phone appointment.',
      dueAt: new Date(at.getTime() + hours(3)),
    });
  }

  // 9. A human-requested handoff. Automation is paused.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0009',
      displayName: 'Amara Okafor',
      phone: '+15125550309',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.READY_FOR_RECRUITER,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 5,
      automationPaused: true,
      automationPausedReason: 'The applicant asked for a person.',
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550309', openedAt);
    await grantConsent(org, applicant.id, ConsentPurpose.CALLBACK_CALL, '+15125550309', openedAt);
    const session = await seedIntakeAnswers(
      org,
      applicant.id,
      openedAt,
      IntakePathway.FULL_INTAKE,
      {
        full_name: 'Amara Okafor',
        phone: '+15125550309',
        contact_preference: 'A phone call',
        anything_else: 'Can I just talk to a real person please',
      },
      IntakeSessionStatus.HANDED_OFF,
    );
    const flag = await prisma.reviewFlag.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        kind: ReviewFlagKind.HUMAN_REQUESTED,
        detail: 'The applicant asked to speak with a person during intake.',
        restricted: false,
        sourceRef: `intake_session:${session.id}`,
        raisedAt: new Date(openedAt.getTime() + 240_000),
      },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.REVIEW_HUMAN_REQUEST,
      title: 'Call Amara — she asked for a person',
      reason: 'The applicant asked to speak with a person during intake.',
      dueAt: new Date(at.getTime() - hours(1)),
      sourceRef: `review_flag:${flag.id}`,
    });
  }

  // 10. A sensitive-topic handoff. Restricted, and deliberately vague about
  //     what was said: the routing bucket, never a conclusion.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0010',
      displayName: 'Ben Castillo',
      phone: '+15125550310',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.READY_FOR_RECRUITER,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 8,
      automationPaused: true,
      automationPausedReason: 'A question came up that automation must not answer.',
    });
    await grantConsent(org, applicant.id, ConsentPurpose.CALLBACK_CALL, '+15125550310', openedAt);
    const session = await seedIntakeAnswers(
      org,
      applicant.id,
      openedAt,
      IntakePathway.FULL_INTAKE,
      {
        full_name: 'Ben Castillo',
        phone: '+15125550310',
        contact_preference: 'A phone call',
      },
      IntakeSessionStatus.HANDED_OFF,
      // The sensitive answer is stored restricted and excluded from brief
      // preparation.
      { key: 'anything_else', value: 'I take a prescription for asthma, does that matter?' },
    );
    const flag = await prisma.reviewFlag.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        kind: ReviewFlagKind.SENSITIVE_QUESTION,
        detail:
          'A medical topic came up during intake. Automation stopped without answering it; a recruiter handles it directly.',
        restricted: true,
        sourceRef: `intake_session:${session.id}`,
        raisedAt: new Date(openedAt.getTime() + 300_000),
      },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.REVIEW_SENSITIVE,
      title: 'Recruiter review required for Ben Castillo',
      reason: 'A question came up that automation must not answer.',
      dueAt: new Date(at.getTime() + hours(1)),
      sourceRef: `review_flag:${flag.id}`,
    });
  }

  // 11. An opted-out contact, with a pending send that was canceled by it.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0011',
      displayName: 'Hannah Pierce',
      phone: '+15125550311',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.AWAITING_APPLICANT,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 150,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550311', openedAt);
    await grantConsent(
      org,
      applicant.id,
      ConsentPurpose.RECRUITER_SMS,
      '+15125550311',
      new Date(at.getTime() - days(2)),
      ConsentAction.SUPPRESSED,
    );
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550311',
      direction: MessageDirection.INBOUND,
      authorKind: MessageAuthorKind.APPLICANT,
      body: 'STOP',
      state: MessageState.RECEIVED,
      occurredAt: new Date(at.getTime() - days(2)),
      providerMessageId: 'SIMIN000000000000000000011',
    });
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550311',
      direction: MessageDirection.OUTBOUND,
      authorKind: MessageAuthorKind.RECRUITER,
      authorMemberId: org.members[AUSTIN]!,
      body: 'Hi Hannah, following up on your questions from last week.',
      state: MessageState.CANCELED,
      blockedReason: 'Canceled: the recipient opted out before this was sent.',
      occurredAt: new Date(at.getTime() - days(2) + 60_000),
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Hannah opted out of texts — decide whether a call is appropriate',
      reason: 'An opt-out is final for texts. A recruiter decides what, if anything, happens next.',
      dueAt: new Date(at.getTime() + days(2)),
    });
  }

  // 12 + 13. Two cases that share one phone number. NOT merged, and neither
  //          can see the other's history.
  {
    const shared = '+15125550312';
    const first = await createCase(org, at, {
      reference: 'C26-0012',
      displayName: 'Ethan Pratt',
      phone: shared,
      location: 'Hutto',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.TWO_WAY_CONVERSATION,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 60,
    });
    await grantConsent(org, first.applicant.id, ConsentPurpose.RECRUITER_SMS, shared, first.openedAt);
    await addTask(org, {
      applicantId: first.applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.LINKING_REVIEW,
      title: 'Two cases share one phone number — decide who is who',
      reason: 'A shared phone number is not proof of identity. Nothing has been merged.',
      dueAt: new Date(at.getTime() + hours(8)),
    });

    const second = await createCase(org, at, {
      reference: 'C26-0013',
      displayName: 'Nora Pratt',
      phone: shared,
      location: 'Hutto',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.NEW_INQUIRY,
      ownerEmail: MARCUS,
      originKind: 'inbound_sms',
      openedHoursAgo: 20,
    });
    await grantConsent(org, second.applicant.id, ConsentPurpose.RECRUITER_SMS, shared, second.openedAt);

    const [a, b] = [first.applicant.id, second.applicant.id].sort();
    await prisma.duplicateCandidate.create({
      data: {
        organizationId: org.organization.id,
        applicantAId: a!,
        applicantBId: b!,
        signal: 'shared_phone',
        signalDetail:
          'Both cases list the same mobile number. Siblings share phones; this is a shared contact value, not proof of identity.',
      },
    });
    for (const applicantId of [first.applicant.id, second.applicant.id]) {
      await prisma.reviewFlag.create({
        data: {
          organizationId: org.organization.id,
          applicantId,
          kind: ReviewFlagKind.DUPLICATE_SUSPECTED,
          detail:
            'This case may be the same person as another case in this organization. Both list the same mobile number. Nothing has been merged.',
          sourceRef: `duplicate:${a}:${b}:shared_phone`,
        },
      });
    }
    await addTask(org, {
      applicantId: second.applicant.id,
      ownerEmail: MARCUS,
      type: TaskType.FOLLOW_UP,
      title: 'First contact with Nora Pratt',
      reason: 'A new inbound text has not been answered.',
      dueAt: new Date(at.getTime() + hours(2)),
    });
  }

  // 14. A failed outbound message, using the simulator's non-deliverable
  //     fixture number.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0014',
      displayName: 'Owen Delacroix',
      phone: '+15550001900',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.CONTACT_ATTEMPTED,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 40,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15550001900', openedAt);
    const failed = await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15550001900',
      direction: MessageDirection.OUTBOUND,
      authorKind: MessageAuthorKind.RECRUITER,
      authorMemberId: org.members[AUSTIN]!,
      approvedByMemberId: org.members[AUSTIN]!,
      body: 'Hi Owen, Austin from the recruiting office — when is a good time to talk?',
      state: MessageState.FAILED,
      failureCode: 'SIM-30006',
      failureDetail: 'Simulated landline / unreachable carrier.',
      occurredAt: new Date(at.getTime() - hours(30)),
      providerMessageId: 'SIM0000000000000000000014',
      deliveryEvents: [
        { status: 'sent', state: MessageState.SENT, rank: 7, offsetSeconds: 2 },
        { status: 'undelivered', state: MessageState.FAILED, rank: 8, offsetSeconds: 30, errorCode: 'SIM-30006' },
      ],
    });
    await prisma.reviewFlag.create({
      data: {
        organizationId: org.organization.id,
        applicantId: applicant.id,
        kind: ReviewFlagKind.BRIEF_REVIEW,
        detail:
          'An outbound message failed at the carrier (SIM-30006). It was not delivered, so this is not contact.',
        sourceRef: `message:${failed.id}`,
      },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.CALLBACK,
      title: 'Text to Owen failed — try calling instead',
      reason: 'The carrier rejected the message, so nothing reached him.',
      dueAt: new Date(at.getTime() + hours(4)),
    });
  }

  // 15. A case whose ownership was handed over, to show reassignment history.
  {
    const { applicant, openedAt } = await createCase(org, at, {
      reference: 'C26-0015',
      displayName: 'Grace Lindqvist',
      phone: '+15125550315',
      timezone: 'America/Chicago',
      timezoneConfirmed: true,
      status: CaseStatus.TWO_WAY_CONVERSATION,
      ownerEmail: AUSTIN,
      originKind: 'web_intake',
      openedHoursAgo: 180,
    });
    await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+15125550315', openedAt);
    await prisma.auditEvent.create({
      data: {
        organizationId: org.organization.id,
        category: 'SECURITY',
        action: 'case.reassigned',
        actorKind: 'staff',
        actorMemberId: org.members['dana.whitfield@central.invalid']!,
        actorLabel: 'Dana Whitfield',
        subjectType: 'applicant',
        subjectId: applicant.id,
        applicantId: applicant.id,
        metadata: {
          from: org.members[MARCUS]!,
          to: org.members[AUSTIN]!,
          reason: 'Marcus is at training; Austin already had the conversation.',
        },
        occurredAt: new Date(at.getTime() - days(2)),
      },
    });
    await addMessage(org, {
      applicantId: applicant.id,
      contactValue: '+15125550315',
      direction: MessageDirection.INBOUND,
      authorKind: MessageAuthorKind.APPLICANT,
      body: 'Thanks — could you send me what the timeline looks like from here?',
      state: MessageState.RECEIVED,
      occurredAt: new Date(at.getTime() - hours(5)),
      providerMessageId: 'SIMIN000000000000000000015',
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: applicant.id },
      data: {
        firstHumanOutreachAt: new Date(at.getTime() - days(6)),
        firstTwoWayHumanAt: new Date(at.getTime() - days(6) + hours(4)),
      },
    });
    await addTask(org, {
      applicantId: applicant.id,
      ownerEmail: AUSTIN,
      type: TaskType.FOLLOW_UP,
      title: 'Reply to Grace about the timeline',
      reason: 'A new reply came in and has not been answered.',
      dueAt: new Date(at.getTime() + hours(3)),
    });
  }

  // ---- prepare a few briefs with the real local provider -----------------
  const briefTargets = await prisma.applicant.findMany({
    where: {
      organizationId: org.organization.id,
      reference: { in: ['C26-0001', 'C26-0002', 'C26-0009', 'C26-0015'] },
    },
    select: { id: true, reference: true },
  });
  for (const target of briefTargets) {
    const result = await prepareBrief({
      organizationId: org.organization.id,
      applicantId: target.id,
      requestedByMemberId: null,
      reason: 'seed',
    });
    console.log(`[seed] brief for ${target.reference}: ${result.status}`);
  }

  // Every active case ends the seed with an owner and a dated next step.
  const actives = await prisma.applicant.findMany({
    where: { organizationId: org.organization.id, status: { not: CaseStatus.CLOSED } },
    select: { id: true },
  });
  for (const active of actives) {
    await prisma.$transaction((tx) => ensureNextStep(tx, ctx, active.id));
  }
}

async function seedIntakeAnswers(
  org: BuiltOrg,
  applicantId: string,
  openedAt: Date,
  pathway: IntakePathway,
  answers: Record<string, string>,
  status: IntakeSessionStatus = IntakeSessionStatus.COMPLETED,
  sensitiveAnswer?: { key: string; value: string },
) {
  const session = await prisma.intakeSession.create({
    data: {
      organizationId: org.organization.id,
      applicantId,
      intakeVersionId: org.version.id,
      pathway,
      status,
      completedAt: status === IntakeSessionStatus.COMPLETED ? new Date(openedAt.getTime() + 300_000) : null,
      handedOffAt: status === IntakeSessionStatus.HANDED_OFF ? new Date(openedAt.getTime() + 300_000) : null,
      lastActivityAt: new Date(openedAt.getTime() + 300_000),
      createdAt: openedAt,
    },
  });

  let index = 0;
  for (const [key, value] of Object.entries(answers)) {
    await prisma.intakeAnswer.create({
      data: {
        organizationId: org.organization.id,
        intakeSessionId: session.id,
        questionKey: key,
        questionPrompt: QUESTIONS.find((q) => q.key === key && q.pathway === pathway)?.prompt ?? key,
        revision: 1,
        valueText: value,
        answeredAt: new Date(openedAt.getTime() + index++ * 45_000),
      },
    });
  }

  if (sensitiveAnswer) {
    await prisma.intakeAnswer.create({
      data: {
        organizationId: org.organization.id,
        intakeSessionId: session.id,
        questionKey: sensitiveAnswer.key,
        questionPrompt: QUESTIONS.find((q) => q.key === sensitiveAnswer.key)?.prompt ?? sensitiveAnswer.key,
        revision: 1,
        valueText: sensitiveAnswer.value,
        // Restricted: needs the sensitive-source grant to read, and never
        // reaches an external AI provider.
        sensitive: true,
        answeredAt: new Date(openedAt.getTime() + index * 45_000),
      },
    });
  }

  return session;
}

// ---------------------------------------------------------------------------
// The second organization — exists so isolation can be proven
// ---------------------------------------------------------------------------

async function seedNorthsideCases(org: BuiltOrg, at: Date) {
  const JORDAN = 'jordan.kim@northside.invalid';
  const ctx = systemContext(org.organization.id, 'seed');

  const { applicant, openedAt } = await createCase(org, at, {
    reference: 'N26-0001',
    displayName: 'Riley Sandoval',
    phone: '+13035550401',
    location: 'Lakewood',
    timezone: 'America/Denver',
    timezoneConfirmed: true,
    status: CaseStatus.READY_FOR_RECRUITER,
    ownerEmail: JORDAN,
    originKind: 'web_intake',
    openedHoursAgo: 6,
  });
  await grantConsent(org, applicant.id, ConsentPurpose.RECRUITER_SMS, '+13035550401', openedAt);
  await seedIntakeAnswers(org, applicant.id, openedAt, IntakePathway.FULL_INTAKE, {
    full_name: 'Riley Sandoval',
    phone: '+13035550401',
    general_location: 'Lakewood',
    contact_preference: 'Either is fine',
    timeline: 'Within 6 to 12 months',
  });
  await addTask(org, {
    applicantId: applicant.id,
    ownerEmail: JORDAN,
    type: TaskType.FOLLOW_UP,
    title: 'First contact with Riley',
    reason: 'A new inquiry finished intake and no recruiter has reached out yet.',
    dueAt: new Date(at.getTime() + hours(3)),
  });

  // A case that deliberately shares a phone number with a CENTRAL case, to
  // prove that a shared number never crosses an organization boundary.
  const second = await createCase(org, at, {
    reference: 'N26-0002',
    displayName: 'Unrelated Person With The Same Number',
    phone: '+15125550312',
    status: CaseStatus.NEW_INQUIRY,
    ownerEmail: JORDAN,
    originKind: 'inbound_sms',
    openedHoursAgo: 4,
  });
  await addTask(org, {
    applicantId: second.applicant.id,
    ownerEmail: JORDAN,
    type: TaskType.FOLLOW_UP,
    title: 'First contact',
    reason: 'A new inbound text has not been answered.',
    dueAt: new Date(at.getTime() + hours(4)),
  });

  const actives = await prisma.applicant.findMany({
    where: { organizationId: org.organization.id, status: { not: CaseStatus.CLOSED } },
    select: { id: true },
  });
  for (const active of actives) {
    await prisma.$transaction((tx) => ensureNextStep(tx, ctx, active.id));
  }
}

main()
  .catch((error) => {
    console.error('[seed] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

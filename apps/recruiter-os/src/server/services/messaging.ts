import 'server-only';
import {
  CaseStatus,
  ConsentPurpose,
  ContactChannel,
  DefinitionState,
  MessageAuthorKind,
  MessageDirection,
  MessageState,
  MetricEventKind,
  ReviewFlagKind,
  TemplateKind,
  type Message,
} from '@prisma/client';
import { z } from 'zod';
import { prisma, type DbOrTx } from '@/server/db';
import { now } from '@/server/clock';
import { env } from '@/env';
import { contentHash } from '@/lib/crypto';
import { maskContact } from '@/lib/redact';
import { isWithinQuietHours } from '@/lib/time';
import {
  assertTransition,
  messageStateRank,
  messageTransitions,
  PENDING_SEND_STATES,
} from '@/server/domain/state-machines';
import { BlockedError, ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import {
  requireCase,
  requireStaff,
  systemContext,
  type ActorContext,
} from '@/server/authz/policy';
import { auditOperational } from '@/server/audit';
import { recordMetric } from '@/server/metrics';
import { enqueue, cancelPending } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { resolveSmsProvider } from '@/server/providers/registry';
import { checkSendPermission, suppressSmsForContactValue, resumeSmsForContactValue } from './consent';
import { advanceStatus, raiseReviewFlag } from './cases';
import { detectHumanRequest, detectSensitive } from './sensitive';
import { ensureNextStep } from './tasks';

/**
 * Messaging.
 *
 * The separations this file keeps straight, because conflating them is how a
 * recruiting tool ends up lying to a recruiter:
 *
 *   AUTHORSHIP    who wrote it (applicant / recruiter / approved automation)
 *   APPROVAL      whether a human signed off on this exact text
 *   TRANSPORT     what the carrier has done with it
 *
 * Drafting is not sending. Scheduling is not sending. Provider acceptance is
 * not delivery. Delivery is not a conversation. Each of those is a distinct
 * state, and the queue and the reports read the state, not the intention.
 */

// ---------------------------------------------------------------------------
// Pre-dispatch gate
// ---------------------------------------------------------------------------

export type SendGate =
  | { allowed: true; providerSimulated: boolean }
  | { allowed: false; code: string; reason: string; requiresReview: boolean };

/**
 * Everything that must be true before a message goes out. Run BEFORE
 * scheduling and AGAIN immediately before dispatch, because consent,
 * ownership, case restrictions and provider enablement all change in between.
 */
export async function evaluateSendGate(
  db: DbOrTx,
  input: {
    organizationId: string;
    applicantId: string;
    purpose: ConsentPurpose;
    toValue: string;
    at?: Date;
    /** Reminders and acknowledgments are time-critical; drafts are not. */
    ignoreQuietHours?: boolean;
  },
): Promise<SendGate> {
  const at = input.at ?? now();

  const provider = await resolveSmsProvider(input.organizationId);
  if (!provider.available) {
    return { allowed: false, code: `provider_${provider.status.toLowerCase()}`, reason: provider.reason, requiresReview: false };
  }

  const settings = await db.organizationSettings.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!settings) return { allowed: false, code: 'no_settings', reason: 'Organization settings are missing.', requiresReview: true };

  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      timezone: true,
      timezoneConfirmed: true,
      automationPaused: true,
      automationPausedReason: true,
      mergedIntoApplicantId: true,
    },
  });
  if (!applicant) return { allowed: false, code: 'no_case', reason: 'That case does not exist.', requiresReview: false };
  if (applicant.mergedIntoApplicantId) {
    return { allowed: false, code: 'merged_case', reason: 'This case was merged into another one. Send from the surviving case.', requiresReview: true };
  }
  if (applicant.status === CaseStatus.CLOSED) {
    return { allowed: false, code: 'case_closed', reason: 'This case is closed.', requiresReview: true };
  }

  const permission = await checkSendPermission(db, {
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    purpose: input.purpose,
    contactValue: input.toValue,
  });
  if (!permission.allowed) {
    return {
      allowed: false,
      code: permission.code,
      reason: permission.reason,
      // An opt-out is never a review item: it is final until the person opts
      // back in. A missing permission IS a review item.
      requiresReview: permission.code === 'no_permission',
    };
  }

  if (!input.ignoreQuietHours) {
    const zone = applicant.timezone && applicant.timezoneConfirmed ? applicant.timezone : null;
    if (zone) {
      if (isWithinQuietHours(at, zone, settings.quietHoursStartMinute, settings.quietHoursEndMinute)) {
        return {
          allowed: false,
          code: 'quiet_hours',
          reason: `It is inside quiet hours in ${zone}. Schedule it for after the window opens.`,
          requiresReview: false,
        };
      }
    } else {
      // Documented conservative policy for an unknown recipient timezone: we
      // do NOT guess a window from an area code.
      const orgQuiet = isWithinQuietHours(
        at,
        settings.defaultTimezone,
        settings.quietHoursStartMinute,
        settings.quietHoursEndMinute,
      );
      if (settings.unknownTimezonePolicy === 'REVIEW') {
        return {
          allowed: false,
          code: 'unknown_timezone_review',
          reason: 'The applicant’s timezone is not confirmed, so a recruiter has to decide the timing.',
          requiresReview: true,
        };
      }
      if (orgQuiet) {
        return {
          allowed: false,
          code: 'unknown_timezone_quiet_hours',
          reason: `The applicant’s timezone is not confirmed, so the office window in ${settings.defaultTimezone} applies — and it is closed.`,
          requiresReview: false,
        };
      }
    }
  }

  return { allowed: true, providerSimulated: provider.simulated };
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

export async function ensureConversation(
  db: DbOrTx,
  input: { organizationId: string; applicantId: string; channel: ContactChannel; contactValue: string },
) {
  return db.conversation.upsert({
    where: {
      organizationId_applicantId_channel_contactValue: {
        organizationId: input.organizationId,
        applicantId: input.applicantId,
        channel: input.channel,
        contactValue: input.contactValue,
      },
    },
    create: { ...input },
    update: { lastEventAt: now() },
  });
}

async function organizationFromNumber(db: DbOrTx, organizationId: string): Promise<string> {
  const config = await db.integrationConfig.findFirst({
    where: { organizationId, kind: 'SMS', enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  const settings = (config?.settings ?? {}) as { fromNumber?: string };
  return settings.fromNumber ?? '+15555550100';
}

function statusCallbackUrl(): string | undefined {
  const base = env.TWILIO_WEBHOOK_BASE_URL || env.PUBLIC_APP_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/api/webhooks/twilio/status`;
}

// ---------------------------------------------------------------------------
// Drafting and approval
// ---------------------------------------------------------------------------

export const draftInput = z.object({
  applicantId: z.string().min(1),
  toValue: z.string().min(3),
  body: z.string().min(1).max(1200),
  purpose: z.nativeEnum(ConsentPurpose).default(ConsentPurpose.RECRUITER_SMS),
  aiGenerated: z.boolean().default(false),
  aiBriefId: z.string().nullable().default(null),
});

export async function createDraft(ctx: ActorContext, input: z.infer<typeof draftInput>) {
  const staff = requireStaff(ctx);
  await requireCase(ctx, input.applicantId, 'act');
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const conversation = await ensureConversation(tx, {
      organizationId,
      applicantId: input.applicantId,
      channel: ContactChannel.SMS,
      contactValue: input.toValue,
    });

    const message = await tx.message.create({
      data: {
        organizationId,
        applicantId: input.applicantId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        // An AI-written draft is still authored BY THE RECRUITER once they
        // approve it. Until then it is a draft and cannot be sent.
        authorKind: MessageAuthorKind.RECRUITER,
        authorMemberId: staff.member.id,
        channel: ContactChannel.SMS,
        fromValue: await organizationFromNumber(tx, organizationId),
        toValue: input.toValue,
        body: input.body,
        state: MessageState.DRAFT,
        aiGenerated: input.aiGenerated,
        aiBriefId: input.aiBriefId,
        occurredAt: now(),
        createdAt: now(),
      },
    });

    await auditOperational(tx, ctx, {
      action: 'message.drafted',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: input.applicantId,
      metadata: { aiGenerated: input.aiGenerated, length: input.body.length, to: maskContact(input.toValue) },
    });
    return message;
  });
}

/**
 * Editing a draft. If it was already approved, the approval is INVALIDATED and
 * the message goes back to DRAFT — an approval covers one exact text, which is
 * why `approvedBodyHash` exists.
 */
export async function editDraft(
  ctx: ActorContext,
  input: { messageId: string; body: string; expectedVersion?: number },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, organizationId } });
    if (!message) throw new NotFoundError('Message');
    await requireCase(ctx, message.applicantId, 'act');
    if (input.expectedVersion !== undefined && message.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed this message. Reload and try again.');
    }
    const editable: readonly MessageState[] = [
      MessageState.DRAFT,
      MessageState.APPROVED,
      MessageState.BLOCKED,
      MessageState.SCHEDULED,
    ];
    if (!editable.includes(message.state)) {
      throw new ConflictError(`A message in state ${message.state} can no longer be edited.`);
    }

    const wasApproved = message.state === MessageState.APPROVED || message.state === MessageState.SCHEDULED;
    if (wasApproved && message.state === MessageState.SCHEDULED) {
      await cancelPending(tx, `send:${message.id}`, 'draft edited after scheduling');
    }

    const updated = await tx.message.update({
      where: { id: message.id },
      data: {
        body: input.body,
        state: MessageState.DRAFT,
        approvedBodyHash: null,
        approvedByMemberId: null,
        approvedAt: null,
        scheduledFor: null,
        blockedReason: null,
        version: { increment: 1 },
      },
    });

    await auditOperational(tx, ctx, {
      action: 'message.edited',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
      metadata: { approvalInvalidated: wasApproved, length: input.body.length },
    });
    return updated;
  });
}

export async function approveDraft(
  ctx: ActorContext,
  input: { messageId: string; expectedVersion?: number },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, organizationId } });
    if (!message) throw new NotFoundError('Message');
    await requireCase(ctx, message.applicantId, 'act');
    if (input.expectedVersion !== undefined && message.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed this message. Reload and try again.');
    }
    assertTransition(messageTransitions, message.state, MessageState.APPROVED, 'Message');

    const updated = await tx.message.update({
      where: { id: message.id },
      data: {
        state: MessageState.APPROVED,
        // Bound to this exact text. Any later edit breaks the match.
        approvedBodyHash: contentHash(message.body),
        approvedByMemberId: staff.member.id,
        approvedAt: now(),
        version: { increment: 1 },
      },
    });
    await auditOperational(tx, ctx, {
      action: 'message.approved',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
      metadata: { bodyHash: updated.approvedBodyHash },
    });
    return updated;
  });
}

/**
 * Queue an approved message. `sendAt` in the future schedules it; omitted
 * sends as soon as the worker picks it up. Either way the gate runs now AND
 * again at dispatch.
 */
export async function queueApprovedMessage(
  ctx: ActorContext,
  input: { messageId: string; sendAt?: Date; purpose?: ConsentPurpose },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, organizationId } });
    if (!message) throw new NotFoundError('Message');
    await requireCase(ctx, message.applicantId, 'act');

    if (message.state !== MessageState.APPROVED) {
      throw new ConflictError(
        message.state === MessageState.DRAFT
          ? 'This draft has not been approved yet.'
          : `A message in state ${message.state} cannot be queued.`,
      );
    }
    // Defence in depth: an approval must still match the body.
    if (message.approvedBodyHash !== contentHash(message.body)) {
      throw new ConflictError('The text changed after it was approved. Approve it again.');
    }

    const purpose = input.purpose ?? ConsentPurpose.RECRUITER_SMS;
    const sendAt = input.sendAt ?? now();
    const gate = await evaluateSendGate(tx, {
      organizationId,
      applicantId: message.applicantId,
      purpose,
      toValue: message.toValue,
      at: sendAt,
    });

    if (!gate.allowed) {
      await tx.message.update({
        where: { id: message.id },
        data: { state: MessageState.BLOCKED, blockedReason: gate.reason, version: { increment: 1 } },
      });
      if (gate.requiresReview) {
        await raiseReviewFlag(tx, ctx, {
          applicantId: message.applicantId,
          kind: ReviewFlagKind.BRIEF_REVIEW,
          detail: `A message could not be sent: ${gate.reason}`,
          sourceRef: `message:${message.id}`,
          taskTitle: 'Sort out a blocked message',
        });
      }
      await auditOperational(tx, ctx, {
        action: 'message.blocked',
        subjectType: 'message',
        subjectId: message.id,
        applicantId: message.applicantId,
        metadata: { code: gate.code, reason: gate.reason },
      });
      throw new BlockedError(gate.reason, gate.code);
    }

    const scheduled = sendAt.getTime() > now().getTime() + 1000;
    const updated = await tx.message.update({
      where: { id: message.id },
      data: {
        state: scheduled ? MessageState.SCHEDULED : MessageState.QUEUED,
        scheduledFor: scheduled ? sendAt : null,
        // The gate that runs again before dispatch asks this same question.
        consentPurpose: purpose,
        // One logical send, whatever the retries or double clicks.
        idempotencyKey: message.idempotencyKey ?? `send:${message.id}`,
        simulated: gate.providerSimulated,
        version: { increment: 1 },
      },
    });

    await enqueue(
      tx,
      JOB.dispatchMessage,
      { organizationId, messageId: message.id },
      { idempotencyKey: `send:${message.id}`, availableAt: sendAt },
    );

    await auditOperational(tx, ctx, {
      action: scheduled ? 'message.scheduled' : 'message.queued',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
      metadata: { sendAt: sendAt.toISOString(), simulated: gate.providerSimulated },
    });
    return updated;
  });
}

export async function cancelMessage(ctx: ActorContext, input: { messageId: string; reason: string }) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, organizationId } });
    if (!message) throw new NotFoundError('Message');
    await requireCase(ctx, message.applicantId, 'act');
    assertTransition(messageTransitions, message.state, MessageState.CANCELED, 'Message');
    await cancelPending(tx, `send:${message.id}`, input.reason);
    const updated = await tx.message.update({
      where: { id: message.id },
      data: { state: MessageState.CANCELED, blockedReason: input.reason, version: { increment: 1 } },
    });
    await auditOperational(tx, ctx, {
      action: 'message.canceled',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
      metadata: { reason: input.reason },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approved automation (templates)
// ---------------------------------------------------------------------------

const AUTOMATABLE_KINDS: readonly TemplateKind[] = [
  TemplateKind.ACKNOWLEDGMENT,
  TemplateKind.INTAKE_INVITATION,
  TemplateKind.APPOINTMENT_REMINDER,
  // The single reply to a call nobody answered, and the scripted intake
  // questions that follow only after the person says yes. Both are
  // administrative, both are versioned, and both need an approved published
  // version before anything is sent.
  TemplateKind.MISSED_CALL_REPLY,
  TemplateKind.INTAKE_SMS_PROMPT,
];

export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

/**
 * Dispatch an approved, versioned administrative template without a recruiter
 * in the loop. Only the three allowlisted kinds qualify, only a PUBLISHED
 * approved version is used, and a paused case blocks it outright.
 */
export async function sendApprovedTemplate(
  db: DbOrTx,
  organizationId: string,
  input: {
    applicantId: string;
    templateKey: string;
    purpose: ConsentPurpose;
    toValue: string;
    values: Record<string, string>;
    idempotencyKey: string;
    ignoreQuietHours?: boolean;
    /**
     * Only for the single message that tells somebody automation has stopped
     * and a person is taking over. That message is sent after the case is
     * paused, so it has to be allowed past the pause — and nothing else is.
     */
    ignoreAutomationPause?: boolean;
  },
): Promise<{ status: 'queued'; messageId: string } | { status: 'blocked'; reason: string }> {
  const ctx = systemContext(organizationId, 'template-automation');

  const settings = await db.organizationSettings.findUnique({ where: { organizationId } });
  if (!settings?.automationEnabled) {
    return { status: 'blocked', reason: 'Automated messaging is turned off for this organization.' };
  }

  const template = await db.messageTemplate.findUnique({
    where: { organizationId_key: { organizationId, key: input.templateKey } },
    include: { versions: { where: { state: DefinitionState.PUBLISHED }, orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!template) return { status: 'blocked', reason: `No template "${input.templateKey}".` };
  if (!template.automatable || !AUTOMATABLE_KINDS.includes(template.kind)) {
    return { status: 'blocked', reason: `Template "${input.templateKey}" is not on the automation allowlist.` };
  }
  const version = template.versions[0];
  if (!version?.approvedByMemberId) {
    return { status: 'blocked', reason: `Template "${input.templateKey}" has no approved published version.` };
  }

  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, organizationId },
    select: { automationPaused: true, automationPausedReason: true, displayName: true, preferredName: true },
  });
  if (!applicant) return { status: 'blocked', reason: 'That case does not exist.' };
  if (applicant.automationPaused && !input.ignoreAutomationPause) {
    // A sensitive or human-requested handoff stops automated conversation
    // until a recruiter has looked.
    return {
      status: 'blocked',
      reason: `Automated messaging is paused on this case: ${applicant.automationPausedReason ?? 'recruiter review required'}.`,
    };
  }

  const gate = await evaluateSendGate(db, {
    organizationId,
    applicantId: input.applicantId,
    purpose: input.purpose,
    toValue: input.toValue,
    ignoreQuietHours: input.ignoreQuietHours,
  });
  if (!gate.allowed) return { status: 'blocked', reason: gate.reason };

  const body = renderTemplate(version.body, {
    first_name: applicant.preferredName || applicant.displayName.split(' ')[0] || 'there',
    ...input.values,
  });

  const conversation = await ensureConversation(db, {
    organizationId,
    applicantId: input.applicantId,
    channel: ContactChannel.SMS,
    contactValue: input.toValue,
  });

  const existing = await db.message.findFirst({
    where: { organizationId, idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { status: 'queued', messageId: existing.id };

  const message = await db.message.create({
    data: {
      organizationId,
      applicantId: input.applicantId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      authorKind: MessageAuthorKind.APPROVED_AUTOMATION,
      channel: ContactChannel.SMS,
      fromValue: await organizationFromNumber(db, organizationId),
      toValue: input.toValue,
      body,
      state: MessageState.QUEUED,
      consentPurpose: input.purpose,
      templateVersionId: version.id,
      approvedBodyHash: contentHash(body),
      approvedByMemberId: version.approvedByMemberId,
      approvedAt: version.approvedAt,
      idempotencyKey: input.idempotencyKey,
      simulated: gate.providerSimulated,
      occurredAt: now(),
      createdAt: now(),
    },
  });

  await enqueue(
    db,
    JOB.dispatchMessage,
    { organizationId, messageId: message.id },
    { idempotencyKey: input.idempotencyKey },
  );

  await auditOperational(db, ctx, {
    action: 'message.automation_queued',
    subjectType: 'message',
    subjectId: message.id,
    applicantId: input.applicantId,
    metadata: { template: input.templateKey, templateVersion: version.version },
  });

  return { status: 'queued', messageId: message.id };
}

// ---------------------------------------------------------------------------
// Dispatch (worker)
// ---------------------------------------------------------------------------

/**
 * The only place a message actually leaves the building.
 *
 * Re-checks the gate immediately before submission, because consent can have
 * been revoked, the case closed, or the provider disabled since the job was
 * enqueued. Then it submits ONCE. A definite failure is terminal. An ambiguous
 * outcome becomes OUTCOME_UNKNOWN and is reconciled — never retried blindly.
 */
export async function dispatchMessage(
  organizationId: string,
  messageId: string,
): Promise<{ state: MessageState; detail: string }> {
  const ctx = systemContext(organizationId, JOB.dispatchMessage);

  const claimed = await prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: messageId, organizationId } });
    if (!message) throw new NotFoundError('Message');

    // Idempotency: a replayed job for an already-submitted message stops here.
    if (!PENDING_SEND_STATES.includes(message.state)) {
      return { message, alreadyHandled: true as const };
    }

    if (message.approvedBodyHash !== contentHash(message.body)) {
      const blocked = await tx.message.update({
        where: { id: message.id },
        data: {
          state: MessageState.BLOCKED,
          blockedReason: 'The approved text no longer matches the message body.',
          version: { increment: 1 },
        },
      });
      return { message: blocked, alreadyHandled: true as const };
    }

    // The purpose the message was gated on when it was queued. Rows written
    // before that was stored fall back to the old inference so their
    // behaviour is unchanged.
    const purpose =
      message.consentPurpose ??
      (message.authorKind === MessageAuthorKind.APPROVED_AUTOMATION && message.templateVersionId
        ? ConsentPurpose.INTAKE_SMS
        : ConsentPurpose.RECRUITER_SMS);

    const gate = await evaluateSendGate(tx, {
      organizationId,
      applicantId: message.applicantId,
      purpose,
      toValue: message.toValue,
      ignoreQuietHours: message.authorKind === MessageAuthorKind.APPROVED_AUTOMATION,
    });
    if (!gate.allowed) {
      const blocked = await tx.message.update({
        where: { id: message.id },
        data: { state: MessageState.BLOCKED, blockedReason: gate.reason, version: { increment: 1 } },
      });
      await auditOperational(tx, ctx, {
        action: 'message.blocked_at_dispatch',
        subjectType: 'message',
        subjectId: message.id,
        applicantId: message.applicantId,
        metadata: { code: gate.code, reason: gate.reason },
      });
      return { message: blocked, alreadyHandled: true as const };
    }

    const submitting = await tx.message.update({
      where: { id: message.id },
      data: {
        state: MessageState.SUBMITTING,
        submittedAt: now(),
        attemptCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    return { message: submitting, alreadyHandled: false as const };
  });

  if (claimed.alreadyHandled) {
    return { state: claimed.message.state, detail: claimed.message.blockedReason ?? 'Already handled.' };
  }

  const message = claimed.message;
  const provider = await resolveSmsProvider(organizationId);
  if (!provider.available) {
    await prisma.message.update({
      where: { id: message.id },
      data: { state: MessageState.BLOCKED, blockedReason: provider.reason, version: { increment: 1 } },
    });
    return { state: MessageState.BLOCKED, detail: provider.reason };
  }

  const result = await provider.provider.send({
    organizationId,
    idempotencyKey: message.idempotencyKey ?? `send:${message.id}`,
    from: message.fromValue,
    to: message.toValue,
    body: message.body,
    statusCallbackUrl: statusCallbackUrl(),
  });

  return prisma.$transaction(async (tx) => {
    if (result.outcome === 'accepted') {
      await tx.message.update({
        where: { id: message.id },
        data: {
          state: MessageState.PROVIDER_ACCEPTED,
          providerMessageId: result.providerMessageId,
          providerName: result.providerName,
          simulated: provider.simulated,
          version: { increment: 1 },
        },
      });
      await markAcknowledgmentAccepted(tx, organizationId, message);
      await auditOperational(tx, ctx, {
        action: 'message.provider_accepted',
        subjectType: 'message',
        subjectId: message.id,
        applicantId: message.applicantId,
        metadata: { provider: result.providerName, simulated: provider.simulated },
      });
      if (message.authorKind === MessageAuthorKind.RECRUITER) {
        await advanceStatus(tx, ctx, message.applicantId, CaseStatus.CONTACT_ATTEMPTED);
        await recordMetric(tx, {
          organizationId,
          kind: MetricEventKind.HUMAN_OUTREACH_ATTEMPTED,
          applicantId: message.applicantId,
          memberId: message.authorMemberId,
          detail: 'sms',
        });
        await stampFirstHumanOutreach(tx, organizationId, message.applicantId);
      }
      return { state: MessageState.PROVIDER_ACCEPTED, detail: 'Provider accepted the message. That is not delivery.' };
    }

    if (result.outcome === 'failed') {
      await tx.message.update({
        where: { id: message.id },
        data: {
          state: MessageState.FAILED,
          failureCode: result.code,
          failureDetail: result.detail,
          providerName: result.providerName,
          version: { increment: 1 },
        },
      });
      await auditOperational(tx, ctx, {
        action: 'message.failed',
        subjectType: 'message',
        subjectId: message.id,
        applicantId: message.applicantId,
        metadata: { code: result.code },
      });
      await raiseReviewFlag(tx, ctx, {
        applicantId: message.applicantId,
        kind: ReviewFlagKind.BRIEF_REVIEW,
        detail: `An outbound message failed at the provider (${result.code}). It was not delivered.`,
        sourceRef: `message:${message.id}`,
        taskTitle: 'A message failed to send — try another channel',
      });
      return { state: MessageState.FAILED, detail: result.detail };
    }

    // Ambiguous. The provider may well have accepted it.
    await tx.message.update({
      where: { id: message.id },
      data: {
        state: MessageState.OUTCOME_UNKNOWN,
        failureDetail: result.detail,
        providerName: result.providerName,
        version: { increment: 1 },
      },
    });
    await enqueue(
      tx,
      JOB.reconcileMessage,
      { organizationId, messageId: message.id, attempt: 1 },
      { idempotencyKey: `reconcile:${message.id}:1`, availableAt: new Date(now().getTime() + 60_000) },
    );
    await raiseReviewFlag(tx, ctx, {
      applicantId: message.applicantId,
      kind: ReviewFlagKind.SEND_RECONCILIATION,
      detail:
        'We submitted a message and never learned whether the carrier took it. Do not resend until this is reconciled — the applicant may already have it.',
      sourceRef: `message:${message.id}`,
      taskTitle: 'Reconcile a message with an unknown outcome',
    });
    await auditOperational(tx, ctx, {
      action: 'message.outcome_unknown',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
      metadata: { detail: result.detail },
    });
    return { state: MessageState.OUTCOME_UNKNOWN, detail: result.detail };
  });
}

/**
 * Reconciliation for an ambiguous submission. Asks the provider what it knows.
 * It NEVER sends again.
 */
export async function reconcileMessage(
  organizationId: string,
  messageId: string,
  attempt: number,
): Promise<{ resolved: boolean; detail: string }> {
  const ctx = systemContext(organizationId, JOB.reconcileMessage);
  const message = await prisma.message.findFirst({ where: { id: messageId, organizationId } });
  if (!message) throw new NotFoundError('Message');
  if (message.state !== MessageState.OUTCOME_UNKNOWN) {
    return { resolved: true, detail: `Already resolved to ${message.state}.` };
  }

  const provider = await resolveSmsProvider(organizationId);
  if (!provider.available || !provider.provider.lookupByIdempotencyKey) {
    return { resolved: false, detail: 'No provider lookup available; a human has to decide.' };
  }

  const lookup = await provider.provider.lookupByIdempotencyKey(
    organizationId,
    message.idempotencyKey ?? `send:${message.id}`,
    message.toValue,
  );
  if (!lookup.found) {
    if (attempt >= 3) {
      return { resolved: false, detail: 'Provider has no record after three checks. Left for recruiter review.' };
    }
    await prisma.$transaction(async (tx) => {
      await enqueue(
        tx,
        JOB.reconcileMessage,
        { organizationId, messageId, attempt: attempt + 1 },
        {
          idempotencyKey: `reconcile:${messageId}:${attempt + 1}`,
          availableAt: new Date(now().getTime() + 5 * 60_000 * attempt),
        },
      );
    });
    return { resolved: false, detail: lookup.detail };
  }

  const normalized = normalizeProviderStatus(lookup.status);
  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: message.id },
      data: {
        state: normalized,
        providerMessageId: lookup.providerMessageId,
        failureCode: lookup.errorCode ?? null,
        version: { increment: 1 },
      },
    });
    await tx.reviewFlag.updateMany({
      where: {
        organizationId,
        applicantId: message.applicantId,
        kind: ReviewFlagKind.SEND_RECONCILIATION,
        sourceRef: `message:${message.id}`,
        status: 'OPEN',
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: now(),
        resolutionReason: `Reconciled with the provider: ${lookup.status}.`,
      },
    });
    await auditOperational(tx, ctx, {
      action: 'message.reconciled',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
      metadata: { providerStatus: lookup.status, resolvedState: normalized },
    });
  });
  return { resolved: true, detail: `Reconciled to ${normalized}.` };
}

export function normalizeProviderStatus(status: string): MessageState {
  switch (status.toLowerCase()) {
    case 'queued':
    case 'accepted':
    case 'scheduled':
    case 'provider_accepted':
      return MessageState.PROVIDER_ACCEPTED;
    case 'sending':
    case 'sent':
      return MessageState.SENT;
    case 'delivered':
      return MessageState.DELIVERED;
    case 'undelivered':
    case 'failed':
      return MessageState.FAILED;
    case 'canceled':
      return MessageState.CANCELED;
    default:
      return MessageState.OUTCOME_UNKNOWN;
  }
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit|optout|opt-out)\s*$/i;
const START_WORDS = /^(start|unstop|yes|subscribe)\s*$/i;
const HELP_WORDS = /^(help|info)\s*$/i;

export type InboundResult = {
  handled: boolean;
  duplicate: boolean;
  applicantId: string | null;
  keyword: 'STOP' | 'START' | 'HELP' | null;
  /**
   * True when the provider itself answers the keyword. We must NOT send our
   * own confirmation on top of the carrier's — the person would get two.
   */
  providerAutoResponds: boolean;
  detail: string;
};

/**
 * Record an inbound SMS.
 *
 * Association rules:
 *   * Exactly one case holds this number → attach it there.
 *   * More than one case holds it → attach nothing, and create a RESTRICTED
 *     linking-review item. Shared phone numbers are not proof of identity and
 *     must never reveal one case's history on another.
 *   * No case holds it → a new inquiry case, owned and with a next step.
 */
export async function recordInboundSms(input: {
  organizationId: string;
  from: string;
  to: string;
  body: string;
  providerMessageId: string;
  providerName: string;
  simulated: boolean;
  occurredAt?: Date;
}): Promise<InboundResult> {
  const at = input.occurredAt ?? now();
  const trimmed = input.body.trim();
  const keyword = STOP_WORDS.test(trimmed)
    ? ('STOP' as const)
    : START_WORDS.test(trimmed)
      ? ('START' as const)
      : HELP_WORDS.test(trimmed)
        ? ('HELP' as const)
        : null;

  return prisma.$transaction(async (tx) => {
    const ctx = systemContext(input.organizationId, 'inbound-sms');

    // Deduplicate on the provider's own message identifier.
    const existing = await tx.message.findFirst({
      where: { organizationId: input.organizationId, providerMessageId: input.providerMessageId },
      select: { id: true, applicantId: true },
    });
    if (existing) {
      return {
        handled: true,
        duplicate: true,
        applicantId: existing.applicantId,
        keyword,
        providerAutoResponds: keyword !== null,
        detail: 'Duplicate inbound message; ignored.',
      };
    }

    // Opt-out is honoured for the NUMBER, before any case association.
    if (keyword === 'STOP') {
      const affected = await suppressSmsForContactValue(tx, {
        organizationId: input.organizationId,
        contactValue: input.from,
        source: 'sms_keyword:STOP',
        occurredAt: at,
      });
      // Cancel everything already in flight to that number.
      const pending = await tx.message.findMany({
        where: {
          organizationId: input.organizationId,
          toValue: input.from,
          state: { in: [...PENDING_SEND_STATES] },
        },
        select: { id: true },
      });
      for (const p of pending) {
        await cancelPending(tx, `send:${p.id}`, 'recipient opted out');
        await tx.message.update({
          where: { id: p.id },
          data: {
            state: MessageState.CANCELED,
            blockedReason: 'Canceled: the recipient opted out before this was sent.',
            version: { increment: 1 },
          },
        });
      }
      await auditOperational(tx, ctx, {
        action: 'sms.opt_out',
        subjectType: 'channel_permission',
        subjectId: null,
        metadata: { contact: maskContact(input.from), casesAffected: affected.length, pendingCanceled: pending.length },
      });
    }
    if (keyword === 'START') {
      await resumeSmsForContactValue(tx, {
        organizationId: input.organizationId,
        contactValue: input.from,
        source: 'sms_keyword:START',
        occurredAt: at,
      });
    }

    // --- association -----------------------------------------------------
    const holders = await tx.contactPoint.findMany({
      where: {
        organizationId: input.organizationId,
        value: input.from,
        channel: { in: [ContactChannel.SMS, ContactChannel.PHONE_CALL] },
      },
      select: { applicantId: true },
      distinct: ['applicantId'],
    });
    const activeHolders = holders.length
      ? await tx.applicant.findMany({
          where: {
            organizationId: input.organizationId,
            id: { in: holders.map((h) => h.applicantId) },
            mergedIntoApplicantId: null,
          },
          select: { id: true, status: true, ownerMemberId: true },
        })
      : [];

    let applicantId: string | null = null;
    let ambiguous = false;

    if (activeHolders.length === 1) {
      applicantId = activeHolders[0]!.id;
    } else if (activeHolders.length > 1) {
      ambiguous = true;
    } else if (keyword === null) {
      // A genuinely new inbound conversation becomes a case with an owner.
      const created = await (await import('./cases')).createCase(tx, ctx, {
        organizationId: input.organizationId,
        displayName: `Inbound text ${maskContact(input.from)}`,
        originKind: 'inbound_sms',
        contactPoints: [
          { channel: ContactChannel.SMS, value: input.from, isPrimary: true },
          { channel: ContactChannel.PHONE_CALL, value: input.from },
        ],
      });
      applicantId = created.applicant.id;
    }

    if (ambiguous) {
      // Restricted linking-review work. No content is attached to either case.
      for (const holder of activeHolders) {
        await raiseReviewFlag(tx, ctx, {
          applicantId: holder.id,
          kind: ReviewFlagKind.LINKING_REVIEW,
          detail: `A text arrived from ${maskContact(input.from)}, which appears on more than one case. Someone has to decide which case it belongs to. The message is not attached to any case until then.`,
          restricted: true,
          sourceRef: `inbound:${input.providerMessageId}`,
          taskTitle: 'Decide which case an inbound text belongs to',
        });
      }
      await auditOperational(tx, ctx, {
        action: 'sms.inbound_ambiguous',
        subjectType: 'message',
        subjectId: null,
        metadata: {
          contact: maskContact(input.from),
          candidateCount: activeHolders.length,
          providerMessageId: input.providerMessageId,
        },
      });
      return {
        handled: true,
        duplicate: false,
        applicantId: null,
        keyword,
        providerAutoResponds: keyword !== null,
        detail: 'Ambiguous sender; linking review created.',
      };
    }

    if (!applicantId) {
      // A bare keyword from an unknown number: honour it, record nothing else.
      return {
        handled: true,
        duplicate: false,
        applicantId: null,
        keyword,
        providerAutoResponds: keyword !== null,
        detail: 'Keyword handled for an unknown number.',
      };
    }

    const conversation = await ensureConversation(tx, {
      organizationId: input.organizationId,
      applicantId,
      channel: ContactChannel.SMS,
      contactValue: input.from,
    });

    const message = await tx.message.create({
      data: {
        organizationId: input.organizationId,
        applicantId,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        authorKind: MessageAuthorKind.APPLICANT,
        channel: ContactChannel.SMS,
        fromValue: input.from,
        toValue: input.to,
        body: input.body,
        state: MessageState.RECEIVED,
        providerMessageId: input.providerMessageId,
        providerName: input.providerName,
        simulated: input.simulated,
        occurredAt: at,
        createdAt: at,
      },
    });

    // Is this reply part of a scripted text intake we started? If so the
    // script owns the response, and none of the human-conversation bookkeeping
    // below applies: answering a bot's question is not a conversation with a
    // recruiter, and it must not look like one in the reports.
    // STOP and HELP are the carrier's to answer and ours to obey; neither
    // belongs to a script. START is different: "YES" is a carrier opt-in
    // keyword, so somebody answering our invitation with the most natural
    // word in the language lands here as a keyword. It is still an answer,
    // and treating it as one is the whole point.
    const scriptedSession =
      keyword === null || keyword === 'START'
        ? await (await import('./text-back')).findLiveSmsSession(tx, input.organizationId, input.from)
        : null;

    if (scriptedSession) {
      await (await import('./text-back')).enqueueSmsIntakeAdvance(tx, {
        organizationId: input.organizationId,
        sessionId: scriptedSession.id,
        messageId: message.id,
      });
      await advanceStatus(tx, ctx, applicantId, CaseStatus.INTAKE_IN_PROGRESS);
    }

    // Two-way HUMAN contact: only if a human recruiter had reached out, and
    // this is not a keyword. A bot exchange is not a conversation.
    if (keyword === null && !scriptedSession) {
      await stampTwoWayHumanContact(tx, input.organizationId, applicantId, at);
      await advanceStatus(tx, ctx, applicantId, CaseStatus.TWO_WAY_CONVERSATION);

      const humanRequested = detectHumanRequest(input.body);
      const sensitive = detectSensitive(input.body);
      if (humanRequested || sensitive.sensitive) {
        await raiseReviewFlag(tx, ctx, {
          applicantId,
          kind: humanRequested ? ReviewFlagKind.HUMAN_REQUESTED : ReviewFlagKind.SENSITIVE_QUESTION,
          detail: humanRequested
            ? 'The applicant asked to speak with a person by text.'
            : `A ${sensitive.category ?? 'sensitive'} topic came up by text. Automation stopped; a recruiter handles it.`,
          restricted: !humanRequested,
          sourceRef: `message:${message.id}`,
          taskTitle: humanRequested ? 'Call the applicant — they asked for a person' : 'Recruiter review required',
        });
      }

      await (await import('./tasks')).ensureTaskOnce(tx, ctx, {
        applicantId,
        type: 'FOLLOW_UP',
        title: 'Reply to the applicant',
        reason: 'A new reply came in and has not been answered.',
        dueAt: new Date(at.getTime() + 4 * 3600_000),
        dedupeKey: `reply:${message.id}`,
      });
    }

    await tx.conversation.update({ where: { id: conversation.id }, data: { lastEventAt: at } });
    await auditOperational(tx, ctx, {
      action: 'sms.inbound_recorded',
      subjectType: 'message',
      subjectId: message.id,
      applicantId,
      metadata: {
        keyword,
        length: input.body.length,
        simulated: input.simulated,
        scriptedIntake: Boolean(scriptedSession),
      },
    });
    await ensureNextStep(tx, ctx, applicantId);

    return {
      handled: true,
      duplicate: false,
      applicantId,
      keyword,
      // Twilio answers STOP/HELP itself. We deliberately add nothing.
      providerAutoResponds: keyword !== null,
      detail: 'Inbound message recorded.',
    };
  });
}

/**
 * Apply a provider delivery callback.
 *
 * Append-only: every event is kept. The message's own state only moves FORWARD
 * by rank, so a late "sent" arriving after "delivered" is recorded in history
 * without corrupting the current state.
 */
export async function applyDeliveryEvent(input: {
  organizationId: string;
  providerMessageId: string;
  providerStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerEventId?: string | null;
  occurredAt: Date;
}): Promise<{ applied: boolean; detail: string; state?: MessageState }> {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({
      where: { organizationId: input.organizationId, providerMessageId: input.providerMessageId },
    });
    if (!message) return { applied: false, detail: 'No message with that provider id.' };

    const normalized = normalizeProviderStatus(input.providerStatus);
    const rank = messageStateRank[normalized];

    try {
      await tx.messageDeliveryEvent.create({
        data: {
          organizationId: input.organizationId,
          messageId: message.id,
          providerStatus: input.providerStatus,
          normalizedState: normalized,
          stateRank: rank,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          providerEventId: input.providerEventId ?? null,
          occurredAt: input.occurredAt,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return { applied: false, detail: 'Duplicate delivery event; ignored.', state: message.state };
      }
      throw error;
    }

    const currentRank = messageStateRank[message.state];
    if (rank <= currentRank) {
      // Out-of-order arrival. History keeps it; current state does not move.
      return {
        applied: true,
        detail: `Recorded out-of-order event "${input.providerStatus}"; state stays ${message.state}.`,
        state: message.state,
      };
    }

    const updated = await tx.message.update({
      where: { id: message.id },
      data: {
        state: normalized,
        failureCode: input.errorCode ?? message.failureCode,
        failureDetail: input.errorMessage ?? message.failureDetail,
        version: { increment: 1 },
      },
    });

    if (normalized === MessageState.DELIVERED) {
      await markAcknowledgmentDelivered(tx, input.organizationId, message);
    }
    if (normalized === MessageState.FAILED) {
      const ctx = systemContext(input.organizationId, 'delivery-callback');
      await raiseReviewFlag(tx, ctx, {
        applicantId: message.applicantId,
        kind: ReviewFlagKind.BRIEF_REVIEW,
        detail: `The carrier reported this message as ${input.providerStatus}${input.errorCode ? ` (${input.errorCode})` : ''}. It was not delivered.`,
        sourceRef: `message:${message.id}`,
        taskTitle: 'A message was not delivered — try another channel',
      });
    }

    return { applied: true, detail: `State moved to ${normalized}.`, state: updated.state };
  });
}

// ---------------------------------------------------------------------------
// Episode clock stamping
// ---------------------------------------------------------------------------

async function currentEpisode(db: DbOrTx, organizationId: string, applicantId: string) {
  return db.inquiryEpisode.findFirst({
    where: { organizationId, applicantId, supersededAt: null },
    orderBy: { openedAt: 'desc' },
  });
}

async function markAcknowledgmentAccepted(db: DbOrTx, organizationId: string, message: Message) {
  if (message.authorKind !== MessageAuthorKind.APPROVED_AUTOMATION) return;
  const episode = await currentEpisode(db, organizationId, message.applicantId);
  if (!episode || episode.acknowledgedAcceptedAt) return;
  const at = now();
  await db.inquiryEpisode.update({ where: { id: episode.id }, data: { acknowledgedAcceptedAt: at } });
  await recordMetric(db, {
    organizationId,
    kind: MetricEventKind.ACK_PROVIDER_ACCEPTED,
    applicantId: message.applicantId,
    inquiryEpisodeId: episode.id,
    numericValue: Math.round((at.getTime() - episode.openedAt.getTime()) / 1000),
    occurredAt: at,
  });
}

async function markAcknowledgmentDelivered(db: DbOrTx, organizationId: string, message: Message) {
  if (message.authorKind !== MessageAuthorKind.APPROVED_AUTOMATION) return;
  const episode = await currentEpisode(db, organizationId, message.applicantId);
  if (!episode || episode.acknowledgedDeliveredAt) return;
  const at = now();
  await db.inquiryEpisode.update({ where: { id: episode.id }, data: { acknowledgedDeliveredAt: at } });
  await recordMetric(db, {
    organizationId,
    kind: MetricEventKind.ACK_DELIVERED,
    applicantId: message.applicantId,
    inquiryEpisodeId: episode.id,
    numericValue: Math.round((at.getTime() - episode.openedAt.getTime()) / 1000),
    occurredAt: at,
  });
}

export async function stampFirstHumanOutreach(db: DbOrTx, organizationId: string, applicantId: string) {
  const episode = await currentEpisode(db, organizationId, applicantId);
  if (!episode || episode.firstHumanOutreachAt) return;
  await db.inquiryEpisode.update({ where: { id: episode.id }, data: { firstHumanOutreachAt: now() } });
}

/**
 * Genuine two-way human contact. Requires that a HUMAN had already reached out
 * on this episode. An applicant replying to an automated acknowledgment is not
 * two-way human contact, and neither is a bot exchange.
 */
export async function stampTwoWayHumanContact(
  db: DbOrTx,
  organizationId: string,
  applicantId: string,
  at: Date,
) {
  const episode = await currentEpisode(db, organizationId, applicantId);
  if (!episode || episode.firstTwoWayHumanAt) return;
  if (!episode.firstHumanOutreachAt) return;
  await db.inquiryEpisode.update({ where: { id: episode.id }, data: { firstTwoWayHumanAt: at } });
  await recordMetric(db, {
    organizationId,
    kind: MetricEventKind.TWO_WAY_HUMAN_CONTACT,
    applicantId,
    inquiryEpisodeId: episode.id,
    numericValue: Math.round((at.getTime() - episode.openedAt.getTime()) / 1000),
    occurredAt: at,
  });
}

export async function listConversation(organizationId: string, applicantId: string, limit = 200) {
  return prisma.message.findMany({
    where: { organizationId, applicantId },
    // The id breaks the tie. Two messages can share an instant — a scripted
    // reply and the question that follows it, most obviously — and a
    // transcript whose order changes between reads is worse than useless.
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: { deliveryEvents: { orderBy: { occurredAt: 'asc' } } },
  });
}

export async function findPrimaryContact(
  organizationId: string,
  applicantId: string,
  channel: ContactChannel,
) {
  return prisma.contactPoint.findFirst({
    where: { organizationId, applicantId, channel },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
}

export function validateDraftBody(body: string) {
  if (body.trim().length === 0) throw new ValidationError('A message needs some text.');
  if (body.length > 1200) throw new ValidationError('That message is too long.');
  return body;
}

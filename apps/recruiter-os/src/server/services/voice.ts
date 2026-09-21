import 'server-only';
import {
  CallDirection,
  CallOutcome,
  CaseStatus,
  ConsentPurpose,
  ContactChannel,
  MetricEventKind,
  TaskType,
} from '@prisma/client';
import { prisma, type DbOrTx } from '@/server/db';
import { now } from '@/server/clock';
import { maskContact } from '@/lib/redact';
import { systemContext, requireStaff, requireCase, type ActorContext, organizationIdOf } from '@/server/authz/policy';
import { auditOperational } from '@/server/audit';
import { recordMetric } from '@/server/metrics';
import { ensureTaskOnce } from './tasks';
import { advanceStatus, createCase, normalizePhone } from './cases';
import { stampFirstHumanOutreach, stampTwoWayHumanContact, findPrimaryContact } from './messaging';
import { checkSendPermission } from './consent';
import { offerTextBackAfterMissedCall } from './text-back';
import { ValidationError } from '@/server/authz/errors';

/**
 * Voice.
 *
 * The one thing that is easy to get wrong and expensive when you do: a
 * forwarded inbound call reports the PARENT call as `completed` whether or not
 * a human answered. Deciding "missed call" from the parent status produces
 * callback tasks for calls that were answered, and none for calls that were
 * not. So every decision here reads the FORWARDED LEG's outcome
 * (`DialCallStatus`), and only `completed` on that leg with real duration
 * counts as a human having spoken.
 *
 * No recording, no transcription, no autonomous voice agent.
 */

export type LegOutcome = 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled' | 'unknown';

export function classifyForwardedLeg(input: {
  dialCallStatus: string | null;
  dialCallDuration: number | null;
}): { outcome: CallOutcome; humanConnected: boolean } {
  const status = (input.dialCallStatus ?? '').toLowerCase();
  switch (status) {
    case 'completed':
      // A bridged leg with no measurable duration did not reach a person.
      return (input.dialCallDuration ?? 0) > 0
        ? { outcome: CallOutcome.CONNECTED, humanConnected: true }
        : { outcome: CallOutcome.FORWARD_UNANSWERED, humanConnected: false };
    case 'no-answer':
      return { outcome: CallOutcome.NO_ANSWER, humanConnected: false };
    case 'busy':
      return { outcome: CallOutcome.BUSY, humanConnected: false };
    case 'failed':
      return { outcome: CallOutcome.FAILED, humanConnected: false };
    case 'canceled':
      return { outcome: CallOutcome.CANCELED, humanConnected: false };
    default:
      // Never assume a connection we cannot evidence.
      return { outcome: CallOutcome.UNKNOWN, humanConnected: false };
  }
}

/**
 * Associate an inbound caller with a case. Same rules as inbound SMS: one
 * holder attaches, several is a linking review (handled by the caller), none
 * creates a case.
 */
export async function resolveCallerCase(
  db: DbOrTx,
  organizationId: string,
  fromValue: string,
): Promise<{ applicantId: string | null; ambiguous: boolean; created: boolean }> {
  const holders = await db.contactPoint.findMany({
    where: {
      organizationId,
      value: fromValue,
      channel: { in: [ContactChannel.PHONE_CALL, ContactChannel.SMS] },
    },
    select: { applicantId: true },
    distinct: ['applicantId'],
  });
  const active = holders.length
    ? await db.applicant.findMany({
        where: { organizationId, id: { in: holders.map((h) => h.applicantId) }, mergedIntoApplicantId: null },
        select: { id: true },
      })
    : [];

  if (active.length === 1) return { applicantId: active[0]!.id, ambiguous: false, created: false };
  if (active.length > 1) return { applicantId: null, ambiguous: true, created: false };

  const ctx = systemContext(organizationId, 'inbound-voice');
  const created = await createCase(db, ctx, {
    organizationId,
    displayName: `Inbound call ${maskContact(fromValue)}`,
    originKind: 'missed_call',
    contactPoints: [
      { channel: ContactChannel.PHONE_CALL, value: fromValue, isPrimary: true },
      { channel: ContactChannel.SMS, value: fromValue },
    ],
  });
  return { applicantId: created.applicant.id, ambiguous: false, created: true };
}

/**
 * Record the outcome of a forwarded inbound call and, when nobody answered,
 * create exactly ONE callback task. Idempotent on the provider call sid, so a
 * replayed callback does not create a second task.
 */
export async function recordInboundCallOutcome(input: {
  organizationId: string;
  from: string;
  to: string;
  providerCallSid: string;
  providerParentCallSid?: string | null;
  providerLeg: string;
  dialCallStatus: string | null;
  dialCallDuration: number | null;
  providerName: string;
  simulated: boolean;
  occurredAt?: Date;
}) {
  const at = input.occurredAt ?? now();
  const classified = classifyForwardedLeg({
    dialCallStatus: input.dialCallStatus,
    dialCallDuration: input.dialCallDuration,
  });

  return prisma.$transaction(async (tx) => {
    const ctx = systemContext(input.organizationId, 'inbound-voice');

    const existing = await tx.callEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCallSid: input.providerCallSid,
        providerLeg: input.providerLeg,
      },
    });
    if (existing) {
      return {
        duplicate: true,
        applicantId: existing.applicantId,
        outcome: existing.outcome,
        taskCreated: false,
        textBack: { status: 'skipped', reason: 'This call callback was already processed.' },
      };
    }

    const resolved = await resolveCallerCase(tx, input.organizationId, input.from);
    if (resolved.ambiguous) {
      await (await import('./cases')).raiseReviewFlag(tx, ctx, {
        applicantId: (
          await tx.contactPoint.findFirstOrThrow({
            where: { organizationId: input.organizationId, value: input.from },
            select: { applicantId: true },
          })
        ).applicantId,
        kind: 'LINKING_REVIEW',
        detail: `A call came from ${maskContact(input.from)}, which appears on more than one case. Someone has to decide which case it belongs to.`,
        restricted: true,
        sourceRef: `call:${input.providerCallSid}`,
        taskTitle: 'Decide which case an inbound call belongs to',
      });
    }

    const call = await tx.callEvent.create({
      data: {
        organizationId: input.organizationId,
        applicantId: resolved.applicantId,
        direction: CallDirection.FORWARDED,
        fromValue: input.from,
        toValue: input.to,
        outcome: classified.outcome,
        humanConnected: classified.humanConnected,
        durationSeconds: input.dialCallDuration,
        providerCallSid: input.providerCallSid,
        providerParentCallSid: input.providerParentCallSid ?? null,
        providerLeg: input.providerLeg,
        providerName: input.providerName,
        simulated: input.simulated,
        note: `Forwarded leg reported "${input.dialCallStatus ?? 'unknown'}".`,
        occurredAt: at,
      },
    });

    let taskCreated = false;
    let textBack: { status: string; reason?: string } = { status: 'not attempted' };
    if (resolved.applicantId) {
      if (classified.humanConnected) {
        await stampFirstHumanOutreach(tx, input.organizationId, resolved.applicantId);
        await stampTwoWayHumanContact(tx, input.organizationId, resolved.applicantId, at);
        await advanceStatus(tx, ctx, resolved.applicantId, CaseStatus.TWO_WAY_CONVERSATION);
      } else {
        // Busy / no-answer / failed / unknown all mean the same thing
        // operationally: somebody has to call back. Exactly once.
        const result = await ensureTaskOnce(tx, ctx, {
          applicantId: resolved.applicantId,
          type: TaskType.CALLBACK,
          title: `Call back ${maskContact(input.from)}`,
          reason: `An inbound call was not answered (forwarded leg: ${input.dialCallStatus ?? 'unknown'}).`,
          dueAt: new Date(at.getTime() + 2 * 3600_000),
          dedupeKey: `call:${input.providerCallSid}`,
        });
        taskCreated = result.created;
        await advanceStatus(tx, ctx, resolved.applicantId, CaseStatus.READY_FOR_RECRUITER);

        // Text back, if the organization has turned it on. This is inside the
        // same transaction as the case, the callback task and the consent
        // record: there is no state where a message went out but the script
        // that has to answer the reply does not exist. The callback task
        // stands either way — somebody called a person, and that is still the
        // right follow-up.
        const offer = await offerTextBackAfterMissedCall(tx, {
          organizationId: input.organizationId,
          applicantId: resolved.applicantId,
          callerNumber: input.from,
          providerCallSid: input.providerCallSid,
          calledAt: at,
        });
        textBack =
          offer.status === 'sent'
            ? { status: 'sent' }
            : { status: 'skipped', reason: offer.reason };
      }
    }

    await auditOperational(tx, ctx, {
      action: 'call.inbound_recorded',
      subjectType: 'call_event',
      subjectId: call.id,
      applicantId: resolved.applicantId,
      metadata: {
        outcome: classified.outcome,
        humanConnected: classified.humanConnected,
        dialCallStatus: input.dialCallStatus,
        taskCreated,
        caseCreated: resolved.created,
        textBack,
      },
    });

    return {
      duplicate: false,
      applicantId: resolved.applicantId,
      outcome: classified.outcome,
      taskCreated,
      textBack,
    };
  });
}

/**
 * Whether an automatic intake text may follow a missed call.
 *
 * Only where an approved flow explicitly obtained permission. A missed call on
 * its own is NOT permission, and this returns false — deliberately.
 */
export async function mayTextAfterMissedCall(
  db: DbOrTx,
  organizationId: string,
  applicantId: string,
): Promise<{ allowed: boolean; reason: string; contactValue: string | null }> {
  const contact = await db.contactPoint.findFirst({
    where: { organizationId, applicantId, channel: ContactChannel.SMS },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  if (!contact) return { allowed: false, reason: 'No SMS contact point on this case.', contactValue: null };

  const permission = await checkSendPermission(db, {
    organizationId,
    applicantId,
    purpose: ConsentPurpose.INTAKE_SMS,
    contactValue: contact.value,
  });
  if (!permission.allowed) {
    return {
      allowed: false,
      // The honest reason: a missed call is not consent.
      reason: `${permission.reason} A missed call does not create permission to text.`,
      contactValue: contact.value,
    };
  }
  return { allowed: true, reason: 'Explicit SMS permission is recorded.', contactValue: contact.value };
}

/**
 * A recruiter logging a call they made outside the app.
 *
 * `humanConnected` comes from the recruiter saying so. A clicked tel: link
 * never sets it — the UI opens the dialler and then asks what happened.
 */
export async function logManualCall(
  ctx: ActorContext,
  input: {
    applicantId: string;
    toValue: string;
    outcome: CallOutcome;
    durationSeconds?: number | null;
    note?: string;
  },
) {
  const staff = requireStaff(ctx);
  await requireCase(ctx, input.applicantId, 'act');
  const organizationId = staff.member.organizationId;
  const normalized = normalizePhone(input.toValue);
  if (!normalized) throw new ValidationError('That is not a valid phone number.');

  return prisma.$transaction(async (tx) => {
    const at = now();
    const humanConnected = input.outcome === CallOutcome.CONNECTED;
    const call = await tx.callEvent.create({
      data: {
        organizationId,
        applicantId: input.applicantId,
        direction: CallDirection.OUTBOUND_MANUAL,
        fromValue: `member:${staff.member.id}`,
        toValue: normalized,
        outcome: input.outcome,
        humanConnected,
        durationSeconds: input.durationSeconds ?? null,
        recordedByMemberId: staff.member.id,
        note: input.note ?? null,
        occurredAt: at,
      },
    });

    await stampFirstHumanOutreach(tx, organizationId, input.applicantId);
    await recordMetric(tx, {
      organizationId,
      kind: MetricEventKind.HUMAN_OUTREACH_ATTEMPTED,
      applicantId: input.applicantId,
      memberId: staff.member.id,
      detail: `call:${input.outcome}`,
      occurredAt: at,
    });

    if (humanConnected) {
      await stampTwoWayHumanContact(tx, organizationId, input.applicantId, at);
      await advanceStatus(tx, ctx, input.applicantId, CaseStatus.TWO_WAY_CONVERSATION);
    } else {
      await advanceStatus(tx, ctx, input.applicantId, CaseStatus.CONTACT_ATTEMPTED);
    }

    await auditOperational(tx, ctx, {
      action: 'call.logged',
      subjectType: 'call_event',
      subjectId: call.id,
      applicantId: input.applicantId,
      metadata: { outcome: input.outcome, humanConnected, to: maskContact(normalized) },
    });
    await (await import('./tasks')).ensureNextStep(tx, ctx, input.applicantId);
    return call;
  });
}

export async function listCallEvents(organizationId: string, applicantId: string) {
  return prisma.callEvent.findMany({
    where: { organizationId, applicantId },
    orderBy: { occurredAt: 'desc' },
  });
}

/** The recruiter number an inbound call should be forwarded to. */
export async function forwardTargetFor(
  organizationId: string,
  applicantId: string | null,
): Promise<{ number: string | null; reason: string }> {
  const config = await prisma.integrationConfig.findFirst({
    where: { organizationId, kind: 'VOICE', enabled: true },
  });
  const settings = (config?.settings ?? {}) as { forwardTo?: string; fallbackForwardTo?: string };

  if (applicantId) {
    const applicant = await prisma.applicant.findFirst({
      where: { id: applicantId, organizationId },
      select: { ownerMemberId: true },
    });
    if (applicant?.ownerMemberId) {
      const owner = await prisma.member.findFirst({
        where: { organizationId, id: applicant.ownerMemberId, active: true },
        select: { id: true },
      });
      if (owner && settings.forwardTo) {
        return { number: settings.forwardTo, reason: 'organization forwarding number' };
      }
    }
  }
  if (settings.fallbackForwardTo) return { number: settings.fallbackForwardTo, reason: 'fallback number' };
  if (settings.forwardTo) return { number: settings.forwardTo, reason: 'organization forwarding number' };
  return { number: null, reason: 'No forwarding number is configured for this organization.' };
}

export { findPrimaryContact, organizationIdOf };

import { OutboxStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { redactError } from '@/lib/redact';
import { JOB, jobPayloads, type JobName } from '@/server/domain/jobs';
import { dispatchMessage, reconcileMessage, sendApprovedTemplate } from '@/server/services/messaging';
import { prepareBrief, carryForwardCorrections } from '@/server/services/briefs';
import { executeReminder } from '@/server/services/appointments';
import { detectDuplicates } from '@/server/services/duplicates';
import { deliverHandoffWebhook } from '@/server/services/handoff';
import { advanceSmsIntake } from '@/server/services/text-back';
import { executeRetentionRun } from '@/server/services/retention';
import { ensureNextStep } from '@/server/services/tasks';
import { systemContext } from '@/server/authz/policy';
import { ConsentPurpose } from '@prisma/client';

/**
 * Job handlers.
 *
 * Every handler is IDEMPOTENT and re-reads current state. A job that runs
 * twice must not send twice, create two tasks, or double-book a slot. The
 * queue guarantees at-least-once; the handlers turn that into
 * effectively-once for our own state, and into "never blindly repeat an
 * external side effect" for anything that leaves the building.
 */

export type HandlerResult = { ok: boolean; detail: string };

export const handlers: { [K in JobName]: (payload: unknown) => Promise<HandlerResult> } = {
  [JOB.dispatchMessage]: async (raw) => {
    const payload = jobPayloads[JOB.dispatchMessage].parse(raw);
    const result = await dispatchMessage(payload.organizationId, payload.messageId);
    return { ok: true, detail: `${result.state}: ${result.detail}` };
  },

  [JOB.reconcileMessage]: async (raw) => {
    const payload = jobPayloads[JOB.reconcileMessage].parse(raw);
    const result = await reconcileMessage(payload.organizationId, payload.messageId, payload.attempt);
    return { ok: true, detail: result.detail };
  },

  /**
   * The automated acknowledgment. Re-checks consent, opt-out state, quiet
   * hours and case restrictions at execution time, all of which can have
   * changed since the inquiry was submitted.
   */
  [JOB.sendAcknowledgment]: async (raw) => {
    const payload = jobPayloads[JOB.sendAcknowledgment].parse(raw);
    const contact = await prisma.contactPoint.findFirst({
      where: { organizationId: payload.organizationId, applicantId: payload.applicantId, channel: 'SMS' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    if (!contact) {
      return { ok: true, detail: 'No SMS contact point; no acknowledgment sent. Nothing was faked.' };
    }
    const result = await prisma.$transaction((tx) =>
      sendApprovedTemplate(tx, payload.organizationId, {
        applicantId: payload.applicantId,
        templateKey: 'acknowledgment',
        purpose: ConsentPurpose.INTAKE_SMS,
        toValue: contact.value,
        values: {},
        idempotencyKey: `ack:${payload.inquiryEpisodeId}`,
      }),
    );
    return {
      ok: true,
      detail: result.status === 'queued' ? `Queued message ${result.messageId}.` : `Blocked: ${result.reason}`,
    };
  },

  [JOB.prepareBrief]: async (raw) => {
    const payload = jobPayloads[JOB.prepareBrief].parse(raw);
    const result = await prepareBrief({
      organizationId: payload.organizationId,
      applicantId: payload.applicantId,
      requestedByMemberId: payload.requestedByMemberId,
      reason: payload.reason,
    });
    if (result.status === 'ok') {
      // Recruiter corrections survive a regeneration.
      const carried = await carryForwardCorrections(
        prisma,
        payload.organizationId,
        payload.applicantId,
        result.briefId,
      );
      return { ok: true, detail: `Brief revision ${result.revision}; ${carried} correction(s) carried forward.` };
    }
    return { ok: true, detail: `${result.status}: ${result.reason}` };
  },

  [JOB.appointmentReminder]: async (raw) => {
    const payload = jobPayloads[JOB.appointmentReminder].parse(raw);
    const result = await executeReminder(payload);
    return { ok: true, detail: `${result.status}: ${result.detail}` };
  },

  /**
   * Overdue sweep. It does NOT complete or escalate anything on its own; it
   * makes sure every active case still has a next step, which is the one
   * invariant that must hold without a human present.
   */
  [JOB.scanOverdueTasks]: async (raw) => {
    const payload = jobPayloads[JOB.scanOverdueTasks].parse(raw);
    const ctx = systemContext(payload.organizationId, JOB.scanOverdueTasks);
    const cases = await prisma.applicant.findMany({
      where: {
        organizationId: payload.organizationId,
        mergedIntoApplicantId: null,
        status: { not: 'CLOSED' },
      },
      select: { id: true },
      take: 2000,
    });
    let created = 0;
    for (const row of cases) {
      const task = await prisma.$transaction((tx) => ensureNextStep(tx, ctx, row.id));
      if (task) created += 1;
    }
    return { ok: true, detail: `Checked ${cases.length} active case(s); created ${created} next step(s).` };
  },

  [JOB.detectDuplicates]: async (raw) => {
    const payload = jobPayloads[JOB.detectDuplicates].parse(raw);
    const result = await detectDuplicates(payload.organizationId, payload.applicantId);
    return { ok: true, detail: `${result.created} duplicate candidate(s) recorded. Nothing was merged.` };
  },

  [JOB.deliverHandoffWebhook]: async (raw) => {
    const payload = jobPayloads[JOB.deliverHandoffWebhook].parse(raw);
    const result = await deliverHandoffWebhook(payload.organizationId, payload.handoffExportId);
    return { ok: result.outcome !== 'failed', detail: `${result.outcome}: ${result.detail}` };
  },

  [JOB.advanceSmsIntake]: async (raw) => {
    const payload = jobPayloads[JOB.advanceSmsIntake].parse(raw);
    const result = await advanceSmsIntake(payload);
    return { ok: true, detail: `${result.outcome}: ${result.detail}` };
  },

  [JOB.retentionRun]: async (raw) => {
    const payload = jobPayloads[JOB.retentionRun].parse(raw);
    const summary = await executeRetentionRun(payload);
    return {
      ok: true,
      detail: `${summary.mode}: ${summary.casesAffected} case(s), ${summary.casesOnLegalHold} held.`,
    };
  },
};

/** Mark an outbox row after its job finished, so it is never re-published. */
export async function settleOutbox(idempotencyKey: string, result: HandlerResult) {
  await prisma.outboxRecord.updateMany({
    where: { idempotencyKey },
    data: result.ok
      ? { status: OutboxStatus.PUBLISHED, publishedAt: now(), lastError: null }
      : { lastError: result.detail.slice(0, 500) },
  });
}

export async function failOutbox(idempotencyKey: string, error: unknown, retryLimit: number) {
  const info = redactError(error);
  const record = await prisma.outboxRecord.findUnique({ where: { idempotencyKey } });
  const attempts = (record?.attempts ?? 0) + 1;
  await prisma.outboxRecord.updateMany({
    where: { idempotencyKey },
    data: {
      attempts,
      lastError: `${info.name}: ${info.message}`,
      ...(attempts > retryLimit
        ? { status: OutboxStatus.FAILED, deadLetteredAt: now() }
        : { status: OutboxStatus.PENDING }),
    },
  });
}

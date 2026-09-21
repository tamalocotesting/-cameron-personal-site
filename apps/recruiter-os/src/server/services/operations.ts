import 'server-only';
import { MessageState, OutboxStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { redact } from '@/lib/redact';
import { requireOrganizationAdmin, type ActorContext } from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { NotFoundError } from '@/server/authz/errors';

/**
 * The operations view: failed jobs, blocked sends, dead letters, worker
 * heartbeat. Redacted diagnostics only — enough to act on, never a second
 * copy of an applicant's words.
 */

export type WorkerHeartbeat = {
  seenAt: Date | null;
  healthy: boolean;
  detail: string;
};

export async function workerHeartbeat(): Promise<WorkerHeartbeat> {
  // The worker touches this row on every poll. No heartbeat means no worker,
  // which means scheduled work is not running — and the workspace says so.
  const clock = await prisma.systemClock.findUnique({ where: { id: 'worker-heartbeat' } });
  if (!clock) {
    return { seenAt: null, healthy: false, detail: 'The background worker has never reported in.' };
  }
  const age = now().getTime() - clock.updatedAt.getTime();
  const healthy = age < 120_000;
  return {
    seenAt: clock.updatedAt,
    healthy,
    detail: healthy
      ? `Worker reported ${Math.round(age / 1000)}s ago.`
      : `Worker has not reported for ${Math.round(age / 1000)}s. Scheduled sends, reminders and briefs are not running.`,
  };
}

export async function recordWorkerHeartbeat() {
  await prisma.systemClock.upsert({
    where: { id: 'worker-heartbeat' },
    create: { id: 'worker-heartbeat', offsetSeconds: 0 },
    update: { offsetSeconds: 0 },
  });
}

export async function loadOperations(ctx: ActorContext) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;

  const [pending, failed, deadLettered, blockedMessages, unknownOutcome, receipts, heartbeat] =
    await Promise.all([
      prisma.outboxRecord.count({ where: { organizationId, status: OutboxStatus.PENDING } }),
      prisma.outboxRecord.findMany({
        where: { organizationId, status: OutboxStatus.FAILED },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      prisma.outboxRecord.count({ where: { organizationId, deadLetteredAt: { not: null } } }),
      prisma.message.findMany({
        where: { organizationId, state: MessageState.BLOCKED },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          applicantId: true,
          blockedReason: true,
          updatedAt: true,
          applicant: { select: { reference: true, displayName: true } },
        },
      }),
      prisma.message.findMany({
        where: { organizationId, state: MessageState.OUTCOME_UNKNOWN },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          applicantId: true,
          failureDetail: true,
          attemptCount: true,
          updatedAt: true,
          applicant: { select: { reference: true } },
        },
      }),
      prisma.webhookReceipt.findMany({
        where: { organizationId },
        orderBy: { receivedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          provider: true,
          endpoint: true,
          signatureValid: true,
          outcome: true,
          outcomeDetail: true,
          receivedAt: true,
        },
      }),
      workerHeartbeat(),
    ]);

  return {
    heartbeat,
    pendingJobs: pending,
    deadLetteredJobs: deadLettered,
    failedJobs: failed.map((job) => ({
      id: job.id,
      jobName: job.jobName,
      attempts: job.attempts,
      // Payloads carry identifiers only, and are redacted again on the way out.
      payload: redact(job.payload),
      lastError: job.lastError,
      deadLetteredAt: job.deadLetteredAt,
      updatedAt: job.updatedAt,
    })),
    blockedMessages,
    unknownOutcome,
    recentWebhooks: receipts,
  };
}

/** Re-queue a dead-lettered job. Safe: every handler is idempotent. */
export async function retryJob(ctx: ActorContext, input: { outboxId: string }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const record = await tx.outboxRecord.findFirst({ where: { id: input.outboxId, organizationId } });
    if (!record) throw new NotFoundError('Job');
    const updated = await tx.outboxRecord.update({
      where: { id: record.id },
      data: {
        status: OutboxStatus.PENDING,
        deadLetteredAt: null,
        lastError: null,
        availableAt: now(),
        attempts: 0,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'operations.job_retried',
      subjectType: 'outbox_record',
      subjectId: record.id,
      metadata: { jobName: record.jobName, previousAttempts: record.attempts },
    });
    void staff;
    return updated;
  });
}

export async function requeueReconciliation(ctx: ActorContext, input: { messageId: string }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, organizationId } });
    if (!message) throw new NotFoundError('Message');
    await enqueue(
      tx,
      JOB.reconcileMessage,
      { organizationId, messageId: message.id, attempt: message.attemptCount + 1 },
      { idempotencyKey: `reconcile:${message.id}:manual:${now().getTime()}` },
    );
    await auditSecurity(tx, ctx, {
      action: 'operations.reconciliation_requeued',
      subjectType: 'message',
      subjectId: message.id,
      applicantId: message.applicantId,
    });
    void staff;
    return { queued: true };
  });
}

import 'server-only';
import type { Prisma } from '@prisma/client';
import type { DbOrTx } from '@/server/db';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { JOB, jobPayloads, type JobName, type JobPayload } from '@/server/domain/jobs';

/**
 * Transactional outbox.
 *
 * `enqueue` is called INSIDE the business transaction. If the transaction
 * rolls back the job disappears with it; if it commits the job is durable even
 * though no queue connection was involved. The worker polls PENDING rows,
 * publishes them to pg-boss, and marks them published — at-least-once, which
 * is why every handler is idempotent.
 *
 * `idempotencyKey` is a BUSINESS key ("send:<messageId>"), not a random uuid,
 * so a double-clicked button produces one job, not two.
 */
export async function enqueue<K extends JobName>(
  db: DbOrTx,
  jobName: K,
  payload: JobPayload<K>,
  options: { idempotencyKey: string; availableAt?: Date },
) {
  const parsed = jobPayloads[jobName].parse(payload) as Record<string, unknown>;
  const organizationId = String(parsed.organizationId);

  // A duplicate business key is a no-op, not an error: the work is already
  // scheduled and will run exactly as it was going to.
  const existing = await db.outboxRecord.findUnique({
    where: { idempotencyKey: options.idempotencyKey },
    select: { id: true },
  });
  if (existing) return existing;

  return db.outboxRecord.create({
    data: {
      organizationId,
      jobName,
      payload: parsed as Prisma.InputJsonValue,
      idempotencyKey: options.idempotencyKey,
      availableAt: options.availableAt ?? now(),
    },
    select: { id: true },
  });
}

/** Cancel a pending outbox row whose business reason disappeared. */
export async function cancelPending(db: DbOrTx, idempotencyKey: string, reason: string) {
  await db.outboxRecord.updateMany({
    where: { idempotencyKey, status: 'PENDING' },
    data: { status: 'FAILED', lastError: `canceled: ${reason}`, deadLetteredAt: now() },
  });
}

export async function pendingOutboxCount(organizationId: string) {
  return prisma.outboxRecord.count({ where: { organizationId, status: 'PENDING' } });
}

export { JOB };

import 'server-only';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { ConflictError, NotFoundError } from '@/server/authz/errors';
import { canRunRetention, requireOrganizationAdmin, requireStaff, type ActorContext } from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';

/**
 * Retention.
 *
 * Deliberate design choices:
 *   * There is NO destructive default for a live organization. A policy has to
 *     be created, approved and enabled before anything is deleted.
 *   * `preview` is a dry run that reports counts and shows exactly what a
 *     legal hold protected.
 *   * Deletion covers DERIVED material too: briefs and their citations, stored
 *     provider payloads, queued jobs and exports — not just the case row.
 *   * A legal hold blocks every retention action on that case, full stop.
 *   * Audit metadata that survives is minimal and holds no deleted content.
 *
 * What this cannot do, and SECURITY.md says so: a database DELETE does not
 * erase backups, replicas, or copies a provider holds. Those expire on their
 * own schedules.
 */

export type RetentionSummary = {
  mode: 'preview' | 'execute';
  casesConsidered: number;
  casesOnLegalHold: number;
  casesAffected: number;
  briefsRemoved: number;
  briefSourceRefsRemoved: number;
  webhookPayloadsRemoved: number;
  handoffExportsRemoved: number;
  outboxRecordsRemoved: number;
  intakeAnswersRemoved: number;
  messagesRemoved: number;
  notesRemoved: number;
  auditMetadataMinimized: number;
  caveats: string[];
};

export async function createPolicy(
  ctx: ActorContext,
  input: {
    name: string;
    closedCaseRetentionDays: number | null;
    webhookPayloadRetentionDays: number | null;
    briefRetentionDays: number | null;
    auditMetadataRetentionDays: number | null;
  },
) {
  const staff = requireOrganizationAdmin(ctx);
  return prisma.$transaction(async (tx) => {
    const policy = await tx.retentionPolicy.create({
      data: { organizationId: staff.member.organizationId, ...input },
    });
    await auditSecurity(tx, ctx, {
      action: 'retention.policy_created',
      subjectType: 'retention_policy',
      subjectId: policy.id,
      metadata: { ...input },
    });
    return policy;
  });
}

export async function approvePolicy(ctx: ActorContext, input: { policyId: string; enable: boolean }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const policy = await tx.retentionPolicy.findFirst({ where: { id: input.policyId, organizationId } });
    if (!policy) throw new NotFoundError('Retention policy');
    const updated = await tx.retentionPolicy.update({
      where: { id: policy.id },
      data: { approvedByMemberId: staff.member.id, approvedAt: now(), enabled: input.enable },
    });
    await auditSecurity(tx, ctx, {
      action: 'retention.policy_approved',
      subjectType: 'retention_policy',
      subjectId: policy.id,
      metadata: { enabled: input.enable },
    });
    return updated;
  });
}

export async function queueRetentionRun(
  ctx: ActorContext,
  input: { policyId: string; mode: 'preview' | 'execute' },
) {
  const staff = requireStaff(ctx);
  if (!(await canRunRetention(ctx))) {
    throw new ConflictError('Running retention needs the retention-admin grant.');
  }
  const organizationId = staff.member.organizationId;
  const policy = await prisma.retentionPolicy.findFirst({ where: { id: input.policyId, organizationId } });
  if (!policy) throw new NotFoundError('Retention policy');
  if (input.mode === 'execute') {
    if (!policy.approvedAt || !policy.enabled) {
      throw new ConflictError(
        'This policy has not been approved and enabled. Deleting applicant data needs an approved policy.',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const run = await tx.retentionRun.create({
      data: {
        organizationId,
        policyId: policy.id,
        mode: input.mode,
        requestedByMemberId: staff.member.id,
      },
    });
    await enqueue(
      tx,
      JOB.retentionRun,
      {
        organizationId,
        policyId: policy.id,
        runId: run.id,
        mode: input.mode,
        requestedByMemberId: staff.member.id,
      },
      { idempotencyKey: `retention:${run.id}` },
    );
    await auditSecurity(tx, ctx, {
      action: `retention.${input.mode}_queued`,
      subjectType: 'retention_run',
      subjectId: run.id,
      metadata: { policyId: policy.id },
    });
    return run;
  });
}

export async function executeRetentionRun(input: {
  organizationId: string;
  policyId: string;
  runId: string;
  mode: 'preview' | 'execute';
}): Promise<RetentionSummary> {
  const policy = await prisma.retentionPolicy.findFirst({
    where: { id: input.policyId, organizationId: input.organizationId },
  });
  if (!policy) throw new NotFoundError('Retention policy');
  const at = now();

  const cutoffFor = (days: number | null) => (days === null ? null : new Date(at.getTime() - days * 86400_000));
  const closedCutoff = cutoffFor(policy.closedCaseRetentionDays);
  const briefCutoff = cutoffFor(policy.briefRetentionDays);
  const webhookCutoff = cutoffFor(policy.webhookPayloadRetentionDays);
  const auditCutoff = cutoffFor(policy.auditMetadataRetentionDays);

  const summary: RetentionSummary = {
    mode: input.mode,
    casesConsidered: 0,
    casesOnLegalHold: 0,
    casesAffected: 0,
    briefsRemoved: 0,
    briefSourceRefsRemoved: 0,
    webhookPayloadsRemoved: 0,
    handoffExportsRemoved: 0,
    outboxRecordsRemoved: 0,
    intakeAnswersRemoved: 0,
    messagesRemoved: 0,
    notesRemoved: 0,
    auditMetadataMinimized: 0,
    caveats: [
      'A database delete does not remove data from backups, replicas or a provider’s own systems. Those expire on their own schedules — see SECURITY.md.',
      'Minimal audit metadata is kept so the deletion itself remains accountable. It holds identifiers and field names, never deleted content.',
    ],
  };

  let candidates: Array<{ id: string; legalHold: boolean }> = [];
  if (closedCutoff) {
    candidates = await prisma.applicant.findMany({
      where: {
        organizationId: input.organizationId,
        status: 'CLOSED',
        closedAt: { lt: closedCutoff },
      },
      select: { id: true, legalHold: true },
    });
  }
  summary.casesConsidered = candidates.length;
  const held = candidates.filter((c) => c.legalHold);
  summary.casesOnLegalHold = held.length;
  const deletable = candidates.filter((c) => !c.legalHold).map((c) => c.id);
  summary.casesAffected = deletable.length;

  const countOrDelete = async <T>(
    count: () => Promise<number>,
    remove: () => Promise<T>,
  ): Promise<number> => {
    const n = await count();
    if (input.mode === 'execute' && n > 0) await remove();
    return n;
  };

  if (deletable.length) {
    summary.intakeAnswersRemoved = await countOrDelete(
      () =>
        prisma.intakeAnswer.count({
          where: { organizationId: input.organizationId, intakeSession: { applicantId: { in: deletable } } },
        }),
      () =>
        prisma.intakeAnswer.deleteMany({
          where: { organizationId: input.organizationId, intakeSession: { applicantId: { in: deletable } } },
        }),
    );
    summary.messagesRemoved = await countOrDelete(
      () => prisma.message.count({ where: { organizationId: input.organizationId, applicantId: { in: deletable } } }),
      () =>
        prisma.message.deleteMany({
          where: { organizationId: input.organizationId, applicantId: { in: deletable } },
        }),
    );
    summary.notesRemoved = await countOrDelete(
      () => prisma.note.count({ where: { organizationId: input.organizationId, applicantId: { in: deletable } } }),
      () => prisma.note.deleteMany({ where: { organizationId: input.organizationId, applicantId: { in: deletable } } }),
    );
    summary.handoffExportsRemoved = await countOrDelete(
      () =>
        prisma.handoffExport.count({
          where: { organizationId: input.organizationId, applicantId: { in: deletable } },
        }),
      () =>
        prisma.handoffExport.deleteMany({
          where: { organizationId: input.organizationId, applicantId: { in: deletable } },
        }),
    );
    // Derived material goes with it: briefs, their items and their citations.
    summary.briefSourceRefsRemoved = await countOrDelete(
      () =>
        prisma.briefSourceRef.count({
          where: {
            organizationId: input.organizationId,
            briefItem: { brief: { applicantId: { in: deletable } } },
          },
        }),
      () =>
        prisma.briefSourceRef.deleteMany({
          where: {
            organizationId: input.organizationId,
            briefItem: { brief: { applicantId: { in: deletable } } },
          },
        }),
    );
    summary.briefsRemoved = await countOrDelete(
      () => prisma.brief.count({ where: { organizationId: input.organizationId, applicantId: { in: deletable } } }),
      () => prisma.brief.deleteMany({ where: { organizationId: input.organizationId, applicantId: { in: deletable } } }),
    );
    // Pending jobs that reference a deleted case would fail forever.
    const pendingJobs = await prisma.outboxRecord.findMany({
      where: { organizationId: input.organizationId, status: 'PENDING' },
      select: { id: true, payload: true },
    });
    const orphanJobIds = pendingJobs
      .filter((job) => {
        const payload = job.payload as { applicantId?: unknown } | null;
        return typeof payload?.applicantId === 'string' && deletable.includes(payload.applicantId);
      })
      .map((job) => job.id);
    summary.outboxRecordsRemoved = orphanJobIds.length;
    if (input.mode === 'execute' && orphanJobIds.length) {
      await prisma.outboxRecord.deleteMany({ where: { id: { in: orphanJobIds } } });
    }
  }

  if (briefCutoff) {
    const extra = await countOrDelete(
      () =>
        prisma.brief.count({
          where: { organizationId: input.organizationId, generatedAt: { lt: briefCutoff }, applicant: { legalHold: false } },
        }),
      () =>
        prisma.brief.deleteMany({
          where: { organizationId: input.organizationId, generatedAt: { lt: briefCutoff }, applicant: { legalHold: false } },
        }),
    );
    summary.briefsRemoved += extra;
  }

  if (webhookCutoff) {
    summary.webhookPayloadsRemoved = await countOrDelete(
      () =>
        prisma.webhookReceipt.count({
          where: { organizationId: input.organizationId, receivedAt: { lt: webhookCutoff } },
        }),
      () =>
        prisma.webhookReceipt.deleteMany({
          where: { organizationId: input.organizationId, receivedAt: { lt: webhookCutoff } },
        }),
    );
  }

  if (auditCutoff) {
    // Audit rows are not deleted; their metadata is minimized so the fact of
    // the action survives without the detail.
    const rows = await prisma.auditEvent.findMany({
      where: {
        organizationId: input.organizationId,
        occurredAt: { lt: auditCutoff },
        NOT: { metadata: { equals: {} } },
      },
      select: { id: true },
      take: 5000,
    });
    summary.auditMetadataMinimized = rows.length;
    if (input.mode === 'execute' && rows.length) {
      await prisma.auditEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { metadata: {}, ipAddress: null, userAgent: null },
      });
    }
  }

  if (input.mode === 'execute' && deletable.length) {
    await prisma.applicant.deleteMany({
      where: { organizationId: input.organizationId, id: { in: deletable } },
    });
  }

  await prisma.retentionRun.update({
    where: { id: input.runId },
    data: { finishedAt: now(), summary: summary as unknown as object },
  });

  return summary;
}

export async function setLegalHold(
  ctx: ActorContext,
  input: { applicantId: string; hold: boolean; reason: string },
) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.applicant.update({
      where: { id: input.applicantId },
      data: { legalHold: input.hold, legalHoldReason: input.hold ? input.reason : null },
    });
    await auditSecurity(tx, ctx, {
      action: input.hold ? 'retention.legal_hold_set' : 'retention.legal_hold_cleared',
      subjectType: 'applicant',
      subjectId: input.applicantId,
      applicantId: input.applicantId,
      metadata: { reason: input.reason },
    });
    void organizationId;
    return updated;
  });
}

export async function listPolicies(organizationId: string) {
  return prisma.retentionPolicy.findMany({
    where: { organizationId },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
    orderBy: { createdAt: 'desc' },
  });
}

import 'server-only';
import {
  CaseStatus,
  TaskStatus,
  TaskType,
  type Task,
  type TaskCompletionOutcome,
} from '@prisma/client';
import { z } from 'zod';
import type { DbOrTx } from '@/server/db';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { auditOperational } from '@/server/audit';
import { recordMetric, MetricEventKind } from '@/server/metrics';
import { assertTransition, taskTransitions, OPEN_TASK_STATUSES } from '@/server/domain/state-machines';
import { ConflictError, ValidationError } from '@/server/authz/errors';
import { requireCase, type ActorContext, organizationIdOf, requireStaff } from '@/server/authz/policy';

/**
 * Follow-ups and commitments.
 *
 * Two rules that the rest of the workspace leans on:
 *   * A task is completed only by an explicit completion with an OUTCOME.
 *     Drafting a message does not complete it. Neither does the due time
 *     passing.
 *   * Snoozing keeps `originalDueAt` untouched, requires a reason and a new
 *     date, and writes a snooze row. "Follow-ups completed by the ORIGINAL
 *     promised deadline" is only an honest number because of that.
 */

export const createTaskInput = z.object({
  applicantId: z.string().min(1),
  type: z.nativeEnum(TaskType),
  title: z.string().min(3).max(160),
  reason: z.string().min(3).max(300),
  dueAt: z.coerce.date(),
  ownerMemberId: z.string().min(1).optional(),
  sourceRef: z.string().max(200).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskInput>;

export async function createTask(
  db: DbOrTx,
  ctx: ActorContext,
  input: CreateTaskInput,
  options: { audit?: boolean } = { audit: true },
): Promise<Task> {
  const organizationId = organizationIdOf(ctx);
  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, organizationId },
    select: { id: true, ownerMemberId: true, teamId: true },
  });
  if (!applicant) throw new ValidationError('That case does not exist in this organization.');

  const ownerMemberId = input.ownerMemberId ?? applicant.ownerMemberId;
  if (!ownerMemberId) {
    throw new ConflictError('A task needs an accountable owner, and this case has none.');
  }

  const task = await db.task.create({
    data: {
      organizationId,
      applicantId: input.applicantId,
      type: input.type,
      title: input.title,
      reason: input.reason,
      sourceRef: input.sourceRef ?? null,
      ownerMemberId,
      dueAt: input.dueAt,
      originalDueAt: input.dueAt,
      status: TaskStatus.OPEN,
      createdAt: now(),
    },
  });

  if (options.audit !== false) {
    await auditOperational(db, ctx, {
      action: 'task.created',
      subjectType: 'task',
      subjectId: task.id,
      applicantId: input.applicantId,
      metadata: { type: input.type, dueAt: input.dueAt.toISOString(), reason: input.reason },
    });
  }
  return task;
}

/**
 * Create a task only if an equivalent open one does not already exist.
 * Used by every automatic path (missed call, handoff, reconciliation) so a
 * replayed webhook cannot produce two callback tasks.
 */
export async function ensureTaskOnce(
  db: DbOrTx,
  ctx: ActorContext,
  input: CreateTaskInput & { dedupeKey: string },
): Promise<{ task: Task; created: boolean }> {
  const organizationId = organizationIdOf(ctx);
  const existing = await db.task.findFirst({
    where: {
      organizationId,
      applicantId: input.applicantId,
      type: input.type,
      sourceRef: input.dedupeKey,
      status: { in: [...OPEN_TASK_STATUSES] },
    },
  });
  if (existing) return { task: existing, created: false };

  const task = await createTask(db, ctx, { ...input, sourceRef: input.dedupeKey });
  return { task, created: true };
}

export async function completeTask(
  ctx: ActorContext,
  input: {
    taskId: string;
    outcome: TaskCompletionOutcome;
    note?: string;
    expectedVersion?: number;
  },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: input.taskId, organizationId } });
    if (!task) throw new ValidationError('That task does not exist.');
    await requireCase(ctx, task.applicantId, 'act');

    if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed this task. Reload and try again.');
    }
    assertTransition(taskTransitions, task.status, TaskStatus.COMPLETED, 'Task');

    const at = now();
    const updated = await tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt: at,
        completedByMemberId: staff.member.id,
        completionOutcome: input.outcome,
        completionNote: input.note ?? null,
        version: { increment: 1 },
      },
    });

    // On time is measured against the ORIGINAL promise, not the snoozed date.
    const onTime = at.getTime() <= task.originalDueAt.getTime();
    await recordMetric(tx, {
      organizationId,
      kind: onTime ? MetricEventKind.TASK_COMPLETED_ON_TIME : MetricEventKind.TASK_COMPLETED_LATE,
      applicantId: task.applicantId,
      memberId: task.ownerMemberId,
      numericValue: Math.round((at.getTime() - task.originalDueAt.getTime()) / 60000),
      detail: task.type,
      occurredAt: at,
    });

    await auditOperational(tx, ctx, {
      action: 'task.completed',
      subjectType: 'task',
      subjectId: task.id,
      applicantId: task.applicantId,
      metadata: { outcome: input.outcome, onTime, snoozeCount: task.snoozeCount },
    });

    // Completing the last actionable task must leave the case with a next
    // step, a dated waiting state, or an explicit closure.
    await ensureNextStep(tx, ctx, task.applicantId);

    return updated;
  });
}

export async function snoozeTask(
  ctx: ActorContext,
  input: { taskId: string; newDueAt: Date; reason: string; expectedVersion?: number },
) {
  const staff = requireStaff(ctx);
  if (input.reason.trim().length < 3) {
    throw new ValidationError('Snoozing requires a reason.', { reason: ['Say why this is moving.'] });
  }
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: input.taskId, organizationId } });
    if (!task) throw new ValidationError('That task does not exist.');
    await requireCase(ctx, task.applicantId, 'act');
    if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed this task. Reload and try again.');
    }
    if (input.newDueAt.getTime() <= now().getTime()) {
      throw new ValidationError('A snoozed task needs a future date.', {
        newDueAt: ['Pick a date in the future.'],
      });
    }
    assertTransition(taskTransitions, task.status, TaskStatus.SNOOZED, 'Task');

    await tx.taskSnooze.create({
      data: {
        organizationId,
        taskId: task.id,
        fromDueAt: task.dueAt,
        toDueAt: input.newDueAt,
        reason: input.reason,
        byMemberId: staff.member.id,
      },
    });

    const updated = await tx.task.update({
      where: { id: task.id },
      data: {
        // originalDueAt is deliberately NOT touched.
        dueAt: input.newDueAt,
        status: TaskStatus.SNOOZED,
        snoozeCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await auditOperational(tx, ctx, {
      action: 'task.snoozed',
      subjectType: 'task',
      subjectId: task.id,
      applicantId: task.applicantId,
      metadata: {
        fromDueAt: task.dueAt.toISOString(),
        toDueAt: input.newDueAt.toISOString(),
        originalDueAt: task.originalDueAt.toISOString(),
        reason: input.reason,
      },
    });
    return updated;
  });
}

export async function cancelTask(
  ctx: ActorContext,
  input: { taskId: string; reason: string; expectedVersion?: number },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: input.taskId, organizationId } });
    if (!task) throw new ValidationError('That task does not exist.');
    await requireCase(ctx, task.applicantId, 'act');
    if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed this task. Reload and try again.');
    }
    assertTransition(taskTransitions, task.status, TaskStatus.CANCELED, 'Task');

    const updated = await tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.CANCELED,
        canceledAt: now(),
        cancelReason: input.reason,
        version: { increment: 1 },
      },
    });
    await auditOperational(tx, ctx, {
      action: 'task.canceled',
      subjectType: 'task',
      subjectId: task.id,
      applicantId: task.applicantId,
      metadata: { reason: input.reason },
    });
    await ensureNextStep(tx, ctx, task.applicantId);
    return updated;
  });
}

export async function reassignTask(
  db: DbOrTx,
  ctx: ActorContext,
  input: { taskId: string; toMemberId: string; reason: string },
) {
  const organizationId = organizationIdOf(ctx);
  const task = await db.task.findFirst({ where: { id: input.taskId, organizationId } });
  if (!task) throw new ValidationError('That task does not exist.');
  const updated = await db.task.update({
    where: { id: task.id },
    data: { ownerMemberId: input.toMemberId, version: { increment: 1 } },
  });
  await auditOperational(db, ctx, {
    action: 'task.reassigned',
    subjectType: 'task',
    subjectId: task.id,
    applicantId: task.applicantId,
    metadata: { from: task.ownerMemberId, to: input.toMemberId, reason: input.reason },
  });
  return updated;
}

/**
 * The next-step invariant.
 *
 * Every active case must have exactly one accountable owner and at least one
 * concrete next step with a due/review time. A "waiting on the applicant"
 * state still needs a review date — that is what stops a case from quietly
 * ageing out of everyone's attention.
 */
export async function ensureNextStep(db: DbOrTx, ctx: ActorContext, applicantId: string) {
  const organizationId = organizationIdOf(ctx);
  const applicant = await db.applicant.findFirst({
    where: { id: applicantId, organizationId },
    select: { id: true, status: true, ownerMemberId: true, mergedIntoApplicantId: true },
  });
  if (!applicant) return null;
  if (applicant.status === CaseStatus.CLOSED || applicant.mergedIntoApplicantId) return null;

  const openTasks = await db.task.count({
    where: { organizationId, applicantId, status: { in: [...OPEN_TASK_STATUSES] } },
  });
  if (openTasks > 0) return null;

  const upcomingAppointment = await db.appointment.findFirst({
    where: {
      organizationId,
      applicantId,
      state: { in: ['PROPOSED', 'SCHEDULED', 'CONFIRMED'] },
      startsAt: { gt: now() },
    },
    select: { id: true, startsAt: true },
    orderBy: { startsAt: 'asc' },
  });

  if (upcomingAppointment) {
    // The appointment is the next step; a prep task keeps it accountable.
    const { task } = await ensureTaskOnce(db, ctx, {
      applicantId,
      type: TaskType.APPOINTMENT_PREP,
      title: 'Confirm and prepare for the appointment',
      reason: 'An appointment is scheduled and needs confirmation before it happens.',
      dueAt: new Date(Math.max(now().getTime() + 60_000, upcomingAppointment.startsAt.getTime() - 24 * 3600_000)),
      dedupeKey: `appointment:${upcomingAppointment.id}`,
    });
    return task;
  }

  // No open work and no appointment: create a dated review so the case cannot
  // sit in a waiting state forever.
  const reviewDays = applicant.status === CaseStatus.AWAITING_APPLICANT ? 3 : 1;
  const { task } = await ensureTaskOnce(db, ctx, {
    applicantId,
    type: TaskType.FOLLOW_UP,
    title:
      applicant.status === CaseStatus.AWAITING_APPLICANT
        ? 'Review this case — waiting on the applicant'
        : 'Decide the next step on this case',
    reason:
      applicant.status === CaseStatus.AWAITING_APPLICANT
        ? 'Waiting states still need a review date so the case does not age out unnoticed.'
        : 'The last open commitment was resolved and the case still needs a next step.',
    dueAt: new Date(now().getTime() + reviewDays * 86400_000),
    dedupeKey: `next-step:${applicant.status}:${applicantId}`,
  });
  return task;
}

export async function listTasksForCase(organizationId: string, applicantId: string) {
  return prisma.task.findMany({
    where: { organizationId, applicantId },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    include: { snoozes: { orderBy: { createdAt: 'desc' } }, owner: { select: { displayName: true } } },
  });
}

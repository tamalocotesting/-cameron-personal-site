import 'server-only';
import {
  CaseClosureReason,
  CaseStatus,
  ContactChannel,
  MetricEventKind,
  ReviewFlagKind,
  ReviewFlagStatus,
  TaskStatus,
  TaskType,
  type Applicant,
  type Prisma,
} from '@prisma/client';
import { z } from 'zod';
import type { DbOrTx } from '@/server/db';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { auditOperational, auditSecurity } from '@/server/audit';
import { recordMetric } from '@/server/metrics';
import { ACTIVE_CASE_STATUSES, assertTransition, caseTransitions } from '@/server/domain/state-machines';
import { ConflictError, ValidationError } from '@/server/authz/errors';
import {
  organizationIdOf,
  requireCase,
  requireStaff,
  canReassignAny,
  type ActorContext,
} from '@/server/authz/policy';
import { routeNewInquiry } from './ownership';
import { createTask, ensureNextStep } from './tasks';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { maskContact } from '@/lib/redact';

/**
 * Case files.
 *
 * A "case" here is the Applicant row plus everything hanging off it. The
 * service owns three things the rest of the app must not do by hand:
 * creating a case with an owner and a next step, moving workflow status
 * through the transition table, and keeping the next-step invariant true.
 */

export const E164 = /^\+[1-9]\d{6,14}$/;

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return E164.test(digits) ? digits : null;
  const bare = digits.replace(/\D/g, '');
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  return null;
}

export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return null;
  return value;
}

async function nextReference(db: DbOrTx, organizationId: string): Promise<string> {
  // A short, human-quotable reference. Collisions retry; uniqueness is
  // enforced by the (organizationId, reference) constraint in the database.
  const count = await db.applicant.count({ where: { organizationId } });
  const year = now().getUTCFullYear().toString().slice(-2);
  return `C${year}-${String(count + 1).padStart(4, '0')}`;
}

export type CreateCaseInput = {
  organizationId: string;
  displayName: string;
  preferredName?: string | null;
  generalLocation?: string | null;
  timezone?: string | null;
  originKind: string;
  contactPoints: Array<{ channel: ContactChannel; value: string; isPrimary?: boolean; label?: string }>;
  status?: CaseStatus;
  ownerMemberId?: string;
};

/**
 * Create a case, its first inquiry episode, an accountable owner and a next
 * step — in ONE transaction, together with the audit row and the outbox job
 * for the automated acknowledgment. There is no window in which a submitted
 * inquiry exists without an owner.
 */
export async function createCase(
  db: DbOrTx,
  ctx: ActorContext,
  input: CreateCaseInput,
): Promise<{ applicant: Applicant; inquiryEpisodeId: string }> {
  const at = now();
  const routed = input.ownerMemberId
    ? { memberId: input.ownerMemberId, basis: 'explicitly assigned' }
    : await routeNewInquiry(db, input.organizationId, at);

  let reference = await nextReference(db, input.organizationId);
  let applicant: Applicant | null = null;
  for (let attempt = 0; attempt < 5 && !applicant; attempt += 1) {
    try {
      applicant = await db.applicant.create({
        data: {
          organizationId: input.organizationId,
          reference,
          displayName: input.displayName.trim() || 'Unnamed inquiry',
          preferredName: input.preferredName ?? null,
          generalLocation: input.generalLocation ?? null,
          timezone: input.timezone ?? null,
          status: input.status ?? CaseStatus.NEW_INQUIRY,
          ownerMemberId: routed.memberId,
          // Stamped from the application clock so the demo clock, the tests
          // and the reports all agree about when this arrived.
          createdAt: at,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      reference = `${reference}-${attempt + 2}`;
    }
  }
  if (!applicant) throw new ConflictError('Could not allocate a case reference. Try again.');

  for (const [index, cp] of input.contactPoints.entries()) {
    const normalized =
      cp.channel === ContactChannel.EMAIL ? normalizeEmail(cp.value) : normalizePhone(cp.value);
    if (!normalized) continue;
    await db.contactPoint.upsert({
      where: {
        organizationId_applicantId_channel_value: {
          organizationId: input.organizationId,
          applicantId: applicant.id,
          channel: cp.channel,
          value: normalized,
        },
      },
      create: {
        organizationId: input.organizationId,
        applicantId: applicant.id,
        channel: cp.channel,
        value: normalized,
        label: cp.label ?? null,
        isPrimary: cp.isPrimary ?? index === 0,
      },
      update: {},
    });
  }

  const episode = await db.inquiryEpisode.create({
    data: {
      organizationId: input.organizationId,
      applicantId: applicant.id,
      originKind: input.originKind,
      openedAt: at,
    },
  });

  await recordMetric(db, {
    organizationId: input.organizationId,
    kind: MetricEventKind.INQUIRY_OPENED,
    applicantId: applicant.id,
    inquiryEpisodeId: episode.id,
    memberId: routed.memberId,
    detail: input.originKind,
    occurredAt: at,
  });

  await auditOperational(db, ctx, {
    action: 'case.created',
    subjectType: 'applicant',
    subjectId: applicant.id,
    applicantId: applicant.id,
    metadata: {
      originKind: input.originKind,
      ownerBasis: routed.basis,
      reference: applicant.reference,
      contactChannels: input.contactPoints.map((c) => c.channel),
    },
  });

  // Duplicate detection runs in the worker: it must never block an applicant's
  // submission, and it must never auto-merge.
  await enqueue(
    db,
    JOB.detectDuplicates,
    { organizationId: input.organizationId, applicantId: applicant.id },
    { idempotencyKey: `duplicates:${applicant.id}` },
  );

  // The invariant, established inside the same transaction: there is no window
  // in which a submitted inquiry exists without an owner AND a dated next step.
  await ensureNextStep(db, ctx, applicant.id);

  return { applicant, inquiryEpisodeId: episode.id };
}

export async function setCaseStatus(
  db: DbOrTx,
  ctx: ActorContext,
  input: {
    applicantId: string;
    status: CaseStatus;
    reason?: string;
    closureReason?: CaseClosureReason;
    expectedVersion?: number;
  },
) {
  const organizationId = organizationIdOf(ctx);
  const applicant = await db.applicant.findFirst({ where: { id: input.applicantId, organizationId } });
  if (!applicant) throw new ValidationError('That case does not exist.');
  if (input.expectedVersion !== undefined && applicant.version !== input.expectedVersion) {
    throw new ConflictError('Someone else changed this case. Reload and try again.');
  }
  assertTransition(caseTransitions, applicant.status, input.status, 'Case');

  if (input.status === CaseStatus.CLOSED && !input.closureReason) {
    throw new ValidationError('Closing a case requires an operational reason.', {
      closureReason: ['Pick why this case is being closed.'],
    });
  }

  const at = now();
  const reopening = applicant.status === CaseStatus.CLOSED && input.status !== CaseStatus.CLOSED;

  const updated = await db.applicant.update({
    where: { id: applicant.id },
    data: {
      status: input.status,
      closureReason: input.status === CaseStatus.CLOSED ? input.closureReason! : null,
      closureNote: input.status === CaseStatus.CLOSED ? (input.reason ?? null) : null,
      closedAt: input.status === CaseStatus.CLOSED ? at : null,
      version: { increment: 1 },
    },
  });

  if (input.status === CaseStatus.CLOSED) {
    // Closing cancels open work; the closure reason is the record of why.
    await db.task.updateMany({
      where: { organizationId, applicantId: applicant.id, status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] } },
      data: { status: TaskStatus.CANCELED, canceledAt: at, cancelReason: `case closed: ${input.closureReason}` },
    });
    await db.inquiryEpisode.updateMany({
      where: { organizationId, applicantId: applicant.id, closedAt: null },
      data: { closedAt: at },
    });
    await recordMetric(db, {
      organizationId,
      kind: MetricEventKind.CASE_CLOSED,
      applicantId: applicant.id,
      memberId: applicant.ownerMemberId,
      detail: input.closureReason ?? null,
      occurredAt: at,
    });
  }

  if (reopening) {
    // A reopened case starts a NEW inquiry episode. The old episode's clocks
    // are left alone, so historical time-to-contact does not move.
    await db.inquiryEpisode.updateMany({
      where: { organizationId, applicantId: applicant.id, supersededAt: null, closedAt: { not: null } },
      data: { supersededAt: at },
    });
    const episode = await db.inquiryEpisode.create({
      data: { organizationId, applicantId: applicant.id, originKind: 'reopened', openedAt: at },
    });
    await recordMetric(db, {
      organizationId,
      kind: MetricEventKind.CASE_REOPENED,
      applicantId: applicant.id,
      inquiryEpisodeId: episode.id,
      occurredAt: at,
    });
  }

  await auditOperational(db, ctx, {
    action: 'case.status_changed',
    subjectType: 'applicant',
    subjectId: applicant.id,
    applicantId: applicant.id,
    metadata: {
      from: applicant.status,
      to: input.status,
      closureReason: input.closureReason ?? null,
      reason: input.reason ?? null,
    },
  });

  await ensureNextStep(db, ctx, applicant.id);
  return updated;
}

/** Nudge the status forward when a workflow event implies it. Never backwards. */
export async function advanceStatus(
  db: DbOrTx,
  ctx: ActorContext,
  applicantId: string,
  target: CaseStatus,
) {
  const organizationId = organizationIdOf(ctx);
  const applicant = await db.applicant.findFirst({
    where: { id: applicantId, organizationId },
    select: { id: true, status: true },
  });
  if (!applicant) return;
  if (applicant.status === CaseStatus.CLOSED) return;
  const order: CaseStatus[] = [
    CaseStatus.NEW_INQUIRY,
    CaseStatus.INTAKE_IN_PROGRESS,
    CaseStatus.READY_FOR_RECRUITER,
    CaseStatus.CONTACT_ATTEMPTED,
    CaseStatus.TWO_WAY_CONVERSATION,
    CaseStatus.APPOINTMENT_SCHEDULED,
  ];
  const currentIndex = order.indexOf(applicant.status);
  const targetIndex = order.indexOf(target);
  if (targetIndex < 0) return;
  if (currentIndex >= 0 && targetIndex <= currentIndex) return;
  if (!caseTransitions[applicant.status].includes(target)) return;
  await setCaseStatus(db, ctx, { applicantId, status: target, reason: 'workflow event' });
}

export async function pauseAutomation(
  db: DbOrTx,
  ctx: ActorContext,
  applicantId: string,
  reason: string,
) {
  const organizationId = organizationIdOf(ctx);
  await db.applicant.updateMany({
    where: { id: applicantId, organizationId },
    data: { automationPaused: true, automationPausedReason: reason },
  });
  await auditOperational(db, ctx, {
    action: 'case.automation_paused',
    subjectType: 'applicant',
    subjectId: applicantId,
    applicantId,
    metadata: { reason },
  });
}

export async function resumeAutomation(db: DbOrTx, ctx: ActorContext, applicantId: string) {
  const organizationId = organizationIdOf(ctx);
  await db.applicant.updateMany({
    where: { id: applicantId, organizationId },
    data: { automationPaused: false, automationPausedReason: null },
  });
  await auditOperational(db, ctx, {
    action: 'case.automation_resumed',
    subjectType: 'applicant',
    subjectId: applicantId,
    applicantId,
  });
}

/**
 * Raise a review flag and (for human/sensitive handoffs) pause automated
 * conversational progression. Idempotent per (kind, sourceRef).
 */
export async function raiseReviewFlag(
  db: DbOrTx,
  ctx: ActorContext,
  input: {
    applicantId: string;
    kind: ReviewFlagKind;
    detail: string;
    restricted?: boolean;
    sourceRef?: string;
    taskTitle?: string;
    taskDueAt?: Date;
  },
) {
  const organizationId = organizationIdOf(ctx);
  const existing = await db.reviewFlag.findFirst({
    where: {
      organizationId,
      applicantId: input.applicantId,
      kind: input.kind,
      status: ReviewFlagStatus.OPEN,
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    },
  });
  if (existing) return { flag: existing, created: false };

  const flag = await db.reviewFlag.create({
    data: {
      organizationId,
      applicantId: input.applicantId,
      kind: input.kind,
      detail: input.detail,
      restricted: input.restricted ?? false,
      sourceRef: input.sourceRef ?? null,
      raisedAt: now(),
    },
  });

  const needsPause =
    input.kind === ReviewFlagKind.HUMAN_REQUESTED || input.kind === ReviewFlagKind.SENSITIVE_QUESTION;
  if (needsPause) {
    await pauseAutomation(
      db,
      ctx,
      input.applicantId,
      input.kind === ReviewFlagKind.HUMAN_REQUESTED
        ? 'The applicant asked for a person.'
        : 'A question came up that automation must not answer.',
    );
  }

  const taskType =
    input.kind === ReviewFlagKind.HUMAN_REQUESTED
      ? TaskType.REVIEW_HUMAN_REQUEST
      : input.kind === ReviewFlagKind.SENSITIVE_QUESTION
        ? TaskType.REVIEW_SENSITIVE
        : input.kind === ReviewFlagKind.LINKING_REVIEW
          ? TaskType.LINKING_REVIEW
          : input.kind === ReviewFlagKind.SEND_RECONCILIATION
            ? TaskType.RECONCILE_SEND
            : TaskType.OTHER;

  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, organizationId },
    select: { ownerMemberId: true },
  });
  if (applicant?.ownerMemberId) {
    await createTask(db, ctx, {
      applicantId: input.applicantId,
      type: taskType,
      title: input.taskTitle ?? 'Review required',
      // Neutral, workflow-only. Never a judgement about the person.
      reason: input.detail,
      dueAt: input.taskDueAt ?? new Date(now().getTime() + 2 * 3600_000),
      sourceRef: `review_flag:${flag.id}`,
      ownerMemberId: applicant.ownerMemberId,
    });
  }

  await auditOperational(db, ctx, {
    action: 'review_flag.raised',
    subjectType: 'review_flag',
    subjectId: flag.id,
    applicantId: input.applicantId,
    metadata: { kind: input.kind, restricted: input.restricted ?? false, sourceRef: input.sourceRef ?? null },
  });

  return { flag, created: true };
}

export async function resolveReviewFlag(
  ctx: ActorContext,
  input: { flagId: string; resolution: 'RESOLVED' | 'DISMISSED'; reason: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  if (input.reason.trim().length < 3) {
    throw new ValidationError('Resolving a review flag requires a reason.', {
      reason: ['Say what you did.'],
    });
  }
  return prisma.$transaction(async (tx) => {
    const flag = await tx.reviewFlag.findFirst({ where: { id: input.flagId, organizationId } });
    if (!flag) throw new ValidationError('That review flag does not exist.');
    await requireCase(ctx, flag.applicantId, 'act');
    if (flag.restricted) await requireCase(ctx, flag.applicantId, 'sensitive');

    const at = now();
    const updated = await tx.reviewFlag.update({
      where: { id: flag.id },
      data: {
        status: input.resolution === 'RESOLVED' ? ReviewFlagStatus.RESOLVED : ReviewFlagStatus.DISMISSED,
        resolvedAt: at,
        resolvedByMemberId: staff.member.id,
        resolutionReason: input.reason,
      },
    });

    await tx.task.updateMany({
      where: {
        organizationId,
        applicantId: flag.applicantId,
        sourceRef: `review_flag:${flag.id}`,
        status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] },
      },
      data: { status: TaskStatus.COMPLETED, completedAt: at, completedByMemberId: staff.member.id, completionOutcome: 'RESOLVED', completionNote: input.reason },
    });

    // Automation resumes only when nothing else is waiting on a human.
    const stillOpen = await tx.reviewFlag.count({
      where: {
        organizationId,
        applicantId: flag.applicantId,
        status: ReviewFlagStatus.OPEN,
        kind: { in: [ReviewFlagKind.HUMAN_REQUESTED, ReviewFlagKind.SENSITIVE_QUESTION] },
      },
    });
    if (stillOpen === 0) await resumeAutomation(tx, ctx, flag.applicantId);

    await auditOperational(tx, ctx, {
      action: 'review_flag.resolved',
      subjectType: 'review_flag',
      subjectId: flag.id,
      applicantId: flag.applicantId,
      metadata: { resolution: input.resolution, reason: input.reason },
    });

    await ensureNextStep(tx, ctx, flag.applicantId);
    return updated;
  });
}

export const reassignInput = z.object({
  applicantId: z.string().min(1),
  toMemberId: z.string().min(1),
  reason: z.string().min(3).max(300),
});

export async function reassignCase(ctx: ActorContext, input: z.infer<typeof reassignInput>) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  const { applicant, access } = await requireCase(ctx, input.applicantId, 'metadata');
  if (!access.reassign && !(await canReassignAny(ctx))) {
    throw new ConflictError('You do not have permission to reassign this case.');
  }

  return prisma.$transaction(async (tx) => {
    const target = await tx.member.findFirst({
      where: { organizationId, id: input.toMemberId, active: true },
      select: { id: true, displayName: true },
    });
    if (!target) throw new ValidationError('That member cannot take ownership (missing or deactivated).');

    const updated = await tx.applicant.update({
      where: { id: applicant.id },
      data: { ownerMemberId: target.id, version: { increment: 1 } },
    });
    // Open work follows the case, so nothing is left owned by the old owner.
    await tx.task.updateMany({
      where: {
        organizationId,
        applicantId: applicant.id,
        status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] },
      },
      data: { ownerMemberId: target.id },
    });

    await auditSecurity(tx, ctx, {
      action: 'case.reassigned',
      subjectType: 'applicant',
      subjectId: applicant.id,
      applicantId: applicant.id,
      metadata: { from: applicant.ownerMemberId, to: target.id, reason: input.reason },
    });
    await ensureNextStep(tx, ctx, applicant.id);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Manual record editing and notes
// ---------------------------------------------------------------------------

export const updateCaseInput = z.object({
  applicantId: z.string().min(1),
  displayName: z.string().min(1).max(160).optional(),
  preferredName: z.string().max(160).nullable().optional(),
  generalLocation: z.string().max(160).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  timezoneConfirmed: z.boolean().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export async function updateCase(ctx: ActorContext, input: z.infer<typeof updateCaseInput>) {
  await requireCase(ctx, input.applicantId, 'act');
  const organizationId = organizationIdOf(ctx);
  return prisma.$transaction(async (tx) => {
    const applicant = await tx.applicant.findFirst({ where: { id: input.applicantId, organizationId } });
    if (!applicant) throw new ValidationError('That case does not exist.');
    if (input.expectedVersion !== undefined && applicant.version !== input.expectedVersion) {
      throw new ConflictError('Someone else changed this case. Reload and try again.');
    }
    const data: Prisma.ApplicantUpdateInput = { version: { increment: 1 } };
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.preferredName !== undefined) data.preferredName = input.preferredName;
    if (input.generalLocation !== undefined) data.generalLocation = input.generalLocation;
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.timezoneConfirmed !== undefined) data.timezoneConfirmed = input.timezoneConfirmed;

    const updated = await tx.applicant.update({ where: { id: applicant.id }, data });
    await auditOperational(tx, ctx, {
      action: 'case.updated',
      subjectType: 'applicant',
      subjectId: applicant.id,
      applicantId: applicant.id,
      // Field NAMES only. The values are the applicant's, not the log's.
      metadata: { fields: Object.keys(data).filter((k) => k !== 'version') },
    });
    return updated;
  });
}

export async function addContactPoint(
  ctx: ActorContext,
  input: { applicantId: string; channel: ContactChannel; value: string; label?: string },
) {
  await requireCase(ctx, input.applicantId, 'act');
  const organizationId = organizationIdOf(ctx);
  const normalized =
    input.channel === ContactChannel.EMAIL ? normalizeEmail(input.value) : normalizePhone(input.value);
  if (!normalized) {
    throw new ValidationError('That contact value is not valid.', {
      value: [input.channel === ContactChannel.EMAIL ? 'Enter an email address.' : 'Enter a phone number.'],
    });
  }
  return prisma.$transaction(async (tx) => {
    const created = await tx.contactPoint.upsert({
      where: {
        organizationId_applicantId_channel_value: {
          organizationId,
          applicantId: input.applicantId,
          channel: input.channel,
          value: normalized,
        },
      },
      create: {
        organizationId,
        applicantId: input.applicantId,
        channel: input.channel,
        value: normalized,
        label: input.label ?? null,
      },
      update: { label: input.label ?? null },
    });
    await auditOperational(tx, ctx, {
      action: 'case.contact_point_added',
      subjectType: 'contact_point',
      subjectId: created.id,
      applicantId: input.applicantId,
      metadata: { channel: input.channel, value: maskContact(normalized) },
    });
    await enqueue(
      tx,
      JOB.detectDuplicates,
      { organizationId, applicantId: input.applicantId },
      { idempotencyKey: `duplicates:${input.applicantId}:${created.id}` },
    );
    return created;
  });
}

export async function addNote(
  ctx: ActorContext,
  input: { applicantId: string; body: string; sensitive?: boolean },
) {
  const staff = requireStaff(ctx);
  await requireCase(ctx, input.applicantId, 'act');
  const organizationId = staff.member.organizationId;
  if (input.body.trim().length < 1) throw new ValidationError('A note needs some text.');

  return prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        organizationId,
        applicantId: input.applicantId,
        authorMemberId: staff.member.id,
        private: true,
        sensitive: input.sensitive ?? false,
      },
    });
    await tx.noteRevision.create({
      data: {
        organizationId,
        noteId: note.id,
        revision: 1,
        body: input.body,
        authorMemberId: staff.member.id,
      },
    });
    await auditOperational(tx, ctx, {
      action: 'note.created',
      subjectType: 'note',
      subjectId: note.id,
      applicantId: input.applicantId,
      metadata: { sensitive: input.sensitive ?? false, length: input.body.length },
    });
    return note;
  });
}

export async function editNote(ctx: ActorContext, input: { noteId: string; body: string }) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.findFirst({
      where: { id: input.noteId, organizationId },
      include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
    });
    if (!note) throw new ValidationError('That note does not exist.');
    await requireCase(ctx, note.applicantId, 'act');
    const nextRevision = (note.revisions[0]?.revision ?? 0) + 1;
    // Revisions are immutable and additive, so a brief citation keeps pointing
    // at the exact text it read.
    const revision = await tx.noteRevision.create({
      data: {
        organizationId,
        noteId: note.id,
        revision: nextRevision,
        body: input.body,
        authorMemberId: staff.member.id,
      },
    });
    await auditOperational(tx, ctx, {
      action: 'note.revised',
      subjectType: 'note',
      subjectId: note.id,
      applicantId: note.applicantId,
      metadata: { revision: nextRevision },
    });
    return revision;
  });
}

export async function listActiveCasesForOwner(organizationId: string, memberId: string) {
  return prisma.applicant.count({
    where: {
      organizationId,
      ownerMemberId: memberId,
      mergedIntoApplicantId: null,
      status: { in: [...ACTIVE_CASE_STATUSES] },
    },
  });
}

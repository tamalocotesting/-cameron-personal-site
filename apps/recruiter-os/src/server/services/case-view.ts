import 'server-only';
import { ReviewFlagStatus, TaskStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { requireCase, type ActorContext, type CaseAccess } from '@/server/authz/policy';
import { auditRead } from '@/server/audit';
import { getLatestBrief } from './briefs';
import { listDuplicateCandidates } from './duplicates';

/**
 * One loader for the whole case file, so opening a case is a bounded set of
 * queries rather than a render-time N+1. The Today split view and the
 * standalone applicant page both call this and render the same components.
 *
 * What it returns depends on ACCESS: a manager with metadata-only rights gets
 * the header, the owner, the status and the next action — and no transcript,
 * no intake answers, no notes, no brief text.
 */
export type CaseFileData = Awaited<ReturnType<typeof loadCaseFile>>;

export async function loadCaseFile(ctx: ActorContext, applicantId: string) {
  const { applicant, access } = await requireCase(ctx, applicantId, 'metadata');
  const organizationId = applicant.organizationId;

  const [contactPoints, permissions, tasks, flags, appointments, owner, members, episode] =
    await Promise.all([
      prisma.contactPoint.findMany({
        where: { organizationId, applicantId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.channelPermission.findMany({
        where: { organizationId, applicantId },
        orderBy: [{ channel: 'asc' }, { purpose: 'asc' }],
      }),
      prisma.task.findMany({
        where: { organizationId, applicantId },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        include: {
          owner: { select: { displayName: true } },
          snoozes: { orderBy: { createdAt: 'desc' } },
        },
      }),
      prisma.reviewFlag.findMany({
        where: { organizationId, applicantId },
        orderBy: [{ status: 'asc' }, { raisedAt: 'desc' }],
      }),
      prisma.appointment.findMany({
        where: { organizationId, applicantId },
        orderBy: { startsAt: 'desc' },
        include: { recruiter: { select: { displayName: true } }, reminders: true },
      }),
      applicant.ownerMemberId
        ? prisma.member.findFirst({
            where: { organizationId, id: applicant.ownerMemberId },
            select: { id: true, displayName: true, staffRole: true, active: true },
          })
        : null,
      prisma.member.findMany({
        where: { organizationId, active: true },
        select: { id: true, displayName: true, staffRole: true },
        orderBy: { displayName: 'asc' },
      }),
      prisma.inquiryEpisode.findFirst({
        where: { organizationId, applicantId, supersededAt: null },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

  // Content-gated sections. A caller without content access simply does not
  // get the rows, so there is nothing for the UI to accidentally render.
  const [messages, intakeSessions, notes, calls, brief, duplicates, handoffs, activity] = access.content
    ? await Promise.all([
        prisma.message.findMany({
          where: { organizationId, applicantId },
          orderBy: { occurredAt: 'asc' },
          take: 300,
          include: { deliveryEvents: { orderBy: { occurredAt: 'asc' } } },
        }),
        prisma.intakeSession.findMany({
          where: { organizationId, applicantId },
          orderBy: { createdAt: 'desc' },
          include: {
            intakeVersion: { select: { version: true, state: true } },
            answers: { where: { supersededAt: null }, orderBy: { answeredAt: 'asc' } },
          },
        }),
        prisma.note.findMany({
          where: { organizationId, applicantId },
          orderBy: { createdAt: 'desc' },
          include: { revisions: { orderBy: { revision: 'desc' } } },
        }),
        prisma.callEvent.findMany({
          where: { organizationId, applicantId },
          orderBy: { occurredAt: 'desc' },
          take: 50,
        }),
        getLatestBrief(organizationId, applicantId),
        listDuplicateCandidates(organizationId, applicantId),
        prisma.handoffExport.findMany({
          where: { organizationId, applicantId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.auditEvent.findMany({
          where: { organizationId, applicantId },
          orderBy: { occurredAt: 'desc' },
          take: 120,
        }),
      ])
    : [[], [], [], [], null, [], [], []];

  const openTasks = tasks.filter((t) => t.status === TaskStatus.OPEN || t.status === TaskStatus.SNOOZED);
  const nextTask = openTasks[0] ?? null;
  const openFlags = flags.filter((f) => f.status === ReviewFlagStatus.OPEN);

  // Reading a case's CONTENT is an auditable event, not a free action.
  if (access.content && ctx.kind === 'staff') {
    await auditRead(ctx, {
      action: 'case.content_viewed',
      subjectType: 'applicant',
      subjectId: applicant.id,
      applicantId: applicant.id,
      metadata: { basis: access.basis, sections: ['conversation', 'intake', 'notes', 'brief'] },
    });
  }

  return {
    applicant,
    access,
    owner,
    members,
    episode,
    contactPoints,
    permissions,
    tasks,
    openTasks,
    nextTask,
    flags,
    openFlags,
    appointments,
    messages,
    intakeSessions,
    notes,
    calls,
    brief,
    duplicates,
    handoffs,
    activity,
    loadedAt: now(),
  };
}

export type { CaseAccess };

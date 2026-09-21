import 'server-only';
import { CaseStatus, StaffRole, TaskStatus } from '@prisma/client';
import type { DbOrTx } from '@/server/db';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { ConflictError } from '@/server/authz/errors';

/**
 * Ownership and coverage.
 *
 * The invariant this file defends: a new inquiry NEVER lands on a recruiter
 * who is away. Routing checks absence, and falls back to the organization's
 * configured always-active fallback owner. If even that is unavailable, it
 * falls back to any active recruiter rather than leaving the case unowned —
 * an unowned active case is the one outcome that is not allowed.
 */

export async function isMemberAbsent(db: DbOrTx, organizationId: string, memberId: string, at = now()) {
  const absence = await db.absence.findFirst({
    where: { organizationId, memberId, startsAt: { lte: at }, endsAt: { gt: at } },
    select: { id: true },
  });
  return absence !== null;
}

export async function activeRecruiters(db: DbOrTx, organizationId: string) {
  return db.member.findMany({
    where: { organizationId, active: true, staffRole: { in: [StaffRole.RECRUITER, StaffRole.MANAGER] } },
    select: { id: true, displayName: true, staffRole: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Pick the accountable owner for a new inquiry.
 *
 * ROUND_ROBIN spreads across present recruiters by current open workload,
 * which is deterministic given the same data (ties break on member id).
 */
export async function routeNewInquiry(
  db: DbOrTx,
  organizationId: string,
  at = now(),
): Promise<{ memberId: string; basis: string }> {
  const settings = await db.organizationSettings.findUnique({ where: { organizationId } });
  const recruiters = await activeRecruiters(db, organizationId);
  if (!recruiters.length) {
    throw new ConflictError(
      'This organization has no active recruiter to own a new inquiry. Add or reactivate a member first.',
    );
  }

  const absentIds = new Set<string>();
  const absences = await db.absence.findMany({
    where: { organizationId, startsAt: { lte: at }, endsAt: { gt: at } },
    select: { memberId: true },
  });
  for (const a of absences) absentIds.add(a.memberId);

  const present = recruiters.filter((r) => !absentIds.has(r.id));

  const fallbackId = settings?.fallbackOwnerMemberId ?? null;
  const fallbackPresent =
    fallbackId && recruiters.some((r) => r.id === fallbackId) && !absentIds.has(fallbackId);

  if (settings?.routingStrategy === 'FALLBACK_ONLY') {
    if (fallbackPresent) return { memberId: fallbackId!, basis: 'configured fallback owner' };
  }

  if (present.length) {
    const counts = await db.applicant.groupBy({
      by: ['ownerMemberId'],
      where: {
        organizationId,
        status: { notIn: [CaseStatus.CLOSED] },
        mergedIntoApplicantId: null,
        ownerMemberId: { in: present.map((p) => p.id) },
      },
      _count: { _all: true },
    });
    const load = new Map(counts.map((c) => [c.ownerMemberId!, c._count._all]));
    // Recruiters first. A manager can carry cases, and does when there is no
    // recruiter free, but a new inquiry should not land on them while a
    // recruiter is sitting idle. Then workload, then member id — so the same
    // data always produces the same owner.
    const rank = (role: StaffRole) => (role === StaffRole.RECRUITER ? 0 : 1);
    const chosen = [...present].sort((a, b) => {
      if (rank(a.staffRole) !== rank(b.staffRole)) return rank(a.staffRole) - rank(b.staffRole);
      const la = load.get(a.id) ?? 0;
      const lb = load.get(b.id) ?? 0;
      if (la !== lb) return la - lb;
      return a.id < b.id ? -1 : 1;
    })[0]!;
    return {
      memberId: chosen.id,
      basis:
        chosen.staffRole === StaffRole.RECRUITER
          ? 'round-robin by open workload'
          : 'round-robin by open workload (no recruiter available)',
    };
  }

  // Everyone routable is away. The fallback owner takes it even if marked
  // absent, because a new inquiry cannot be left unowned.
  if (fallbackId && recruiters.some((r) => r.id === fallbackId)) {
    return { memberId: fallbackId, basis: 'fallback owner (all recruiters absent)' };
  }
  return { memberId: recruiters[0]!.id, basis: 'first active member (all recruiters absent, no fallback set)' };
}

/**
 * Deactivation guard. A member with active owned cases or open tasks cannot be
 * deactivated: the work would silently stop being anybody's.
 */
export async function assertDeactivatable(organizationId: string, memberId: string) {
  const [cases, tasks, appointments] = await Promise.all([
    prisma.applicant.count({
      where: {
        organizationId,
        ownerMemberId: memberId,
        mergedIntoApplicantId: null,
        status: { not: CaseStatus.CLOSED },
      },
    }),
    prisma.task.count({
      where: { organizationId, ownerMemberId: memberId, status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] } },
    }),
    prisma.appointment.count({
      where: {
        organizationId,
        recruiterMemberId: memberId,
        state: { in: ['PROPOSED', 'SCHEDULED', 'CONFIRMED'] },
      },
    }),
  ]);
  if (cases || tasks || appointments) {
    throw new ConflictError(
      `Reassign this member's work first: ${cases} active case(s), ${tasks} open task(s), ${appointments} upcoming appointment(s).`,
    );
  }
}

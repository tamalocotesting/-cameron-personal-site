import 'server-only';
import { GrantType, StaffRole, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import {
  canViewTeamReports,
  requireOrganizationAdmin,
  requireStaff,
  type ActorContext,
} from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { assertDeactivatable } from './ownership';

/**
 * Team management: membership, teams, coverage, absence, grants.
 *
 * Coverage ALWAYS expires — the database enforces it. Deactivating a member
 * with live work is refused, because the alternative is work that silently
 * belongs to nobody.
 */

export const coverageInput = z.object({
  fromMemberId: z.string().min(1),
  toMemberId: z.string().min(1),
  applicantId: z.string().min(1).nullable().default(null),
  startsAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  reason: z.string().min(3).max(300),
});

export async function grantCoverage(ctx: ActorContext, input: z.infer<typeof coverageInput>) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  if (staff.member.staffRole === StaffRole.RECRUITER && input.fromMemberId !== staff.member.id) {
    throw new ConflictError('A recruiter can only hand their own cases to someone else.');
  }
  if (input.expiresAt.getTime() <= input.startsAt.getTime()) {
    throw new ValidationError('Coverage has to end after it starts.', {
      expiresAt: ['Coverage always expires; pick an end date.'],
    });
  }
  if (input.fromMemberId === input.toMemberId) {
    throw new ValidationError('Pick a different member to cover.');
  }

  return prisma.$transaction(async (tx) => {
    for (const memberId of [input.fromMemberId, input.toMemberId]) {
      const member = await tx.member.findFirst({ where: { organizationId, id: memberId, active: true } });
      if (!member) throw new ValidationError('That member is missing or deactivated.');
    }
    const coverage = await tx.coverage.create({
      data: {
        organizationId,
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        applicantId: input.applicantId,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        reason: input.reason,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'coverage.granted',
      subjectType: 'coverage',
      subjectId: coverage.id,
      applicantId: input.applicantId,
      metadata: {
        from: input.fromMemberId,
        to: input.toMemberId,
        expiresAt: input.expiresAt.toISOString(),
        reason: input.reason,
      },
    });
    return coverage;
  });
}

export async function revokeCoverage(ctx: ActorContext, input: { coverageId: string; reason: string }) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const coverage = await tx.coverage.findFirst({ where: { id: input.coverageId, organizationId } });
    if (!coverage) throw new NotFoundError('Coverage');
    if (
      staff.member.staffRole === StaffRole.RECRUITER &&
      coverage.fromMemberId !== staff.member.id &&
      coverage.toMemberId !== staff.member.id
    ) {
      throw new ConflictError('You cannot revoke someone else’s coverage.');
    }
    const updated = await tx.coverage.update({
      where: { id: coverage.id },
      // Revocation takes effect immediately: the policy layer reads revokedAt
      // on every request, so old links and live sessions stop working now.
      data: { revokedAt: now() },
    });
    await auditSecurity(tx, ctx, {
      action: 'coverage.revoked',
      subjectType: 'coverage',
      subjectId: coverage.id,
      metadata: { reason: input.reason },
    });
    return updated;
  });
}

export const grantInput = z.object({
  subjectMemberId: z.string().min(1),
  grant: z.nativeEnum(GrantType),
  applicantId: z.string().min(1).nullable().default(null),
  teamId: z.string().min(1).nullable().default(null),
  reason: z.string().min(3).max(300),
  expiresAt: z.coerce.date().nullable().default(null),
});

export async function issueGrant(ctx: ActorContext, input: z.infer<typeof grantInput>) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const subject = await tx.member.findFirst({
      where: { organizationId, id: input.subjectMemberId, active: true },
    });
    if (!subject) throw new ValidationError('That member is missing or deactivated.');

    const grant = await tx.permissionGrant.create({
      data: {
        organizationId,
        subjectMemberId: input.subjectMemberId,
        grant: input.grant,
        applicantId: input.applicantId,
        teamId: input.teamId,
        grantedByMemberId: staff.member.id,
        reason: input.reason,
        // The application clock owns this, not the database clock: otherwise a
        // frozen demo clock or a test clock disagrees with `startsAt` and the
        // grant silently looks inactive.
        startsAt: now(),
        expiresAt: input.expiresAt,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'grant.issued',
      subjectType: 'permission_grant',
      subjectId: grant.id,
      applicantId: input.applicantId,
      metadata: {
        grant: input.grant,
        subject: input.subjectMemberId,
        scope: input.applicantId ? 'case' : input.teamId ? 'team' : 'organization',
        reason: input.reason,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      },
    });
    return grant;
  });
}

export async function revokeGrant(ctx: ActorContext, input: { grantId: string; reason: string }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const grant = await tx.permissionGrant.findFirst({ where: { id: input.grantId, organizationId } });
    if (!grant) throw new NotFoundError('Grant');
    const updated = await tx.permissionGrant.update({
      where: { id: grant.id },
      data: { revokedAt: now() },
    });
    await auditSecurity(tx, ctx, {
      action: 'grant.revoked',
      subjectType: 'permission_grant',
      subjectId: grant.id,
      metadata: { grant: grant.grant, reason: input.reason },
    });
    return updated;
  });
}

export async function setMemberActive(
  ctx: ActorContext,
  input: { memberId: string; active: boolean; reason: string },
) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;

  if (!input.active) {
    // Refuses rather than orphaning work.
    await assertDeactivatable(organizationId, input.memberId);
  }

  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findFirst({ where: { organizationId, id: input.memberId } });
    if (!member) throw new NotFoundError('Member');
    const updated = await tx.member.update({
      where: { id: member.id },
      data: { active: input.active, deactivatedAt: input.active ? null : now() },
    });
    if (!input.active) {
      // Deactivation also ends every coverage they were given.
      await tx.coverage.updateMany({
        where: { organizationId, toMemberId: member.id, revokedAt: null },
        data: { revokedAt: now() },
      });
      await tx.permissionGrant.updateMany({
        where: { organizationId, subjectMemberId: member.id, revokedAt: null },
        data: { revokedAt: now() },
      });
    }
    await auditSecurity(tx, ctx, {
      action: input.active ? 'member.reactivated' : 'member.deactivated',
      subjectType: 'member',
      subjectId: member.id,
      metadata: { reason: input.reason },
    });
    return updated;
  });
}

export async function recordAbsence(
  ctx: ActorContext,
  input: { memberId: string; startsAt: Date; endsAt: Date; note?: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  if (
    staff.member.staffRole === StaffRole.RECRUITER &&
    input.memberId !== staff.member.id
  ) {
    throw new ConflictError('You can only record your own absence.');
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new ValidationError('Absence has to end after it starts.');
  }
  return prisma.$transaction(async (tx) => {
    const absence = await tx.absence.create({
      data: {
        organizationId,
        memberId: input.memberId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note ?? null,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'absence.recorded',
      subjectType: 'absence',
      subjectId: absence.id,
      metadata: { memberId: input.memberId, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() },
    });
    return absence;
  });
}

export async function setFallbackOwner(ctx: ActorContext, input: { memberId: string }) {
  const staff = requireOrganizationAdmin(ctx);
  const organizationId = staff.member.organizationId;
  const member = await prisma.member.findFirst({
    where: { organizationId, id: input.memberId, active: true },
  });
  if (!member) throw new ValidationError('The fallback owner has to be an active member.');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.organizationSettings.update({
      where: { organizationId },
      data: { fallbackOwnerMemberId: input.memberId, version: { increment: 1 } },
    });
    await auditSecurity(tx, ctx, {
      action: 'settings.fallback_owner_set',
      subjectType: 'organization_settings',
      subjectId: updated.id,
      metadata: { memberId: input.memberId },
    });
    return updated;
  });
}

/**
 * Workload view for a manager. Operational metadata only: counts, overdue
 * work, ages. No conversation content, which is exactly what the MANAGER role
 * is and is not allowed to see.
 */
export async function loadTeamWorkload(ctx: ActorContext) {
  const staff = requireStaff(ctx);
  if (!(await canViewTeamReports(ctx))) {
    throw new ConflictError('Viewing team workload needs the team-reports grant or a manager role.');
  }
  const organizationId = staff.member.organizationId;
  const at = now();

  const members = await prisma.member.findMany({
    where: { organizationId, active: true },
    select: { id: true, displayName: true, staffRole: true },
    orderBy: { displayName: 'asc' },
  });

  const [caseCounts, openTasks, overdueTasks, absences, coverages] = await Promise.all([
    prisma.applicant.groupBy({
      by: ['ownerMemberId'],
      where: { organizationId, mergedIntoApplicantId: null, status: { not: 'CLOSED' } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['ownerMemberId'],
      where: { organizationId, status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['ownerMemberId'],
      where: {
        organizationId,
        status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] },
        originalDueAt: { lt: at },
      },
      _count: { _all: true },
    }),
    prisma.absence.findMany({
      where: { organizationId, endsAt: { gt: at } },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.coverage.findMany({
      where: { organizationId, revokedAt: null, expiresAt: { gt: at } },
      include: {
        fromMember: { select: { displayName: true } },
        toMember: { select: { displayName: true } },
      },
      orderBy: { expiresAt: 'asc' },
    }),
  ]);

  const byOwner = (rows: Array<{ ownerMemberId: string | null; _count: { _all: number } }>) =>
    new Map(rows.map((r) => [r.ownerMemberId ?? '', r._count._all]));

  const cases = byOwner(caseCounts);
  const open = byOwner(openTasks);
  const overdue = byOwner(overdueTasks);

  return {
    generatedAt: at,
    members: members.map((m) => ({
      ...m,
      activeCases: cases.get(m.id) ?? 0,
      openTasks: open.get(m.id) ?? 0,
      overdueTasks: overdue.get(m.id) ?? 0,
      absent: absences.some((a) => a.memberId === m.id && a.startsAt <= at && a.endsAt > at),
    })),
    absences,
    coverages,
  };
}

export async function listMembers(organizationId: string) {
  return prisma.member.findMany({
    where: { organizationId },
    include: { user: { select: { email: true, name: true, twoFactorEnabled: true } } },
    orderBy: [{ active: 'desc' }, { displayName: 'asc' }],
  });
}

export async function listGrants(organizationId: string) {
  return prisma.permissionGrant.findMany({
    where: { organizationId, revokedAt: null },
    include: { subject: { select: { displayName: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listTeams(organizationId: string) {
  return prisma.team.findMany({
    where: { organizationId },
    include: {
      manager: { select: { displayName: true } },
      members: { include: { member: { select: { displayName: true, staffRole: true } } } },
    },
    orderBy: { name: 'asc' },
  });
}

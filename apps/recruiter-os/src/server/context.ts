import 'server-only';
import { headers } from 'next/headers';
import type { Prisma } from '@prisma/client';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { UnauthenticatedError, ForbiddenError } from '@/server/authz/errors';
import { authorizedOwnerScope, type StaffContext } from '@/server/authz/policy';

/**
 * Resolves the signed-in staff member for the current request.
 *
 * Two things this function is responsible for:
 *   * A revoked session or deactivated membership stops working immediately —
 *     including through an old link, because every request re-reads the row.
 *   * The organization comes from the SESSION, never from anything the client
 *     submitted.
 */
export async function getStaffContext(): Promise<StaffContext | null> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user || !session.session) return null;

  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  const member = await prisma.member.findFirst({
    where: {
      userId: session.user.id,
      ...(activeOrganizationId ? { organizationId: activeOrganizationId } : {}),
    },
    include: {
      organization: { select: { id: true, name: true, slug: true, dataScope: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!member) return null;
  // Deactivated membership: no access, immediately, even with a live cookie.
  if (!member.active) return null;

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: member.organizationId },
    select: { defaultTimezone: true },
  });

  return {
    kind: 'staff',
    identity: {
      userId: session.user.id,
      sessionId: session.session.id,
      email: session.user.email,
      name: session.user.name,
    },
    member: {
      id: member.id,
      organizationId: member.organizationId,
      staffRole: member.staffRole,
      displayName: member.displayName || session.user.name,
      active: member.active,
    },
    organization: member.organization,
    timezone: settings?.defaultTimezone ?? 'America/Chicago',
    cache: {},
  };
}

export async function requireStaffContext(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

/**
 * The Prisma `where` fragment that limits a case list, search, count or export
 * to what this member may see. Every list query composes this; nothing
 * filters in application memory.
 */
export async function applicantScopeWhere(ctx: StaffContext): Promise<Prisma.ApplicantWhereInput> {
  const scope = await authorizedOwnerScope(ctx);
  if (scope.wholeOrganization) {
    return { organizationId: ctx.member.organizationId };
  }
  const or: Prisma.ApplicantWhereInput[] = [{ ownerMemberId: { in: scope.ownerMemberIds } }];
  if (scope.teamIds.length) or.push({ teamId: { in: scope.teamIds } });
  if (scope.applicantIds.length) or.push({ id: { in: scope.applicantIds } });
  return { organizationId: ctx.member.organizationId, OR: or };
}

export function requireActiveMember(ctx: StaffContext) {
  if (!ctx.member.active) throw new ForbiddenError('This membership has been deactivated.');
  return ctx;
}

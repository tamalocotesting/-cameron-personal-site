import 'server-only';
import { GrantType, StaffRole, type Applicant, type Member, type Organization } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { ForbiddenError, NotFoundError } from './errors';

/**
 * ONE authorization layer, used by pages, queries, mutations, exports and
 * worker jobs. Hiding a nav item is not authorization; every read and write
 * goes through here.
 *
 * The permission matrix (see PERMISSIONS.md):
 *
 *   RECRUITER  — full access to cases they own, plus cases covered by an
 *                active, unexpired coverage grant. Nothing else.
 *   MANAGER    — operational metadata and reports for their authorized teams,
 *                plus assignment/reassignment. Conversation CONTENT requires a
 *                separate grant (CASE_CONTENT or TEAM_CONVERSATION_CONTENT).
 *   ORG_ADMIN  — members, settings, integrations, audit. This role ALONE does
 *                not read conversation content; it must grant itself
 *                CASE_CONTENT explicitly, which is audited.
 *
 * Everything above a role's floor is an explicit, revocable grant.
 */

export type StaffIdentity = {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
};

export type StaffContext = {
  kind: 'staff';
  identity: StaffIdentity;
  member: Pick<Member, 'id' | 'organizationId' | 'staffRole' | 'displayName' | 'active'>;
  organization: Pick<Organization, 'id' | 'name' | 'slug' | 'dataScope'>;
  timezone: string;
  /** Per-request caches, so a page render does not re-query grants per row. */
  cache: {
    grants?: LoadedGrant[];
    coverage?: LoadedCoverage[];
    teamIds?: string[];
  };
};

/**
 * Background work. A job never inherits a human's authority: it gets exactly
 * the case it was enqueued for, and it re-checks current state when it runs.
 */
export type SystemContext = {
  kind: 'system';
  organizationId: string;
  jobName: string;
};

export type ActorContext = StaffContext | SystemContext;

type LoadedGrant = {
  grant: GrantType;
  applicantId: string | null;
  teamId: string | null;
};

type LoadedCoverage = {
  fromMemberId: string;
  applicantId: string | null;
};

export function isStaff(ctx: ActorContext): ctx is StaffContext {
  return ctx.kind === 'staff';
}

export function requireStaff(ctx: ActorContext): StaffContext {
  if (!isStaff(ctx)) throw new ForbiddenError('This action requires a signed-in staff member.');
  return ctx;
}

// ---------------------------------------------------------------------------
// Grant / coverage loading
// ---------------------------------------------------------------------------

export async function loadGrants(ctx: StaffContext): Promise<LoadedGrant[]> {
  if (ctx.cache.grants) return ctx.cache.grants;
  const at = now();
  const rows = await prisma.permissionGrant.findMany({
    where: {
      organizationId: ctx.member.organizationId,
      subjectMemberId: ctx.member.id,
      revokedAt: null,
      startsAt: { lte: at },
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
    select: { grant: true, applicantId: true, teamId: true },
  });
  ctx.cache.grants = rows;
  return rows;
}

export async function loadCoverage(ctx: StaffContext): Promise<LoadedCoverage[]> {
  if (ctx.cache.coverage) return ctx.cache.coverage;
  const at = now();
  const rows = await prisma.coverage.findMany({
    where: {
      organizationId: ctx.member.organizationId,
      toMemberId: ctx.member.id,
      revokedAt: null,
      startsAt: { lte: at },
      expiresAt: { gt: at },
    },
    select: { fromMemberId: true, applicantId: true },
  });
  ctx.cache.coverage = rows;
  return rows;
}

export async function loadTeamIds(ctx: StaffContext): Promise<string[]> {
  if (ctx.cache.teamIds) return ctx.cache.teamIds;
  const [memberships, managed] = await Promise.all([
    prisma.teamMember.findMany({
      where: { organizationId: ctx.member.organizationId, memberId: ctx.member.id },
      select: { teamId: true },
    }),
    prisma.team.findMany({
      where: { organizationId: ctx.member.organizationId, managerMemberId: ctx.member.id },
      select: { id: true },
    }),
  ]);
  const ids = [...new Set([...memberships.map((m) => m.teamId), ...managed.map((t) => t.id)])];
  ctx.cache.teamIds = ids;
  return ids;
}

/** Members whose cases this member may see the operational metadata of. */
export async function authorizedOwnerScope(ctx: StaffContext): Promise<{
  ownerMemberIds: string[];
  teamIds: string[];
  applicantIds: string[];
  wholeOrganization: boolean;
}> {
  const [grants, coverage, teamIds] = await Promise.all([
    loadGrants(ctx),
    loadCoverage(ctx),
    loadTeamIds(ctx),
  ]);

  const ownerMemberIds = new Set<string>([ctx.member.id]);
  for (const c of coverage) if (!c.applicantId) ownerMemberIds.add(c.fromMemberId);

  const applicantIds = new Set<string>();
  for (const c of coverage) if (c.applicantId) applicantIds.add(c.applicantId);
  for (const g of grants) if (g.applicantId) applicantIds.add(g.applicantId);

  const scopedTeams = new Set<string>();
  // A manager sees their own teams' operational metadata by role.
  if (ctx.member.staffRole === StaffRole.MANAGER) for (const id of teamIds) scopedTeams.add(id);
  for (const g of grants) {
    if (g.teamId && (g.grant === GrantType.TEAM_REPORTS || g.grant === GrantType.TEAM_CONVERSATION_CONTENT)) {
      scopedTeams.add(g.teamId);
    }
  }

  // An org-wide CASE_CONTENT grant is the only thing that widens this to the
  // whole organization — and it is an explicit, audited grant, never a role.
  const wholeOrganization = grants.some((g) => g.grant === GrantType.CASE_CONTENT && !g.applicantId && !g.teamId);

  return {
    ownerMemberIds: [...ownerMemberIds],
    teamIds: [...scopedTeams],
    applicantIds: [...applicantIds],
    wholeOrganization,
  };
}

// ---------------------------------------------------------------------------
// Case-level access
// ---------------------------------------------------------------------------

export type CaseAccess = {
  /** Operational metadata: name, owner, status, next action, due times. */
  metadata: boolean;
  /** Conversation, intake answers, notes, brief text, source excerpts. */
  content: boolean;
  /** Sensitive original free text and material derived from it. */
  sensitive: boolean;
  /** Write actions on the case. */
  act: boolean;
  /** Change ownership. */
  reassign: boolean;
  /** Human-readable basis, shown in the UI and written to the audit trail. */
  basis: string;
};

const NO_ACCESS: CaseAccess = {
  metadata: false,
  content: false,
  sensitive: false,
  act: false,
  reassign: false,
  basis: 'no applicable grant',
};

export type CaseSubject = Pick<Applicant, 'id' | 'organizationId' | 'ownerMemberId' | 'teamId'>;

export async function caseAccess(ctx: ActorContext, subject: CaseSubject): Promise<CaseAccess> {
  if (ctx.kind === 'system') {
    // A job acts only inside the organization it was enqueued for, and only
    // as far as the specific job needs. It never gets sensitive text.
    if (subject.organizationId !== ctx.organizationId) return NO_ACCESS;
    return {
      metadata: true,
      content: true,
      sensitive: false,
      act: true,
      reassign: false,
      basis: `background job ${ctx.jobName}`,
    };
  }

  if (subject.organizationId !== ctx.member.organizationId) return NO_ACCESS;
  if (!ctx.member.active) return { ...NO_ACCESS, basis: 'membership is deactivated' };

  const [grants, coverage, teamIds] = await Promise.all([
    loadGrants(ctx),
    loadCoverage(ctx),
    loadTeamIds(ctx),
  ]);

  const isOwner = subject.ownerMemberId === ctx.member.id;
  const coveringWhole = coverage.some(
    (c) => !c.applicantId && subject.ownerMemberId === c.fromMemberId,
  );
  const coveringCase = coverage.some((c) => c.applicantId === subject.id);

  const hasGrant = (grant: GrantType) =>
    grants.some(
      (g) =>
        g.grant === grant &&
        (g.applicantId === null || g.applicantId === subject.id) &&
        (g.teamId === null || (subject.teamId !== null && g.teamId === subject.teamId)),
    );

  const caseContentGrant = hasGrant(GrantType.CASE_CONTENT);
  const teamContentGrant =
    subject.teamId !== null &&
    grants.some(
      (g) => g.grant === GrantType.TEAM_CONVERSATION_CONTENT && (g.teamId === null || g.teamId === subject.teamId),
    );

  // Manager role: operational metadata for their teams, by role. Not content.
  const managerMetadata =
    ctx.member.staffRole === StaffRole.MANAGER &&
    subject.teamId !== null &&
    teamIds.includes(subject.teamId);
  const teamReportsGrant =
    subject.teamId !== null &&
    grants.some((g) => g.grant === GrantType.TEAM_REPORTS && (g.teamId === null || g.teamId === subject.teamId));

  const metadata =
    isOwner || coveringWhole || coveringCase || caseContentGrant || teamContentGrant || managerMetadata || teamReportsGrant;
  if (!metadata) return NO_ACCESS;

  const content = isOwner || coveringWhole || coveringCase || caseContentGrant || teamContentGrant;
  const sensitive = content && hasGrant(GrantType.SENSITIVE_SOURCE);
  const act = isOwner || coveringWhole || coveringCase || caseContentGrant;
  const reassign =
    hasGrant(GrantType.REASSIGNMENT) ||
    (ctx.member.staffRole === StaffRole.MANAGER && managerMetadata) ||
    ctx.member.staffRole === StaffRole.ORG_ADMIN;

  const basis = isOwner
    ? 'case owner'
    : coveringWhole || coveringCase
      ? 'active coverage grant'
      : caseContentGrant
        ? 'CASE_CONTENT grant'
        : teamContentGrant
          ? 'TEAM_CONVERSATION_CONTENT grant'
          : managerMetadata
            ? 'manager of the owning team (metadata only)'
            : 'TEAM_REPORTS grant (metadata only)';

  return { metadata, content, sensitive, act, reassign, basis };
}

/**
 * Load a case and its access in one step. An unauthorized case is reported as
 * not found: a caller with no access must not learn that the row exists.
 */
export async function requireCase(
  ctx: ActorContext,
  applicantId: string,
  need: 'metadata' | 'content' | 'act' | 'sensitive' = 'metadata',
) {
  const organizationId = ctx.kind === 'staff' ? ctx.member.organizationId : ctx.organizationId;
  const applicant = await prisma.applicant.findFirst({
    where: { id: applicantId, organizationId },
  });
  if (!applicant) throw new NotFoundError('Case');

  const access = await caseAccess(ctx, applicant);
  if (!access.metadata) throw new NotFoundError('Case');

  if (need === 'content' && !access.content) {
    throw new ForbiddenError(
      'You can see this case in team reporting, but reading its conversation needs a case-content grant.',
      GrantType.CASE_CONTENT,
    );
  }
  if (need === 'act' && !access.act) {
    throw new ForbiddenError(
      'You do not have permission to act on this case. Ask for coverage or a case-content grant.',
      GrantType.CASE_CONTENT,
    );
  }
  if (need === 'sensitive' && !access.sensitive) {
    throw new ForbiddenError(
      'This material is restricted. Reading it needs a sensitive-source grant.',
      GrantType.SENSITIVE_SOURCE,
    );
  }

  return { applicant, access };
}

// ---------------------------------------------------------------------------
// Organization-level capabilities
// ---------------------------------------------------------------------------

export function canManageOrganization(ctx: ActorContext): boolean {
  return isStaff(ctx) && ctx.member.active && ctx.member.staffRole === StaffRole.ORG_ADMIN;
}

export function requireOrganizationAdmin(ctx: ActorContext): StaffContext {
  const staff = requireStaff(ctx);
  if (!canManageOrganization(staff)) {
    throw new ForbiddenError('Only an organization administrator can change this.');
  }
  return staff;
}

export async function hasOrgGrant(ctx: StaffContext, grant: GrantType): Promise<boolean> {
  const grants = await loadGrants(ctx);
  return grants.some((g) => g.grant === grant);
}

export async function requireGrant(ctx: ActorContext, grant: GrantType, message: string) {
  const staff = requireStaff(ctx);
  if (!(await hasOrgGrant(staff, grant))) throw new ForbiddenError(message, grant);
  return staff;
}

export async function canExport(ctx: ActorContext): Promise<boolean> {
  if (!isStaff(ctx)) return false;
  return hasOrgGrant(ctx, GrantType.EXPORT);
}

export async function canViewTeamReports(ctx: ActorContext): Promise<boolean> {
  if (!isStaff(ctx)) return false;
  if (ctx.member.staffRole === StaffRole.MANAGER) return true;
  return hasOrgGrant(ctx, GrantType.TEAM_REPORTS);
}

export async function canEnterBaselines(ctx: ActorContext): Promise<boolean> {
  if (!isStaff(ctx)) return false;
  return hasOrgGrant(ctx, GrantType.BASELINE_ENTRY);
}

export async function canRunRetention(ctx: ActorContext): Promise<boolean> {
  if (!isStaff(ctx)) return false;
  return hasOrgGrant(ctx, GrantType.RETENTION_ADMIN);
}

export async function canReassignAny(ctx: ActorContext): Promise<boolean> {
  if (!isStaff(ctx)) return false;
  if (ctx.member.staffRole === StaffRole.ORG_ADMIN || ctx.member.staffRole === StaffRole.MANAGER) return true;
  return hasOrgGrant(ctx, GrantType.REASSIGNMENT);
}

export function organizationIdOf(ctx: ActorContext): string {
  return ctx.kind === 'staff' ? ctx.member.organizationId : ctx.organizationId;
}

export function actorLabel(ctx: ActorContext): string {
  return ctx.kind === 'staff' ? ctx.member.displayName || ctx.identity.email : `system:${ctx.jobName}`;
}

export function systemContext(organizationId: string, jobName: string): SystemContext {
  return { kind: 'system', organizationId, jobName };
}

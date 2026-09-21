import { beforeEach, describe, expect, it } from 'vitest';
import { GrantType, StaffRole } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import { caseAccess, requireCase, systemContext } from '@/server/authz/policy';
import { applicantScopeWhere } from '@/server/context';
import { createCase, addNote, resolveReviewFlag } from '@/server/services/cases';
import { loadQueue } from '@/server/services/queue';
import { loadCaseFile } from '@/server/services/case-view';
import { exportReportCsv, buildReport } from '@/server/services/reports';
import { grantCoverage, revokeCoverage } from '@/server/services/team';
import { prepareHandoff, exportHandoff } from '@/server/services/handoff';
import { NotFoundError, ForbiddenError } from '@/server/authz/errors';
import { createMember, createWorkspace, grantPermission, staffContext, type Workspace } from '../setup/factories';

/**
 * Acceptance 12.
 *
 * The permission matrix, exercised through the same functions pages and
 * mutations use. An unauthorized read is reported as NOT FOUND, so a caller
 * cannot use the error to learn that a case exists.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');

let central: Workspace;
let northside: Workspace;
let centralCaseId: string;
let northsideCaseId: string;

beforeEach(async () => {
  __setClock(CLOCK);
  central = await createWorkspace({ slug: 'central-test' });
  northside = await createWorkspace({ slug: 'northside-test' });

  const a = await prisma.$transaction((tx) =>
    createCase(tx, central.recruiterCtx, {
      organizationId: central.organization.id,
      displayName: 'Central Applicant',
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: '+15125550801' }],
      ownerMemberId: central.recruiter.member.id,
    }),
  );
  centralCaseId = a.applicant.id;
  await prisma.applicant.update({ where: { id: centralCaseId }, data: { teamId: central.team.id } });

  const b = await prisma.$transaction((tx) =>
    createCase(tx, northside.recruiterCtx, {
      organizationId: northside.organization.id,
      displayName: 'Northside Applicant',
      originKind: 'web_intake',
      // Deliberately the SAME phone number as the Central case.
      contactPoints: [{ channel: 'SMS', value: '+15125550801' }],
      ownerMemberId: northside.recruiter.member.id,
    }),
  );
  northsideCaseId = b.applicant.id;
});

describe('12. organization isolation', () => {
  it('reports another organization’s case as not found, not forbidden', async () => {
    await expect(loadCaseFile(central.recruiterCtx, northsideCaseId)).rejects.toThrow(NotFoundError);
    await expect(requireCase(northside.recruiterCtx, centralCaseId)).rejects.toThrow(NotFoundError);
  });

  it('keeps a shared phone number from crossing the boundary', async () => {
    const centralHolders = await prisma.contactPoint.findMany({
      where: { organizationId: central.organization.id, value: '+15125550801' },
    });
    expect(centralHolders.map((c) => c.applicantId)).toEqual([centralCaseId]);

    const duplicates = await prisma.duplicateCandidate.findMany({});
    // No candidate can span organizations: the compound key makes it
    // unrepresentable, and detection is per organization.
    for (const candidate of duplicates) {
      const both = await prisma.applicant.findMany({
        where: { id: { in: [candidate.applicantAId, candidate.applicantBId] } },
        select: { organizationId: true },
      });
      expect(new Set(both.map((b) => b.organizationId)).size).toBe(1);
    }
  });

  it('keeps lists, searches and counts inside the organization', async () => {
    const scope = await applicantScopeWhere(central.recruiterCtx);
    const visible = await prisma.applicant.findMany({ where: scope, select: { id: true } });
    expect(visible.map((v) => v.id)).toEqual([centralCaseId]);

    const queue = await loadQueue(central.recruiterCtx, { filter: 'my_queue' });
    expect(queue.rows.map((r) => r.applicantId)).toEqual([centralCaseId]);
    expect(queue.total).toBe(1);
  });

  it('refuses a cross-organization reference at the database level', async () => {
    await expect(
      prisma.task.create({
        data: {
          organizationId: central.organization.id,
          // A case that belongs to the OTHER organization.
          applicantId: northsideCaseId,
          type: 'FOLLOW_UP',
          title: 'Should be impossible',
          reason: 'test',
          ownerMemberId: central.recruiter.member.id,
          dueAt: now(),
          originalDueAt: now(),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('12. the recruiter floor', () => {
  it('gives a recruiter full access to their own case and nothing to another recruiter’s', async () => {
    const other = await createMember(central.organization.id, { role: StaffRole.RECRUITER, name: 'Other Recruiter' });
    const otherCtx = staffContext(other.member, central.orgRef);

    const mine = await caseAccess(central.recruiterCtx, {
      id: centralCaseId,
      organizationId: central.organization.id,
      ownerMemberId: central.recruiter.member.id,
      teamId: central.team.id,
    });
    expect(mine).toMatchObject({ metadata: true, content: true, act: true });
    expect(mine.basis).toBe('case owner');
    // Even the owner does not get sensitive material without a grant.
    expect(mine.sensitive).toBe(false);

    await expect(loadCaseFile(otherCtx, centralCaseId)).rejects.toThrow(NotFoundError);
    const otherQueue = await loadQueue(otherCtx, { filter: 'my_queue' });
    expect(otherQueue.rows).toHaveLength(0);
  });

  it('opens access through coverage and closes it again on revocation', async () => {
    const coveringMember = await createMember(central.organization.id, {
      role: StaffRole.RECRUITER,
      name: 'Covering Recruiter',
    });
    const coveringCtx = staffContext(coveringMember.member, central.orgRef);

    await expect(loadCaseFile(coveringCtx, centralCaseId)).rejects.toThrow(NotFoundError);

    const coverage = await grantCoverage(central.adminCtx, {
      fromMemberId: central.recruiter.member.id,
      toMemberId: coveringMember.member.id,
      applicantId: null,
      startsAt: new Date(CLOCK.getTime() - 3_600_000),
      expiresAt: new Date(CLOCK.getTime() + 86_400_000),
      reason: 'Covering while away.',
    });

    const withCoverage = staffContext(coveringMember.member, central.orgRef);
    const loaded = await loadCaseFile(withCoverage, centralCaseId);
    expect(loaded.access.content).toBe(true);
    expect(loaded.access.basis).toMatch(/coverage/);

    await revokeCoverage(central.adminCtx, { coverageId: coverage.id, reason: 'Back early.' });

    // Access stops on the very next request, with no cached authority.
    const afterRevoke = staffContext(coveringMember.member, central.orgRef);
    await expect(loadCaseFile(afterRevoke, centralCaseId)).rejects.toThrow(NotFoundError);
  });

  it('expires coverage automatically without anyone revoking it', async () => {
    const coveringMember = await createMember(central.organization.id, { role: StaffRole.RECRUITER });
    await grantCoverage(central.adminCtx, {
      fromMemberId: central.recruiter.member.id,
      toMemberId: coveringMember.member.id,
      applicantId: null,
      startsAt: new Date(CLOCK.getTime() - 7_200_000),
      expiresAt: new Date(CLOCK.getTime() + 3_600_000),
      reason: 'Short cover.',
    });

    expect((await loadCaseFile(staffContext(coveringMember.member, central.orgRef), centralCaseId)).access.content).toBe(
      true,
    );

    // Two hours later the grant has simply run out.
    __setClock(new Date(CLOCK.getTime() + 7_200_000));
    await expect(
      loadCaseFile(staffContext(coveringMember.member, central.orgRef), centralCaseId),
    ).rejects.toThrow(NotFoundError);
  });

  it('stops a deactivated membership immediately', async () => {
    await prisma.member.update({
      where: { id: central.recruiter.member.id },
      data: { active: false, deactivatedAt: now() },
    });
    const stale = { ...central.recruiterCtx, member: { ...central.recruiterCtx.member, active: false }, cache: {} };
    const access = await caseAccess(stale, {
      id: centralCaseId,
      organizationId: central.organization.id,
      ownerMemberId: central.recruiter.member.id,
      teamId: central.team.id,
    });
    expect(access.metadata).toBe(false);
    expect(access.basis).toMatch(/deactivated/);
  });
});

describe('12. the manager boundary', () => {
  it('gives operational metadata but not conversation content', async () => {
    const access = await caseAccess(central.managerCtx, {
      id: centralCaseId,
      organizationId: central.organization.id,
      ownerMemberId: central.recruiter.member.id,
      teamId: central.team.id,
    });
    expect(access.metadata).toBe(true);
    expect(access.content).toBe(false);
    expect(access.reassign).toBe(true);

    const loaded = await loadCaseFile(central.managerCtx, centralCaseId);
    // The content-gated sections come back EMPTY, not filtered in the UI.
    expect(loaded.messages).toHaveLength(0);
    expect(loaded.intakeSessions).toHaveLength(0);
    expect(loaded.notes).toHaveLength(0);
    expect(loaded.brief).toBeNull();
    // But the operational metadata they are entitled to is there.
    expect(loaded.tasks.length).toBeGreaterThan(0);
    expect(loaded.applicant.ownerMemberId).toBe(central.recruiter.member.id);

    await expect(requireCase(central.managerCtx, centralCaseId, 'content')).rejects.toThrow(ForbiddenError);
    await expect(addNote(central.managerCtx, { applicantId: centralCaseId, body: 'nope' })).rejects.toThrow();
  });

  it('opens content only with an explicit team-conversation grant', async () => {
    await grantPermission(
      central.organization.id,
      central.manager.member.id,
      GrantType.TEAM_CONVERSATION_CONTENT,
      { teamId: central.team.id },
    );
    const fresh = staffContext(central.manager.member, central.orgRef);
    const loaded = await loadCaseFile(fresh, centralCaseId);
    expect(loaded.access.content).toBe(true);
    expect(loaded.access.basis).toMatch(/TEAM_CONVERSATION_CONTENT/);
  });
});

describe('12. the administrator boundary', () => {
  it('does not grant conversation content by role alone', async () => {
    const access = await caseAccess(central.adminCtx, {
      id: centralCaseId,
      organizationId: central.organization.id,
      ownerMemberId: central.recruiter.member.id,
      teamId: central.team.id,
    });
    // An administrator manages the organization; that is not the same thing as
    // reading everyone's conversations.
    expect(access.content).toBe(false);
    await expect(requireCase(central.adminCtx, centralCaseId, 'content')).rejects.toThrow();
  });

  it('requires an explicit, audited grant to read case content', async () => {
    await grantPermission(central.organization.id, central.admin.member.id, GrantType.CASE_CONTENT);
    const fresh = staffContext(central.admin.member, central.orgRef);
    const loaded = await loadCaseFile(fresh, centralCaseId);
    expect(loaded.access.content).toBe(true);

    const audit = await prisma.auditEvent.findMany({
      where: { organizationId: central.organization.id, action: 'case.content_viewed' },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]!.actorMemberId).toBe(central.admin.member.id);
  });
});

describe('12. sensitive material and exports need their own grants', () => {
  it('hides sensitive detail until a sensitive-source grant exists', async () => {
    const flag = await prisma.reviewFlag.create({
      data: {
        organizationId: central.organization.id,
        applicantId: centralCaseId,
        kind: 'SENSITIVE_QUESTION',
        detail: 'A medical topic came up during intake.',
        restricted: true,
      },
    });
    // The owner can see that review work exists, but resolving a restricted
    // flag needs the sensitive-source grant.
    await expect(
      resolveReviewFlag(central.recruiterCtx, { flagId: flag.id, resolution: 'RESOLVED', reason: 'handled' }),
    ).rejects.toThrow(/sensitive-source/);

    await grantPermission(central.organization.id, central.recruiter.member.id, GrantType.SENSITIVE_SOURCE);
    const fresh = staffContext(central.recruiter.member, central.orgRef);
    const resolved = await resolveReviewFlag(fresh, {
      flagId: flag.id,
      resolution: 'RESOLVED',
      reason: 'Called and handled it directly.',
    });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('refuses an export without the export grant and audits one with it', async () => {
    const filters = { from: new Date(CLOCK.getTime() - 86_400_000), to: new Date(CLOCK.getTime() + 86_400_000) };
    await expect(exportReportCsv(central.recruiterCtx, filters)).rejects.toThrow(/export grant/);

    await grantPermission(central.organization.id, central.recruiter.member.id, GrantType.EXPORT);
    const fresh = staffContext(central.recruiter.member, central.orgRef);
    const result = await exportReportCsv(fresh, filters);
    expect(result.csv).toContain('metric');
    expect(result.filename).toMatch(/FICTIONAL-DEMO/);

    const audit = await prisma.auditEvent.findMany({
      where: { organizationId: central.organization.id, action: 'report.exported' },
    });
    expect(audit).toHaveLength(1);
    // The audit row lists field NAMES, not the exported values.
    expect(JSON.stringify(audit[0]!.metadata)).toContain('fields');
  });

  it('refuses a handoff export without the export grant', async () => {
    const handoff = await prepareHandoff(central.recruiterCtx, { applicantId: centralCaseId });
    await expect(
      exportHandoff(central.recruiterCtx, { handoffId: handoff.id, format: 'json' }),
    ).rejects.toThrow(/export grant/);
  });

  it('refuses a team-filtered report without the team-reports grant', async () => {
    const filters = {
      from: new Date(CLOCK.getTime() - 86_400_000),
      to: new Date(CLOCK.getTime() + 86_400_000),
      teamId: central.team.id,
    };
    await expect(buildReport(central.recruiterCtx, filters)).rejects.toThrow(/team-reports grant/);
    // The manager holds it by role.
    const report = await buildReport(central.managerCtx, filters);
    expect(report.metrics.length).toBeGreaterThan(0);
  });
});

describe('12. background jobs do not inherit a human’s authority', () => {
  it('is scoped to its own organization and never gets sensitive material', async () => {
    const ctx = systemContext(central.organization.id, 'test-job');
    const own = await caseAccess(ctx, {
      id: centralCaseId,
      organizationId: central.organization.id,
      ownerMemberId: central.recruiter.member.id,
      teamId: central.team.id,
    });
    expect(own).toMatchObject({ metadata: true, content: true, act: true, sensitive: false, reassign: false });

    const foreign = await caseAccess(ctx, {
      id: northsideCaseId,
      organizationId: northside.organization.id,
      ownerMemberId: northside.recruiter.member.id,
      teamId: null,
    });
    expect(foreign.metadata).toBe(false);
  });
});

describe('12. grant scoping', () => {
  it('honours a grant limited to one case', async () => {
    const second = await prisma.$transaction((tx) =>
      createCase(tx, central.recruiterCtx, {
        organizationId: central.organization.id,
        displayName: 'Another Central Case',
        originKind: 'web_intake',
        contactPoints: [{ channel: 'SMS', value: '+15125550802' }],
        ownerMemberId: central.recruiter.member.id,
      }),
    );
    const outsider = await createMember(central.organization.id, { role: StaffRole.RECRUITER });
    await grantPermission(central.organization.id, outsider.member.id, GrantType.CASE_CONTENT, {
      applicantId: centralCaseId,
    });

    const ctx = staffContext(outsider.member, central.orgRef);
    expect((await loadCaseFile(ctx, centralCaseId)).access.content).toBe(true);
    await expect(loadCaseFile(ctx, second.applicant.id)).rejects.toThrow(NotFoundError);
  });

  it('honours an expiry on a grant', async () => {
    const outsider = await createMember(central.organization.id, { role: StaffRole.RECRUITER });
    await grantPermission(central.organization.id, outsider.member.id, GrantType.CASE_CONTENT, {
      expiresAt: new Date(CLOCK.getTime() + 3_600_000),
    });
    expect((await loadCaseFile(staffContext(outsider.member, central.orgRef), centralCaseId)).access.content).toBe(
      true,
    );

    __setClock(new Date(CLOCK.getTime() + 7_200_000));
    await expect(
      loadCaseFile(staffContext(outsider.member, central.orgRef), centralCaseId),
    ).rejects.toThrow(NotFoundError);
  });
});

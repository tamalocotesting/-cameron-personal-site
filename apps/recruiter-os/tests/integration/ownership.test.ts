import { beforeEach, describe, expect, it } from 'vitest';
import { CaseClosureReason, CaseStatus, StaffRole, TaskType } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import { createCase, reassignCase, setCaseStatus } from '@/server/services/cases';
import { cancelTask, completeTask, createTask, ensureNextStep, snoozeTask } from '@/server/services/tasks';
import { routeNewInquiry, assertDeactivatable } from '@/server/services/ownership';
import { mergeCases } from '@/server/services/duplicates';
import { setMemberActive } from '@/server/services/team';
import { grantPermission, createMember, createWorkspace, staffContext, type Workspace } from '../setup/factories';
import { GrantType } from '@prisma/client';

/**
 * Acceptance 11.
 *
 * "Every active case keeps an owner and a next step" — through completion,
 * snoozing, absence, reassignment, merging and member removal.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');

let workspace: Workspace;

/**
 * Cases are created with an explicit owner by default, so a test that then
 * acts as the recruiter is not at the mercy of the round-robin tie-break.
 * The routing itself is tested directly instead.
 */
async function makeCase(name: string, ownerMemberId?: string) {
  const created = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: name,
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: `+1512555${Math.floor(1000 + Math.random() * 8999)}` }],
      ownerMemberId: ownerMemberId ?? workspace.recruiter.member.id,
    }),
  );
  return created.applicant;
}

async function openTaskCount(applicantId: string) {
  return prisma.task.count({ where: { applicantId, status: { in: ['OPEN', 'SNOOZED'] } } });
}

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
});

describe('11. a new inquiry always lands on someone who is here', () => {
  it('routes away from an absent recruiter', async () => {
    const away = await createMember(workspace.organization.id, { role: StaffRole.RECRUITER, name: 'Away Recruiter' });
    await prisma.absence.create({
      data: {
        organizationId: workspace.organization.id,
        memberId: away.member.id,
        startsAt: new Date(CLOCK.getTime() - 3_600_000),
        endsAt: new Date(CLOCK.getTime() + 86_400_000),
      },
    });

    for (let i = 0; i < 6; i += 1) {
      const routed = await routeNewInquiry(prisma, workspace.organization.id);
      expect(routed.memberId).not.toBe(away.member.id);
    }
  });

  it('falls back to the configured owner when everybody routable is away', async () => {
    const routable = await prisma.member.findMany({
      where: { organizationId: workspace.organization.id, staffRole: { in: ['RECRUITER', 'MANAGER'] } },
    });
    for (const member of routable) {
      await prisma.absence.create({
        data: {
          organizationId: workspace.organization.id,
          memberId: member.id,
          startsAt: new Date(CLOCK.getTime() - 3_600_000),
          endsAt: new Date(CLOCK.getTime() + 86_400_000),
        },
      });
    }
    const routed = await routeNewInquiry(prisma, workspace.organization.id);
    // The case is never left unowned.
    expect(routed.memberId).toBe(workspace.recruiter.member.id);
    expect(routed.basis).toMatch(/fallback/i);
  });

  it('spreads work by open load rather than at random', async () => {
    const second = await createMember(workspace.organization.id, { role: StaffRole.RECRUITER, name: 'Second' });
    // Give the first recruiter three cases; the routable set then has two
    // members on zero and one on three.
    for (let i = 0; i < 3; i += 1) await makeCase(`Load ${i}`, workspace.recruiter.member.id);

    const routed = await routeNewInquiry(prisma, workspace.organization.id);
    expect(routed.basis).toMatch(/round-robin/);
    // The loaded recruiter is skipped in favour of someone with capacity.
    expect(routed.memberId).not.toBe(workspace.recruiter.member.id);
    expect([second.member.id, workspace.manager.member.id]).toContain(routed.memberId);

    // And the choice is deterministic: the same data routes the same way.
    const again = await routeNewInquiry(prisma, workspace.organization.id);
    expect(again.memberId).toBe(routed.memberId);
  });

  it('refuses to create a case when nobody could own it', async () => {
    await prisma.member.updateMany({
      where: { organizationId: workspace.organization.id },
      data: { active: false },
    });
    await expect(
      prisma.$transaction((tx) =>
        createCase(tx, workspace.recruiterCtx, {
          organizationId: workspace.organization.id,
          displayName: 'Nobody Home',
          originKind: 'web_intake',
          contactPoints: [],
        }),
      ),
    ).rejects.toThrow(/no active recruiter/i);
    expect(await prisma.applicant.count({ where: { organizationId: workspace.organization.id } })).toBe(0);
  });

  it('cannot store an active case with no owner', async () => {
    const applicant = await makeCase('Constraint Check');
    await expect(
      prisma.applicant.update({ where: { id: applicant.id }, data: { ownerMemberId: null } }),
    ).rejects.toThrow();
  });
});

describe('11. completing the last task establishes the next step', () => {
  it('replaces a completed follow-up with a new dated commitment', async () => {
    const applicant = await makeCase('Completion Flow');
    const tasks = await prisma.task.findMany({ where: { applicantId: applicant.id, status: 'OPEN' } });
    expect(tasks.length).toBe(1);

    await completeTask(workspace.recruiterCtx, {
      taskId: tasks[0]!.id,
      outcome: 'SPOKE_WITH_APPLICANT',
      note: 'Talked it through.',
    });

    expect(await openTaskCount(applicant.id)).toBeGreaterThan(0);
    const next = await prisma.task.findFirstOrThrow({
      where: { applicantId: applicant.id, status: { in: ['OPEN', 'SNOOZED'] } },
    });
    expect(next.dueAt.getTime()).toBeGreaterThan(CLOCK.getTime());
  });

  it('does the same when the last task is cancelled', async () => {
    const applicant = await makeCase('Cancellation Flow');
    const task = await prisma.task.findFirstOrThrow({ where: { applicantId: applicant.id, status: 'OPEN' } });
    await cancelTask(workspace.recruiterCtx, { taskId: task.id, reason: 'No longer needed.' });
    expect(await openTaskCount(applicant.id)).toBeGreaterThan(0);
  });

  it('gives a waiting state a review date rather than letting it drift', async () => {
    const applicant = await makeCase('Waiting Flow');
    const task = await prisma.task.findFirstOrThrow({ where: { applicantId: applicant.id, status: 'OPEN' } });
    await prisma.$transaction((tx) =>
      setCaseStatus(tx, workspace.recruiterCtx, {
        applicantId: applicant.id,
        status: CaseStatus.AWAITING_APPLICANT,
        reason: 'Waiting for them to come back.',
      }),
    );
    await completeTask(workspace.recruiterCtx, { taskId: task.id, outcome: 'SENT_MESSAGE' });

    const review = await prisma.task.findFirstOrThrow({
      where: { applicantId: applicant.id, status: { in: ['OPEN', 'SNOOZED'] } },
    });
    expect(review.title).toMatch(/review/i);
    expect(review.reason).toMatch(/waiting/i);
    expect(review.dueAt.getTime()).toBeGreaterThan(CLOCK.getTime());
  });

  it('does not complete a task just because its due time passed', async () => {
    const applicant = await makeCase('Overdue Flow');
    const task = await prisma.task.findFirstOrThrow({ where: { applicantId: applicant.id, status: 'OPEN' } });

    __setClock(new Date(CLOCK.getTime() + 10 * 86_400_000));
    const stillOpen = await prisma.task.findFirstOrThrow({ where: { id: task.id } });
    expect(stillOpen.status).toBe('OPEN');
    expect(stillOpen.completionOutcome).toBeNull();

    // The database refuses a completion with no outcome.
    await expect(
      prisma.task.update({ where: { id: task.id }, data: { status: 'COMPLETED' } }),
    ).rejects.toThrow();
  });
});

describe('11. snoozing keeps the original promise', () => {
  it('moves the working date, records the reason, and keeps the promise date', async () => {
    const applicant = await makeCase('Snooze Flow');
    const task = await prisma.task.findFirstOrThrow({ where: { applicantId: applicant.id, status: 'OPEN' } });
    const promised = task.originalDueAt;

    await expect(
      snoozeTask(workspace.recruiterCtx, {
        taskId: task.id,
        newDueAt: new Date(CLOCK.getTime() + 86_400_000),
        reason: 'x',
      }),
    ).rejects.toThrow(/reason/i);

    const moved = await snoozeTask(workspace.recruiterCtx, {
      taskId: task.id,
      newDueAt: new Date(CLOCK.getTime() + 2 * 86_400_000),
      reason: 'The applicant asked for later in the week.',
    });
    expect(moved.originalDueAt.getTime()).toBe(promised.getTime());
    expect(moved.dueAt.getTime()).toBeGreaterThan(promised.getTime());
    expect(moved.snoozeCount).toBe(1);

    const history = await prisma.taskSnooze.findMany({ where: { taskId: task.id } });
    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toMatch(/later in the week/);

    // Completing it after the original date counts as LATE.
    __setClock(new Date(CLOCK.getTime() + 3 * 86_400_000));
    await completeTask(workspace.recruiterCtx, { taskId: task.id, outcome: 'SPOKE_WITH_APPLICANT' });
    const metric = await prisma.metricEvent.findFirstOrThrow({
      where: { applicantId: applicant.id, kind: { in: ['TASK_COMPLETED_ON_TIME', 'TASK_COMPLETED_LATE'] } },
    });
    expect(metric.kind).toBe('TASK_COMPLETED_LATE');
  });

  it('refuses a snooze into the past', async () => {
    const applicant = await makeCase('Snooze Past');
    const task = await prisma.task.findFirstOrThrow({ where: { applicantId: applicant.id, status: 'OPEN' } });
    await expect(
      snoozeTask(workspace.recruiterCtx, {
        taskId: task.id,
        newDueAt: new Date(CLOCK.getTime() - 3_600_000),
        reason: 'Backdating it.',
      }),
    ).rejects.toThrow(/future/i);
  });
});

describe('11. reassignment and deactivation', () => {
  it('moves open work with the case', async () => {
    const applicant = await makeCase('Reassign Flow', workspace.recruiter.member.id);
    const second = await createMember(workspace.organization.id, { role: StaffRole.RECRUITER, name: 'Receiver' });
    // The manager of the owning team is who reassigns in practice.
    await prisma.applicant.update({ where: { id: applicant.id }, data: { teamId: workspace.team.id } });

    await reassignCase(workspace.managerCtx, {
      applicantId: applicant.id,
      toMemberId: second.member.id,
      reason: 'Handing over before leave.',
    });

    const updated = await prisma.applicant.findFirstOrThrow({ where: { id: applicant.id } });
    expect(updated.ownerMemberId).toBe(second.member.id);
    const tasks = await prisma.task.findMany({
      where: { applicantId: applicant.id, status: { in: ['OPEN', 'SNOOZED'] } },
    });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.ownerMemberId === second.member.id)).toBe(true);
  });

  it('refuses to deactivate a member who still owns live work', async () => {
    await makeCase('Still Owned', workspace.recruiter.member.id);
    await expect(assertDeactivatable(workspace.organization.id, workspace.recruiter.member.id)).rejects.toThrow(
      /Reassign this member/,
    );
    await expect(
      setMemberActive(workspace.adminCtx, {
        memberId: workspace.recruiter.member.id,
        active: false,
        reason: 'Leaving',
      }),
    ).rejects.toThrow(/Reassign this member/);

    const member = await prisma.member.findFirstOrThrow({ where: { id: workspace.recruiter.member.id } });
    expect(member.active).toBe(true);
  });

  it('deactivates cleanly once the work has moved, and revokes their grants', async () => {
    const applicant = await makeCase('Movable', workspace.recruiter.member.id);
    const second = await createMember(workspace.organization.id, { role: StaffRole.RECRUITER, name: 'Receiver' });
    await grantPermission(workspace.organization.id, workspace.recruiter.member.id, GrantType.EXPORT);
    await prisma.applicant.update({ where: { id: applicant.id }, data: { teamId: workspace.team.id } });

    await reassignCase(workspace.managerCtx, {
      applicantId: applicant.id,
      toMemberId: second.member.id,
      reason: 'Handing over.',
    });
    await prisma.appointment.deleteMany({ where: { recruiterMemberId: workspace.recruiter.member.id } });

    const result = await setMemberActive(workspace.adminCtx, {
      memberId: workspace.recruiter.member.id,
      active: false,
      reason: 'Left the station.',
    });
    expect(result.active).toBe(false);

    const grants = await prisma.permissionGrant.findMany({
      where: { subjectMemberId: workspace.recruiter.member.id },
    });
    expect(grants.every((g) => g.revokedAt !== null)).toBe(true);

    // And the case still has an owner and a next step.
    const still = await prisma.applicant.findFirstOrThrow({ where: { id: applicant.id } });
    expect(still.ownerMemberId).toBe(second.member.id);
    expect(await openTaskCount(applicant.id)).toBeGreaterThan(0);
  });
});

describe('11. merging keeps the surviving case accountable', () => {
  it('leaves the survivor owned with a next step and the merged case closed', async () => {
    const keep = await makeCase('Ethan Pratt', workspace.recruiter.member.id);
    const merge = await makeCase('E. Pratt', workspace.recruiter.member.id);
    void CaseStatus;
    await grantPermission(workspace.organization.id, workspace.recruiter.member.id, GrantType.REASSIGNMENT);

    const ctx = staffContext(workspace.recruiter.member, workspace.orgRef);
    await mergeCases(ctx, {
      survivingApplicantId: keep.id,
      mergedApplicantId: merge.id,
      reason: 'Same person; confirmed on the phone.',
    });

    const survivor = await prisma.applicant.findFirstOrThrow({ where: { id: keep.id } });
    expect(survivor.ownerMemberId).not.toBeNull();
    expect(survivor.status).not.toBe(CaseStatus.CLOSED);
    expect(await openTaskCount(keep.id)).toBeGreaterThan(0);

    const merged = await prisma.applicant.findFirstOrThrow({ where: { id: merge.id } });
    expect(merged.mergedIntoApplicantId).toBe(keep.id);
    expect(merged.closureReason).toBe(CaseClosureReason.MERGED_DUPLICATE);
  });
});

describe('11. closing is explicit and reversible', () => {
  it('requires a reason, cancels open work, and reopens into a new episode', async () => {
    const applicant = await makeCase('Closing Flow');

    await expect(
      prisma.$transaction((tx) =>
        setCaseStatus(tx, workspace.recruiterCtx, { applicantId: applicant.id, status: CaseStatus.CLOSED }),
      ),
    ).rejects.toThrow(/operational reason/);

    await prisma.$transaction((tx) =>
      setCaseStatus(tx, workspace.recruiterCtx, {
        applicantId: applicant.id,
        status: CaseStatus.CLOSED,
        closureReason: CaseClosureReason.UNABLE_TO_REACH,
        reason: 'Six attempts over three weeks.',
      }),
    );

    const closed = await prisma.applicant.findFirstOrThrow({ where: { id: applicant.id } });
    expect(closed.closedAt).not.toBeNull();
    expect(await openTaskCount(applicant.id)).toBe(0);
    // A closed case needs no next step; the sweep leaves it alone.
    expect(await ensureNextStep(prisma, workspace.recruiterCtx, applicant.id)).toBeNull();

    const firstEpisodes = await prisma.inquiryEpisode.findMany({ where: { applicantId: applicant.id } });
    expect(firstEpisodes.every((e) => e.closedAt !== null)).toBe(true);

    __setClock(new Date(CLOCK.getTime() + 86_400_000));
    await prisma.$transaction((tx) =>
      setCaseStatus(tx, workspace.recruiterCtx, {
        applicantId: applicant.id,
        status: CaseStatus.READY_FOR_RECRUITER,
        reason: 'They wrote back.',
      }),
    );

    const episodes = await prisma.inquiryEpisode.findMany({
      where: { applicantId: applicant.id },
      orderBy: { openedAt: 'asc' },
    });
    // A reopened case starts a NEW episode; the old clocks are untouched.
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.supersededAt).not.toBeNull();
    expect(episodes[1]!.originKind).toBe('reopened');
    expect(await openTaskCount(applicant.id)).toBeGreaterThan(0);
  });
});

describe('11. automatic work is created exactly once', () => {
  it('deduplicates a next step on repeated sweeps', async () => {
    const applicant = await makeCase('Sweep Flow');
    const before = await openTaskCount(applicant.id);
    for (let i = 0; i < 5; i += 1) {
      await prisma.$transaction((tx) => ensureNextStep(tx, workspace.recruiterCtx, applicant.id));
    }
    expect(await openTaskCount(applicant.id)).toBe(before);
  });

  it('refuses a task with no owner', async () => {
    const applicant = await makeCase('Ownerless Task');
    await expect(
      prisma.$transaction((tx) =>
        createTask(tx, workspace.recruiterCtx, {
          applicantId: applicant.id,
          type: TaskType.FOLLOW_UP,
          title: 'Orphan',
          reason: 'test',
          dueAt: now(),
          ownerMemberId: 'not-a-member',
        }),
      ),
    ).rejects.toThrow();
  });
});

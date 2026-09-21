import { beforeEach, describe, expect, it } from 'vitest';
import { CaseStatus, ReviewFlagKind, TaskType } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import { createCase, raiseReviewFlag } from '@/server/services/cases';
import { createTask } from '@/server/services/tasks';
import { loadQueue, loadQueueCounts, QUEUE_CATEGORIES, explainCategory } from '@/server/services/queue';
import { createWorkspace, type Workspace } from '../setup/factories';

/**
 * Today's Priority Queue.
 *
 * The ordering has to be deterministic, derived only from workflow events, and
 * explainable. No hidden score about the applicant may influence it.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');

let workspace: Workspace;

async function makeCase(options: {
  name: string;
  status?: CaseStatus;
  dueOffsetHours?: number;
  taskType?: TaskType;
  originalDueOffsetHours?: number;
  ownerMemberId?: string;
}) {
  const created = await prisma.$transaction(async (tx) => {
    const result = await createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: options.name,
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: `+1512555${Math.floor(1000 + Math.random() * 8999)}` }],
      ownerMemberId: options.ownerMemberId ?? workspace.recruiter.member.id,
    });
    // Replace the automatic next step with the one this test wants.
    await tx.task.updateMany({
      where: { applicantId: result.applicant.id },
      data: { status: 'CANCELED', canceledAt: now(), cancelReason: 'replaced by test fixture' },
    });
    if (options.dueOffsetHours !== undefined) {
      const dueAt = new Date(CLOCK.getTime() + options.dueOffsetHours * 3_600_000);
      const task = await createTask(tx, workspace.recruiterCtx, {
        applicantId: result.applicant.id,
        type: options.taskType ?? TaskType.FOLLOW_UP,
        title: `Work on ${options.name}`,
        reason: 'test fixture',
        dueAt,
        ownerMemberId: options.ownerMemberId ?? workspace.recruiter.member.id,
      });
      if (options.originalDueOffsetHours !== undefined) {
        await tx.task.update({
          where: { id: task.id },
          data: { originalDueAt: new Date(CLOCK.getTime() + options.originalDueOffsetHours * 3_600_000) },
        });
      }
    }
    return result;
  });

  if (options.status) {
    await prisma.applicant.update({ where: { id: created.applicant.id }, data: { status: options.status } });
  }
  return created.applicant;
}

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
});

describe('the queue orders by workflow events only', () => {
  it('puts a human handoff first, then overdue work, then an open callback window', async () => {
    const dueLater = await makeCase({ name: 'Due later', dueOffsetHours: 6, status: CaseStatus.CONTACT_ATTEMPTED });
    const callback = await makeCase({
      name: 'Callback now',
      dueOffsetHours: -1,
      taskType: TaskType.CALLBACK,
      status: CaseStatus.READY_FOR_RECRUITER,
    });
    const overdue = await makeCase({
      name: 'Overdue promise',
      dueOffsetHours: -2,
      originalDueOffsetHours: -48,
      status: CaseStatus.CONTACT_ATTEMPTED,
    });
    const handoff = await makeCase({
      name: 'Asked for a person',
      dueOffsetHours: 12,
      status: CaseStatus.READY_FOR_RECRUITER,
    });
    await prisma.$transaction((tx) =>
      raiseReviewFlag(tx, workspace.recruiterCtx, {
        applicantId: handoff.id,
        kind: ReviewFlagKind.HUMAN_REQUESTED,
        detail: 'The applicant asked to speak with a person.',
      }),
    );

    const page = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    const order = page.rows.map((r) => r.applicantId);

    expect(order.indexOf(handoff.id)).toBe(0);
    expect(order.indexOf(overdue.id)).toBeLessThan(order.indexOf(callback.id));
    expect(order.indexOf(callback.id)).toBeLessThan(order.indexOf(dueLater.id));

    expect(page.rows[0]!.categoryKey).toBe('human_handoff');
    expect(page.rows[0]!.reasons).toContain('Human review requested');
    expect(page.rows.find((r) => r.applicantId === overdue.id)!.reasons).toContain('Follow-up overdue');
    expect(page.rows.find((r) => r.applicantId === callback.id)!.reasons).toContain('Callback requested');
  });

  it('places a new inquiry with no outreach above ordinary due work', async () => {
    const newInquiry = await makeCase({
      name: 'Brand new',
      dueOffsetHours: 20,
      status: CaseStatus.READY_FOR_RECRUITER,
    });
    const inProgress = await makeCase({
      name: 'Already contacted',
      dueOffsetHours: 2,
      status: CaseStatus.CONTACT_ATTEMPTED,
    });
    await prisma.inquiryEpisode.updateMany({
      where: { applicantId: inProgress.id },
      data: { firstHumanOutreachAt: new Date(CLOCK.getTime() - 3_600_000) },
    });

    const page = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    const order = page.rows.map((r) => r.applicantId);
    expect(order.indexOf(newInquiry.id)).toBeLessThan(order.indexOf(inProgress.id));
    expect(page.rows.find((r) => r.applicantId === newInquiry.id)!.reasons).toContain(
      'New inquiry — no recruiter outreach yet',
    );
  });

  it('sorts inside a category by due time, then by the oldest waiting event', async () => {
    const later = await makeCase({ name: 'Later today', dueOffsetHours: 5, status: CaseStatus.CONTACT_ATTEMPTED });
    const sooner = await makeCase({ name: 'Sooner today', dueOffsetHours: 1, status: CaseStatus.CONTACT_ATTEMPTED });
    for (const id of [later.id, sooner.id]) {
      await prisma.inquiryEpisode.updateMany({
        where: { applicantId: id },
        data: { firstHumanOutreachAt: new Date(CLOCK.getTime() - 3_600_000) },
      });
    }
    const page = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    const order = page.rows.map((r) => r.applicantId);
    expect(order.indexOf(sooner.id)).toBeLessThan(order.indexOf(later.id));
  });

  it('produces the same order every time for the same data', async () => {
    for (let i = 0; i < 6; i += 1) {
      await makeCase({ name: `Case ${i}`, dueOffsetHours: 3, status: CaseStatus.CONTACT_ATTEMPTED });
    }
    const first = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    const second = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    const third = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    expect(second.rows.map((r) => r.reference)).toEqual(first.rows.map((r) => r.reference));
    expect(third.rows.map((r) => r.reference)).toEqual(first.rows.map((r) => r.reference));
    // The tie-break is the case reference, which is stable and inspectable.
    const references = first.rows.map((r) => r.reference);
    expect([...references].sort()).toEqual(references);
  });

  it('can explain every category in words', () => {
    for (const category of QUEUE_CATEGORIES) {
      expect(explainCategory(category.key).length).toBeGreaterThan(20);
    }
  });

  it('gives a case with no open commitment a visible reason', async () => {
    const stalled = await makeCase({ name: 'No commitment', status: CaseStatus.CONTACT_ATTEMPTED });
    const page = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    const row = page.rows.find((r) => r.applicantId === stalled.id)!;
    expect(row.reasons).toContain('No open commitment — needs a next step');
  });
});

describe('the queue filters, searches and paginates on the server', () => {
  beforeEach(async () => {
    await makeCase({ name: 'Overdue Alice', dueOffsetHours: -3, originalDueOffsetHours: -30, status: CaseStatus.CONTACT_ATTEMPTED });
    await makeCase({ name: 'Today Bob', dueOffsetHours: 4, status: CaseStatus.CONTACT_ATTEMPTED });
    await makeCase({ name: 'Upcoming Cara', dueOffsetHours: 72, status: CaseStatus.CONTACT_ATTEMPTED });
    await makeCase({ name: 'Waiting Dev', dueOffsetHours: 30, status: CaseStatus.AWAITING_APPLICANT });
    const flagged = await makeCase({ name: 'Review Erin', dueOffsetHours: 8, status: CaseStatus.READY_FOR_RECRUITER });
    await prisma.$transaction((tx) =>
      raiseReviewFlag(tx, workspace.recruiterCtx, {
        applicantId: flagged.id,
        kind: ReviewFlagKind.SENSITIVE_QUESTION,
        detail: 'A sensitive topic came up.',
        restricted: true,
      }),
    );
  });

  it('applies each filter to the right subset', async () => {
    const overdue = await loadQueue(workspace.recruiterCtx, { filter: 'overdue', pageSize: 50 });
    expect(overdue.rows.map((r) => r.displayName)).toEqual(['Overdue Alice']);

    const dueToday = await loadQueue(workspace.recruiterCtx, { filter: 'due_today', pageSize: 50 });
    expect(dueToday.rows.map((r) => r.displayName)).toContain('Today Bob');
    expect(dueToday.rows.map((r) => r.displayName)).not.toContain('Upcoming Cara');

    const review = await loadQueue(workspace.recruiterCtx, { filter: 'review_requested', pageSize: 50 });
    expect(review.rows.map((r) => r.displayName)).toEqual(['Review Erin']);

    const waiting = await loadQueue(workspace.recruiterCtx, { filter: 'awaiting_applicant', pageSize: 50 });
    expect(waiting.rows.map((r) => r.displayName)).toEqual(['Waiting Dev']);

    const upcoming = await loadQueue(workspace.recruiterCtx, { filter: 'upcoming', pageSize: 50 });
    expect(upcoming.rows.map((r) => r.displayName)).toContain('Upcoming Cara');
  });

  it('searches by name and by case reference', async () => {
    const byName = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', search: 'erin', pageSize: 50 });
    expect(byName.rows.map((r) => r.displayName)).toEqual(['Review Erin']);
    expect(byName.total).toBe(1);

    const reference = byName.rows[0]!.reference;
    const byReference = await loadQueue(workspace.recruiterCtx, {
      filter: 'my_queue',
      search: reference,
      pageSize: 50,
    });
    expect(byReference.rows.map((r) => r.reference)).toEqual([reference]);
  });

  it('paginates with a stable total', async () => {
    const first = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', page: 1, pageSize: 5 });
    const second = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', page: 2, pageSize: 5 });
    expect(first.rows).toHaveLength(5);
    expect(first.total).toBe(second.total);
    // No overlap between pages.
    const overlap = first.rows.filter((r) => second.rows.some((s) => s.applicantId === r.applicantId));
    expect(overlap).toHaveLength(0);
  });

  it('counts each filter consistently with its listing', async () => {
    const counts = await loadQueueCounts(workspace.recruiterCtx);
    const overdue = await loadQueue(workspace.recruiterCtx, { filter: 'overdue', pageSize: 50 });
    expect(counts.overdue).toBe(overdue.total);
    const mine = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    expect(counts.my_queue).toBe(mine.total);
  });

  it('excludes closed and merged cases', async () => {
    const closed = await makeCase({ name: 'Closed Case', dueOffsetHours: 2, status: CaseStatus.CONTACT_ATTEMPTED });
    await prisma.applicant.update({
      where: { id: closed.id },
      data: { status: CaseStatus.CLOSED, closureReason: 'UNABLE_TO_REACH', closedAt: now() },
    });
    const page = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    expect(page.rows.map((r) => r.applicantId)).not.toContain(closed.id);
  });

  it('keeps my queue to cases this member owns, whatever else they can see', async () => {
    const other = await makeCase({
      name: 'Owned by the manager',
      dueOffsetHours: 1,
      status: CaseStatus.CONTACT_ATTEMPTED,
      ownerMemberId: workspace.manager.member.id,
    });
    const mine = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue', pageSize: 50 });
    expect(mine.rows.map((r) => r.applicantId)).not.toContain(other.id);
  });

  it('reports the timezone it is displaying times in', async () => {
    const page = await loadQueue(workspace.recruiterCtx, { filter: 'my_queue' });
    expect(page.timezone).toBe('America/Chicago');
    expect(page.generatedAt.toISOString()).toBe(CLOCK.toISOString());
  });
});

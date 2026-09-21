import { beforeEach, describe, expect, it } from 'vitest';
import { ConsentPurpose, OutboxStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import { enqueue, cancelPending } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { handlers, settleOutbox, failOutbox } from '../../worker/handlers';
import { createCase } from '@/server/services/cases';
import { approveDraft, createDraft, queueApprovedMessage } from '@/server/services/messaging';
import { proposeAppointment } from '@/server/services/appointments';
import { createWorkspace, grantConsent, type Workspace } from '../setup/factories';

/**
 * Acceptance 9.
 *
 * The transactional outbox and the idempotency of every handler. A worker
 * restart is simulated by simply running the handlers again: nothing may
 * double-send, double-book or double-create.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');
const PHONE = '+15125551001';

let workspace: Workspace;
let applicantId: string;

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
  const created = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: 'Worker Test Case',
      timezone: 'America/Chicago',
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: PHONE, isPrimary: true }],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  applicantId = created.applicant.id;
  await prisma.applicant.update({ where: { id: applicantId }, data: { timezoneConfirmed: true } });
  await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.RECRUITER_SMS, PHONE);
  await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.INTAKE_SMS, PHONE);
});

describe('9. the outbox is written with the business change', () => {
  it('rolls the job back with the transaction that created it', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueue(
          tx,
          JOB.prepareBrief,
          { organizationId: workspace.organization.id, applicantId, requestedByMemberId: null, reason: 'test' },
          { idempotencyKey: 'rollback-test' },
        );
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    expect(await prisma.outboxRecord.count({ where: { idempotencyKey: 'rollback-test' } })).toBe(0);
  });

  it('treats a duplicate business key as a no-op', async () => {
    for (let i = 0; i < 3; i += 1) {
      await prisma.$transaction((tx) =>
        enqueue(
          tx,
          JOB.prepareBrief,
          { organizationId: workspace.organization.id, applicantId, requestedByMemberId: null, reason: 'test' },
          { idempotencyKey: 'dedupe-key' },
        ),
      );
    }
    expect(await prisma.outboxRecord.count({ where: { idempotencyKey: 'dedupe-key' } })).toBe(1);
  });

  it('keeps only scoped identifiers in a job payload', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'This body must never end up in a queue row.',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });

    const job = await prisma.outboxRecord.findFirstOrThrow({ where: { jobName: JOB.dispatchMessage } });
    const payload = JSON.stringify(job.payload);
    expect(payload).not.toContain('must never end up');
    expect(payload).not.toContain(PHONE);
    expect(Object.keys(job.payload as object).sort()).toEqual(['messageId', 'organizationId']);
  });

  it('cancels a pending job when its business reason disappears', async () => {
    await prisma.$transaction((tx) =>
      enqueue(
        tx,
        JOB.prepareBrief,
        { organizationId: workspace.organization.id, applicantId, requestedByMemberId: null, reason: 'test' },
        { idempotencyKey: 'cancel-me' },
      ),
    );
    await prisma.$transaction((tx) => cancelPending(tx, 'cancel-me', 'no longer needed'));
    const job = await prisma.outboxRecord.findFirstOrThrow({ where: { idempotencyKey: 'cancel-me' } });
    expect(job.status).toBe(OutboxStatus.FAILED);
    expect(job.deadLetteredAt).not.toBeNull();
  });
});

describe('9. handlers survive a restart and a replay', () => {
  it('runs the acknowledgment handler twice without sending twice', async () => {
    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId } });
    const payload = {
      organizationId: workspace.organization.id,
      applicantId,
      inquiryEpisodeId: episode.id,
    };

    const first = await handlers[JOB.sendAcknowledgment](payload);
    const second = await handlers[JOB.sendAcknowledgment](payload);
    expect(first.ok && second.ok).toBe(true);

    const messages = await prisma.message.findMany({
      where: { organizationId: workspace.organization.id, authorKind: 'APPROVED_AUTOMATION' },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.idempotencyKey).toBe(`ack:${episode.id}`);
  });

  it('runs the dispatch handler twice without a second submission', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'One send only',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });

    await handlers[JOB.dispatchMessage]({ organizationId: workspace.organization.id, messageId: draft.id });
    await handlers[JOB.dispatchMessage]({ organizationId: workspace.organization.id, messageId: draft.id });

    const message = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(message.attemptCount).toBe(1);
    expect(message.state).toBe('PROVIDER_ACCEPTED');
  });

  it('runs the reminder handler twice without a second reminder', async () => {
    await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.APPOINTMENT_REMINDER_SMS, PHONE);
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: { year: 2026, month: 6, day: 18, hour: 10, minute: 0 },
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });
    const reminder = await prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: created.appointment.id, status: 'pending' },
    });
    const payload = {
      organizationId: workspace.organization.id,
      appointmentId: created.appointment.id,
      reminderId: reminder.id,
    };

    await handlers[JOB.appointmentReminder](payload);
    await handlers[JOB.appointmentReminder](payload);

    const reminders = await prisma.message.findMany({
      where: { organizationId: workspace.organization.id, idempotencyKey: `reminder-send:${reminder.id}` },
    });
    expect(reminders).toHaveLength(1);
  });

  it('runs the duplicate scan twice without creating a second candidate', async () => {
    await prisma.$transaction((tx) =>
      createCase(tx, workspace.recruiterCtx, {
        organizationId: workspace.organization.id,
        displayName: 'Sibling On The Same Phone',
        originKind: 'inbound_sms',
        contactPoints: [{ channel: 'SMS', value: PHONE }],
        ownerMemberId: workspace.recruiter.member.id,
      }),
    );
    const payload = { organizationId: workspace.organization.id, applicantId };
    await handlers[JOB.detectDuplicates](payload);
    await handlers[JOB.detectDuplicates](payload);

    const candidates = await prisma.duplicateCandidate.findMany({
      where: { organizationId: workspace.organization.id },
    });
    expect(candidates).toHaveLength(1);
    // Detection never merges.
    expect(candidates[0]!.resolution).toBe('open');
  });

  it('keeps the next-step sweep idempotent', async () => {
    const before = await prisma.task.count({
      where: { organizationId: workspace.organization.id, status: { in: ['OPEN', 'SNOOZED'] } },
    });
    for (let i = 0; i < 3; i += 1) {
      await handlers[JOB.scanOverdueTasks]({ organizationId: workspace.organization.id });
    }
    const after = await prisma.task.count({
      where: { organizationId: workspace.organization.id, status: { in: ['OPEN', 'SNOOZED'] } },
    });
    expect(after).toBe(before);
  });

  it('preserves scheduled work across a simulated worker restart', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Scheduled for later',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, {
      messageId: draft.id,
      sendAt: new Date(CLOCK.getTime() + 4 * 3_600_000),
    });

    // "Restart": the process goes away, and the only record is in the database.
    const pending = await prisma.outboxRecord.findMany({
      where: { organizationId: workspace.organization.id, status: OutboxStatus.PENDING },
    });
    expect(pending.some((p) => p.idempotencyKey === `send:${draft.id}`)).toBe(true);
    const job = pending.find((p) => p.idempotencyKey === `send:${draft.id}`)!;
    expect(job.availableAt.getTime()).toBe(CLOCK.getTime() + 4 * 3_600_000);

    // The work is still there and still dispatchable once its time comes.
    __setClock(new Date(CLOCK.getTime() + 5 * 3_600_000));
    const result = await handlers[JOB.dispatchMessage]({
      organizationId: workspace.organization.id,
      messageId: draft.id,
    });
    expect(result.detail).toMatch(/PROVIDER_ACCEPTED/);
  });
});

describe('9. failure accounting and dead lettering', () => {
  it('marks a job published on success', async () => {
    await prisma.$transaction((tx) =>
      enqueue(
        tx,
        JOB.detectDuplicates,
        { organizationId: workspace.organization.id, applicantId },
        { idempotencyKey: 'settle-ok' },
      ),
    );
    await settleOutbox('settle-ok', { ok: true, detail: 'done' });
    const job = await prisma.outboxRecord.findFirstOrThrow({ where: { idempotencyKey: 'settle-ok' } });
    expect(job.status).toBe(OutboxStatus.PUBLISHED);
    expect(job.publishedAt).not.toBeNull();
  });

  it('dead-letters a job once its retries are exhausted, with a redacted error', async () => {
    await prisma.$transaction((tx) =>
      enqueue(
        tx,
        JOB.detectDuplicates,
        { organizationId: workspace.organization.id, applicantId },
        { idempotencyKey: 'settle-fail' },
      ),
    );

    const error = new Error('provider exploded\nrequest body: {"to":"+15125551001"}');
    await failOutbox('settle-fail', error, 1);
    let job = await prisma.outboxRecord.findFirstOrThrow({ where: { idempotencyKey: 'settle-fail' } });
    expect(job.attempts).toBe(1);
    expect(job.status).toBe(OutboxStatus.PENDING);
    // The stored error carries no applicant content.
    expect(job.lastError).toBe('Error: provider exploded');

    await failOutbox('settle-fail', error, 1);
    job = await prisma.outboxRecord.findFirstOrThrow({ where: { idempotencyKey: 'settle-fail' } });
    expect(job.attempts).toBe(2);
    expect(job.status).toBe(OutboxStatus.FAILED);
    expect(job.deadLetteredAt).not.toBeNull();
  });

  it('gives the dispatch job no retries at all', async () => {
    const { jobRetryPolicy } = await import('@/server/domain/jobs');
    // A dispatch that might have gone out is reconciled, never retried.
    expect(jobRetryPolicy[JOB.dispatchMessage].retryLimit).toBe(0);
    expect(jobRetryPolicy[JOB.reconcileMessage].retryLimit).toBeGreaterThan(0);
  });
});

describe('9. permission changes between enqueue and execution are respected', () => {
  it('blocks a queued send whose consent was revoked in the meantime', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Queued before the opt-out',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, {
      messageId: draft.id,
      sendAt: new Date(CLOCK.getTime() + 3_600_000),
    });

    // The applicant opts out after the job is scheduled.
    const { suppressSmsForContactValue } = await import('@/server/services/consent');
    await prisma.$transaction((tx) =>
      suppressSmsForContactValue(tx, {
        organizationId: workspace.organization.id,
        contactValue: PHONE,
        source: 'sms_keyword:STOP',
      }),
    );

    __setClock(new Date(CLOCK.getTime() + 2 * 3_600_000));
    const result = await handlers[JOB.dispatchMessage]({
      organizationId: workspace.organization.id,
      messageId: draft.id,
    });
    expect(result.detail).toMatch(/BLOCKED/);
    const message = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(message.state).toBe('BLOCKED');
    expect(message.providerMessageId).toBeNull();
  });

  it('blocks a queued send whose case was closed in the meantime', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Queued before the closure',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });

    await prisma.applicant.update({
      where: { id: applicantId },
      data: { status: 'CLOSED', closureReason: 'APPLICANT_WITHDREW', closedAt: now() },
    });

    const result = await handlers[JOB.dispatchMessage]({
      organizationId: workspace.organization.id,
      messageId: draft.id,
    });
    expect(result.detail).toMatch(/BLOCKED/);
  });
});

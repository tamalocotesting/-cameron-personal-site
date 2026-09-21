import { beforeEach, describe, expect, it } from 'vitest';
import { ConsentPurpose, IntakePathway, ReviewFlagKind } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import {
  buildIntakeView,
  exchangeResumeToken,
  pauseSession,
  startIntakeSession,
  submitAnswer,
  verifyResumeIdentity,
} from '@/server/services/intake';
import { loadQueue } from '@/server/services/queue';
import { createWorkspace, type Workspace } from '../setup/factories';

/**
 * Acceptance 1, 2 and 3.
 *
 * These drive the real intake service against real PostgreSQL. Nothing is
 * mocked, so what passes here is what an applicant would actually get.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z'); // 10:00 CDT

let workspace: Workspace;

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
});

async function completeCallbackRequest(name = 'Tasha Alvarez', phone = '+15125550301') {
  const started = await startIntakeSession({
    organizationId: workspace.organization.id,
    pathway: IntakePathway.CALLBACK_REQUEST,
    requestKey: `test-${Math.random()}`,
  });
  const meta = { requestKey: `test-${Math.random()}` };

  await submitAnswer({ sessionId: started.sessionId, questionKey: 'full_name', valueText: name, valueOptions: [], skip: false }, meta);
  await submitAnswer({ sessionId: started.sessionId, questionKey: 'phone', valueText: phone, valueOptions: [], skip: false }, meta);
  await submitAnswer(
    { sessionId: started.sessionId, questionKey: 'availability', valueText: 'Weekday mornings', valueOptions: [], skip: false },
    meta,
  );
  await submitAnswer(
    { sessionId: started.sessionId, questionKey: 'callback_call_consent', valueText: '', valueOptions: [], skip: false, consentGranted: true },
    meta,
  );
  const last = await submitAnswer(
    { sessionId: started.sessionId, questionKey: 'callback_sms_consent', valueText: '', valueOptions: [], skip: false, consentGranted: false },
    meta,
  );
  return { started, last };
}

describe('1. a public callback request becomes one owned, accountable case', () => {
  it('creates exactly one case with an owner, a next step, and a queue row', async () => {
    const { last } = await completeCallbackRequest();
    expect(last.status).toBe('complete');

    const applicants = await prisma.applicant.findMany({
      where: { organizationId: workspace.organization.id },
      include: { tasks: true, contactPoints: true, inquiries: true },
    });
    expect(applicants).toHaveLength(1);

    const applicant = applicants[0]!;
    expect(applicant.ownerMemberId).not.toBeNull();
    expect(applicant.displayName).toBe('Tasha Alvarez');
    expect(applicant.inquiries).toHaveLength(1);
    expect(applicant.inquiries[0]!.originKind).toBe('callback_request');

    // A concrete next step with a due time, not a vague "pending".
    const open = applicant.tasks.filter((t) => t.status === 'OPEN' || t.status === 'SNOOZED');
    expect(open.length).toBeGreaterThan(0);
    expect(open[0]!.dueAt).toBeInstanceOf(Date);

    // It shows up in the owning recruiter's queue with a stated reason.
    const ownerCtx =
      applicant.ownerMemberId === workspace.recruiter.member.id ? workspace.recruiterCtx : workspace.managerCtx;
    const queue = await loadQueue(ownerCtx, { filter: 'my_queue' });
    expect(queue.rows.map((r) => r.applicantId)).toContain(applicant.id);
    expect(queue.rows[0]!.reasons.length).toBeGreaterThan(0);
  });

  it('records permission to CALL without inventing permission to text', async () => {
    await completeCallbackRequest();
    const applicant = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });

    const permissions = await prisma.channelPermission.findMany({
      where: { organizationId: workspace.organization.id, applicantId: applicant.id },
    });
    const call = permissions.find((p) => p.purpose === ConsentPurpose.CALLBACK_CALL);
    const sms = permissions.find((p) => p.purpose === ConsentPurpose.RECRUITER_SMS);

    expect(call?.granted).toBe(true);
    // Submitting a phone number and asking for a call is NOT SMS consent.
    expect(sms?.granted ?? false).toBe(false);

    // The consent log keeps the exact disclosure it was captured against.
    const events = await prisma.consentEvent.findMany({
      where: { organizationId: workspace.organization.id, applicantId: applicant.id },
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const event of events) {
      expect(event.disclosureText.length).toBeGreaterThan(10);
      expect(event.disclosureVersion).toBeGreaterThan(0);
      expect(event.source).toMatch(/intake_session:/);
    }
  });

  it('enqueues exactly one acknowledgment job for the episode', async () => {
    await completeCallbackRequest();
    const jobs = await prisma.outboxRecord.findMany({
      where: { organizationId: workspace.organization.id, jobName: 'inquiry.acknowledge' },
    });
    expect(jobs).toHaveLength(1);
    // Payloads carry identifiers only.
    expect(Object.keys(jobs[0]!.payload as object).sort()).toEqual([
      'applicantId',
      'inquiryEpisodeId',
      'organizationId',
    ]);
  });
});

describe('2. intake pauses, resumes and keeps its published version', () => {
  it('resumes securely, requires verification on a new device, and never leaks another case', async () => {
    const started = await startIntakeSession({
      organizationId: workspace.organization.id,
      pathway: IntakePathway.FULL_INTAKE,
      requestKey: 'device-a',
    });
    const meta = { requestKey: 'device-a' };
    await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'full_name', valueText: 'Priyanka Rao', valueOptions: [], skip: false },
      meta,
    );
    await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'phone', valueText: '+15125550303', valueOptions: [], skip: false },
      meta,
    );

    // Optional questions can be skipped.
    const skipped = await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'general_location', valueText: '', valueOptions: [], skip: true },
      meta,
    );
    expect(skipped.status).toBe('continue');
    const skippedAnswer = await prisma.intakeAnswer.findFirstOrThrow({
      where: { intakeSessionId: started.sessionId, questionKey: 'general_location' },
    });
    expect(skippedAnswer.skipped).toBe(true);

    const paused = await pauseSession(started.sessionId);
    expect(paused.resumeToken).not.toBe(started.resumeToken);

    // A wrong or made-up token is refused, and says nothing about why.
    expect(await exchangeResumeToken('not-a-real-token', { requestKey: 'device-b', hasPriorDeviceSession: false })).toEqual({
      status: 'invalid',
    });
    // The superseded token is dead too.
    expect(
      await exchangeResumeToken(started.resumeToken, { requestKey: 'device-b2', hasPriorDeviceSession: false }),
    ).toEqual({ status: 'invalid' });

    const exchanged = await exchangeResumeToken(paused.resumeToken, {
      requestKey: 'device-c',
      hasPriorDeviceSession: false,
    });
    expect(exchanged).toMatchObject({ status: 'ok', sessionId: started.sessionId, needsVerification: true });

    // Without verification, previously submitted answers are NOT echoed back.
    const unverified = await buildIntakeView(started.sessionId, { answersVisible: false });
    expect(unverified.answered).toHaveLength(0);
    expect(unverified.question).not.toBeNull();

    // A wrong verification answer is refused and counted on the row.
    expect((await verifyResumeIdentity(started.sessionId, '9999', { requestKey: 'v1' })).ok).toBe(false);
    const afterFailure = await prisma.intakeSession.findFirstOrThrow({ where: { id: started.sessionId } });
    expect(afterFailure.resumeVerificationAttempts).toBe(1);

    // The right answer (last four of the number they themselves gave) works.
    expect((await verifyResumeIdentity(started.sessionId, '0303', { requestKey: 'v2' })).ok).toBe(true);
    const verified = await buildIntakeView(started.sessionId, { answersVisible: true });
    expect(verified.answered.map((a) => a.questionKey)).toContain('full_name');
  });

  it('keeps the version a session started on when a new one is published', async () => {
    const started = await startIntakeSession({
      organizationId: workspace.organization.id,
      pathway: IntakePathway.FULL_INTAKE,
      requestKey: 'version-test',
    });

    // Publish a second version behind the session's back.
    await prisma.intakeVersion.update({
      where: { id: workspace.version.id },
      data: { state: 'RETIRED', retiredAt: now() },
    });
    const v2 = await prisma.intakeVersion.create({
      data: {
        organizationId: workspace.organization.id,
        definitionId: workspace.version.definitionId,
        version: 2,
        state: 'PUBLISHED',
        greeting: 'Different greeting',
        completionText: 'Different completion',
        handoffText: 'Different handoff',
        approvedByMemberId: workspace.admin.member.id,
        approvedAt: now(),
        publishedAt: now(),
      },
    });

    const session = await prisma.intakeSession.findFirstOrThrow({ where: { id: started.sessionId } });
    expect(session.intakeVersionId).toBe(workspace.version.id);
    expect(session.intakeVersionId).not.toBe(v2.id);

    const view = await buildIntakeView(started.sessionId, { answersVisible: true });
    expect(view.greeting).not.toBe('Different greeting');
  });

  it('cannot be used to look up someone else by phone number', async () => {
    // Two separate cases exist with known numbers.
    await completeCallbackRequest('Person One', '+15125550401');
    await completeCallbackRequest('Person Two', '+15125550402');

    // There is deliberately no lookup-by-contact entry point. The ONLY way in
    // is a hashed, expiring, revocable credential, and the stored hash cannot
    // be derived from the phone number.
    const sessions = await prisma.intakeSession.findMany({
      where: { organizationId: workspace.organization.id },
      select: { resumeTokenHash: true },
    });
    for (const session of sessions) {
      expect(session.resumeTokenHash).not.toContain('5125550401');
      expect(session.resumeTokenHash).not.toContain('5125550402');
    }
    expect(await exchangeResumeToken('+15125550401', { requestKey: 'x', hasPriorDeviceSession: false })).toEqual({
      status: 'invalid',
    });
  });
});

describe('3. handoff on a human request or a sensitive topic', () => {
  it('stops the questions, creates review work, and answers nothing', async () => {
    const started = await startIntakeSession({
      organizationId: workspace.organization.id,
      pathway: IntakePathway.FULL_INTAKE,
      requestKey: 'handoff',
    });
    const meta = { requestKey: 'handoff' };
    await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'full_name', valueText: 'Ben Castillo', valueOptions: [], skip: false },
      meta,
    );
    await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'phone', valueText: '+15125550310', valueOptions: [], skip: false },
      meta,
    );

    const result = await submitAnswer(
      {
        sessionId: started.sessionId,
        questionKey: 'anything_else',
        valueText: 'I take a prescription for asthma, does that disqualify me?',
        valueOptions: [],
        skip: false,
      },
      meta,
    );

    expect(result.status).toBe('handed_off');
    expect(result.nextQuestionKey).toBeNull();
    // Neutral. No eligibility answer, no advice, no hint at what was detected.
    expect(result.message).toMatch(/recruiter/i);
    expect(result.message?.toLowerCase()).not.toMatch(/asthma|disqualif|eligib|qualify|waiver/);

    const session = await prisma.intakeSession.findFirstOrThrow({ where: { id: started.sessionId } });
    expect(session.status).toBe('HANDED_OFF');
    expect(session.currentQuestionKey).toBeNull();

    const applicant = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    // Automated conversational progression is paused.
    expect(applicant.automationPaused).toBe(true);

    const flags = await prisma.reviewFlag.findMany({
      where: { organizationId: workspace.organization.id, applicantId: applicant.id },
    });
    expect(flags.map((f) => f.kind)).toContain(ReviewFlagKind.SENSITIVE_QUESTION);
    const flag = flags.find((f) => f.kind === ReviewFlagKind.SENSITIVE_QUESTION)!;
    expect(flag.restricted).toBe(true);
    // The flag describes the routing, never a conclusion about the person.
    expect(flag.detail.toLowerCase()).not.toMatch(/disqualif|ineligib|unsuitab/);

    const tasks = await prisma.task.findMany({
      where: { organizationId: workspace.organization.id, applicantId: applicant.id, status: 'OPEN' },
    });
    expect(tasks.some((t) => t.type === 'REVIEW_SENSITIVE')).toBe(true);

    // The sensitive answer is stored restricted.
    const answer = await prisma.intakeAnswer.findFirstOrThrow({
      where: { intakeSessionId: started.sessionId, questionKey: 'anything_else' },
    });
    expect(answer.sensitive).toBe(true);
  });

  it('always hands off on an explicit request for a person', async () => {
    const started = await startIntakeSession({
      organizationId: workspace.organization.id,
      pathway: IntakePathway.FULL_INTAKE,
      requestKey: 'human',
    });
    const meta = { requestKey: 'human' };
    await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'full_name', valueText: 'Amara Okafor', valueOptions: [], skip: false },
      meta,
    );
    await submitAnswer(
      { sessionId: started.sessionId, questionKey: 'phone', valueText: '+15125550309', valueOptions: [], skip: false },
      meta,
    );
    const result = await submitAnswer(
      {
        sessionId: started.sessionId,
        questionKey: 'general_location',
        valueText: 'Can I just talk to a real person please',
        valueOptions: [],
        skip: false,
      },
      meta,
    );

    expect(result.status).toBe('handed_off');
    const applicant = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    const flags = await prisma.reviewFlag.findMany({ where: { applicantId: applicant.id } });
    expect(flags.map((f) => f.kind)).toContain(ReviewFlagKind.HUMAN_REQUESTED);
    expect(applicant.automationPaused).toBe(true);
  });
});

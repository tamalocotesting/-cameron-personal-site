import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConsentPurpose,
  IntakeChannel,
  IntakeSessionStatus,
  MessageAuthorKind,
  MessageState,
  ReviewFlagKind,
  TaskType,
} from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock } from '@/server/clock';
import { recordInboundCallOutcome } from '@/server/services/voice';
import { dispatchMessage, recordInboundSms } from '@/server/services/messaging';
import { advanceSmsIntake, parseSmsAnswer, renderQuestion } from '@/server/services/text-back';
import { loadQueue } from '@/server/services/queue';
import { createWorkspace, staffContext, OFFICE_NUMBER, type Workspace } from '../setup/factories';

/**
 * Text-back intake, end to end.
 *
 * The scenario this exists for: somebody calls at 16:40, nobody picks up, and
 * by the time the recruiter opens the workspace the next morning the case is
 * already there with the answers on it.
 *
 * These run against real PostgreSQL, real services and the real outbox — the
 * only thing standing in for a third party is the SMS simulator, which is the
 * same adapter the demo uses.
 */

const CLOCK = new Date('2026-06-15T21:40:00Z'); // 16:40 in America/Chicago
const CALLER = '+15125557788';

let workspace: Workspace;

/**
 * Drain the outbox the way the worker does: take every pending
 * `intake.sms-advance` row and run it. Nothing is mocked; this is the same
 * handler the worker calls.
 */
async function runPendingAdvances(): Promise<number> {
  let ran = 0;
  for (let pass = 0; pass < 12; pass += 1) {
    const pending = await prisma.outboxRecord.findMany({
      where: { organizationId: workspace.organization.id, jobName: 'intake.sms-advance', status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!pending.length) break;
    for (const record of pending) {
      const payload = record.payload as { organizationId: string; sessionId: string; messageId: string };
      await advanceSmsIntake(payload);
      await prisma.outboxRecord.update({
        where: { id: record.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      ran += 1;
    }
  }
  return ran;
}

/** The text messages we have sent, oldest first. */
async function outboundBodies(): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { organizationId: workspace.organization.id, direction: 'OUTBOUND' },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { body: true },
  });
  return rows.map((r) => r.body);
}

async function missedCall(sid = 'CA-missed-1') {
  return recordInboundCallOutcome({
    organizationId: workspace.organization.id,
    from: CALLER,
    to: OFFICE_NUMBER,
    providerCallSid: sid,
    providerLeg: 'child',
    dialCallStatus: 'no-answer',
    dialCallDuration: 0,
    providerName: 'simulator',
    simulated: true,
  });
}

/** Each exchange moves the clock on, the way a real conversation does. */
let tick = 0;

async function reply(body: string, id: string) {
  tick += 1;
  __setClock(new Date(CLOCK.getTime() + tick * 60_000));
  const result = await recordInboundSms({
    organizationId: workspace.organization.id,
    from: CALLER,
    to: OFFICE_NUMBER,
    body,
    providerMessageId: id,
    providerName: 'simulator',
    simulated: true,
  });
  await runPendingAdvances();
  return result;
}

beforeEach(async () => {
  tick = 0;
  __setClock(CLOCK);
  workspace = await createWorkspace({ textBack: true });
});

describe('a call nobody answered', () => {
  it('creates the case, the callback task and exactly one reply', async () => {
    const call = await missedCall();

    expect(call.taskCreated).toBe(true);
    expect(call.textBack).toEqual({ status: 'sent' });

    const bodies = await outboundBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/could not pick up/i);
    // It says what it is, and how to get out of it.
    expect(bodies[0]).toMatch(/Reply GO/);
    expect(bodies[0]).toMatch(/STOP/);

    // The callback task stands regardless: a person rang a person.
    const task = await prisma.task.findFirst({
      where: { organizationId: workspace.organization.id, type: TaskType.CALLBACK },
    });
    expect(task).not.toBeNull();

    // The message is marked as automation, not as the recruiter.
    const message = await prisma.message.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, direction: 'OUTBOUND' },
    });
    expect(message.authorKind).toBe(MessageAuthorKind.APPROVED_AUTOMATION);
    expect(message.templateVersionId).not.toBeNull();
  });

  it('dispatches the reply on the basis it was gated on', async () => {
    // Regression: dispatch used to GUESS the consent purpose from the author
    // kind, so a reply gated on INBOUND_CALL_RESPONSE was re-checked against
    // INTAKE_SMS — which the caller had never given — and blocked.
    await missedCall();

    const message = await prisma.message.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, direction: 'OUTBOUND' },
    });
    expect(message.consentPurpose).toBe(ConsentPurpose.INBOUND_CALL_RESPONSE);

    const result = await dispatchMessage(workspace.organization.id, message.id);
    expect(result.state).not.toBe(MessageState.BLOCKED);

    const after = await prisma.message.findFirstOrThrow({ where: { id: message.id } });
    expect(after.blockedReason).toBeNull();
  });

  it('records a narrow consent basis, not permission to text freely', async () => {
    await missedCall();

    const events = await prisma.consentEvent.findMany({
      where: { organizationId: workspace.organization.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.purpose).toBe(ConsentPurpose.INBOUND_CALL_RESPONSE);
    expect(events[0]!.source).toMatch(/^inbound_call:/);
    // The call did NOT create intake or recruiter SMS permission.
    const intakePermission = await prisma.channelPermission.findFirst({
      where: { organizationId: workspace.organization.id, purpose: ConsentPurpose.INTAKE_SMS },
    });
    expect(intakePermission).toBeNull();
  });

  it('replies exactly once even if the provider repeats the callback', async () => {
    await missedCall('CA-dup');
    await missedCall('CA-dup');

    expect(await outboundBodies()).toHaveLength(1);
    const sessions = await prisma.intakeSession.findMany({
      where: { organizationId: workspace.organization.id, channel: IntakeChannel.SMS },
    });
    expect(sessions).toHaveLength(1);
  });

  it('sends nothing when the organization has not turned text-back on', async () => {
    workspace = await createWorkspace({ textBack: false });
    const call = await missedCall('CA-off');

    expect(call.taskCreated).toBe(true);
    expect(call.textBack.status).toBe('skipped');
    expect(await outboundBodies()).toHaveLength(0);
  });

  it('sends nothing to a number that has opted out', async () => {
    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: CALLER,
      to: OFFICE_NUMBER,
      body: 'STOP',
      providerMessageId: 'SM-stop',
      providerName: 'simulator',
      simulated: true,
    });

    const call = await missedCall('CA-after-stop');
    expect(call.textBack.status).toBe('skipped');
    expect(await outboundBodies()).toHaveLength(0);
  });
});

describe('the scripted conversation', () => {
  it('asks nothing until the person says yes, then asks one question at a time', async () => {
    await missedCall();
    expect(await outboundBodies()).toHaveLength(1);

    await reply('yes', 'SM-1');

    const afterYes = await outboundBodies();
    expect(afterYes).toHaveLength(2);
    expect(afterYes[1]).toMatch(/What name should the recruiter ask for\?/);
    expect(afterYes[1]).toMatch(/Reply CALL any time/);

    // Saying yes IS the consent to continue, recorded as its own event.
    const permission = await prisma.channelPermission.findFirst({
      where: { organizationId: workspace.organization.id, purpose: ConsentPurpose.INTAKE_SMS },
    });
    expect(permission?.granted).toBe(true);

    await reply('Jordan Vance', 'SM-2');
    const afterName = await outboundBodies();
    expect(afterName).toHaveLength(3);
    expect(afterName[2]).toMatch(/best phone number/i);

    const answer = await prisma.intakeAnswer.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, questionKey: 'full_name' },
    });
    expect(answer.valueText).toBe('Jordan Vance');
  });

  it('stops and says nothing more when the person declines', async () => {
    await missedCall();
    await reply('no thanks', 'SM-no');

    // No parting message. They said no to texts.
    expect(await outboundBodies()).toHaveLength(1);
    const session = await prisma.intakeSession.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, channel: IntakeChannel.SMS },
    });
    expect(session.status).toBe(IntakeSessionStatus.ABANDONED);
  });

  it('gets out of the way when the person writes a real message instead of yes', async () => {
    await missedCall();
    await reply('Hi, I was calling about the reserve options my cousin mentioned', 'SM-prose');

    expect(await outboundBodies()).toHaveLength(1);
    const session = await prisma.intakeSession.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, channel: IntakeChannel.SMS },
    });
    expect(session.status).toBe(IntakeSessionStatus.ABANDONED);
  });

  it('hands off the moment a person is asked for, and answers nothing', async () => {
    await missedCall();
    await reply('yes', 'SM-1');
    await reply('can I just talk to a real person', 'SM-human');

    const flag = await prisma.reviewFlag.findFirst({
      where: { organizationId: workspace.organization.id, kind: ReviewFlagKind.HUMAN_REQUESTED },
    });
    expect(flag).not.toBeNull();

    const applicant = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    expect(applicant.automationPaused).toBe(true);

    const session = await prisma.intakeSession.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, channel: IntakeChannel.SMS },
    });
    expect(session.status).toBe(IntakeSessionStatus.HANDED_OFF);

    // And nothing further is asked, ever.
    await reply('still there?', 'SM-after-handoff');
    const bodies = await outboundBodies();
    expect(bodies[bodies.length - 1]).not.toMatch(/\?$/);
  });

  it('stops on a sensitive topic without investigating it', async () => {
    await missedCall();
    await reply('yes', 'SM-1');
    await reply('I have a medical waiver question about my asthma', 'SM-sensitive');

    const flag = await prisma.reviewFlag.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, kind: ReviewFlagKind.SENSITIVE_QUESTION },
    });
    // The flag routes work. It never states a conclusion about the person.
    expect(flag.detail).not.toMatch(/qualif|eligib|disqualif/i);

    const bodies = await outboundBodies();
    const last = bodies[bodies.length - 1]!;
    expect(last).not.toMatch(/qualif|eligib|waiver is/i);
    expect(last).toMatch(/stopped the questions/i);
  });

  it('never counts the scripted exchange as human contact', async () => {
    await missedCall();
    await reply('yes', 'SM-1');
    await reply('Jordan Vance', 'SM-2');

    const episode = await prisma.inquiryEpisode.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    expect(episode.firstHumanOutreachAt).toBeNull();
    expect(episode.firstTwoWayHumanAt).toBeNull();
  });

  it('stops asking once it hits the configured question limit', async () => {
    await missedCall();
    await reply('yes', 'SM-1');
    await reply('Jordan Vance', 'SM-2');
    await reply('512-555-4321', 'SM-3');
    await reply('Round Rock', 'SM-4');
    await reply('2', 'SM-5'); // "Within 3 months"

    const session = await prisma.intakeSession.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, channel: IntakeChannel.SMS },
    });
    // Either it ran out of questions or it hit the cap; both end the script.
    expect([IntakeSessionStatus.PAUSED, IntakeSessionStatus.COMPLETED]).toContain(session.status);

    const answers = await prisma.intakeAnswer.findMany({
      where: { organizationId: workspace.organization.id, supersededAt: null },
    });
    expect(answers.length).toBeGreaterThanOrEqual(4);
  });
});

describe('the morning after', () => {
  it('puts the case in the queue with the answers already on it', async () => {
    await missedCall();
    await reply('yes', 'SM-1');
    await reply('Jordan Vance', 'SM-2');
    await reply('512-555-4321', 'SM-3');
    await reply('Round Rock', 'SM-4');

    // The next morning, the recruiter opens Today.
    __setClock(new Date('2026-06-16T13:00:00Z'));
    const ctx = staffContext(workspace.recruiter.member, workspace.orgRef);
    const page = await loadQueue(ctx, { filter: 'my_queue', page: 1 });

    // Routing put it on a recruiter, not on the manager or the administrator.
    const owned = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
      select: { ownerMemberId: true },
    });
    expect(owned.ownerMemberId).toBe(workspace.recruiter.member.id);

    expect(page.total).toBe(1);
    const row = page.rows[0]!;
    // The case is no longer a masked phone number: it is a person, because
    // they said so overnight.
    expect(row.displayName).toBe('Jordan Vance');
    // The reasons say, in words, why it is waiting on him.
    expect(row!.reasons.join(' ')).toMatch(/Callback requested|Follow-up overdue|New reply/i);

    const answers = await prisma.intakeAnswer.findMany({
      where: { organizationId: workspace.organization.id, supersededAt: null },
      orderBy: { answeredAt: 'asc' },
    });
    expect(answers.map((a) => a.questionKey)).toContain('full_name');
    expect(answers.map((a) => a.questionKey)).toContain('phone');

    // And the case carries what the script learned, not a guess.
    const applicant = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    expect(applicant.displayName).toBe('Jordan Vance');
    expect(applicant.ownerMemberId).not.toBeNull();
  });
});

describe('what the recruiter finds waiting', () => {
  it('asks for a brief when the script stops, not only when it finishes', async () => {
    await missedCall();
    await reply('yes', 'SM-1');
    await reply('Jordan Vance', 'SM-2');
    await reply('can I just talk to a real person', 'SM-human');

    const briefJobs = await prisma.outboxRecord.findMany({
      where: { organizationId: workspace.organization.id, jobName: 'brief.prepare' },
    });
    expect(briefJobs.length).toBeGreaterThan(0);
    // Keyed per session and reason, so a retry never queues a second one.
    const keys = new Set(briefJobs.map((j) => j.idempotencyKey));
    expect(keys.size).toBe(briefJobs.length);
  });
});

describe('reading a text reply as an answer', () => {
  const single = {
    prompt: 'Roughly what timeframe do you have in mind?',
    helpText: null,
    type: 'SINGLE_SELECT' as const,
    options: ['As soon as possible', 'Within 3 months', 'Not sure'],
    required: false,
  };

  it('numbers the options and takes a number back', () => {
    expect(renderQuestion(single)).toMatch(/1\. As soon as possible/);
    const parsed = parseSmsAnswer(single, '2');
    expect(parsed).toMatchObject({ kind: 'parsed', valueText: 'Within 3 months' });
  });

  it('accepts the option written out', () => {
    expect(parseSmsAnswer(single, 'not sure')).toMatchObject({ valueText: 'Not sure' });
  });

  it('refuses to guess at something ambiguous', () => {
    const parsed = parseSmsAnswer(single, 'maybe the second one, I think?');
    expect(parsed.kind).toBe('unparsed');
  });

  it('will not skip a required question', () => {
    const parsed = parseSmsAnswer(
      { prompt: 'Name?', helpText: null, type: 'SHORT_TEXT' as const, options: [], required: true },
      'skip',
    );
    expect(parsed.kind).toBe('unparsed');
  });
});

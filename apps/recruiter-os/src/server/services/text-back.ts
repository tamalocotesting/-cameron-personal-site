import 'server-only';
import {
  ConsentAction,
  ConsentPurpose,
  ContactChannel,
  IntakeChannel,
  IntakePathway,
  IntakeSessionStatus,
  QuestionType,
  ReviewFlagKind,
  TaskType,
  type IntakeQuestion,
  type IntakeSession,
} from '@prisma/client';
import { prisma, type DbOrTx } from '@/server/db';
import { now } from '@/server/clock';
import { maskContact } from '@/lib/redact';
import { systemContext } from '@/server/authz/policy';
import { auditOperational } from '@/server/audit';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { DISCLOSURES, recordConsent } from './consent';
import { sendApprovedTemplate } from './messaging';
import { submitAnswer, loadSession, getPublishedIntake } from './intake';
import { detectHumanRequest, detectSensitive, HUMAN_REQUEST_TEXT, NEUTRAL_HANDOFF_TEXT } from './sensitive';
import { raiseReviewFlag } from './cases';
import { ensureTaskOnce } from './tasks';

/**
 * Text-back intake: answering a call nobody picked up.
 *
 * The problem this solves is the one a recruiter actually has. Somebody calls
 * at 14:40 while the recruiter is in a school. By the time he calls back the
 * person does not answer. He texts. They reply two days later. Four rounds of
 * missed contact later he still does not know the first thing about them.
 *
 * So: the call goes unanswered, ONE automated message goes back to that same
 * number saying so, and — only if the person says yes — the SAME scripted,
 * versioned intake runs over SMS, one question per message. In the morning the
 * recruiter opens Today and the case is already there with the answers, a
 * source-linked brief and a callback task.
 *
 * What this deliberately is NOT:
 *
 *   * It is not an autonomous agent. It asks the published question set in
 *     order. It cannot improvise, answer a question, or say anything that is
 *     not in an approved versioned artifact.
 *   * It is not permission to market to someone. A missed call authorizes ONE
 *     reply (`INBOUND_CALL_RESPONSE`), inside a configured window, to the
 *     number that called. Continuing by text needs an explicit yes, recorded
 *     separately as `INTAKE_SMS`.
 *   * It is not a substitute for the recruiter. The callback task stands
 *     whether or not the script runs, because the person asked for a human by
 *     calling one.
 *   * It never decides anything about the person. Sensitive topics and any
 *     request for a person stop the script immediately.
 *
 * It is off by default (`OrganizationSettings.textBackEnabled`). Whether to
 * text somebody who called you is a decision with legal weight, and it belongs
 * to the organization deploying this, not to a product default.
 */

/** The template that carries the single reply to a call nobody answered. */
export const MISSED_CALL_TEMPLATE_KEY = 'missed_call_reply';

/**
 * The template every scripted SMS message goes out through.
 *
 * Its body is a single placeholder on purpose. The words come from the
 * PUBLISHED intake version — which is itself immutable, approved and
 * versioned — while the template keeps these messages on the same automation
 * allowlist, approval check and idempotency path as every other automated
 * send. Both halves are approved artifacts; neither is free text.
 */
export const INTAKE_PROMPT_TEMPLATE_KEY = 'intake_sms_prompt';

/**
 * What counts as "yes, go ahead".
 *
 * The invitation asks for GO rather than YES on purpose: YES, START and
 * UNSTOP are carrier opt-in keywords that the provider answers itself. People
 * will reply YES anyway, so it is accepted here too — the inbound path routes
 * a START keyword to a waiting script rather than swallowing it.
 */
const AFFIRMATIVE = /^(go|y|ya|yes|yeah|yep|yup|sure|ok|okay|k|start|begin|please|sounds good)\b/i;
const DECLINE = /^(n|no|nope|nah|not now|later|busy|stop texting|don'?t text)\b/i;
const SKIP_WORDS = /^(skip|pass|next|n\/a|na)\b/i;

/** Marker prepended to nothing — kept as one place to change the suffix. */
const HUMAN_ESCAPE_HINT = 'Reply CALL any time to talk to a person instead.';

// ---------------------------------------------------------------------------
// Offering the script after a missed call
// ---------------------------------------------------------------------------

export type TextBackOffer =
  | { status: 'sent'; sessionId: string; messageId: string }
  | { status: 'skipped'; reason: string };

/**
 * Called from the inbound-call handler when the forwarded leg was not
 * answered. Runs inside that handler's transaction, so the case, the callback
 * task, the consent record, the intake session and the queued message are one
 * atomic unit — there is no state where the text went out but the session
 * that has to answer the reply does not exist.
 */
export async function offerTextBackAfterMissedCall(
  db: DbOrTx,
  input: {
    organizationId: string;
    applicantId: string;
    callerNumber: string;
    providerCallSid: string;
    calledAt: Date;
  },
): Promise<TextBackOffer> {
  const at = now();
  const ctx = systemContext(input.organizationId, 'text-back');

  const settings = await db.organizationSettings.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!settings) return { status: 'skipped', reason: 'Organization settings are missing.' };
  if (!settings.textBackEnabled) {
    return { status: 'skipped', reason: 'Text-back is turned off for this organization.' };
  }

  // A reply that arrives long after the call is not "we just missed you", it
  // is an unsolicited text. Past the window, the recruiter calls back instead.
  const minutesSince = (at.getTime() - input.calledAt.getTime()) / 60_000;
  if (minutesSince > settings.textBackWindowMinutes) {
    return {
      status: 'skipped',
      reason: `The call was ${Math.round(minutesSince)} minutes ago, past the ${settings.textBackWindowMinutes}-minute reply window.`,
    };
  }

  // One live script per number. Two conversations with the same phone is how
  // people end up being spammed by their own recruiter.
  const live = await findLiveSmsSession(db, input.organizationId, input.callerNumber);
  if (live) {
    return { status: 'skipped', reason: 'A text intake is already running with this number.' };
  }

  const version = await getPublishedIntake(input.organizationId);
  if (!version) {
    return { status: 'skipped', reason: 'This organization has no published intake question set.' };
  }

  // The person called us. That is the basis, it is narrow, and it is written
  // down with the call that created it before anything is sent.
  await recordConsent(db, {
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    purpose: ConsentPurpose.INBOUND_CALL_RESPONSE,
    contactValue: input.callerNumber,
    action: ConsentAction.GRANTED,
    disclosure: DISCLOSURES.inbound_call_response,
    source: `inbound_call:${input.providerCallSid}`,
    occurredAt: at,
  });

  const firstQuestion = questionsFor(version.questions, IntakePathway.FULL_INTAKE)[0] ?? null;
  const session = await db.intakeSession.create({
    data: {
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      intakeVersionId: version.id,
      pathway: IntakePathway.FULL_INTAKE,
      channel: IntakeChannel.SMS,
      status: IntakeSessionStatus.IN_PROGRESS,
      smsContactValue: input.callerNumber,
      smsInvitedAt: at,
      // No question is asked until smsOptInAt is set.
      currentQuestionKey: firstQuestion?.key ?? null,
      lastActivityAt: at,
    },
  });

  const sent = await sendApprovedTemplate(db, input.organizationId, {
    applicantId: input.applicantId,
    templateKey: MISSED_CALL_TEMPLATE_KEY,
    purpose: ConsentPurpose.INBOUND_CALL_RESPONSE,
    toValue: input.callerNumber,
    values: {},
    idempotencyKey: `textback:${input.providerCallSid}`,
  });

  if (sent.status === 'blocked') {
    // The invitation could not go out, so the script must not be left waiting
    // for a reply that will never come.
    await db.intakeSession.update({
      where: { id: session.id },
      data: { status: IntakeSessionStatus.ABANDONED, currentQuestionKey: null, version: { increment: 1 } },
    });
    await auditOperational(db, ctx, {
      action: 'textback.blocked',
      subjectType: 'intake_session',
      subjectId: session.id,
      applicantId: input.applicantId,
      metadata: { reason: sent.reason, contact: maskContact(input.callerNumber) },
    });
    return { status: 'skipped', reason: sent.reason };
  }

  await auditOperational(db, ctx, {
    action: 'textback.offered',
    subjectType: 'intake_session',
    subjectId: session.id,
    applicantId: input.applicantId,
    metadata: {
      contact: maskContact(input.callerNumber),
      callSid: input.providerCallSid,
      intakeVersion: version.version,
    },
  });

  return { status: 'sent', sessionId: session.id, messageId: sent.messageId };
}

/** The live scripted conversation with a number, if there is one. */
export async function findLiveSmsSession(
  db: DbOrTx,
  organizationId: string,
  contactValue: string,
): Promise<IntakeSession | null> {
  return db.intakeSession.findFirst({
    where: {
      organizationId,
      channel: IntakeChannel.SMS,
      smsContactValue: contactValue,
      status: { in: [IntakeSessionStatus.IN_PROGRESS, IntakeSessionStatus.PAUSED] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Driving the script
// ---------------------------------------------------------------------------

export type AdvanceResult = {
  outcome: 'opted_in' | 'declined' | 'answered' | 'handed_off' | 'complete' | 'ignored' | 'stopped';
  detail: string;
  sent: boolean;
};

/**
 * Advance the scripted SMS intake by one inbound message.
 *
 * Runs in the worker, not in the webhook: the webhook's job is to validate,
 * persist and acknowledge quickly. Each step re-reads current state, because
 * an opt-out, a recruiter taking over, or a closed case between the reply
 * landing and this running all mean the script must stop.
 */
export async function advanceSmsIntake(input: {
  organizationId: string;
  sessionId: string;
  messageId: string;
}): Promise<AdvanceResult> {
  const ctx = systemContext(input.organizationId, JOB.advanceSmsIntake);

  const session = await loadSession(input.sessionId);
  if (!session || session.organizationId !== input.organizationId) {
    return { outcome: 'ignored', detail: 'That intake session no longer exists.', sent: false };
  }
  if (session.channel !== IntakeChannel.SMS || !session.smsContactValue) {
    return { outcome: 'ignored', detail: 'That session is not a text conversation.', sent: false };
  }
  if (
    session.status !== IntakeSessionStatus.IN_PROGRESS &&
    session.status !== IntakeSessionStatus.PAUSED
  ) {
    return { outcome: 'stopped', detail: `The session is ${session.status.toLowerCase()}.`, sent: false };
  }

  const message = await prisma.message.findFirst({
    where: { id: input.messageId, organizationId: input.organizationId },
    select: { body: true, applicantId: true },
  });
  if (!message?.applicantId) {
    return { outcome: 'ignored', detail: 'That message is not attached to a case.', sent: false };
  }

  const applicant = await prisma.applicant.findFirst({
    where: { id: message.applicantId, organizationId: input.organizationId },
    select: { automationPaused: true, automationPausedReason: true },
  });
  if (applicant?.automationPaused) {
    // A recruiter, a sensitive topic or a human request has already stopped
    // automated conversation on this case. It stays stopped.
    await abandonSession(input.organizationId, session.id, 'automation is paused on this case');
    return {
      outcome: 'stopped',
      detail: applicant.automationPausedReason ?? 'Automation is paused on this case.',
      sent: false,
    };
  }

  const body = message.body.trim();
  const contactValue = session.smsContactValue;

  // ---- a person, asked for at any point, always wins ---------------------
  if (detectHumanRequest(body)) {
    await handOffByText(ctx, {
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      sessionId: session.id,
      contactValue,
      kind: 'human_request',
      sourceRef: `message:${input.messageId}`,
    });
    return { outcome: 'handed_off', detail: 'The person asked for a recruiter.', sent: true };
  }

  const sensitive = detectSensitive(body);
  if (sensitive.sensitive) {
    await handOffByText(ctx, {
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      sessionId: session.id,
      contactValue,
      kind: 'sensitive',
      category: sensitive.category,
      sourceRef: `message:${input.messageId}`,
    });
    return { outcome: 'handed_off', detail: 'A sensitive topic came up.', sent: true };
  }

  // ---- before the person has said yes, nothing is asked ------------------
  if (!session.smsOptInAt) {
    if (DECLINE.test(body)) {
      await abandonSession(input.organizationId, session.id, 'the person declined to continue by text');
      await auditOperational(prisma, ctx, {
        action: 'textback.declined',
        subjectType: 'intake_session',
        subjectId: session.id,
        applicantId: message.applicantId,
        metadata: { contact: maskContact(contactValue) },
      });
      // No parting message: they said no to texts. The callback task the
      // missed call created is still open, and that is the right follow-up.
      return { outcome: 'declined', detail: 'The person declined. Nothing further was sent.', sent: false };
    }

    if (!AFFIRMATIVE.test(body)) {
      // They wrote something real rather than "yes". That is a person talking,
      // and a script should get out of the way.
      await abandonSession(input.organizationId, session.id, 'the person replied with their own message');
      // They wrote something substantive. A brief on what is already known
      // beats the recruiter reading it cold.
      await requestBrief(prisma, {
        organizationId: input.organizationId,
        applicantId: message.applicantId,
        sessionId: session.id,
        reason: 'sms_intake_free_reply',
      });
      return {
        outcome: 'ignored',
        detail: 'The reply was not a yes or a no, so the script stopped and left it to the recruiter.',
        sent: false,
      };
    }

    // An explicit yes IS the consent to continue by text, and it is recorded
    // as its own event with the disclosure they were shown.
    await prisma.$transaction(async (tx) => {
      await recordConsent(tx, {
        organizationId: input.organizationId,
        applicantId: message.applicantId!,
        purpose: ConsentPurpose.INTAKE_SMS,
        contactValue,
        action: ConsentAction.GRANTED,
        disclosure: DISCLOSURES.intake_sms,
        source: `sms_reply:${input.messageId}`,
      });
      await tx.intakeSession.update({
        where: { id: session.id },
        data: { smsOptInAt: now(), lastActivityAt: now(), version: { increment: 1 } },
      });
    });

    const asked = await askCurrentQuestion({
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      sessionId: session.id,
      contactValue,
      stepKey: `optin:${input.messageId}`,
    });
    return { outcome: 'opted_in', detail: asked.detail, sent: asked.sent };
  }

  // ---- an answer to the question we asked --------------------------------
  const questionKey = session.currentQuestionKey;
  if (!questionKey) {
    return { outcome: 'ignored', detail: 'There is no question outstanding.', sent: false };
  }
  // Scoped to the session's pathway on purpose: the callback and full-intake
  // paths share question keys (`full_name`, `phone`), so an unscoped lookup
  // asks the wrong pathway's wording and stores the answer against it.
  const question = questionsFor(session.intakeVersion.questions, session.pathway).find(
    (q) => q.key === questionKey,
  );
  if (!question) {
    return { outcome: 'ignored', detail: 'The outstanding question is not in this pathway.', sent: false };
  }

  const parsed = parseSmsAnswer(question, body);
  if (parsed.kind === 'unparsed') {
    // Do not guess at what somebody meant. Ask once more, in plainer terms.
    const sent = await sayByText({
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      contactValue,
      text: `${parsed.help}\n\n${HUMAN_ESCAPE_HINT}`,
      stepKey: `reask:${input.messageId}`,
    });
    return { outcome: 'ignored', detail: 'The answer could not be read; the question was repeated.', sent };
  }

  let result;
  try {
    result = await submitAnswer(
      {
        sessionId: session.id,
        questionKey,
        valueText: parsed.valueText,
        valueOptions: parsed.valueOptions,
        skip: parsed.skip,
        consentGranted: parsed.consentGranted,
      },
      { requestKey: `sms:${contactValue}` },
    );
  } catch (error) {
    // A validation failure is the person having written something the question
    // cannot accept. Say what is needed; never drop the conversation.
    const detail = error instanceof Error ? error.message : 'That answer could not be used.';
    const sent = await sayByText({
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      contactValue,
      text: `${detail}\n\n${renderQuestion(question)}\n\n${HUMAN_ESCAPE_HINT}`,
      stepKey: `invalid:${input.messageId}`,
    });
    return { outcome: 'ignored', detail, sent };
  }

  if (result.status === 'handed_off') {
    await sayByText({
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      contactValue,
      text: result.message ?? NEUTRAL_HANDOFF_TEXT,
      stepKey: `handoff:${input.messageId}`,
      finalWord: true,
    });
    // The handoff happened inside submitAnswer; the brief request belongs
    // here, where every stopping point in this flow asks for one.
    await requestBrief(prisma, {
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      sessionId: session.id,
      reason: 'sms_intake_handoff',
    });
    return { outcome: 'handed_off', detail: 'The session was handed to a recruiter.', sent: true };
  }

  if (result.status === 'complete') {
    await sayByText({
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      contactValue,
      text: result.message ?? 'Thanks — a recruiter has everything they need to pick this up.',
      stepKey: `complete:${input.messageId}`,
    });
    await requestBrief(prisma, {
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      sessionId: session.id,
      reason: 'sms_intake_complete',
    });
    await auditOperational(prisma, ctx, {
      action: 'textback.completed',
      subjectType: 'intake_session',
      subjectId: session.id,
      applicantId: message.applicantId,
      metadata: { contact: maskContact(contactValue) },
    });
    return { outcome: 'complete', detail: 'The scripted intake finished.', sent: true };
  }

  // ---- stop before the script becomes an interrogation --------------------
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: input.organizationId },
  });
  const answered = await prisma.intakeAnswer.count({
    where: { organizationId: input.organizationId, intakeSessionId: session.id, supersededAt: null },
  });
  if (settings && answered >= settings.textBackMaxQuestions) {
    await pauseForRecruiter(ctx, {
      organizationId: input.organizationId,
      applicantId: message.applicantId,
      sessionId: session.id,
      contactValue,
      answered,
    });
    return {
      outcome: 'stopped',
      detail: `Stopped after ${answered} questions; the rest is for the recruiter.`,
      sent: true,
    };
  }

  const asked = await askCurrentQuestion({
    organizationId: input.organizationId,
    applicantId: message.applicantId,
    sessionId: session.id,
    contactValue,
    stepKey: `answer:${input.messageId}`,
  });
  return { outcome: 'answered', detail: asked.detail, sent: asked.sent };
}

// ---------------------------------------------------------------------------
// Rendering and parsing one question over SMS
// ---------------------------------------------------------------------------

function questionsFor(questions: IntakeQuestion[], pathway: IntakePathway) {
  return questions.filter((q) => q.pathway === pathway).sort((a, b) => a.order - b.order);
}

/**
 * A question as it reads in a text message.
 *
 * The wording is the published question's own. Only the answering
 * instructions are added, because a text message has no radio buttons.
 */
export function renderQuestion(question: Pick<IntakeQuestion, 'prompt' | 'helpText' | 'type' | 'options' | 'required'>): string {
  const lines: string[] = [question.prompt];
  if (question.helpText) lines.push(question.helpText);

  if (question.type === QuestionType.SINGLE_SELECT && question.options.length) {
    lines.push(question.options.map((option, index) => `${index + 1}. ${option}`).join('\n'));
    lines.push('Reply with a number.');
  } else if (question.type === QuestionType.MULTI_SELECT && question.options.length) {
    lines.push(question.options.map((option, index) => `${index + 1}. ${option}`).join('\n'));
    lines.push('Reply with the numbers that apply, separated by commas.');
  } else if (question.type === QuestionType.CONSENT) {
    lines.push('Reply YES or NO.');
  }

  if (!question.required) lines.push('Reply SKIP to skip this one.');
  return lines.join('\n');
}

type ParsedAnswer =
  | { kind: 'parsed'; valueText: string; valueOptions: string[]; skip: boolean; consentGranted?: boolean }
  | { kind: 'unparsed'; help: string };

/**
 * Read a text reply as an answer to a specific question.
 *
 * It refuses rather than guesses. "2" against a five-option list is an answer;
 * "maybe the second one I think" is not, and pretending otherwise would put
 * words in somebody's mouth that a recruiter then acts on.
 */
export function parseSmsAnswer(
  question: Pick<IntakeQuestion, 'prompt' | 'helpText' | 'type' | 'options' | 'required'>,
  body: string,
): ParsedAnswer {
  const trimmed = body.trim();

  if (SKIP_WORDS.test(trimmed)) {
    if (question.required) {
      return {
        kind: 'unparsed',
        help: `That one is needed before a recruiter can pick this up.\n\n${renderQuestion(question)}`,
      };
    }
    return { kind: 'parsed', valueText: '', valueOptions: [], skip: true };
  }

  switch (question.type) {
    case QuestionType.CONSENT: {
      if (AFFIRMATIVE.test(trimmed)) {
        return { kind: 'parsed', valueText: 'yes', valueOptions: [], skip: false, consentGranted: true };
      }
      if (DECLINE.test(trimmed)) {
        return { kind: 'parsed', valueText: 'no', valueOptions: [], skip: false, consentGranted: false };
      }
      return { kind: 'unparsed', help: `${question.prompt}\n\nReply YES or NO.` };
    }

    case QuestionType.SINGLE_SELECT: {
      const choice = matchOption(question.options, trimmed);
      if (!choice) return { kind: 'unparsed', help: renderQuestion(question) };
      return { kind: 'parsed', valueText: choice, valueOptions: [choice], skip: false };
    }

    case QuestionType.MULTI_SELECT: {
      const parts = trimmed.split(/[,;]+|\band\b/i).map((p) => p.trim()).filter(Boolean);
      const chosen: string[] = [];
      for (const part of parts) {
        const match = matchOption(question.options, part);
        if (!match) return { kind: 'unparsed', help: renderQuestion(question) };
        if (!chosen.includes(match)) chosen.push(match);
      }
      if (!chosen.length) return { kind: 'unparsed', help: renderQuestion(question) };
      return { kind: 'parsed', valueText: chosen.join(', '), valueOptions: chosen, skip: false };
    }

    default:
      if (!trimmed) return { kind: 'unparsed', help: renderQuestion(question) };
      return { kind: 'parsed', valueText: trimmed, valueOptions: [], skip: false };
  }
}

/** A reply matches an option by its number, or by the option's exact words. */
function matchOption(options: string[], reply: string): string | null {
  const numeric = Number(reply.replace(/[^\d]/g, ''));
  if (/^\s*\d+\s*[.)]?\s*$/.test(reply) && numeric >= 1 && numeric <= options.length) {
    return options[numeric - 1]!;
  }
  const lowered = reply.toLowerCase();
  return options.find((option) => option.toLowerCase() === lowered) ?? null;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Say one thing by text, through the approved template envelope.
 *
 * Every scripted message goes through `sendApprovedTemplate`, so it is subject
 * to the same allowlist, the same approved published version, the same send
 * gate (opt-out, quiet hours, provider enablement, case state) and the same
 * idempotency key as any other automated send. There is no back door.
 */
async function sayByText(input: {
  organizationId: string;
  applicantId: string;
  contactValue: string;
  text: string;
  stepKey: string;
  /**
   * The one exemption: the message that tells somebody we have stopped and
   * passed them to a person is sent AFTER automation is paused on the case,
   * so it has to be allowed past that particular check. Every other gate —
   * opt-out, permission, quiet hours, provider enablement, the approved
   * template version — still applies to it.
   */
  finalWord?: boolean;
}): Promise<boolean> {
  const sent = await sendApprovedTemplate(prisma, input.organizationId, {
    applicantId: input.applicantId,
    templateKey: INTAKE_PROMPT_TEMPLATE_KEY,
    purpose: ConsentPurpose.INTAKE_SMS,
    toValue: input.contactValue,
    values: { text: input.text },
    idempotencyKey: `sms-intake:${input.stepKey}`,
    ignoreAutomationPause: input.finalWord,
  });
  return sent.status === 'queued';
}

async function askCurrentQuestion(input: {
  organizationId: string;
  applicantId: string;
  sessionId: string;
  contactValue: string;
  stepKey: string;
}): Promise<{ sent: boolean; detail: string }> {
  const session = await loadSession(input.sessionId);
  if (!session?.currentQuestionKey) {
    return { sent: false, detail: 'There is no next question to ask.' };
  }
  const question = questionsFor(session.intakeVersion.questions, session.pathway).find(
    (q) => q.key === session.currentQuestionKey,
  );
  if (!question) return { sent: false, detail: 'The next question is not in this pathway.' };

  const sent = await sayByText({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    contactValue: input.contactValue,
    text: `${renderQuestion(question)}\n\n${HUMAN_ESCAPE_HINT}`,
    stepKey: `${input.stepKey}:${question.key}`,
  });
  return { sent, detail: sent ? `Asked "${question.key}".` : 'The next question could not be sent.' };
}

// ---------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------

/**
 * Ask for a brief once the script stops, whatever stopped it.
 *
 * The whole point of the overnight path is that the recruiter opens the
 * workspace to a prepared case, not a pile of text messages. A handoff or a
 * question cap ends the script just as finally as finishing it does, so each
 * of those asks for a brief too — keyed per session and reason, so a retry
 * never queues a second one. A later event makes the brief visibly stale
 * rather than silently replacing it.
 */
async function requestBrief(
  db: DbOrTx,
  input: { organizationId: string; applicantId: string; sessionId: string; reason: string },
) {
  await enqueue(
    db,
    JOB.prepareBrief,
    {
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      requestedByMemberId: null,
      reason: input.reason,
    },
    { idempotencyKey: `brief:sms-intake:${input.sessionId}:${input.reason}` },
  );
}

async function abandonSession(organizationId: string, sessionId: string, reason: string) {
  await prisma.intakeSession.updateMany({
    where: {
      id: sessionId,
      organizationId,
      status: { in: [IntakeSessionStatus.IN_PROGRESS, IntakeSessionStatus.PAUSED] },
    },
    data: {
      status: IntakeSessionStatus.ABANDONED,
      currentQuestionKey: null,
      lastActivityAt: now(),
      version: { increment: 1 },
    },
  });
  return reason;
}

/**
 * A person asked for, or a sensitive topic. The script stops, automation is
 * paused on the case, a recruiter gets the work, and the one message we send
 * back says so without investigating, reassuring or answering anything.
 */
async function handOffByText(
  ctx: ReturnType<typeof systemContext>,
  input: {
    organizationId: string;
    applicantId: string;
    sessionId: string;
    contactValue: string;
    kind: 'human_request' | 'sensitive';
    category?: string | null;
    sourceRef: string;
  },
) {
  const at = now();
  await prisma.$transaction(async (tx) => {
    await tx.intakeSession.updateMany({
      where: {
        id: input.sessionId,
        organizationId: input.organizationId,
        status: { in: [IntakeSessionStatus.IN_PROGRESS, IntakeSessionStatus.PAUSED] },
      },
      data: {
        status: IntakeSessionStatus.HANDED_OFF,
        handedOffAt: at,
        currentQuestionKey: null,
        version: { increment: 1 },
      },
    });

    // Automation stops on the CASE, not just on this session, so nothing else
    // texts them either.
    await tx.applicant.updateMany({
      where: { id: input.applicantId, organizationId: input.organizationId },
      data: {
        automationPaused: true,
        automationPausedReason:
          input.kind === 'human_request'
            ? 'The applicant asked to speak with a person.'
            : 'A sensitive topic came up and needs a recruiter.',
      },
    });

    await raiseReviewFlag(tx, ctx, {
      applicantId: input.applicantId,
      kind: input.kind === 'human_request' ? ReviewFlagKind.HUMAN_REQUESTED : ReviewFlagKind.SENSITIVE_QUESTION,
      detail:
        input.kind === 'human_request'
          ? 'The applicant asked to speak with a person by text.'
          : `A ${input.category ?? 'sensitive'} topic came up by text. Automation stopped; a recruiter handles it.`,
      restricted: input.kind === 'sensitive',
      sourceRef: input.sourceRef,
      taskTitle:
        input.kind === 'human_request'
          ? 'Call the applicant — they asked for a person'
          : 'Recruiter review required',
      taskDueAt: new Date(at.getTime() + 2 * 3600_000),
    });
  });

  await sayByText({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    contactValue: input.contactValue,
    text: input.kind === 'human_request' ? HUMAN_REQUEST_TEXT : NEUTRAL_HANDOFF_TEXT,
    stepKey: `handoff:${input.sourceRef}`,
    finalWord: true,
  });

  // Whatever the script did learn is worth preparing, so the recruiter picking
  // this up is not starting from a blank case.
  await requestBrief(prisma, {
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    sessionId: input.sessionId,
    reason: `sms_intake_${input.kind}`,
  });
}

/**
 * The script has asked as much as it is allowed to. It stops, says so, and
 * leaves a recruiter holding a case that already has most of the answers.
 */
async function pauseForRecruiter(
  ctx: ReturnType<typeof systemContext>,
  input: {
    organizationId: string;
    applicantId: string;
    sessionId: string;
    contactValue: string;
    answered: number;
  },
) {
  const at = now();
  await prisma.$transaction(async (tx) => {
    await tx.intakeSession.updateMany({
      where: { id: input.sessionId, organizationId: input.organizationId, status: IntakeSessionStatus.IN_PROGRESS },
      data: { status: IntakeSessionStatus.PAUSED, lastActivityAt: at, version: { increment: 1 } },
    });
    await ensureTaskOnce(tx, ctx, {
      applicantId: input.applicantId,
      type: TaskType.FOLLOW_UP,
      title: 'Pick up where the text intake stopped',
      reason: `The scripted text intake asked its ${input.answered} questions and stopped. The rest is a conversation.`,
      dueAt: new Date(at.getTime() + 12 * 3600_000),
      dedupeKey: `textback-max:${input.sessionId}`,
    });
  });

  await sayByText({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    contactValue: input.contactValue,
    text:
      'That is everything I can usefully ask by text. A recruiter has all of this and will follow up with you directly.',
    stepKey: `max:${input.sessionId}`,
  });

  await requestBrief(prisma, {
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    sessionId: input.sessionId,
    reason: 'sms_intake_question_limit',
  });
}

// ---------------------------------------------------------------------------
// Enqueue, from the inbound path
// ---------------------------------------------------------------------------

/**
 * Called inside the inbound-SMS transaction. The webhook stays fast; the
 * script runs in the worker, which re-reads everything before it acts.
 */
export async function enqueueSmsIntakeAdvance(
  db: DbOrTx,
  input: { organizationId: string; sessionId: string; messageId: string },
) {
  await enqueue(
    db,
    JOB.advanceSmsIntake,
    {
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      messageId: input.messageId,
    },
    { idempotencyKey: `sms-intake-advance:${input.messageId}` },
  );
}

export { ContactChannel };

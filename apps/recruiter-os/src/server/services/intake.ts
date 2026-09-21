import 'server-only';
import {
  CaseStatus,
  ConsentAction,
  ConsentPurpose,
  ContactChannel,
  DefinitionState,
  IntakePathway,
  IntakeSessionStatus,
  QuestionType,
  ReviewFlagKind,
  type IntakeQuestion,
  type IntakeSession,
} from '@prisma/client';
import { z } from 'zod';
import { prisma, type DbOrTx } from '@/server/db';
import { now } from '@/server/clock';
import { generateNumericCode, generateToken, hashToken } from '@/lib/crypto';
import { rateLimit } from '@/server/rate-limit';
import { assertTransition, intakeSessionTransitions } from '@/server/domain/state-machines';
import { ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import { systemContext } from '@/server/authz/policy';
import { createCase, normalizeEmail, normalizePhone, raiseReviewFlag, advanceStatus } from './cases';
import { DISCLOSURES, recordConsent } from './consent';
import { detectHumanRequest, detectSensitive, HUMAN_REQUEST_TEXT, NEUTRAL_HANDOFF_TEXT } from './sensitive';
import { ensureNextStep } from './tasks';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { auditOperational } from '@/server/audit';
import { isValidTimeZone } from '@/lib/time';

/**
 * Applicant intake.
 *
 * It is a SCRIPTED, VERSIONED FLOW — not an open chatbot. The question set is
 * an immutable published version; a session keeps the version it started on
 * even if an administrator publishes a new one mid-conversation.
 *
 * Progress lives on the server. A closed tab loses nothing. Resuming needs a
 * high-entropy credential that we store only as a hash, and revealing
 * previously submitted answers on a new device needs an additional
 * verification step on top of the credential.
 *
 * Intake keeps working when AI is unavailable: nothing in this file calls a
 * model.
 */

export const RESUME_TTL_HOURS = 72;
const MAX_VERIFICATION_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Published version lookup
// ---------------------------------------------------------------------------

export async function getPublishedIntake(organizationId: string, key = 'default') {
  const definition = await prisma.intakeDefinition.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
  if (!definition) return null;
  return prisma.intakeVersion.findFirst({
    where: { organizationId, definitionId: definition.id, state: DefinitionState.PUBLISHED },
    orderBy: { version: 'desc' },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
}

export async function findOrganizationBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, dataScope: true },
  });
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export type IntakeStart = {
  sessionId: string;
  resumeToken: string;
  greeting: string;
  pathway: IntakePathway;
};

export async function startIntakeSession(input: {
  organizationId: string;
  pathway: IntakePathway;
  requestKey: string;
}): Promise<IntakeStart> {
  const limit = rateLimit(`intake:start:${input.requestKey}`, 10, 600);
  if (!limit.allowed) {
    throw new ConflictError(`Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`);
  }

  const version = await getPublishedIntake(input.organizationId);
  if (!version) {
    throw new ConflictError(
      'This organization has no published intake question set yet. An administrator has to publish one.',
    );
  }

  const token = generateToken(32);
  const at = now();
  const session = await prisma.intakeSession.create({
    data: {
      organizationId: input.organizationId,
      intakeVersionId: version.id,
      pathway: input.pathway,
      status: IntakeSessionStatus.IN_PROGRESS,
      resumeTokenHash: hashToken(token),
      resumeExpiresAt: new Date(at.getTime() + RESUME_TTL_HOURS * 3600_000),
      currentQuestionKey: firstQuestionKey(version.questions, input.pathway),
      lastActivityAt: at,
    },
  });

  return {
    sessionId: session.id,
    resumeToken: token,
    greeting: version.greeting,
    pathway: input.pathway,
  };
}

function questionsForPathway(questions: IntakeQuestion[], pathway: IntakePathway) {
  return questions.filter((q) => q.pathway === pathway).sort((a, b) => a.order - b.order);
}

function firstQuestionKey(questions: IntakeQuestion[], pathway: IntakePathway): string | null {
  return questionsForPathway(questions, pathway)[0]?.key ?? null;
}

export async function loadSession(sessionId: string) {
  return prisma.intakeSession.findUnique({
    where: { id: sessionId },
    include: {
      intakeVersion: { include: { questions: { orderBy: { order: 'asc' } } } },
      answers: { where: { supersededAt: null }, orderBy: { answeredAt: 'asc' } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
}

export type IntakeView = {
  sessionId: string;
  organizationName: string;
  organizationSlug: string;
  status: IntakeSessionStatus;
  pathway: IntakePathway;
  greeting: string;
  completionText: string;
  handoffText: string;
  /** The question to ask now, or null when the flow is finished. */
  question:
    | (Pick<
        IntakeQuestion,
        'key' | 'type' | 'prompt' | 'helpText' | 'required' | 'options' | 'consentPurpose' | 'disclosureText'
      > & { index: number; total: number })
    | null;
  answered: Array<{ questionKey: string; prompt: string; valueText: string; skipped: boolean; revision: number }>;
  /** True only after the applicant passed the extra verification step. */
  answersVisible: boolean;
  handedOff: boolean;
  handoffMessage: string | null;
};

export async function buildIntakeView(
  sessionId: string,
  options: { answersVisible: boolean },
): Promise<IntakeView> {
  const session = await loadSession(sessionId);
  if (!session) throw new NotFoundError('Intake session');

  const pathwayQuestions = questionsForPathway(session.intakeVersion.questions, session.pathway);
  const answeredKeys = new Set(session.answers.map((a) => a.questionKey));
  const next =
    session.status === IntakeSessionStatus.IN_PROGRESS || session.status === IntakeSessionStatus.PAUSED
      ? (pathwayQuestions.find((q) => q.key === session.currentQuestionKey) ??
        pathwayQuestions.find((q) => !answeredKeys.has(q.key)) ??
        null)
      : null;

  const handedOff = session.status === IntakeSessionStatus.HANDED_OFF;

  return {
    sessionId: session.id,
    organizationName: session.organization.name,
    organizationSlug: session.organization.slug,
    status: session.status,
    pathway: session.pathway,
    greeting: session.intakeVersion.greeting,
    completionText: session.intakeVersion.completionText,
    handoffText: session.intakeVersion.handoffText,
    question: next
      ? {
          key: next.key,
          type: next.type,
          prompt: next.prompt,
          helpText: next.helpText,
          required: next.required,
          options: next.options,
          consentPurpose: next.consentPurpose,
          disclosureText: next.disclosureText,
          index: pathwayQuestions.findIndex((q) => q.key === next.key) + 1,
          total: pathwayQuestions.length,
        }
      : null,
    // Previously submitted answers are only echoed back once the person has
    // passed the additional verification step on this device.
    answered: options.answersVisible
      ? session.answers.map((a) => ({
          questionKey: a.questionKey,
          prompt: a.questionPrompt,
          valueText: a.sensitive ? '(shared with the recruiter)' : a.valueText,
          skipped: a.skipped,
          revision: a.revision,
        }))
      : [],
    answersVisible: options.answersVisible,
    handedOff,
    handoffMessage: handedOff ? session.intakeVersion.handoffText : null,
  };
}

// ---------------------------------------------------------------------------
// Answer submission
// ---------------------------------------------------------------------------

export const submitAnswerInput = z.object({
  sessionId: z.string().min(1),
  questionKey: z.string().min(1),
  valueText: z.string().max(2000).optional().default(''),
  valueOptions: z.array(z.string().max(200)).max(20).optional().default([]),
  skip: z.boolean().optional().default(false),
  consentGranted: z.boolean().optional(),
});

export type SubmitAnswerResult = {
  status: 'continue' | 'handed_off' | 'complete';
  message: string | null;
  nextQuestionKey: string | null;
};

export async function submitAnswer(
  input: z.infer<typeof submitAnswerInput>,
  meta: { requestKey: string },
): Promise<SubmitAnswerResult> {
  const limit = rateLimit(`intake:answer:${meta.requestKey}`, 120, 600);
  if (!limit.allowed) {
    throw new ConflictError(`Too many submissions. Try again in ${limit.retryAfterSeconds} seconds.`);
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.intakeSession.findUnique({
      where: { id: input.sessionId },
      include: { intakeVersion: { include: { questions: { orderBy: { order: 'asc' } } } } },
    });
    if (!session) throw new NotFoundError('Intake session');
    if (
      session.status !== IntakeSessionStatus.IN_PROGRESS &&
      session.status !== IntakeSessionStatus.PAUSED
    ) {
      throw new ConflictError('This intake is no longer accepting answers.');
    }

    const ctx = systemContext(session.organizationId, 'intake');
    const pathwayQuestions = questionsForPathway(session.intakeVersion.questions, session.pathway);
    const question = pathwayQuestions.find((q) => q.key === input.questionKey);
    if (!question) throw new ValidationError('That question is not part of this intake.');

    // ---- validation -----------------------------------------------------
    const rawText = input.valueText.trim();
    if (input.skip && question.required) {
      throw new ValidationError('That answer is needed to pass this to a recruiter.', {
        [question.key]: ['This one is required.'],
      });
    }

    let storedText = rawText;
    if (!input.skip) {
      switch (question.type) {
        case QuestionType.PHONE: {
          const normalized = normalizePhone(rawText);
          if (!normalized) {
            throw new ValidationError('That does not look like a phone number.', {
              [question.key]: ['Enter a 10-digit US number, or skip this.'],
            });
          }
          storedText = normalized;
          break;
        }
        case QuestionType.EMAIL: {
          const normalized = normalizeEmail(rawText);
          if (!normalized) {
            throw new ValidationError('That does not look like an email address.', {
              [question.key]: ['Enter an email address, or skip this.'],
            });
          }
          storedText = normalized;
          break;
        }
        case QuestionType.SINGLE_SELECT: {
          const choice = input.valueOptions[0] ?? rawText;
          if (!question.options.includes(choice)) {
            throw new ValidationError('Pick one of the options.', { [question.key]: ['Pick an option.'] });
          }
          storedText = choice;
          break;
        }
        case QuestionType.MULTI_SELECT: {
          const invalid = input.valueOptions.filter((o) => !question.options.includes(o));
          if (invalid.length) {
            throw new ValidationError('Pick from the options shown.', { [question.key]: ['Unknown option.'] });
          }
          storedText = input.valueOptions.join(', ');
          break;
        }
        case QuestionType.CONSENT: {
          if (input.consentGranted === undefined) {
            throw new ValidationError('Choose yes or no.', { [question.key]: ['Choose yes or no.'] });
          }
          storedText = input.consentGranted ? 'yes' : 'no';
          break;
        }
        case QuestionType.TIMEZONE: {
          storedText = rawText;
          break;
        }
        default:
          if (question.required && !rawText) {
            throw new ValidationError('This one is required.', { [question.key]: ['Add an answer.'] });
          }
      }
    }

    // ---- human request and sensitive routing ----------------------------
    const humanRequested = !input.skip && detectHumanRequest(rawText);
    const sensitive = !input.skip ? detectSensitive(rawText) : { sensitive: false, category: null };

    // ---- store the answer as a new immutable revision -------------------
    const previous = await tx.intakeAnswer.findFirst({
      where: { organizationId: session.organizationId, intakeSessionId: session.id, questionKey: question.key },
      orderBy: { revision: 'desc' },
    });
    if (previous) {
      await tx.intakeAnswer.update({ where: { id: previous.id }, data: { supersededAt: now() } });
    }
    const answer = await tx.intakeAnswer.create({
      data: {
        organizationId: session.organizationId,
        intakeSessionId: session.id,
        questionKey: question.key,
        questionPrompt: question.prompt,
        revision: (previous?.revision ?? 0) + 1,
        valueText: input.skip ? '' : storedText,
        valueOptions: input.valueOptions,
        skipped: input.skip,
        // Sensitive free text is access-restricted and excluded from external
        // AI by default.
        sensitive: sensitive.sensitive || Boolean(question.sensitiveCategory),
      },
    });

    // ---- consent --------------------------------------------------------
    if (question.type === QuestionType.CONSENT && question.consentPurpose && session.applicantId) {
      const contactValue = await resolveConsentContact(tx, session, question.consentPurpose);
      if (contactValue) {
        await recordConsent(tx, {
          organizationId: session.organizationId,
          applicantId: session.applicantId,
          purpose: question.consentPurpose,
          contactValue,
          action: input.consentGranted ? ConsentAction.GRANTED : ConsentAction.REVOKED,
          disclosure: {
            key: question.disclosureKey ?? question.key,
            version: session.intakeVersion.version,
            text: question.disclosureText ?? question.prompt,
          },
          source: `intake_session:${session.id}`,
        });
      }
    }

    // ---- advance or hand off --------------------------------------------
    const answeredKeys = new Set(
      (
        await tx.intakeAnswer.findMany({
          where: { organizationId: session.organizationId, intakeSessionId: session.id, supersededAt: null },
          select: { questionKey: true },
        })
      ).map((a) => a.questionKey),
    );
    const nextQuestion = pathwayQuestions.find((q) => !answeredKeys.has(q.key)) ?? null;

    if (humanRequested || sensitive.sensitive) {
      // Automated conversational progression stops here. No eligibility
      // answer is produced, and the substance is not repeated back.
      await handOffSession(tx, session, {
        kind: humanRequested ? 'human_request' : 'sensitive',
        category: sensitive.category,
        sourceRef: `intake_answer:${answer.id}`,
      });
      return {
        status: 'handed_off' as const,
        message: humanRequested ? HUMAN_REQUEST_TEXT : NEUTRAL_HANDOFF_TEXT,
        nextQuestionKey: null,
      };
    }

    await tx.intakeSession.update({
      where: { id: session.id },
      data: {
        currentQuestionKey: nextQuestion?.key ?? null,
        lastActivityAt: now(),
        status: IntakeSessionStatus.IN_PROGRESS,
        version: { increment: 1 },
      },
    });

    if (session.applicantId) {
      await advanceStatus(tx, ctx, session.applicantId, CaseStatus.INTAKE_IN_PROGRESS);
      // The case learns who it is as soon as the person says so, rather than
      // staying a masked phone number until the whole script finishes.
      await enrichCaseFromAnswers(tx, session.id);
    }

    if (!nextQuestion) {
      const result = await finalizeSession(tx, session.id);
      return { status: 'complete' as const, message: result.completionText, nextQuestionKey: null };
    }

    return { status: 'continue' as const, message: null, nextQuestionKey: nextQuestion.key };
  });
}

async function resolveConsentContact(
  db: DbOrTx,
  session: IntakeSession,
  purpose: ConsentPurpose,
): Promise<string | null> {
  if (!session.applicantId) return null;
  const channel =
    purpose === ConsentPurpose.EMAIL_UPDATES
      ? ContactChannel.EMAIL
      : purpose === ConsentPurpose.CALLBACK_CALL
        ? ContactChannel.PHONE_CALL
        : ContactChannel.SMS;
  const point = await db.contactPoint.findFirst({
    where: {
      organizationId: session.organizationId,
      applicantId: session.applicantId,
      channel: channel === ContactChannel.SMS ? { in: [ContactChannel.SMS, ContactChannel.PHONE_CALL] } : channel,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  return point?.value ?? null;
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

async function handOffSession(
  db: DbOrTx,
  session: IntakeSession,
  input: { kind: 'human_request' | 'sensitive'; category: string | null; sourceRef: string },
) {
  const at = now();
  assertTransition(intakeSessionTransitions, session.status, IntakeSessionStatus.HANDED_OFF, 'Intake session');
  await db.intakeSession.update({
    where: { id: session.id },
    data: {
      status: IntakeSessionStatus.HANDED_OFF,
      handedOffAt: at,
      currentQuestionKey: null,
      version: { increment: 1 },
    },
  });

  // Make sure there is a case to attach the review work to.
  const applicantId = session.applicantId ?? (await materializeCase(db, session.id)).applicantId;
  const ctx = systemContext(session.organizationId, 'intake');

  await raiseReviewFlag(db, ctx, {
    applicantId,
    kind: input.kind === 'human_request' ? ReviewFlagKind.HUMAN_REQUESTED : ReviewFlagKind.SENSITIVE_QUESTION,
    // Workflow-only wording. The category names the ROUTING bucket, never a
    // conclusion about the person.
    detail:
      input.kind === 'human_request'
        ? 'The applicant asked to speak with a person during intake.'
        : `A ${input.category ?? 'sensitive'} topic came up during intake. Automation stopped; a recruiter handles it.`,
    restricted: input.kind === 'sensitive',
    sourceRef: input.sourceRef,
    taskTitle: input.kind === 'human_request' ? 'Call the applicant — they asked for a person' : 'Recruiter review required',
    taskDueAt: new Date(at.getTime() + 2 * 3600_000),
  });

  await advanceStatus(db, ctx, applicantId, CaseStatus.READY_FOR_RECRUITER);
  await ensureNextStep(db, ctx, applicantId);
}

// ---------------------------------------------------------------------------
// Case materialization and completion
// ---------------------------------------------------------------------------

const NAME_KEYS = ['full_name', 'name', 'preferred_name'];
const PHONE_KEYS = ['phone', 'callback_phone', 'mobile'];
const EMAIL_KEYS = ['email'];
const LOCATION_KEYS = ['general_location', 'location', 'city'];
const TIMEZONE_KEYS = ['timezone', 'time_zone'];

/**
 * Turn a session's answers into a case. Idempotent: a session that already has
 * a case returns it. Called on completion, on handoff, and by the callback
 * path — so there is exactly ONE reliable way a case comes into existence.
 */
/**
 * A case opened before we knew who it was.
 *
 * A missed call or an inbound text creates a case named "Inbound call
 * ***7788", because a phone number is all we have. When the person then tells
 * us their name, their town or another number, the case should stop being a
 * masked phone number — otherwise the recruiter opens the queue in the
 * morning and reads a list of digits.
 *
 * It fills GAPS only. A value a recruiter typed, or a name we already learned,
 * is never overwritten by a later answer; that is the same rule the briefs
 * follow, and for the same reason.
 */
const PLACEHOLDER_NAME = /^(Inbound call |Inbound text |Unnamed inquiry$)/;

export async function enrichCaseFromAnswers(
  db: DbOrTx,
  sessionId: string,
): Promise<{ updated: string[] }> {
  const session = await db.intakeSession.findUnique({
    where: { id: sessionId },
    include: { answers: { where: { supersededAt: null } } },
  });
  if (!session?.applicantId) return { updated: [] };

  const applicant = await db.applicant.findFirst({
    where: { organizationId: session.organizationId, id: session.applicantId },
  });
  if (!applicant) return { updated: [] };

  const byKey = new Map(session.answers.map((a) => [a.questionKey, a]));
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const answer = byKey.get(key);
      if (answer && !answer.skipped && answer.valueText) return answer.valueText;
    }
    return null;
  };

  const data: Record<string, string> = {};
  const updated: string[] = [];

  const name = pick(NAME_KEYS);
  if (name && PLACEHOLDER_NAME.test(applicant.displayName)) {
    data.displayName = name;
    updated.push('displayName');
  }
  const location = pick(LOCATION_KEYS);
  if (location && !applicant.generalLocation) {
    data.generalLocation = location;
    updated.push('generalLocation');
  }
  const timezone = pick(TIMEZONE_KEYS);
  if (timezone && isValidTimeZone(timezone) && !applicant.timezoneConfirmed) {
    data.timezone = timezone;
    updated.push('timezone');
  }

  if (updated.length) {
    await db.applicant.update({
      where: { id: applicant.id },
      data: { ...data, version: { increment: 1 } },
    });
  }

  // A number or address they gave us is a way to reach them, so it is added
  // as a contact point — with no permission attached, because telling us a
  // number is not permission to use it.
  const phone = pick(PHONE_KEYS);
  const email = pick(EMAIL_KEYS);
  for (const [channel, value] of [
    [ContactChannel.PHONE_CALL, phone],
    [ContactChannel.SMS, phone],
    [ContactChannel.EMAIL, email],
  ] as const) {
    if (!value) continue;
    const existing = await db.contactPoint.findFirst({
      where: { organizationId: session.organizationId, applicantId: applicant.id, channel, value },
      select: { id: true },
    });
    if (existing) continue;
    await db.contactPoint.create({
      data: {
        organizationId: session.organizationId,
        applicantId: applicant.id,
        channel,
        value,
        isPrimary: false,
      },
    });
    updated.push(`contact:${channel}`);
  }

  if (updated.length) {
    await auditOperational(db, systemContext(session.organizationId, 'intake'), {
      action: 'case.enriched_from_intake',
      subjectType: 'applicant',
      subjectId: applicant.id,
      applicantId: applicant.id,
      // Which fields were filled, never their values.
      metadata: { fields: updated, sessionId: session.id },
    });
  }

  return { updated };
}

export async function materializeCase(
  db: DbOrTx,
  sessionId: string,
): Promise<{ applicantId: string; created: boolean }> {
  const session = await db.intakeSession.findUnique({
    where: { id: sessionId },
    include: {
      answers: { where: { supersededAt: null } },
      intakeVersion: { include: { questions: true } },
    },
  });
  if (!session) throw new NotFoundError('Intake session');
  if (session.applicantId) return { applicantId: session.applicantId, created: false };

  const byKey = new Map(session.answers.map((a) => [a.questionKey, a]));
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const answer = byKey.get(key);
      if (answer && !answer.skipped && answer.valueText) return answer.valueText;
    }
    return null;
  };

  const displayName = pick(NAME_KEYS) ?? 'Unnamed inquiry';
  const phone = pick(PHONE_KEYS);
  const email = pick(EMAIL_KEYS);

  const contactPoints: Array<{ channel: ContactChannel; value: string; isPrimary?: boolean }> = [];
  if (phone) {
    contactPoints.push({ channel: ContactChannel.PHONE_CALL, value: phone, isPrimary: true });
    contactPoints.push({ channel: ContactChannel.SMS, value: phone });
  }
  if (email) contactPoints.push({ channel: ContactChannel.EMAIL, value: email, isPrimary: !phone });

  const ctx = systemContext(session.organizationId, 'intake');
  const { applicant, inquiryEpisodeId } = await createCase(db, ctx, {
    organizationId: session.organizationId,
    displayName,
    generalLocation: pick(LOCATION_KEYS),
    timezone: pick(TIMEZONE_KEYS),
    originKind: session.pathway === IntakePathway.CALLBACK_REQUEST ? 'callback_request' : 'web_intake',
    contactPoints,
    status: CaseStatus.NEW_INQUIRY,
  });

  await db.intakeSession.update({
    where: { id: session.id },
    data: { applicantId: applicant.id, version: { increment: 1 } },
  });

  // Consent answers submitted before the case existed are recorded now, with
  // their original disclosure version.
  for (const answer of session.answers) {
    const question = session.intakeVersion.questions.find((q) => q.key === answer.questionKey);
    if (!question || question.type !== QuestionType.CONSENT || !question.consentPurpose) continue;
    const contactValue = await resolveConsentContact(
      db,
      { ...session, applicantId: applicant.id },
      question.consentPurpose,
    );
    if (!contactValue) continue;
    await recordConsent(db, {
      organizationId: session.organizationId,
      applicantId: applicant.id,
      purpose: question.consentPurpose,
      contactValue,
      action: answer.valueText === 'yes' ? ConsentAction.GRANTED : ConsentAction.REVOKED,
      disclosure: {
        key: question.disclosureKey ?? question.key,
        version: session.intakeVersion.version,
        text: question.disclosureText ?? question.prompt,
      },
      source: `intake_session:${session.id}`,
      occurredAt: answer.answeredAt,
    });
  }

  // A phone callback request grants permission to CALL that number. It does
  // not create SMS consent — that needs its own explicit answer.
  if (phone && session.pathway === IntakePathway.CALLBACK_REQUEST) {
    await recordConsent(db, {
      organizationId: session.organizationId,
      applicantId: applicant.id,
      purpose: ConsentPurpose.CALLBACK_CALL,
      contactValue: phone,
      action: ConsentAction.GRANTED,
      disclosure: DISCLOSURES.callback_call,
      source: `intake_session:${session.id}`,
    });
  }

  await enqueue(
    db,
    JOB.sendAcknowledgment,
    { organizationId: session.organizationId, applicantId: applicant.id, inquiryEpisodeId },
    { idempotencyKey: `ack:${inquiryEpisodeId}` },
  );

  return { applicantId: applicant.id, created: true };
}

export async function finalizeSession(db: DbOrTx, sessionId: string) {
  const session = await db.intakeSession.findUnique({
    where: { id: sessionId },
    include: { intakeVersion: true },
  });
  if (!session) throw new NotFoundError('Intake session');

  const { applicantId } = await materializeCase(db, sessionId);
  const ctx = systemContext(session.organizationId, 'intake');

  if (session.status !== IntakeSessionStatus.COMPLETED) {
    assertTransition(intakeSessionTransitions, session.status, IntakeSessionStatus.COMPLETED, 'Intake session');
    await db.intakeSession.update({
      where: { id: session.id },
      data: {
        status: IntakeSessionStatus.COMPLETED,
        completedAt: now(),
        currentQuestionKey: null,
        // The resume credential is revoked the moment it is no longer needed.
        resumeRevokedAt: now(),
        version: { increment: 1 },
      },
    });
  }

  await advanceStatus(db, ctx, applicantId, CaseStatus.READY_FOR_RECRUITER);
  await ensureNextStep(db, ctx, applicantId);
  await enqueue(
    db,
    JOB.prepareBrief,
    { organizationId: session.organizationId, applicantId, requestedByMemberId: null, reason: 'intake_complete' },
    { idempotencyKey: `brief:intake:${session.id}` },
  );

  return { applicantId, completionText: session.intakeVersion.completionText };
}

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

export async function pauseSession(sessionId: string): Promise<{ resumeToken: string; expiresAt: Date }> {
  const session = await prisma.intakeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError('Intake session');
  if (session.status === IntakeSessionStatus.COMPLETED) {
    throw new ConflictError('This intake is already finished.');
  }

  // A pause always mints a FRESH credential and revokes the previous one.
  const token = generateToken(32);
  const expiresAt = new Date(now().getTime() + RESUME_TTL_HOURS * 3600_000);
  await prisma.intakeSession.update({
    where: { id: session.id },
    data: {
      status:
        session.status === IntakeSessionStatus.HANDED_OFF
          ? IntakeSessionStatus.HANDED_OFF
          : IntakeSessionStatus.PAUSED,
      resumeTokenHash: hashToken(token),
      resumeExpiresAt: expiresAt,
      resumeRevokedAt: null,
      resumeVerificationAttempts: 0,
      lastActivityAt: now(),
      version: { increment: 1 },
    },
  });
  return { resumeToken: token, expiresAt };
}

export type ResumeExchange =
  | { status: 'ok'; sessionId: string; needsVerification: boolean }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'locked'; retryAfterSeconds: number };

/**
 * Exchange a resume credential for a session.
 *
 * The credential arrives once, is looked up BY HASH, and the caller
 * immediately redirects to a URL without it so it does not sit in browser
 * history, referrer headers or a shared screen. Failures are indistinguishable
 * between "no such token" and "wrong token", so this cannot be used to
 * enumerate sessions. There is deliberately NO lookup by phone or email.
 */
export async function exchangeResumeToken(
  token: string,
  meta: { requestKey: string; hasPriorDeviceSession: boolean },
): Promise<ResumeExchange> {
  const limit = rateLimit(`intake:resume:${meta.requestKey}`, 10, 300);
  if (!limit.allowed) return { status: 'locked', retryAfterSeconds: limit.retryAfterSeconds };

  const session = await prisma.intakeSession.findUnique({
    where: { resumeTokenHash: hashToken(token) },
    select: { id: true, resumeExpiresAt: true, resumeRevokedAt: true, status: true },
  });
  if (!session) return { status: 'invalid' };
  if (session.resumeRevokedAt) return { status: 'invalid' };
  if (!session.resumeExpiresAt || session.resumeExpiresAt.getTime() <= now().getTime()) {
    return { status: 'expired' };
  }

  await prisma.intakeSession.update({
    where: { id: session.id },
    data: { lastActivityAt: now() },
  });

  // A valid credential lets the person CONTINUE. Seeing what they previously
  // submitted, on a device that has not been used for this session before,
  // needs one more step.
  return { status: 'ok', sessionId: session.id, needsVerification: !meta.hasPriorDeviceSession };
}

/**
 * The additional verification step: the last four digits of the phone number
 * the person themselves supplied, or a code a recruiter reads out. Attempts
 * are counted on the row, so a restart does not reset them.
 */
export async function verifyResumeIdentity(
  sessionId: string,
  answer: string,
  meta: { requestKey: string },
): Promise<{ ok: boolean; reason?: string }> {
  const limit = rateLimit(`intake:verify:${meta.requestKey}`, 8, 600);
  if (!limit.allowed) return { ok: false, reason: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` };

  const session = await prisma.intakeSession.findUnique({
    where: { id: sessionId },
    include: { answers: { where: { supersededAt: null } } },
  });
  if (!session) return { ok: false, reason: 'That link is no longer valid.' };
  if (session.resumeVerificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { ok: false, reason: 'Too many attempts. Ask the recruiter for a new link.' };
  }

  const phoneAnswer = session.answers.find((a) => PHONE_KEYS.includes(a.questionKey) && a.valueText);
  const expected = phoneAnswer ? phoneAnswer.valueText.replace(/\D/g, '').slice(-4) : null;
  const provided = answer.replace(/\D/g, '').slice(-4);

  const explicitHash = session.resumeVerificationHash;
  const matches = explicitHash
    ? explicitHash === hashToken(answer.trim())
    : expected !== null && expected.length === 4 && expected === provided;

  await prisma.intakeSession.update({
    where: { id: session.id },
    data: { resumeVerificationAttempts: matches ? 0 : { increment: 1 } },
  });

  if (!matches) return { ok: false, reason: 'That did not match. Try again.' };
  return { ok: true };
}

/** A recruiter can set an explicit verification code instead of digits. */
export async function setResumeVerificationCode(sessionId: string, organizationId: string) {
  const code = generateNumericCode(6);
  await prisma.intakeSession.updateMany({
    where: { id: sessionId, organizationId },
    data: { resumeVerificationHash: hashToken(code), resumeVerificationAttempts: 0 },
  });
  return code;
}

export async function revokeResume(sessionId: string, organizationId: string) {
  await prisma.intakeSession.updateMany({
    where: { id: sessionId, organizationId },
    data: { resumeRevokedAt: now(), resumeTokenHash: null },
  });
}

/**
 * Issue a resume link for a case. Used by the recruiter workspace and by the
 * intake-invitation template, so the applicant never has to be looked up by
 * phone number to get back in.
 */
export async function issueResumeLinkForCase(
  db: DbOrTx,
  organizationId: string,
  applicantId: string,
): Promise<{ token: string; sessionId: string } | null> {
  const session = await db.intakeSession.findFirst({
    where: {
      organizationId,
      applicantId,
      status: { in: [IntakeSessionStatus.IN_PROGRESS, IntakeSessionStatus.PAUSED] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!session) return null;
  const token = generateToken(32);
  await db.intakeSession.update({
    where: { id: session.id },
    data: {
      resumeTokenHash: hashToken(token),
      resumeExpiresAt: new Date(now().getTime() + RESUME_TTL_HOURS * 3600_000),
      resumeRevokedAt: null,
    },
  });
  return { token, sessionId: session.id };
}

/** Start a full intake session for an existing case (recruiter-initiated). */
export async function startSessionForCase(
  db: DbOrTx,
  organizationId: string,
  applicantId: string,
  pathway: IntakePathway = IntakePathway.FULL_INTAKE,
) {
  const version = await getPublishedIntake(organizationId);
  if (!version) throw new ConflictError('No published intake question set.');
  const token = generateToken(32);
  const session = await db.intakeSession.create({
    data: {
      organizationId,
      applicantId,
      intakeVersionId: version.id,
      pathway,
      status: IntakeSessionStatus.IN_PROGRESS,
      currentQuestionKey: firstQuestionKey(version.questions, pathway),
      resumeTokenHash: hashToken(token),
      resumeExpiresAt: new Date(now().getTime() + RESUME_TTL_HOURS * 3600_000),
    },
  });
  await auditOperational(db, systemContext(organizationId, 'intake'), {
    action: 'intake.session_started',
    subjectType: 'intake_session',
    subjectId: session.id,
    applicantId,
    metadata: { pathway, intakeVersion: version.version },
  });
  return { sessionId: session.id, token };
}

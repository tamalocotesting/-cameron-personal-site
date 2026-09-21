import 'server-only';
import {
  BriefItemKind,
  BriefState,
  MessageAuthorKind,
  MetricEventKind,
  SourceKind,
  type Brief,
} from '@prisma/client';
import { z } from 'zod';
import { prisma, type DbOrTx } from '@/server/db';
import { now } from '@/server/clock';
import { contentHash } from '@/lib/crypto';
import { ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import { requireCase, requireStaff, systemContext, type ActorContext } from '@/server/authz/policy';
import { auditOperational, auditSecurity } from '@/server/audit';
import { recordMetric } from '@/server/metrics';
import { resolveBriefProvider } from '@/server/providers/ai/registry';
import { briefResultSchema } from '@/server/providers/ai/types';
import type { BriefContext, BriefContextSource, BriefResult, SourceReference } from '@/server/providers/ai/types';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';

/**
 * Recruiter briefs.
 *
 * The governing rule shows up here as code, not as a slogan:
 *
 *   * A brief is PREPARED, never acted on. Nothing in this file sends a
 *     message, changes an owner, schedules anything or closes a case.
 *   * Every FACT must cite a source that exists, belongs to THIS case, is
 *     readable by the viewer, and whose stored text actually contains the
 *     quoted excerpt. A citation that fails any of those is dropped; a fact
 *     left with no surviving citation is demoted to a clarification.
 *     A brief the provider returned malformed is rejected outright.
 *   * Valid citations do not make a brief correct. It still needs review, and
 *     the UI says so.
 *   * A recruiter's correction is never overwritten by a later generation.
 *   * An asynchronous result that arrives after a newer reviewed brief is
 *     discarded rather than allowed to overwrite it.
 */

const MAX_SOURCES = 60;

// ---------------------------------------------------------------------------
// Context assembly (minimised on purpose)
// ---------------------------------------------------------------------------

export async function buildBriefContext(
  organizationId: string,
  applicantId: string,
): Promise<{ context: BriefContext; snapshotHash: string; eventCount: number }> {
  const [settings, applicant] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
    prisma.applicant.findFirst({
      where: { id: applicantId, organizationId },
      include: { owner: { select: { displayName: true } } },
    }),
  ]);
  if (!applicant) throw new NotFoundError('Case');

  const approved = new Set(settings?.aiApprovedCategories ?? []);
  const sources: BriefContextSource[] = [];

  if (approved.has('intake_answers')) {
    const answers = await prisma.intakeAnswer.findMany({
      where: {
        organizationId,
        supersededAt: null,
        skipped: false,
        // Sensitive free text is excluded from external AI by default.
        sensitive: false,
        intakeSession: { applicantId },
      },
      orderBy: { answeredAt: 'asc' },
      take: MAX_SOURCES,
    });
    for (const a of answers) {
      if (!a.valueText) continue;
      sources.push({
        kind: 'INTAKE_ANSWER',
        id: a.id,
        revision: a.revision,
        speaker: 'applicant',
        label: a.questionPrompt,
        fieldKey: a.questionKey,
        occurredAt: a.answeredAt.toISOString(),
        text: a.valueText,
      });
    }
  }

  if (approved.has('applicant_messages') || approved.has('recruiter_messages')) {
    const messages = await prisma.message.findMany({
      where: { organizationId, applicantId },
      orderBy: { occurredAt: 'asc' },
      take: MAX_SOURCES,
    });
    for (const m of messages) {
      const isApplicant = m.authorKind === MessageAuthorKind.APPLICANT;
      if (isApplicant && !approved.has('applicant_messages')) continue;
      if (!isApplicant && !approved.has('recruiter_messages')) continue;
      if (!m.body.trim()) continue;
      sources.push({
        kind: 'MESSAGE',
        id: m.id,
        revision: null,
        speaker: isApplicant
          ? 'applicant'
          : m.authorKind === MessageAuthorKind.RECRUITER
            ? 'recruiter'
            : m.authorKind === MessageAuthorKind.APPROVED_AUTOMATION
              ? 'automation'
              : 'system',
        label: `${m.direction === 'INBOUND' ? 'Received' : 'Sent'} ${m.channel}`,
        fieldKey: null,
        occurredAt: m.occurredAt.toISOString(),
        text: m.body,
      });
    }
  }

  if (approved.has('call_outcomes')) {
    const calls = await prisma.callEvent.findMany({
      where: { organizationId, applicantId },
      orderBy: { occurredAt: 'asc' },
      take: 20,
    });
    for (const c of calls) {
      sources.push({
        kind: 'CALL_EVENT',
        id: c.id,
        revision: null,
        speaker: 'system',
        label: `Call (${c.direction})`,
        fieldKey: null,
        occurredAt: c.occurredAt.toISOString(),
        // Operational text we wrote ourselves, not a transcript. There is no
        // recording and no transcription anywhere in this build.
        text: `${c.outcome}${c.humanConnected ? ', spoke with the applicant' : ', no human connection'}${c.note ? `. ${c.note}` : ''}`,
      });
    }
  }

  // Private staff notes are NEVER sent by default; only an explicitly approved
  // "staff_notes" category includes them, and sensitive ones stay out even then.
  if (approved.has('staff_notes')) {
    const revisions = await prisma.noteRevision.findMany({
      where: { organizationId, note: { applicantId, sensitive: false } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const r of revisions) {
      sources.push({
        kind: 'NOTE_REVISION',
        id: r.id,
        revision: r.revision,
        speaker: 'recruiter',
        label: 'Staff note',
        fieldKey: null,
        occurredAt: r.createdAt.toISOString(),
        text: r.body,
      });
    }
  }

  const [openTasks, flags, permissions] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId, applicantId, status: { in: ['OPEN', 'SNOOZED'] } },
      orderBy: { dueAt: 'asc' },
      select: { title: true, dueAt: true },
    }),
    prisma.reviewFlag.findMany({
      where: { organizationId, applicantId, status: 'OPEN' },
      select: { kind: true },
    }),
    prisma.channelPermission.findMany({
      where: { organizationId, applicantId, granted: true, suppressed: false },
      select: { purpose: true },
    }),
  ]);

  const context: BriefContext = {
    organizationId,
    applicantId,
    applicantDisplayName: applicant.displayName,
    caseStatus: applicant.status,
    timezone: applicant.timezone ?? settings?.defaultTimezone ?? 'America/Chicago',
    sources: sources.slice(-MAX_SOURCES),
    operational: {
      ownerName: applicant.owner?.displayName ?? null,
      openTaskTitles: openTasks.map((t) => t.title),
      nextDueAt: openTasks[0]?.dueAt.toISOString() ?? null,
      openReviewFlagKinds: flags.map((f) => f.kind),
      channelPermissions: permissions.map((p) => p.purpose),
    },
  };

  const snapshotHash = contentHash(
    ...context.sources.map((s) => `${s.kind}:${s.id}:${s.revision ?? 0}`),
    applicant.status,
    String(context.operational.openReviewFlagKinds.length),
  );

  return { context, snapshotHash, eventCount: context.sources.length };
}

// ---------------------------------------------------------------------------
// Citation validation
// ---------------------------------------------------------------------------

export type ValidatedRef = SourceReference & { ok: true };
export type RejectedRef = { ref: SourceReference; reason: string };

function normalizeForMatch(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Verify citations against the database — not against the context we sent, so
 * a provider cannot smuggle in an id we never supplied AND a deleted source
 * cannot survive as a citation.
 */
export async function validateSourceRefs(
  organizationId: string,
  applicantId: string,
  refs: SourceReference[],
): Promise<{ valid: ValidatedRef[]; rejected: RejectedRef[] }> {
  const valid: ValidatedRef[] = [];
  const rejected: RejectedRef[] = [];

  for (const ref of refs) {
    let storedText: string | null = null;
    let belongs = false;

    switch (ref.kind) {
      case SourceKind.MESSAGE: {
        const row = await prisma.message.findFirst({
          where: { id: ref.id, organizationId, applicantId },
          select: { body: true },
        });
        storedText = row?.body ?? null;
        belongs = row !== null;
        break;
      }
      case SourceKind.INTAKE_ANSWER: {
        const row = await prisma.intakeAnswer.findFirst({
          where: {
            id: ref.id,
            organizationId,
            intakeSession: { applicantId },
            ...(ref.revision ? { revision: ref.revision } : {}),
          },
          select: { valueText: true, sensitive: true },
        });
        // A sensitive answer is never citable in a brief that ordinary
        // case-content access can read.
        storedText = row && !row.sensitive ? row.valueText : null;
        belongs = row !== null && !row.sensitive;
        break;
      }
      case SourceKind.NOTE_REVISION: {
        const row = await prisma.noteRevision.findFirst({
          where: { id: ref.id, organizationId, note: { applicantId } },
          select: { body: true },
        });
        storedText = row?.body ?? null;
        belongs = row !== null;
        break;
      }
      case SourceKind.CALL_EVENT: {
        const row = await prisma.callEvent.findFirst({
          where: { id: ref.id, organizationId, applicantId },
          select: { outcome: true, humanConnected: true, note: true },
        });
        storedText = row
          ? `${row.outcome}${row.humanConnected ? ', spoke with the applicant' : ', no human connection'}${row.note ? `. ${row.note}` : ''}`
          : null;
        belongs = row !== null;
        break;
      }
    }

    if (!belongs || storedText === null) {
      rejected.push({ ref, reason: 'The cited source does not exist on this case (or is restricted).' });
      continue;
    }
    if (!normalizeForMatch(storedText).includes(normalizeForMatch(ref.excerpt))) {
      rejected.push({ ref, reason: 'The quoted excerpt does not appear in the stored source text.' });
      continue;
    }
    valid.push({ ...ref, ok: true });
  }

  return { valid, rejected };
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

export async function markBriefsStale(db: DbOrTx, organizationId: string, applicantId: string) {
  await db.brief.updateMany({
    where: { organizationId, applicantId, staleAt: null, state: { in: [BriefState.GENERATED, BriefState.APPROVED] } },
    data: { staleAt: now() },
  });
}

export type PrepareOutcome =
  | { status: 'ok'; briefId: string; revision: number; rejectedRefs: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export async function prepareBrief(input: {
  organizationId: string;
  applicantId: string;
  requestedByMemberId: string | null;
  reason: string;
}): Promise<PrepareOutcome> {
  const ctx = systemContext(input.organizationId, JOB.prepareBrief);

  const resolution = await resolveBriefProvider(input.organizationId);
  if (!resolution.available) {
    // Explicit unavailable state. Recruiter work continues without a brief.
    await prisma.$transaction(async (tx) => {
      const latest = await tx.brief.findFirst({
        where: { organizationId: input.organizationId, applicantId: input.applicantId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      await tx.brief.create({
        data: {
          organizationId: input.organizationId,
          applicantId: input.applicantId,
          revision: (latest?.revision ?? 0) + 1,
          providerName: 'unavailable',
          promptVersion: 'n/a',
          inputSnapshotHash: 'n/a',
          inputEventCount: 0,
          state: BriefState.FAILED,
          failureReason: resolution.reason,
        },
      });
    });
    return { status: 'failed', reason: resolution.reason };
  }

  const { context, snapshotHash, eventCount } = await buildBriefContext(
    input.organizationId,
    input.applicantId,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let outcome;
  try {
    outcome = await resolution.provider.prepare(context, controller.signal);
  } finally {
    clearTimeout(timeout);
  }

  if (outcome.status !== 'ok') {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.brief.findFirst({
        where: { organizationId: input.organizationId, applicantId: input.applicantId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      await tx.brief.create({
        data: {
          organizationId: input.organizationId,
          applicantId: input.applicantId,
          revision: (latest?.revision ?? 0) + 1,
          providerName: outcome.providerName,
          modelId: resolution.provider.modelId,
          promptVersion: resolution.provider.promptVersion,
          inputSnapshotHash: snapshotHash,
          inputEventCount: eventCount,
          state: BriefState.FAILED,
          failureReason: outcome.reason,
        },
      });
      await auditOperational(tx, ctx, {
        action: 'brief.failed',
        subjectType: 'brief',
        applicantId: input.applicantId,
        // Failure telemetry, no raw applicant content.
        metadata: { provider: outcome.providerName, status: outcome.status, reason: outcome.reason },
      });
    });
    return { status: 'failed', reason: outcome.reason };
  }

  return persistBrief({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    result: outcome.result,
    providerName: outcome.providerName,
    modelId: outcome.modelId,
    promptVersion: outcome.promptVersion,
    durationMs: outcome.durationMs,
    snapshotHash,
    eventCount,
    reason: input.reason,
  });
}

/**
 * Persist a provider's result.
 *
 * The result is validated against OUR schema here, whichever provider it came
 * from. A malformed brief — a missing citation, an excerpt too short to verify,
 * a field over length — is recorded as FAILED and never displayed as valid.
 */
export async function persistBrief(input: {
  organizationId: string;
  applicantId: string;
  result: BriefResult;
  providerName: string;
  modelId: string | null;
  promptVersion: string;
  durationMs: number;
  snapshotHash: string;
  eventCount: number;
  reason: string;
}): Promise<PrepareOutcome> {
  const ctx = systemContext(input.organizationId, JOB.prepareBrief);

  const validated = briefResultSchema.safeParse(input.result);
  if (!validated.success) {
    const reason = `Result failed schema validation: ${z.prettifyError(validated.error).slice(0, 300)}`;
    await prisma.$transaction(async (tx) => {
      const latest = await tx.brief.findFirst({
        where: { organizationId: input.organizationId, applicantId: input.applicantId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      await tx.brief.create({
        data: {
          organizationId: input.organizationId,
          applicantId: input.applicantId,
          revision: (latest?.revision ?? 0) + 1,
          providerName: input.providerName,
          modelId: input.modelId,
          promptVersion: input.promptVersion,
          inputSnapshotHash: input.snapshotHash,
          inputEventCount: input.eventCount,
          state: BriefState.FAILED,
          failureReason: reason,
        },
      });
      await auditOperational(tx, ctx, {
        action: 'brief.rejected_invalid',
        subjectType: 'brief',
        applicantId: input.applicantId,
        metadata: { provider: input.providerName, reason },
      });
    });
    return { status: 'failed', reason };
  }

  // Validate every citation BEFORE opening the write transaction.
  const allRefs = input.result.facts.flatMap((f) => f.sources);
  const { valid, rejected } = await validateSourceRefs(input.organizationId, input.applicantId, allRefs);
  const validKeys = new Set(valid.map((v) => `${v.kind}:${v.id}:${v.revision ?? 0}:${v.excerpt}`));

  return prisma.$transaction(async (tx) => {
    const latest = await tx.brief.findFirst({
      where: { organizationId: input.organizationId, applicantId: input.applicantId },
      orderBy: { revision: 'desc' },
    });

    // An async result must not overwrite a NEWER reviewed version.
    if (latest && latest.reviewedAt && latest.inputSnapshotHash === input.snapshotHash) {
      return { status: 'skipped' as const, reason: 'A reviewed brief already covers exactly this input.' };
    }

    const revision = (latest?.revision ?? 0) + 1;
    const brief = await tx.brief.create({
      data: {
        organizationId: input.organizationId,
        applicantId: input.applicantId,
        revision,
        providerName: input.providerName,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        inputSnapshotHash: input.snapshotHash,
        inputEventCount: input.eventCount,
        durationMs: input.durationMs,
        state: BriefState.GENERATED,
        draftMessageBody: input.result.messageDraft ?? null,
      },
    });

    let order = 0;
    const addItem = async (
      kind: BriefItemKind,
      text: string,
      opts: { interpretation?: boolean; unknown?: boolean; refs?: SourceReference[] } = {},
    ) => {
      const item = await tx.briefItem.create({
        data: {
          organizationId: input.organizationId,
          briefId: brief.id,
          kind,
          order: order++,
          generatedText: text,
          interpretation: opts.interpretation ?? false,
          unknown: opts.unknown ?? false,
        },
      });
      for (const ref of opts.refs ?? []) {
        await tx.briefSourceRef.create({
          data: {
            organizationId: input.organizationId,
            briefItemId: item.id,
            sourceKind: ref.kind,
            sourceId: ref.id,
            sourceRevision: ref.revision ?? null,
            quotedExcerpt: ref.excerpt,
          },
        });
      }
      return item;
    };

    // Intent is an interpretation, always labelled as a suggestion.
    await addItem(BriefItemKind.INTENT, input.result.applicantIntent, { interpretation: true });

    let demoted = 0;
    for (const fact of input.result.facts) {
      const keep = fact.sources.filter((s) =>
        validKeys.has(`${s.kind}:${s.id}:${s.revision ?? 0}:${s.excerpt}`),
      );
      if (keep.length === 0) {
        // No surviving citation: it stops being a fact.
        demoted += 1;
        await addItem(
          BriefItemKind.CLARIFICATION,
          `Unverified and therefore not treated as fact — confirm with the applicant: ${fact.text}`,
          { interpretation: true },
        );
        continue;
      }
      await addItem(BriefItemKind.FACT, fact.text, { refs: keep });
    }

    for (const c of input.result.clarifications) await addItem(BriefItemKind.CLARIFICATION, c);
    for (const u of input.result.unknowns) await addItem(BriefItemKind.CLARIFICATION, u, { unknown: true });
    await addItem(BriefItemKind.NEXT_ACTION, input.result.suggestedNextAction, { interpretation: true });
    for (const r of input.result.reviewReasons) await addItem(BriefItemKind.REVIEW_REASON, r);

    if (latest && latest.state !== BriefState.REJECTED) {
      await tx.brief.update({ where: { id: latest.id }, data: { state: BriefState.SUPERSEDED } });
    }

    await auditOperational(tx, ctx, {
      action: 'brief.generated',
      subjectType: 'brief',
      subjectId: brief.id,
      applicantId: input.applicantId,
      metadata: {
        provider: input.providerName,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        revision,
        factCount: input.result.facts.length,
        rejectedCitations: rejected.length,
        demotedFacts: demoted,
        reason: input.reason,
      },
    });

    return { status: 'ok' as const, briefId: brief.id, revision, rejectedRefs: rejected.length };
  });
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

export async function getLatestBrief(organizationId: string, applicantId: string) {
  return prisma.brief.findFirst({
    where: { organizationId, applicantId },
    orderBy: { revision: 'desc' },
    include: {
      items: { orderBy: { order: 'asc' }, include: { sources: true } },
      reviews: { orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function reviewBrief(
  ctx: ActorContext,
  input: { briefId: string; action: 'approve' | 'reject'; note?: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const brief = await tx.brief.findFirst({ where: { id: input.briefId, organizationId } });
    if (!brief) throw new NotFoundError('Brief');
    await requireCase(ctx, brief.applicantId, 'content');
    if (brief.state === BriefState.FAILED) {
      throw new ConflictError('That brief did not generate; there is nothing to review.');
    }

    const correctedItemCount = await tx.briefItem.count({
      where: { organizationId, briefId: brief.id, recruiterText: { not: null } },
    });

    const updated = await tx.brief.update({
      where: { id: brief.id },
      data: {
        state: input.action === 'approve' ? BriefState.APPROVED : BriefState.REJECTED,
        reviewedByMemberId: staff.member.id,
        reviewedAt: now(),
        reviewNote: input.note ?? null,
        version: { increment: 1 },
      },
    });

    await tx.briefReview.create({
      data: {
        organizationId,
        briefId: brief.id,
        action: input.action === 'approve' ? 'approved' : 'rejected',
        memberId: staff.member.id,
        note: input.note ?? null,
        correctedItemCount,
      },
    });

    await recordMetric(tx, {
      organizationId,
      kind: MetricEventKind.BRIEF_REVIEWED,
      applicantId: brief.applicantId,
      memberId: staff.member.id,
      numericValue: correctedItemCount,
      detail: input.action,
    });
    if (correctedItemCount > 0) {
      await recordMetric(tx, {
        organizationId,
        kind: MetricEventKind.BRIEF_CORRECTED,
        applicantId: brief.applicantId,
        memberId: staff.member.id,
        numericValue: correctedItemCount,
      });
    }

    await auditOperational(tx, ctx, {
      action: `brief.${input.action}d`,
      subjectType: 'brief',
      subjectId: brief.id,
      applicantId: brief.applicantId,
      metadata: { correctedItemCount },
    });
    return updated;
  });
}

/**
 * A recruiter correcting a brief item.
 *
 * `generatedText` is retained untouched; the correction lives in
 * `recruiterText`. Regeneration creates a NEW brief revision and copies
 * forward every correction, so a later generation can never quietly replace a
 * human's fix.
 */
export async function editBriefItem(
  ctx: ActorContext,
  input: { briefItemId: string; text: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  if (!input.text.trim()) throw new ValidationError('A correction needs some text.');

  return prisma.$transaction(async (tx) => {
    const item = await tx.briefItem.findFirst({
      where: { id: input.briefItemId, organizationId },
      include: { brief: { select: { applicantId: true, id: true } } },
    });
    if (!item) throw new NotFoundError('Brief item');
    await requireCase(ctx, item.brief.applicantId, 'act');

    const updated = await tx.briefItem.update({
      where: { id: item.id },
      data: {
        recruiterText: input.text,
        recruiterMemberId: staff.member.id,
        recruiterEditedAt: now(),
      },
    });
    await tx.briefReview.create({
      data: {
        organizationId,
        briefId: item.brief.id,
        action: 'edited',
        memberId: staff.member.id,
        correctedItemCount: 1,
      },
    });
    await auditOperational(tx, ctx, {
      action: 'brief.item_corrected',
      subjectType: 'brief_item',
      subjectId: item.id,
      applicantId: item.brief.applicantId,
      metadata: { kind: item.kind, length: input.text.length },
    });
    return updated;
  });
}

export async function requestRegeneration(ctx: ActorContext, input: { applicantId: string }) {
  const staff = requireStaff(ctx);
  await requireCase(ctx, input.applicantId, 'act');
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const latest = await tx.brief.findFirst({
      where: { organizationId, applicantId: input.applicantId },
      orderBy: { revision: 'desc' },
      select: { id: true, revision: true },
    });
    if (latest) {
      await tx.briefReview.create({
        data: {
          organizationId,
          briefId: latest.id,
          action: 'regenerated',
          memberId: staff.member.id,
        },
      });
    }
    await enqueue(
      tx,
      JOB.prepareBrief,
      {
        organizationId,
        applicantId: input.applicantId,
        requestedByMemberId: staff.member.id,
        reason: 'recruiter_requested',
      },
      { idempotencyKey: `brief:regen:${input.applicantId}:${(latest?.revision ?? 0) + 1}` },
    );
    await auditOperational(tx, ctx, {
      action: 'brief.regeneration_requested',
      subjectType: 'brief',
      subjectId: latest?.id ?? null,
      applicantId: input.applicantId,
    });
    return { queued: true };
  });
}

/**
 * Copy recruiter corrections from the previous revision onto a new one,
 * matched by (kind, generatedText). Called after a regeneration lands.
 */
export async function carryForwardCorrections(
  db: DbOrTx,
  organizationId: string,
  applicantId: string,
  newBriefId: string,
) {
  const previous = await db.brief.findFirst({
    where: { organizationId, applicantId, id: { not: newBriefId } },
    orderBy: { revision: 'desc' },
    include: { items: { where: { recruiterText: { not: null } } } },
  });
  if (!previous) return 0;

  const newItems = await db.briefItem.findMany({ where: { organizationId, briefId: newBriefId } });
  let carried = 0;
  for (const old of previous.items) {
    const match = newItems.find((n) => n.kind === old.kind && n.generatedText === old.generatedText);
    if (!match || match.recruiterText) continue;
    await db.briefItem.update({
      where: { id: match.id },
      data: {
        recruiterText: old.recruiterText,
        recruiterMemberId: old.recruiterMemberId,
        recruiterEditedAt: old.recruiterEditedAt,
      },
    });
    carried += 1;
  }
  return carried;
}

/** Resolve a citation to the exact source, with its own authorization check. */
export async function resolveCitation(
  ctx: ActorContext,
  input: { sourceRefId: string },
): Promise<{
  kind: SourceKind;
  label: string;
  text: string;
  occurredAt: Date;
  applicantId: string;
  excerpt: string;
}> {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  const ref = await prisma.briefSourceRef.findFirst({
    where: { id: input.sourceRefId, organizationId },
    include: { briefItem: { include: { brief: { select: { applicantId: true } } } } },
  });
  if (!ref) throw new NotFoundError('Source reference');

  const applicantId = ref.briefItem.brief.applicantId;
  // Source access is authorized in its own right, not implied by having seen
  // the brief.
  await requireCase(ctx, applicantId, 'content');

  let label = '';
  let text = '';
  let occurredAt = now();

  switch (ref.sourceKind) {
    case SourceKind.MESSAGE: {
      const row = await prisma.message.findFirst({
        where: { id: ref.sourceId, organizationId, applicantId },
      });
      if (!row) throw new NotFoundError('Source');
      label = `${row.direction === 'INBOUND' ? 'Received' : 'Sent'} ${row.channel}`;
      text = row.body;
      occurredAt = row.occurredAt;
      break;
    }
    case SourceKind.INTAKE_ANSWER: {
      const row = await prisma.intakeAnswer.findFirst({
        where: { id: ref.sourceId, organizationId, intakeSession: { applicantId } },
      });
      if (!row) throw new NotFoundError('Source');
      if (row.sensitive) await requireCase(ctx, applicantId, 'sensitive');
      label = row.questionPrompt;
      text = row.valueText;
      occurredAt = row.answeredAt;
      break;
    }
    case SourceKind.NOTE_REVISION: {
      const row = await prisma.noteRevision.findFirst({
        where: { id: ref.sourceId, organizationId, note: { applicantId } },
        include: { note: { select: { sensitive: true } } },
      });
      if (!row) throw new NotFoundError('Source');
      if (row.note.sensitive) await requireCase(ctx, applicantId, 'sensitive');
      label = `Staff note (revision ${row.revision})`;
      text = row.body;
      occurredAt = row.createdAt;
      break;
    }
    case SourceKind.CALL_EVENT: {
      const row = await prisma.callEvent.findFirst({
        where: { id: ref.sourceId, organizationId, applicantId },
      });
      if (!row) throw new NotFoundError('Source');
      label = `Call (${row.direction})`;
      text = `${row.outcome}${row.humanConnected ? ', spoke with the applicant' : ', no human connection'}${row.note ? `. ${row.note}` : ''}`;
      occurredAt = row.occurredAt;
      break;
    }
  }

  await auditSecurity(prisma, ctx, {
    action: 'brief.source_viewed',
    subjectType: 'brief_source_ref',
    subjectId: ref.id,
    applicantId,
    metadata: { sourceKind: ref.sourceKind, sourceId: ref.sourceId },
  });

  return { kind: ref.sourceKind, label, text, occurredAt, applicantId, excerpt: ref.quotedExcerpt };
}

export function briefIsStale(brief: Pick<Brief, 'staleAt'>): boolean {
  return brief.staleAt !== null;
}

import 'server-only';
import { CaseClosureReason, CaseStatus, ReviewFlagKind, TaskStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { maskContact } from '@/lib/redact';
import { ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import { canReassignAny, requireCase, requireStaff, systemContext, type ActorContext } from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { raiseReviewFlag } from './cases';
import { ensureNextStep } from './tasks';

/**
 * Duplicate identification and merging.
 *
 * The rule that shapes everything here: A SHARED PHONE NUMBER IS NOT PROOF OF
 * IDENTITY. Families share phones. Siblings have similar names. So:
 *
 *   * Nothing is ever merged automatically.
 *   * A duplicate candidate never reveals one case's contents on the other.
 *     It is a pointer plus the signal that produced it, nothing more.
 *   * Merging is an explicit, authorized action that preserves provenance and
 *     keeps the MOST RESTRICTIVE contact permission until someone reviews it.
 */

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

export async function detectDuplicates(organizationId: string, applicantId: string) {
  const applicant = await prisma.applicant.findFirst({
    where: { id: applicantId, organizationId },
    include: { contactPoints: true },
  });
  if (!applicant) return { created: 0 };

  const values = applicant.contactPoints.map((c) => c.value);
  const candidates = new Map<string, { signal: string; detail: string }>();

  if (values.length) {
    const sharing = await prisma.contactPoint.findMany({
      where: {
        organizationId,
        value: { in: values },
        applicantId: { not: applicantId },
        applicant: { mergedIntoApplicantId: null },
      },
      select: { applicantId: true, value: true, channel: true },
    });
    for (const row of sharing) {
      candidates.set(row.applicantId, {
        signal: row.value.includes('@') ? 'shared_email' : 'shared_phone',
        detail: `Both cases list ${maskContact(row.value)} (${row.channel}). That is a shared contact value, not proof of identity.`,
      });
    }
  }

  const normalized = normalizeName(applicant.displayName);
  if (normalized.length > 4) {
    const sameName = await prisma.applicant.findMany({
      where: { organizationId, id: { not: applicantId }, mergedIntoApplicantId: null },
      select: { id: true, displayName: true },
      take: 500,
    });
    for (const other of sameName) {
      if (normalizeName(other.displayName) !== normalized) continue;
      if (candidates.has(other.id)) continue;
      candidates.set(other.id, {
        signal: 'similar_name',
        detail: 'The display names match. Matching names are not proof of identity.',
      });
    }
  }

  let created = 0;
  const ctx = systemContext(organizationId, 'duplicates.detect');
  for (const [otherId, info] of candidates) {
    const [a, b] = [applicantId, otherId].sort();
    try {
      await prisma.duplicateCandidate.create({
        data: {
          organizationId,
          applicantAId: a!,
          applicantBId: b!,
          signal: info.signal,
          signalDetail: info.detail,
        },
      });
      created += 1;
      await prisma.$transaction(async (tx) => {
        await raiseReviewFlag(tx, ctx, {
          applicantId,
          kind: ReviewFlagKind.DUPLICATE_SUSPECTED,
          detail: `This case may be the same person as another case in this organization. ${info.detail} Nothing has been merged.`,
          sourceRef: `duplicate:${a}:${b}:${info.signal}`,
          taskTitle: 'Check a possible duplicate case',
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }
  return { created };
}

export async function listDuplicateCandidates(organizationId: string, applicantId?: string) {
  return prisma.duplicateCandidate.findMany({
    where: {
      organizationId,
      resolution: 'open',
      ...(applicantId ? { OR: [{ applicantAId: applicantId }, { applicantBId: applicantId }] } : {}),
    },
    include: {
      applicantA: { select: { id: true, displayName: true, reference: true, ownerMemberId: true, teamId: true, organizationId: true } },
      applicantB: { select: { id: true, displayName: true, reference: true, ownerMemberId: true, teamId: true, organizationId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Merge two cases.
 *
 * Requires reassignment authority AND content access to BOTH cases — you
 * cannot merge a case you are not allowed to read. Provenance survives: the
 * merged case is kept, marked, and its rows are re-pointed rather than copied.
 */
export async function mergeCases(
  ctx: ActorContext,
  input: { survivingApplicantId: string; mergedApplicantId: string; reason: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  if (input.survivingApplicantId === input.mergedApplicantId) {
    throw new ValidationError('Pick two different cases.');
  }
  if (!(await canReassignAny(ctx))) {
    throw new ConflictError('Merging cases needs reassignment authority.');
  }
  // Both sides must be readable, in their own right.
  await requireCase(ctx, input.survivingApplicantId, 'content');
  await requireCase(ctx, input.mergedApplicantId, 'content');

  return prisma.$transaction(async (tx) => {
    const surviving = await tx.applicant.findFirst({
      where: { id: input.survivingApplicantId, organizationId },
    });
    const merged = await tx.applicant.findFirst({
      where: { id: input.mergedApplicantId, organizationId },
    });
    if (!surviving || !merged) throw new NotFoundError('Case');
    if (merged.mergedIntoApplicantId) throw new ConflictError('That case has already been merged.');

    const at = now();

    // Contact points move across, keeping their provenance.
    const points = await tx.contactPoint.findMany({
      where: { organizationId, applicantId: merged.id },
    });
    for (const point of points) {
      await tx.contactPoint.upsert({
        where: {
          organizationId_applicantId_channel_value: {
            organizationId,
            applicantId: surviving.id,
            channel: point.channel,
            value: point.value,
          },
        },
        create: {
          organizationId,
          applicantId: surviving.id,
          channel: point.channel,
          value: point.value,
          label: point.label ? `${point.label} (merged from ${merged.reference})` : `merged from ${merged.reference}`,
        },
        update: {},
      });
    }

    /**
     * Channel permissions: take the MOST RESTRICTIVE of the two until someone
     * reviews it. Any suppression anywhere wins; a grant only survives if it
     * is not contradicted.
     */
    const mergedPermissions = await tx.channelPermission.findMany({
      where: { organizationId, applicantId: merged.id },
    });
    for (const permission of mergedPermissions) {
      const existing = await tx.channelPermission.findUnique({
        where: {
          organizationId_applicantId_channel_purpose_contactValue: {
            organizationId,
            applicantId: surviving.id,
            channel: permission.channel,
            purpose: permission.purpose,
            contactValue: permission.contactValue,
          },
        },
      });
      const granted = (existing?.granted ?? false) && permission.granted;
      const suppressed = (existing?.suppressed ?? false) || permission.suppressed;
      await tx.channelPermission.upsert({
        where: {
          organizationId_applicantId_channel_purpose_contactValue: {
            organizationId,
            applicantId: surviving.id,
            channel: permission.channel,
            purpose: permission.purpose,
            contactValue: permission.contactValue,
          },
        },
        create: {
          organizationId,
          applicantId: surviving.id,
          channel: permission.channel,
          purpose: permission.purpose,
          contactValue: permission.contactValue,
          granted: permission.granted && !permission.suppressed,
          suppressed: permission.suppressed,
          suppressedAt: permission.suppressedAt,
          suppressionSource: permission.suppressionSource,
        },
        update: {
          granted: granted && !suppressed,
          suppressed,
          suppressedAt: suppressed ? (existing?.suppressedAt ?? permission.suppressedAt) : null,
        },
      });
    }

    // Immutable history, appointments, tasks, notes, briefs and consent move
    // to the surviving case; nothing is rewritten.
    for (const model of ['conversation', 'message', 'note', 'task', 'appointment', 'reviewFlag', 'brief', 'consentEvent', 'callEvent', 'intakeSession', 'handoffExport'] as const) {
      // @ts-expect-error -- uniform updateMany across models with applicantId
      await tx[model].updateMany({
        where: { organizationId, applicantId: merged.id },
        data: { applicantId: surviving.id },
      });
    }

    /**
     * Inquiry episodes are NOT re-pointed and NOT reset: the merged case's
     * clocks keep their own history, so time-to-contact reporting does not
     * move because two records turned out to be one person.
     */
    await tx.inquiryEpisode.updateMany({
      where: { organizationId, applicantId: merged.id, closedAt: null },
      data: { closedAt: at, supersededAt: at },
    });

    await tx.applicant.update({
      where: { id: merged.id },
      data: {
        mergedIntoApplicantId: surviving.id,
        mergedAt: at,
        status: CaseStatus.CLOSED,
        closureReason: CaseClosureReason.MERGED_DUPLICATE,
        closureNote: input.reason,
        closedAt: at,
        version: { increment: 1 },
      },
    });

    await tx.duplicateCandidate.updateMany({
      where: {
        organizationId,
        OR: [
          { applicantAId: merged.id, applicantBId: surviving.id },
          { applicantAId: surviving.id, applicantBId: merged.id },
        ],
      },
      data: { resolution: 'merged', resolvedAt: at, resolvedByMemberId: staff.member.id },
    });

    // The surviving case gets a review item: a merge changes what the office
    // believes about a person, and the restrictive permissions need a decision.
    await raiseReviewFlag(tx, ctx, {
      applicantId: surviving.id,
      kind: ReviewFlagKind.MERGE_PERMISSION_REVIEW,
      detail: `Case ${merged.reference} was merged into this one. Contact permissions were reduced to the most restrictive of the two — confirm what this person actually agreed to.`,
      sourceRef: `merge:${merged.id}`,
      taskTitle: 'Confirm contact permissions after a merge',
    });

    await auditSecurity(tx, ctx, {
      action: 'case.merged',
      subjectType: 'applicant',
      subjectId: surviving.id,
      applicantId: surviving.id,
      metadata: {
        mergedCase: merged.id,
        mergedReference: merged.reference,
        reason: input.reason,
        contactPointsMoved: points.length,
        permissionsReconciled: mergedPermissions.length,
      },
    });

    await ensureNextStep(tx, ctx, surviving.id);
    return { survivingApplicantId: surviving.id, mergedApplicantId: merged.id };
  });
}

export async function markNotDuplicate(
  ctx: ActorContext,
  input: { candidateId: string; reason: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  const candidate = await prisma.duplicateCandidate.findFirst({
    where: { id: input.candidateId, organizationId },
  });
  if (!candidate) throw new NotFoundError('Duplicate candidate');
  await requireCase(ctx, candidate.applicantAId, 'act');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.duplicateCandidate.update({
      where: { id: candidate.id },
      data: {
        resolution: 'not_duplicate',
        resolvedAt: now(),
        resolvedByMemberId: staff.member.id,
      },
    });
    for (const applicantId of [candidate.applicantAId, candidate.applicantBId]) {
      await tx.reviewFlag.updateMany({
        where: {
          organizationId,
          applicantId,
          kind: ReviewFlagKind.DUPLICATE_SUSPECTED,
          sourceRef: { contains: candidate.signal },
          status: 'OPEN',
        },
        data: {
          status: 'DISMISSED',
          resolvedAt: now(),
          resolvedByMemberId: staff.member.id,
          resolutionReason: input.reason,
        },
      });
      await tx.task.updateMany({
        where: { organizationId, applicantId, type: 'LINKING_REVIEW', status: TaskStatus.OPEN },
        data: {
          status: TaskStatus.CANCELED,
          canceledAt: now(),
          cancelReason: `not a duplicate: ${input.reason}`,
        },
      });
    }
    await auditSecurity(tx, ctx, {
      action: 'duplicate.dismissed',
      subjectType: 'duplicate_candidate',
      subjectId: candidate.id,
      metadata: { reason: input.reason, signal: candidate.signal },
    });
    return updated;
  });
}

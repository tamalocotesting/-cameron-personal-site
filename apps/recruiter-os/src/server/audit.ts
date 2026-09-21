import 'server-only';
import { AuditCategory, type Prisma } from '@prisma/client';
import type { DbOrTx } from '@/server/db';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { redact } from '@/lib/redact';
import { actorLabel, organizationIdOf, type ActorContext } from '@/server/authz/policy';

/**
 * Audit writing.
 *
 * Two separate streams share one table, distinguished by `category`:
 *   SECURITY    — sensitive reads, exports, grants, settings, integrations.
 *   OPERATIONAL — ordinary workflow activity shown on a case's Activity tab.
 *
 * Metadata is redacted on the way in. An audit row records WHICH fields moved
 * and WHO moved them; it never becomes a second, more widely readable copy of
 * an applicant's words.
 *
 * Append-only through the application is not the same as tamper-proof against
 * a database administrator. SECURITY.md says so plainly.
 */
export type AuditInput = {
  category: AuditCategory;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  applicantId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export function auditData(ctx: ActorContext, input: AuditInput): Prisma.AuditEventCreateManyInput {
  return {
    organizationId: organizationIdOf(ctx),
    category: input.category,
    action: input.action,
    actorKind: ctx.kind,
    actorMemberId: ctx.kind === 'staff' ? ctx.member.id : null,
    actorUserId: ctx.kind === 'staff' ? ctx.identity.userId : null,
    actorLabel: actorLabel(ctx),
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    applicantId: input.applicantId ?? null,
    metadata: (redact(input.metadata ?? {}) ?? {}) as Prisma.InputJsonValue,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    occurredAt: now(),
  };
}

/** Write inside the caller's transaction, so the audit row cannot be lost. */
export async function writeAudit(db: DbOrTx, ctx: ActorContext, input: AuditInput) {
  return db.auditEvent.create({ data: auditData(ctx, input) });
}

/** For read-path auditing, where there is no business transaction to join. */
export async function auditRead(ctx: ActorContext, input: Omit<AuditInput, 'category'>) {
  await prisma.auditEvent.create({ data: auditData(ctx, { ...input, category: AuditCategory.SECURITY }) });
}

export async function auditOperational(db: DbOrTx, ctx: ActorContext, input: Omit<AuditInput, 'category'>) {
  return writeAudit(db, ctx, { ...input, category: AuditCategory.OPERATIONAL });
}

export async function auditSecurity(db: DbOrTx, ctx: ActorContext, input: Omit<AuditInput, 'category'>) {
  return writeAudit(db, ctx, { ...input, category: AuditCategory.SECURITY });
}

import 'server-only';
import { HandoffState } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { toCsv } from '@/lib/csv';
import { assertTransition, handoffTransitions } from '@/server/domain/state-machines';
import { ConflictError, NotFoundError } from '@/server/authz/errors';
import { canExport, requireCase, requireStaff, type ActorContext } from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { enqueue } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { deliverWebhook, outboundWebhookEnabled } from '@/server/providers/webhook/outbound';
import { isDemoMode } from '@/env';

/**
 * Handoff to an existing recruiting system.
 *
 * This is a GENERIC, VERSIONED, RECRUITER-REVIEWED PACKAGE plus a manual
 * export. There is no AFRISS API here, no scraping of any official system, and
 * no claim that an export was imported anywhere. INTEGRATIONS.md documents
 * what an implementation partner would need to build the receiving side.
 */

export const HANDOFF_PACKAGE_VERSION = 'recruiteros.handoff/1';

/** Allowlist. Anything not on this list does not leave. */
const ALLOWLISTED_FIELDS = [
  'package_version',
  'case_reference',
  'display_name',
  'preferred_name',
  'general_location',
  'timezone',
  'primary_phone',
  'primary_email',
  'inquiry_origin',
  'inquiry_opened_at',
  'workflow_status',
  'owner_display_name',
  'intake_version',
  'intake_answers',
  'appointment_summary',
  'contact_permissions',
  'external_reference_id',
  'prepared_at',
] as const;

export async function buildHandoffPreview(ctx: ActorContext, applicantId: string) {
  const { applicant } = await requireCase(ctx, applicantId, 'content');
  const organizationId = applicant.organizationId;

  const [contacts, episode, session, appointment, owner, permissions] = await Promise.all([
    prisma.contactPoint.findMany({ where: { organizationId, applicantId }, orderBy: { isPrimary: 'desc' } }),
    prisma.inquiryEpisode.findFirst({
      where: { organizationId, applicantId },
      orderBy: { openedAt: 'asc' },
    }),
    prisma.intakeSession.findFirst({
      where: { organizationId, applicantId },
      orderBy: { createdAt: 'desc' },
      include: {
        intakeVersion: { select: { version: true } },
        // Sensitive answers are excluded from a handoff package by default.
        answers: { where: { supersededAt: null, sensitive: false, skipped: false } },
      },
    }),
    prisma.appointment.findFirst({
      where: { organizationId, applicantId, state: { in: ['SCHEDULED', 'CONFIRMED', 'COMPLETED'] } },
      orderBy: { startsAt: 'desc' },
    }),
    applicant.ownerMemberId
      ? prisma.member.findFirst({ where: { organizationId, id: applicant.ownerMemberId } })
      : null,
    prisma.channelPermission.findMany({
      where: { organizationId, applicantId, granted: true, suppressed: false },
      select: { purpose: true, channel: true },
    }),
  ]);

  const payload: Record<string, unknown> = {
    package_version: HANDOFF_PACKAGE_VERSION,
    case_reference: applicant.reference,
    display_name: applicant.displayName,
    preferred_name: applicant.preferredName,
    general_location: applicant.generalLocation,
    timezone: applicant.timezone,
    primary_phone: contacts.find((c) => c.channel !== 'EMAIL')?.value ?? null,
    primary_email: contacts.find((c) => c.channel === 'EMAIL')?.value ?? null,
    inquiry_origin: episode?.originKind ?? null,
    inquiry_opened_at: episode?.openedAt?.toISOString() ?? null,
    workflow_status: applicant.status,
    owner_display_name: owner?.displayName ?? null,
    intake_version: session?.intakeVersion.version ?? null,
    intake_answers:
      session?.answers.map((a) => ({ question: a.questionPrompt, key: a.questionKey, answer: a.valueText })) ?? [],
    appointment_summary: appointment
      ? {
          starts_at: appointment.startsAt.toISOString(),
          timezone: appointment.timezone,
          state: appointment.state,
          medium: appointment.medium,
        }
      : null,
    contact_permissions: permissions.map((p) => `${p.channel}:${p.purpose}`),
    external_reference_id: null,
    prepared_at: now().toISOString(),
  };

  // Defensive: strip anything that crept outside the allowlist.
  for (const key of Object.keys(payload)) {
    if (!(ALLOWLISTED_FIELDS as readonly string[]).includes(key)) delete payload[key];
  }

  return { payload, allowlist: ALLOWLISTED_FIELDS, demoData: isDemoMode };
}

export async function prepareHandoff(
  ctx: ActorContext,
  input: { applicantId: string; externalReferenceId?: string },
) {
  const staff = requireStaff(ctx);
  const { payload } = await buildHandoffPreview(ctx, input.applicantId);
  if (input.externalReferenceId) payload.external_reference_id = input.externalReferenceId;

  return prisma.$transaction(async (tx) => {
    const record = await tx.handoffExport.create({
      data: {
        organizationId: staff.member.organizationId,
        applicantId: input.applicantId,
        packageVersion: HANDOFF_PACKAGE_VERSION,
        payload: payload as object,
        state: HandoffState.DRAFT,
        preparedByMemberId: staff.member.id,
        externalReferenceId: input.externalReferenceId ?? null,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'handoff.prepared',
      subjectType: 'handoff_export',
      subjectId: record.id,
      applicantId: input.applicantId,
      metadata: { packageVersion: HANDOFF_PACKAGE_VERSION, fields: Object.keys(payload) },
    });
    return record;
  });
}

export async function approveHandoff(ctx: ActorContext, input: { handoffId: string }) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const record = await tx.handoffExport.findFirst({ where: { id: input.handoffId, organizationId } });
    if (!record) throw new NotFoundError('Handoff package');
    await requireCase(ctx, record.applicantId, 'content');
    assertTransition(handoffTransitions, record.state, HandoffState.APPROVED, 'Handoff package');

    const updated = await tx.handoffExport.update({
      where: { id: record.id },
      data: {
        state: HandoffState.APPROVED,
        approvedByMemberId: staff.member.id,
        approvedAt: now(),
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'handoff.approved',
      subjectType: 'handoff_export',
      subjectId: record.id,
      applicantId: record.applicantId,
    });
    return updated;
  });
}

export async function exportHandoff(
  ctx: ActorContext,
  input: { handoffId: string; format: 'json' | 'csv' },
) {
  const staff = requireStaff(ctx);
  if (!(await canExport(ctx))) throw new ConflictError('Exporting needs the export grant.');
  const organizationId = staff.member.organizationId;

  const record = await prisma.handoffExport.findFirst({ where: { id: input.handoffId, organizationId } });
  if (!record) throw new NotFoundError('Handoff package');
  await requireCase(ctx, record.applicantId, 'content');
  if (record.state === HandoffState.DRAFT) {
    throw new ConflictError('A handoff package has to be approved before it is exported.');
  }

  const payload = record.payload as Record<string, unknown>;
  const body =
    input.format === 'json'
      ? JSON.stringify(payload, null, 2)
      : toCsv(Object.keys(payload), [
          Object.values(payload).map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)),
        ]);

  await prisma.$transaction(async (tx) => {
    await tx.handoffExport.update({
      where: { id: record.id },
      data: { state: HandoffState.EXPORTED, exportedAt: now(), transport: input.format },
    });
    await auditSecurity(tx, ctx, {
      action: 'handoff.exported',
      subjectType: 'handoff_export',
      subjectId: record.id,
      applicantId: record.applicantId,
      metadata: { format: input.format, fields: Object.keys(payload) },
    });
  });

  return {
    body,
    contentType: input.format === 'json' ? 'application/json' : 'text/csv',
    filename: `handoff-${payload.case_reference}-${record.id.slice(-6)}${isDemoMode ? '-FICTIONAL-DEMO' : ''}.${input.format}`,
  };
}

export async function queueWebhookDelivery(ctx: ActorContext, input: { handoffId: string }) {
  const staff = requireStaff(ctx);
  if (!outboundWebhookEnabled()) {
    throw new ConflictError(
      'The outbound webhook adapter is disabled. It needs an allowlisted destination and a signing secret.',
    );
  }
  const organizationId = staff.member.organizationId;
  const record = await prisma.handoffExport.findFirst({ where: { id: input.handoffId, organizationId } });
  if (!record) throw new NotFoundError('Handoff package');
  if (record.state === HandoffState.DRAFT) {
    throw new ConflictError('Approve the package before sending it.');
  }
  return prisma.$transaction(async (tx) => {
    await enqueue(
      tx,
      JOB.deliverHandoffWebhook,
      { organizationId, handoffExportId: record.id },
      { idempotencyKey: `handoff-webhook:${record.id}` },
    );
    await auditSecurity(tx, ctx, {
      action: 'handoff.webhook_queued',
      subjectType: 'handoff_export',
      subjectId: record.id,
      applicantId: record.applicantId,
    });
    return { queued: true };
  });
}

export async function deliverHandoffWebhook(organizationId: string, handoffExportId: string) {
  const record = await prisma.handoffExport.findFirst({ where: { id: handoffExportId, organizationId } });
  if (!record) throw new NotFoundError('Handoff package');

  const config = await prisma.integrationConfig.findFirst({
    where: { organizationId, kind: 'OUTBOUND_WEBHOOK', enabled: true },
  });
  const settings = (config?.settings ?? {}) as { url?: string };
  if (!settings.url) {
    await prisma.handoffExport.update({
      where: { id: record.id },
      data: { state: HandoffState.TRANSPORT_FAILED, transportDetail: 'No destination configured.' },
    });
    return { outcome: 'failed' as const, detail: 'No destination configured.' };
  }

  const result = await deliverWebhook({
    url: settings.url,
    payload: record.payload,
    idempotencyKey: `handoff:${record.id}`,
  });

  const state =
    result.outcome === 'accepted'
      ? HandoffState.TRANSPORT_ACCEPTED
      : result.outcome === 'failed'
        ? HandoffState.TRANSPORT_FAILED
        : HandoffState.EXPORTED;

  await prisma.handoffExport.update({
    where: { id: record.id },
    data: {
      state,
      transport: 'webhook',
      transportDetail:
        result.outcome === 'accepted'
          ? `Transport accepted with HTTP ${result.status}. This does NOT confirm the receiving system imported the case.`
          : 'detail' in result
            ? result.detail
            : null,
    },
  });
  return { outcome: result.outcome, detail: 'detail' in result ? result.detail : `HTTP ${result.status}` };
}

/** Somebody on the receiving side confirmed it landed. A 2xx never does this. */
export async function confirmExternalReceipt(
  ctx: ActorContext,
  input: { handoffId: string; externalReferenceId: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const record = await tx.handoffExport.findFirst({ where: { id: input.handoffId, organizationId } });
    if (!record) throw new NotFoundError('Handoff package');
    assertTransition(handoffTransitions, record.state, HandoffState.EXTERNALLY_CONFIRMED, 'Handoff package');
    const updated = await tx.handoffExport.update({
      where: { id: record.id },
      data: {
        state: HandoffState.EXTERNALLY_CONFIRMED,
        externalReferenceId: input.externalReferenceId,
        confirmedAt: now(),
        confirmedByMemberId: staff.member.id,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'handoff.externally_confirmed',
      subjectType: 'handoff_export',
      subjectId: record.id,
      applicantId: record.applicantId,
      metadata: { externalReferenceId: input.externalReferenceId },
    });
    return updated;
  });
}

export async function listHandoffs(organizationId: string, applicantId: string) {
  return prisma.handoffExport.findMany({
    where: { organizationId, applicantId },
    orderBy: { createdAt: 'desc' },
  });
}

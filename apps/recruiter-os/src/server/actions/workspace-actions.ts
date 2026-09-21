'use server';
import { ContactChannel, IntegrationKind } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireStaffContext } from '@/server/context';
import { runAction } from './helpers';
import type { ActionState } from '@/components/ui/form';
import { createCase, normalizeEmail, normalizePhone } from '@/server/services/cases';
import { ensureNextStep } from '@/server/services/tasks';
import { ValidationError } from '@/server/authz/errors';
import { grantCoverage, issueGrant, recordAbsence, revokeCoverage, revokeGrant, setFallbackOwner, setMemberActive } from '@/server/services/team';
import {
  checkIntegrationHealth,
  createDraftIntakeVersion,
  createTemplateDraft,
  publishIntakeVersion,
  publishTemplateVersion,
  recordIntakeApproval,
  setIntegrationEnabled,
  updateCommercialMetadata,
  updateIntegrationSettings,
  updateSettings,
} from '@/server/services/settings';
import { recordBaselineObservation } from '@/server/services/reports';
import { approvePolicy, createPolicy, queueRetentionRun, setLegalHold } from '@/server/services/retention';
import { retryJob, requeueReconciliation } from '@/server/services/operations';
import { approveHandoff, prepareHandoff, queueWebhookDelivery, confirmExternalReceipt } from '@/server/services/handoff';
import { auth } from '@/server/auth';
import { headers } from 'next/headers';

function str(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
function optional(data: FormData, key: string) {
  const value = str(data, key);
  return value.length ? value : undefined;
}
function numOrNull(data: FormData, key: string) {
  const value = str(data, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Applicants
// ---------------------------------------------------------------------------

export async function addApplicantAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const displayName = str(data, 'displayName');
    if (displayName.length < 2) {
      throw new ValidationError('A name is needed.', { displayName: ['Enter a name.'] });
    }
    const phoneRaw = optional(data, 'phone');
    const emailRaw = optional(data, 'email');
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    if (phoneRaw && !phone) {
      throw new ValidationError('That phone number is not valid.', { phone: ['Enter a 10-digit US number.'] });
    }
    if (emailRaw && !email) {
      throw new ValidationError('That email address is not valid.', { email: ['Check the address.'] });
    }

    const contactPoints: Array<{ channel: ContactChannel; value: string; isPrimary?: boolean }> = [];
    if (phone) {
      contactPoints.push({ channel: ContactChannel.PHONE_CALL, value: phone, isPrimary: true });
      contactPoints.push({ channel: ContactChannel.SMS, value: phone });
    }
    if (email) contactPoints.push({ channel: ContactChannel.EMAIL, value: email, isPrimary: !phone });

    const created = await prisma.$transaction(async (tx) => {
      const result = await createCase(tx, ctx, {
        organizationId: ctx.member.organizationId,
        displayName,
        generalLocation: optional(data, 'generalLocation') ?? null,
        timezone: optional(data, 'timezone') ?? null,
        originKind: str(data, 'originKind') || 'manual',
        contactPoints,
        ownerMemberId: optional(data, 'ownerMemberId'),
      });
      await ensureNextStep(tx, ctx, result.applicant.id);
      return result.applicant;
    });

    return {
      message: `Case ${created.reference} created with an owner and a next step.`,
      revalidate: ['/today', '/applicants'],
    };
  });
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function inviteMemberAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    if (ctx.member.staffRole !== 'ORG_ADMIN') {
      throw new ValidationError('Only an organization administrator can invite staff.');
    }
    const email = normalizeEmail(str(data, 'email'));
    if (!email) throw new ValidationError('Enter a valid email address.', { email: ['Check the address.'] });
    const staffRole = z.enum(['RECRUITER', 'MANAGER', 'ORG_ADMIN']).parse(str(data, 'staffRole'));

    const requestHeaders = await headers();
    await auth.api.createInvitation({
      headers: requestHeaders,
      body: {
        email,
        role: staffRole === 'ORG_ADMIN' ? 'admin' : 'member',
        organizationId: ctx.member.organizationId,
      },
    });
    // The RecruiterOS staff role is ours, not Better Auth's, so it is stamped
    // onto the invitation row we just created.
    await prisma.invitation.updateMany({
      where: { organizationId: ctx.member.organizationId, email, status: 'pending' },
      data: { staffRole },
    });

    return {
      message: `Invitation sent to ${email}. Locally, read it in Mailpit at http://localhost:8025.`,
      revalidate: ['/settings/users', '/team'],
    };
  });
}

export async function setMemberActiveAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await setMemberActive(ctx, {
      memberId: str(data, 'memberId'),
      active: str(data, 'active') === 'true',
      reason: str(data, 'reason'),
    });
    return { message: 'Membership updated.', revalidate: ['/settings/users', '/team'] };
  });
}

export async function grantCoverageAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await grantCoverage(ctx, {
      fromMemberId: str(data, 'fromMemberId'),
      toMemberId: str(data, 'toMemberId'),
      applicantId: optional(data, 'applicantId') ?? null,
      startsAt: new Date(str(data, 'startsAt')),
      expiresAt: new Date(str(data, 'expiresAt')),
      reason: str(data, 'reason'),
    });
    return { message: 'Coverage granted. It expires automatically.', revalidate: ['/team', '/today'] };
  });
}

export async function revokeCoverageAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await revokeCoverage(ctx, { coverageId: str(data, 'coverageId'), reason: str(data, 'reason') });
    return { message: 'Coverage revoked. Access stops immediately.', revalidate: ['/team', '/today'] };
  });
}

export async function recordAbsenceAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await recordAbsence(ctx, {
      memberId: str(data, 'memberId'),
      startsAt: new Date(str(data, 'startsAt')),
      endsAt: new Date(str(data, 'endsAt')),
      note: optional(data, 'note'),
    });
    return {
      message: 'Absence recorded. New inquiries route away from this member while it lasts.',
      revalidate: ['/team'],
    };
  });
}

export async function setFallbackOwnerAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await setFallbackOwner(ctx, { memberId: str(data, 'memberId') });
    return { message: 'Fallback owner set.', revalidate: ['/team', '/settings'] };
  });
}

export async function issueGrantAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const expires = optional(data, 'expiresAt');
    await issueGrant(ctx, {
      subjectMemberId: str(data, 'subjectMemberId'),
      grant: z
        .enum([
          'CASE_CONTENT',
          'TEAM_CONVERSATION_CONTENT',
          'REASSIGNMENT',
          'EXPORT',
          'SENSITIVE_SOURCE',
          'TEAM_REPORTS',
          'BASELINE_ENTRY',
          'RETENTION_ADMIN',
        ])
        .parse(str(data, 'grant')),
      applicantId: optional(data, 'applicantId') ?? null,
      teamId: optional(data, 'teamId') ?? null,
      reason: str(data, 'reason'),
      expiresAt: expires ? new Date(expires) : null,
    });
    return { message: 'Grant issued and recorded in the audit trail.', revalidate: ['/settings/users', '/team'] };
  });
}

export async function revokeGrantAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await revokeGrant(ctx, { grantId: str(data, 'grantId'), reason: str(data, 'reason') });
    return { message: 'Grant revoked. Access stops immediately.', revalidate: ['/settings/users', '/team'] };
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettingsAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const categories = data.getAll('aiApprovedCategories').filter((v): v is string => typeof v === 'string');
    await updateSettings(ctx, {
      defaultTimezone: str(data, 'defaultTimezone'),
      quietHoursStartMinute: Number(str(data, 'quietHoursStartMinute')),
      quietHoursEndMinute: Number(str(data, 'quietHoursEndMinute')),
      unknownTimezonePolicy: z.enum(['BLOCK', 'REVIEW']).parse(str(data, 'unknownTimezonePolicy')),
      routingStrategy: z.enum(['ROUND_ROBIN', 'FALLBACK_ONLY']).parse(str(data, 'routingStrategy')),
      seatLimit: Number(str(data, 'seatLimit')),
      minimumIntakeAge: numOrNull(data, 'minimumIntakeAge'),
      youthPolicyNote: optional(data, 'youthPolicyNote') ?? null,
      citizenshipQuestionsEnabled: data.get('citizenshipQuestionsEnabled') === 'on',
      aiPreparationEnabled: data.get('aiPreparationEnabled') === 'on',
      aiProvider: z.enum(['local-rules', 'anthropic']).parse(str(data, 'aiProvider')),
      aiApprovedCategories: z
        .array(
          z.enum(['intake_answers', 'applicant_messages', 'recruiter_messages', 'call_outcomes', 'staff_notes']),
        )
        .parse(categories),
      automationEnabled: data.get('automationEnabled') === 'on',
      textBackEnabled: data.get('textBackEnabled') === 'on',
      textBackWindowMinutes: Number(str(data, 'textBackWindowMinutes')),
      textBackMaxQuestions: Number(str(data, 'textBackMaxQuestions')),
      expectedVersion: Number(str(data, 'expectedVersion')),
    });
    return { message: 'Settings saved.', revalidate: ['/settings'] };
  });
}

export async function recordIntakeApprovalAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await recordIntakeApproval(ctx, { note: str(data, 'note') });
    return {
      message:
        'Recorded that this organization approved its question set. This is an internal record only — it does not create official authorization.',
      revalidate: ['/settings', '/settings/intake'],
    };
  });
}

export async function publishIntakeVersionAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await publishIntakeVersion(ctx, {
      intakeVersionId: str(data, 'intakeVersionId'),
      approvalNote: str(data, 'approvalNote'),
    });
    return {
      message: 'Published. Sessions already in progress keep the version they started on.',
      revalidate: ['/settings/intake'],
    };
  });
}

export async function duplicateIntakeVersionAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const sourceId = str(data, 'intakeVersionId');
    const source = await prisma.intakeVersion.findFirst({
      where: { id: sourceId, organizationId: ctx.member.organizationId },
      include: { questions: { orderBy: { order: 'asc' } }, definition: true },
    });
    if (!source) throw new ValidationError('That version does not exist.');
    await createDraftIntakeVersion(ctx, {
      definitionKey: source.definition.key,
      greeting: str(data, 'greeting') || source.greeting,
      completionText: str(data, 'completionText') || source.completionText,
      handoffText: str(data, 'handoffText') || source.handoffText,
      questions: source.questions.map((q) => ({
        key: q.key,
        order: q.order,
        pathway: q.pathway,
        type: q.type,
        prompt: q.prompt,
        helpText: q.helpText,
        required: q.required,
        options: q.options,
        consentPurpose: q.consentPurpose,
        disclosureKey: q.disclosureKey,
        disclosureText: q.disclosureText,
        sensitiveCategory: q.sensitiveCategory,
      })),
    });
    return {
      message: 'New draft created from that version. Editing a published question set never changes it in place.',
      revalidate: ['/settings/intake'],
    };
  });
}

export async function createTemplateDraftAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await createTemplateDraft(ctx, {
      templateKey: str(data, 'templateKey'),
      kind: z.enum(['ACKNOWLEDGMENT', 'INTAKE_INVITATION', 'APPOINTMENT_REMINDER', 'RECRUITER_MANUAL']).parse(
        str(data, 'kind'),
      ),
      channel: ContactChannel.SMS,
      name: str(data, 'name'),
      body: str(data, 'body'),
      placeholders: str(data, 'placeholders')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      automatable: data.get('automatable') === 'on',
    });
    return { message: 'Template draft saved.', revalidate: ['/settings/templates'] };
  });
}

export async function publishTemplateAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await publishTemplateVersion(ctx, { templateVersionId: str(data, 'templateVersionId') });
    return {
      message: 'Published and approved. Only approved published versions can be automated.',
      revalidate: ['/settings/templates'],
    };
  });
}

export async function setIntegrationEnabledAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await setIntegrationEnabled(ctx, {
      kind: z.nativeEnum(IntegrationKind).parse(str(data, 'kind')),
      provider: str(data, 'provider'),
      enabled: str(data, 'enabled') === 'true',
    });
    return {
      message: 'Saved. Enabling does not make an integration healthy — run a check.',
      revalidate: ['/settings/integrations'],
    };
  });
}

export async function checkIntegrationAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const result = await checkIntegrationHealth(ctx, {
      kind: z.nativeEnum(IntegrationKind).parse(str(data, 'kind')),
      provider: str(data, 'provider'),
    });
    return { message: `Check ran: ${result.statusDetail ?? result.status}`, revalidate: ['/settings/integrations'] };
  });
}

export async function updateIntegrationSettingsAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const settings: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      if (key.startsWith('setting.') && typeof value === 'string' && value.trim()) {
        settings[key.slice('setting.'.length)] = value.trim();
      }
    }
    await updateIntegrationSettings(ctx, {
      kind: z.nativeEnum(IntegrationKind).parse(str(data, 'kind')),
      provider: str(data, 'provider'),
      settings,
    });
    return { message: 'Configuration saved. Run a check to verify it.', revalidate: ['/settings/integrations'] };
  });
}

export async function updateCommercialAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const start = optional(data, 'contractStart');
    const end = optional(data, 'contractEnd');
    await updateCommercialMetadata(ctx, {
      implementationFeeCents: numOrNull(data, 'implementationFee') !== null ? Math.round(numOrNull(data, 'implementationFee')! * 100) : null,
      monthlyFeeCents: numOrNull(data, 'monthlyFee') !== null ? Math.round(numOrNull(data, 'monthlyFee')! * 100) : null,
      licensedSeats: numOrNull(data, 'licensedSeats'),
      contractStart: start ? new Date(start) : null,
      contractEnd: end ? new Date(end) : null,
      note: optional(data, 'note') ?? null,
    });
    return { message: 'Commercial metadata saved. These figures are a hypothesis, not established pricing.', revalidate: ['/settings/commercial'] };
  });
}

// ---------------------------------------------------------------------------
// Reports, retention, operations, handoff
// ---------------------------------------------------------------------------

export async function recordMeasurementAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await recordBaselineObservation(ctx, {
      taskType: str(data, 'taskType'),
      measurementKind: z.enum(['baseline', 'observation']).parse(str(data, 'measurementKind')),
      periodStart: new Date(str(data, 'periodStart')),
      periodEnd: new Date(str(data, 'periodEnd')),
      sampleCount: Number(str(data, 'sampleCount')),
      meanMinutes: Number(str(data, 'meanMinutes')),
      methodology: str(data, 'methodology'),
    });
    return { message: 'Measurement recorded. Savings appear only where a comparable pair exists.', revalidate: ['/reports'] };
  });
}

export async function createRetentionPolicyAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await createPolicy(ctx, {
      name: str(data, 'name'),
      closedCaseRetentionDays: numOrNull(data, 'closedCaseRetentionDays'),
      webhookPayloadRetentionDays: numOrNull(data, 'webhookPayloadRetentionDays'),
      briefRetentionDays: numOrNull(data, 'briefRetentionDays'),
      auditMetadataRetentionDays: numOrNull(data, 'auditMetadataRetentionDays'),
    });
    return { message: 'Policy created. It does nothing until it is approved and enabled.', revalidate: ['/settings/retention'] };
  });
}

export async function approveRetentionPolicyAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await approvePolicy(ctx, { policyId: str(data, 'policyId'), enable: str(data, 'enable') === 'true' });
    return { message: 'Policy approval recorded.', revalidate: ['/settings/retention'] };
  });
}

export async function runRetentionAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const mode = z.enum(['preview', 'execute']).parse(str(data, 'mode'));
    await queueRetentionRun(ctx, { policyId: str(data, 'policyId'), mode });
    return {
      message:
        mode === 'preview'
          ? 'Dry run queued. It reports counts and what a legal hold protected, and deletes nothing.'
          : 'Execution queued. Legal holds are respected.',
      revalidate: ['/settings/retention'],
    };
  });
}

export async function setLegalHoldAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await setLegalHold(ctx, {
      applicantId,
      hold: str(data, 'hold') === 'true',
      reason: str(data, 'reason'),
    });
    return { message: 'Legal hold updated.', revalidate: [`/applicants/${applicantId}`, '/settings/retention'] };
  });
}

export async function retryJobAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await retryJob(ctx, { outboxId: str(data, 'outboxId') });
    return { message: 'Job re-queued. Handlers are idempotent, so a re-run is safe.', revalidate: ['/operations'] };
  });
}

export async function requeueReconciliationAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await requeueReconciliation(ctx, { messageId: str(data, 'messageId') });
    return { message: 'Reconciliation queued. It asks the provider; it never re-sends.', revalidate: ['/operations'] };
  });
}

export async function prepareHandoffAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await prepareHandoff(ctx, { applicantId, externalReferenceId: optional(data, 'externalReferenceId') });
    return { message: 'Handoff package prepared for review.', revalidate: [`/applicants/${applicantId}`] };
  });
}

export async function approveHandoffAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await approveHandoff(ctx, { handoffId: str(data, 'handoffId') });
    return {
      message: 'Approved. Exporting it is a manual handoff; it does not import into any official system.',
      revalidate: [`/applicants/${str(data, 'applicantId')}`],
    };
  });
}

export async function sendHandoffWebhookAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await queueWebhookDelivery(ctx, { handoffId: str(data, 'handoffId') });
    return {
      message: 'Queued. A 2xx means the transport accepted it, not that a business system imported it.',
      revalidate: [`/applicants/${str(data, 'applicantId')}`],
    };
  });
}

export async function confirmHandoffReceiptAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await confirmExternalReceipt(ctx, {
      handoffId: str(data, 'handoffId'),
      externalReferenceId: str(data, 'externalReferenceId'),
    });
    return { message: 'External confirmation recorded.', revalidate: [`/applicants/${str(data, 'applicantId')}`] };
  });
}

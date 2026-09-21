'use server';
import { z } from 'zod';
import {
  AppointmentMedium,
  AppointmentOutcome,
  CallOutcome,
  CaseClosureReason,
  CaseStatus,
  ConsentPurpose,
  ContactChannel,
  TaskCompletionOutcome,
  TaskType,
} from '@prisma/client';
import { prisma } from '@/server/db';
import { requireStaffContext } from '@/server/context';
import { runAction } from './helpers';
import type { ActionState } from '@/components/ui/form';
import {
  addContactPoint,
  addNote,
  editNote,
  reassignCase,
  resolveReviewFlag,
  setCaseStatus,
  updateCase,
} from '@/server/services/cases';
import { completeTask, createTask, snoozeTask, cancelTask } from '@/server/services/tasks';
import {
  approveDraft,
  cancelMessage,
  createDraft,
  editDraft,
  queueApprovedMessage,
} from '@/server/services/messaging';
import { logManualCall } from '@/server/services/voice';
import {
  proposeAppointment,
  rescheduleAppointment,
  cancelAppointment,
  recordAppointmentOutcome,
  appointmentConfirmUrl,
} from '@/server/services/appointments';
import { editBriefItem, requestRegeneration, reviewBrief } from '@/server/services/briefs';
import { recordVerbalConsent } from '@/server/services/consent';
import { issueResumeLinkForCase, startSessionForCase } from '@/server/services/intake';
import { mergeCases, markNotDuplicate } from '@/server/services/duplicates';
import { env } from '@/env';

/**
 * Server actions for the case file.
 *
 * Every one of these re-resolves the signed-in member from the session and
 * goes through the service layer, which goes through the policy layer. None of
 * them trusts an organization id, owner id or role from the form.
 */

function str(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalStr(data: FormData, key: string): string | undefined {
  const value = str(data, key);
  return value.length ? value : undefined;
}

function num(data: FormData, key: string): number | undefined {
  const value = str(data, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const casePaths = (applicantId: string) => ['/today', '/applicants', `/applicants/${applicantId}`, '/follow-ups'];

// ---------------------------------------------------------------------------
// Notes, record editing
// ---------------------------------------------------------------------------

export async function addNoteAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await addNote(ctx, {
      applicantId,
      body: str(data, 'body'),
      sensitive: data.get('sensitive') === 'on',
    });
    return { message: 'Note added.', revalidate: casePaths(applicantId) };
  });
}

export async function editNoteAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const revision = await editNote(ctx, { noteId: str(data, 'noteId'), body: str(data, 'body') });
    return {
      message: `Saved as revision ${revision.revision}. The previous text is kept for provenance.`,
      revalidate: casePaths(str(data, 'applicantId')),
    };
  });
}

export async function updateCaseAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await updateCase(ctx, {
      applicantId,
      displayName: optionalStr(data, 'displayName'),
      preferredName: str(data, 'preferredName') || null,
      generalLocation: str(data, 'generalLocation') || null,
      timezone: str(data, 'timezone') || null,
      timezoneConfirmed: data.get('timezoneConfirmed') === 'on',
      expectedVersion: num(data, 'expectedVersion'),
    });
    return { message: 'Case details saved.', revalidate: casePaths(applicantId) };
  });
}

export async function addContactPointAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await addContactPoint(ctx, {
      applicantId,
      channel: z.nativeEnum(ContactChannel).parse(str(data, 'channel')),
      value: str(data, 'value'),
      label: optionalStr(data, 'label'),
    });
    return { message: 'Contact point added.', revalidate: casePaths(applicantId) };
  });
}

export async function recordConsentAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await recordVerbalConsent(ctx, {
      applicantId,
      purpose: z.nativeEnum(ConsentPurpose).parse(str(data, 'purpose')),
      contactValue: str(data, 'contactValue'),
      granted: str(data, 'granted') === 'yes',
      note: str(data, 'note'),
    });
    return {
      message: 'Permission recorded with today’s disclosure version.',
      revalidate: casePaths(applicantId),
    };
  });
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function setStatusAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const status = z.nativeEnum(CaseStatus).parse(str(data, 'status'));
    const closureReason = optionalStr(data, 'closureReason');
    await prisma.$transaction((tx) =>
      setCaseStatus(tx, ctx, {
        applicantId,
        status,
        reason: optionalStr(data, 'reason'),
        closureReason: closureReason ? z.nativeEnum(CaseClosureReason).parse(closureReason) : undefined,
        expectedVersion: num(data, 'expectedVersion'),
      }),
    );
    return { message: `Workflow status set to ${status.replace(/_/g, ' ').toLowerCase()}.`, revalidate: casePaths(applicantId) };
  });
}

export async function reassignAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await reassignCase(ctx, {
      applicantId,
      toMemberId: str(data, 'toMemberId'),
      reason: str(data, 'reason'),
    });
    return { message: 'Owner changed. Open work moved with the case.', revalidate: casePaths(applicantId) };
  });
}

export async function resolveFlagAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await resolveReviewFlag(ctx, {
      flagId: str(data, 'flagId'),
      resolution: str(data, 'resolution') === 'DISMISSED' ? 'DISMISSED' : 'RESOLVED',
      reason: str(data, 'reason'),
    });
    return { message: 'Review resolved.', revalidate: casePaths(applicantId) };
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTaskAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await prisma.$transaction((tx) =>
      createTask(tx, ctx, {
        applicantId,
        type: z.nativeEnum(TaskType).parse(str(data, 'type')),
        title: str(data, 'title'),
        reason: str(data, 'reason'),
        dueAt: new Date(str(data, 'dueAt')),
      }),
    );
    return { message: 'Follow-up created.', revalidate: casePaths(applicantId) };
  });
}

export async function completeTaskAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await completeTask(ctx, {
      taskId: str(data, 'taskId'),
      outcome: z.nativeEnum(TaskCompletionOutcome).parse(str(data, 'outcome')),
      note: optionalStr(data, 'note'),
      expectedVersion: num(data, 'expectedVersion'),
    });
    return {
      message: 'Follow-up completed with an outcome. The next step was set.',
      revalidate: casePaths(applicantId),
    };
  });
}

export async function snoozeTaskAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await snoozeTask(ctx, {
      taskId: str(data, 'taskId'),
      newDueAt: new Date(str(data, 'newDueAt')),
      reason: str(data, 'reason'),
      expectedVersion: num(data, 'expectedVersion'),
    });
    return {
      message: 'Moved. The originally promised date is kept for reporting.',
      revalidate: casePaths(applicantId),
    };
  });
}

export async function cancelTaskAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await cancelTask(ctx, {
      taskId: str(data, 'taskId'),
      reason: str(data, 'reason'),
      expectedVersion: num(data, 'expectedVersion'),
    });
    return { message: 'Follow-up canceled. A next step was established.', revalidate: casePaths(applicantId) };
  });
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export async function createDraftAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await createDraft(ctx, {
      applicantId,
      toValue: str(data, 'toValue'),
      body: str(data, 'body'),
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: data.get('aiGenerated') === 'on',
      aiBriefId: optionalStr(data, 'aiBriefId') ?? null,
    });
    return {
      message: 'Draft saved. Drafting is not sending — approve it when you are ready.',
      revalidate: casePaths(applicantId),
    };
  });
}

export async function editDraftAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await editDraft(ctx, {
      messageId: str(data, 'messageId'),
      body: str(data, 'body'),
      expectedVersion: num(data, 'expectedVersion'),
    });
    return {
      message: 'Edited. Any earlier approval was invalidated — approve the new text before sending.',
      revalidate: casePaths(applicantId),
    };
  });
}

export async function approveDraftAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await approveDraft(ctx, {
      messageId: str(data, 'messageId'),
      expectedVersion: num(data, 'expectedVersion'),
    });
    return { message: 'Approved. It still has to be queued to go out.', revalidate: casePaths(applicantId) };
  });
}

export async function sendMessageAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const sendAtRaw = optionalStr(data, 'sendAt');
    const message = await queueApprovedMessage(ctx, {
      messageId: str(data, 'messageId'),
      sendAt: sendAtRaw ? new Date(sendAtRaw) : undefined,
    });
    return {
      message:
        message.state === 'SCHEDULED'
          ? 'Scheduled. The permission, opt-out and contact-window checks run again immediately before it goes out.'
          : 'Queued for the worker. It is not sent until the provider accepts it.',
      revalidate: casePaths(applicantId),
    };
  });
}

export async function cancelMessageAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await cancelMessage(ctx, { messageId: str(data, 'messageId'), reason: str(data, 'reason') });
    return { message: 'Canceled before dispatch.', revalidate: casePaths(applicantId) };
  });
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function logCallAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const outcome = z.nativeEnum(CallOutcome).parse(str(data, 'outcome'));
    await logManualCall(ctx, {
      applicantId,
      toValue: str(data, 'toValue'),
      outcome,
      durationSeconds: num(data, 'durationSeconds') ?? null,
      note: optionalStr(data, 'note'),
    });
    return {
      message:
        outcome === CallOutcome.CONNECTED
          ? 'Call logged as a connected conversation.'
          : 'Call logged. It is not counted as human contact because nobody answered.',
      revalidate: casePaths(applicantId),
    };
  });
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

function parseLocal(value: string) {
  // <input type="datetime-local"> gives "YYYY-MM-DDTHH:mm" with no offset,
  // which is exactly the wall-clock time the recruiter typed.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Pick a date and time.');
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

export async function scheduleAppointmentAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const result = await proposeAppointment(ctx, {
      applicantId,
      recruiterMemberId: optionalStr(data, 'recruiterMemberId'),
      local: parseLocal(str(data, 'local')),
      timezone: str(data, 'timezone'),
      durationMinutes: num(data, 'durationMinutes') ?? 45,
      medium: z.nativeEnum(AppointmentMedium).parse(str(data, 'medium')),
      locationDetail: optionalStr(data, 'locationDetail'),
      purpose: str(data, 'purpose'),
      acceptAmbiguous: data.get('acceptAmbiguous') === 'on',
    });
    return {
      message: `Scheduled. Applicant confirmation link: ${appointmentConfirmUrl(result.confirmToken)}${result.note ? ` (${result.note})` : ''}`,
      revalidate: [...casePaths(applicantId), '/calendar'],
    };
  });
}

export async function rescheduleAppointmentAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const result = await rescheduleAppointment(ctx, {
      appointmentId: str(data, 'appointmentId'),
      applicantId,
      local: parseLocal(str(data, 'local')),
      timezone: str(data, 'timezone'),
      durationMinutes: num(data, 'durationMinutes') ?? 45,
      medium: z.nativeEnum(AppointmentMedium).parse(str(data, 'medium')),
      locationDetail: optionalStr(data, 'locationDetail'),
      purpose: str(data, 'purpose'),
      acceptAmbiguous: data.get('acceptAmbiguous') === 'on',
      reason: str(data, 'reason'),
    });
    return {
      message: `Rescheduled. Reminders for the old slot were canceled. New confirmation link: ${appointmentConfirmUrl(result.confirmToken)}`,
      revalidate: [...casePaths(applicantId), '/calendar'],
    };
  });
}

export async function cancelAppointmentAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await cancelAppointment(ctx, {
      appointmentId: str(data, 'appointmentId'),
      reason: str(data, 'reason'),
      byApplicant: data.get('byApplicant') === 'on',
    });
    return { message: 'Appointment canceled and reminders stopped.', revalidate: [...casePaths(applicantId), '/calendar'] };
  });
}

export async function recordAppointmentOutcomeAction(
  _state: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await recordAppointmentOutcome(ctx, {
      appointmentId: str(data, 'appointmentId'),
      outcome: z.nativeEnum(AppointmentOutcome).parse(str(data, 'outcome')),
      note: optionalStr(data, 'note'),
    });
    return {
      message: 'Outcome recorded. An appointment is only complete once someone says what happened.',
      revalidate: [...casePaths(applicantId), '/calendar'],
    };
  });
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export async function reviewBriefAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const action = str(data, 'action') === 'reject' ? 'reject' : 'approve';
    await reviewBrief(ctx, { briefId: str(data, 'briefId'), action, note: optionalStr(data, 'note') });
    return { message: action === 'approve' ? 'Brief approved.' : 'Brief rejected.', revalidate: casePaths(applicantId) };
  });
}

export async function editBriefItemAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await editBriefItem(ctx, { briefItemId: str(data, 'briefItemId'), text: str(data, 'text') });
    return {
      message: 'Correction saved. It is kept alongside the generated text and survives regeneration.',
      revalidate: casePaths(applicantId),
    };
  });
}

export async function regenerateBriefAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    await requestRegeneration(ctx, { applicantId });
    return {
      message: 'Regeneration queued. Your corrections will be carried forward.',
      revalidate: casePaths(applicantId),
    };
  });
}

// ---------------------------------------------------------------------------
// Intake links
// ---------------------------------------------------------------------------

export async function issueIntakeLinkAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const applicantId = str(data, 'applicantId');
    const result = await prisma.$transaction(async (tx) => {
      const existing = await issueResumeLinkForCase(tx, ctx.member.organizationId, applicantId);
      if (existing) return existing;
      const started = await startSessionForCase(tx, ctx.member.organizationId, applicantId);
      return { token: started.token, sessionId: started.sessionId };
    });
    return {
      message: `Secure intake link (share it with the applicant, it expires in 72 hours): ${env.PUBLIC_APP_URL}/resume?t=${result.token}`,
      revalidate: casePaths(applicantId),
    };
  });
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

export async function mergeCasesAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    const surviving = str(data, 'survivingApplicantId');
    await mergeCases(ctx, {
      survivingApplicantId: surviving,
      mergedApplicantId: str(data, 'mergedApplicantId'),
      reason: str(data, 'reason'),
    });
    return {
      message:
        'Merged. Provenance, appointments, tasks and history were preserved, and contact permissions were reduced to the most restrictive of the two pending review.',
      revalidate: casePaths(surviving),
    };
  });
}

export async function notDuplicateAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireStaffContext();
    await markNotDuplicate(ctx, { candidateId: str(data, 'candidateId'), reason: str(data, 'reason') });
    return { message: 'Marked as not a duplicate.', revalidate: ['/today', '/applicants'] };
  });
}

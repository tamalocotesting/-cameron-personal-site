import 'server-only';
import {
  AppointmentMedium,
  AppointmentOutcome,
  AppointmentState,
  CaseStatus,
  ConsentPurpose,
  MetricEventKind,
} from '@prisma/client';
import { z } from 'zod';
import { prisma, type DbOrTx } from '@/server/db';
import { now } from '@/server/clock';
import { generateToken, hashToken } from '@/lib/crypto';
import {
  ACTIVE_APPOINTMENT_STATES,
  appointmentTransitions,
  assertTransition,
} from '@/server/domain/state-machines';
import {
  formatInZone,
  isValidTimeZone,
  localMinuteOfDay,
  localWeekday,
  resolveZonedTime,
  zoneAbbreviation,
  type LocalDateTime,
} from '@/lib/time';
import { ConflictError, NotFoundError, ValidationError } from '@/server/authz/errors';
import { requireCase, requireStaff, systemContext, type ActorContext } from '@/server/authz/policy';
import { auditOperational } from '@/server/audit';
import { recordMetric } from '@/server/metrics';
import { enqueue, cancelPending } from '@/server/outbox';
import { JOB } from '@/server/domain/jobs';
import { advanceStatus } from './cases';
import { ensureNextStep } from './tasks';
import { env } from '@/env';

/**
 * Internal scheduling.
 *
 * This is an INTERNAL calendar plus an .ics download. It is NOT Google or
 * Microsoft calendar synchronization, and nothing in the product claims it is.
 *
 * Three correctness details:
 *   * A time is a UTC instant plus the IANA zone it was agreed in. A wall
 *     clock time that does not exist (spring forward) or happens twice (fall
 *     back) is reported, not guessed.
 *   * Double-booking is prevented in the DATABASE by an exclusion constraint
 *     over the recruiter and the time range, so two concurrent requests cannot
 *     both win.
 *   * Rescheduling keeps lineage and cancels the old reminders; a reminder
 *     re-checks the appointment's current state when it actually runs.
 */

export const OVERLAP_CONSTRAINT = 'appointment_no_overlap';

export const proposeInput = z.object({
  applicantId: z.string().min(1),
  recruiterMemberId: z.string().min(1).optional(),
  /** Local wall-clock time in `timezone`. */
  local: z.object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  timezone: z.string().min(1),
  durationMinutes: z.number().int().min(10).max(240).default(45),
  medium: z.nativeEnum(AppointmentMedium).default(AppointmentMedium.IN_PERSON),
  locationDetail: z.string().max(300).optional(),
  purpose: z.string().min(3).max(200),
  /** Accept the earlier instant when the local time happens twice. */
  acceptAmbiguous: z.boolean().default(false),
});

export type ResolvedSlot = {
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  note: string | null;
};

export function resolveSlot(
  local: LocalDateTime,
  timezone: string,
  durationMinutes: number,
  acceptAmbiguous: boolean,
): ResolvedSlot {
  if (!isValidTimeZone(timezone)) {
    throw new ValidationError('That is not a recognised timezone.', { timezone: ['Unknown IANA timezone.'] });
  }
  const resolution = resolveZonedTime(local, timezone);

  if (resolution.kind === 'invalid') {
    throw new ValidationError(
      `That local time does not exist in ${timezone} — the clocks move forward. ` +
        `The nearest valid time is ${formatInZone(resolution.suggestion, timezone)}.`,
      { local: ['Pick a different time; that hour is skipped by daylight saving.'] },
    );
  }
  if (resolution.kind === 'ambiguous' && !acceptAmbiguous) {
    throw new ValidationError(
      `That local time happens twice in ${timezone} — the clocks move back. ` +
        `Confirm which one you mean: ${formatInZone(resolution.alternatives[0], timezone, { timeStyle: 'short', dateStyle: 'medium' })} ` +
        `(${zoneAbbreviation(resolution.alternatives[0], timezone)}) or ` +
        `${formatInZone(resolution.alternatives[1], timezone, { timeStyle: 'short', dateStyle: 'medium' })} ` +
        `(${zoneAbbreviation(resolution.alternatives[1], timezone)}).`,
      { local: ['Ambiguous local time; confirm which occurrence.'] },
    );
  }

  const startsAt = resolution.instant;
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
    timezone,
    note:
      resolution.kind === 'ambiguous'
        ? `Ambiguous local time; the earlier occurrence (${zoneAbbreviation(startsAt, timezone)}) was used.`
        : null,
  };
}

async function assertWithinAvailability(
  db: DbOrTx,
  organizationId: string,
  memberId: string,
  startsAt: Date,
) {
  const windows = await db.availabilityWindow.findMany({ where: { organizationId, memberId } });
  if (!windows.length) return; // No declared availability: nothing to enforce.
  const matches = windows.some((w) => {
    const weekday = localWeekday(startsAt, w.timezone);
    const minute = localMinuteOfDay(startsAt, w.timezone);
    return weekday === w.weekday && minute >= w.startMinute && minute < w.endMinute;
  });
  if (!matches) {
    throw new ValidationError('That is outside the recruiter’s declared availability.', {
      local: ['Pick a time inside an availability window, or add one in Team.'],
    });
  }
}

function isOverlapViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(OVERLAP_CONSTRAINT) || message.includes('23P01');
}

export async function proposeAppointment(ctx: ActorContext, input: z.infer<typeof proposeInput>) {
  const staff = requireStaff(ctx);
  const { applicant } = await requireCase(ctx, input.applicantId, 'act');
  const organizationId = staff.member.organizationId;
  const recruiterMemberId = input.recruiterMemberId ?? applicant.ownerMemberId ?? staff.member.id;

  const slot = resolveSlot(input.local, input.timezone, input.durationMinutes, input.acceptAmbiguous);
  if (slot.startsAt.getTime() <= now().getTime()) {
    throw new ValidationError('Pick a time in the future.', { local: ['That time has passed.'] });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const recruiter = await tx.member.findFirst({
        where: { organizationId, id: recruiterMemberId, active: true },
        select: { id: true },
      });
      if (!recruiter) throw new ValidationError('That recruiter cannot take appointments.');
      await assertWithinAvailability(tx, organizationId, recruiterMemberId, slot.startsAt);

      const token = generateToken(32);
      const appointment = await tx.appointment.create({
        data: {
          organizationId,
          applicantId: input.applicantId,
          recruiterMemberId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timezone: slot.timezone,
          medium: input.medium,
          locationDetail: input.locationDetail ?? null,
          purpose: input.purpose,
          state: AppointmentState.SCHEDULED,
          confirmTokenHash: hashToken(token),
          confirmExpiresAt: slot.startsAt,
          // The application clock owns this, not the database clock: reports
          // filter on it, and a frozen demo or test clock must agree.
          createdAt: now(),
        },
      });

      await scheduleReminders(tx, organizationId, appointment.id, slot.startsAt);
      await advanceStatus(tx, ctx, input.applicantId, CaseStatus.APPOINTMENT_SCHEDULED);
      await recordMetric(tx, {
        organizationId,
        kind: MetricEventKind.APPOINTMENT_SCHEDULED,
        applicantId: input.applicantId,
        memberId: recruiterMemberId,
      });
      await auditOperational(tx, ctx, {
        action: 'appointment.scheduled',
        subjectType: 'appointment',
        subjectId: appointment.id,
        applicantId: input.applicantId,
        metadata: {
          startsAt: slot.startsAt.toISOString(),
          timezone: slot.timezone,
          durationMinutes: input.durationMinutes,
          ambiguityNote: slot.note,
        },
      });
      await ensureNextStep(tx, ctx, input.applicantId);
      return { appointment, confirmToken: token, note: slot.note };
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new ConflictError(
        'That recruiter already has an appointment overlapping this time. Pick another slot.',
      );
    }
    throw error;
  }
}

async function scheduleReminders(db: DbOrTx, organizationId: string, appointmentId: string, startsAt: Date) {
  const offsets = [24 * 60, 2 * 60];
  for (const minutesBefore of offsets) {
    const sendAt = new Date(startsAt.getTime() - minutesBefore * 60_000);
    if (sendAt.getTime() <= now().getTime()) continue;
    const reminder = await db.appointmentReminder.create({
      data: { organizationId, appointmentId, sendAt, status: 'pending' },
    });
    await enqueue(
      db,
      JOB.appointmentReminder,
      { organizationId, appointmentId, reminderId: reminder.id },
      { idempotencyKey: `reminder:${reminder.id}`, availableAt: sendAt },
    );
  }
}

async function cancelReminders(db: DbOrTx, organizationId: string, appointmentId: string, reason: string) {
  const pending = await db.appointmentReminder.findMany({
    where: { organizationId, appointmentId, status: 'pending' },
  });
  for (const reminder of pending) {
    await cancelPending(db, `reminder:${reminder.id}`, reason);
    await db.appointmentReminder.update({
      where: { id: reminder.id },
      data: { status: 'canceled', canceledAt: now(), skipReason: reason },
    });
  }
  return pending.length;
}

export async function rescheduleAppointment(
  ctx: ActorContext,
  input: z.infer<typeof proposeInput> & { appointmentId: string; reason: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: { id: input.appointmentId, organizationId },
      });
      if (!existing) throw new NotFoundError('Appointment');
      await requireCase(ctx, existing.applicantId, 'act');
      if (!ACTIVE_APPOINTMENT_STATES.includes(existing.state)) {
        throw new ConflictError(`An appointment in state ${existing.state} cannot be rescheduled.`);
      }

      const slot = resolveSlot(input.local, input.timezone, input.durationMinutes, input.acceptAmbiguous);
      const recruiterMemberId = input.recruiterMemberId ?? existing.recruiterMemberId;
      await assertWithinAvailability(tx, organizationId, recruiterMemberId, slot.startsAt);

      // Stale reminders for the old slot must not fire.
      const canceled = await cancelReminders(tx, organizationId, existing.id, 'appointment rescheduled');

      // The superseded slot is CANCELED, never counted as attended.
      await tx.appointment.update({
        where: { id: existing.id },
        data: {
          state: AppointmentState.CANCELED,
          canceledAt: now(),
          cancelReason: `rescheduled: ${input.reason}`,
          outcome: AppointmentOutcome.RESCHEDULED,
          version: { increment: 1 },
        },
      });

      const token = generateToken(32);
      const replacement = await tx.appointment.create({
        data: {
          organizationId,
          applicantId: existing.applicantId,
          recruiterMemberId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timezone: slot.timezone,
          medium: input.medium,
          locationDetail: input.locationDetail ?? existing.locationDetail,
          purpose: input.purpose,
          state: AppointmentState.SCHEDULED,
          supersedesAppointmentId: existing.id,
          confirmTokenHash: hashToken(token),
          confirmExpiresAt: slot.startsAt,
          createdAt: now(),
        },
      });
      await tx.appointment.update({
        where: { id: existing.id },
        data: { supersededByAppointmentId: replacement.id },
      });

      await scheduleReminders(tx, organizationId, replacement.id, slot.startsAt);
      await auditOperational(tx, ctx, {
        action: 'appointment.rescheduled',
        subjectType: 'appointment',
        subjectId: replacement.id,
        applicantId: existing.applicantId,
        metadata: {
          from: existing.startsAt.toISOString(),
          to: slot.startsAt.toISOString(),
          remindersCanceled: canceled,
          reason: input.reason,
        },
      });
      await ensureNextStep(tx, ctx, existing.applicantId);
      return { appointment: replacement, confirmToken: token, note: slot.note };
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new ConflictError('That recruiter already has an overlapping appointment. Pick another slot.');
    }
    throw error;
  }
}

export async function cancelAppointment(
  ctx: ActorContext,
  input: { appointmentId: string; reason: string; byApplicant?: boolean },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: input.appointmentId, organizationId },
    });
    if (!appointment) throw new NotFoundError('Appointment');
    await requireCase(ctx, appointment.applicantId, 'act');
    assertTransition(appointmentTransitions, appointment.state, AppointmentState.CANCELED, 'Appointment');

    const canceled = await cancelReminders(tx, organizationId, appointment.id, 'appointment canceled');
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        state: AppointmentState.CANCELED,
        canceledAt: now(),
        cancelReason: input.reason,
        outcome: input.byApplicant
          ? AppointmentOutcome.CANCELED_BY_APPLICANT
          : AppointmentOutcome.CANCELED_BY_RECRUITER,
        outcomeRecordedByMemberId: staff.member.id,
        outcomeRecordedAt: now(),
        version: { increment: 1 },
      },
    });
    await recordMetric(tx, {
      organizationId,
      kind: MetricEventKind.APPOINTMENT_CANCELED,
      applicantId: appointment.applicantId,
      memberId: appointment.recruiterMemberId,
      detail: input.byApplicant ? 'by_applicant' : 'by_recruiter',
    });
    await auditOperational(tx, ctx, {
      action: 'appointment.canceled',
      subjectType: 'appointment',
      subjectId: appointment.id,
      applicantId: appointment.applicantId,
      metadata: { reason: input.reason, remindersCanceled: canceled },
    });
    await ensureNextStep(tx, ctx, appointment.applicantId);
    return updated;
  });
}

/**
 * Completion REQUIRES a recorded outcome. There is no path that marks an
 * appointment completed because its end time passed.
 */
export async function recordAppointmentOutcome(
  ctx: ActorContext,
  input: { appointmentId: string; outcome: AppointmentOutcome; note?: string },
) {
  const staff = requireStaff(ctx);
  const organizationId = staff.member.organizationId;

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: input.appointmentId, organizationId },
    });
    if (!appointment) throw new NotFoundError('Appointment');
    await requireCase(ctx, appointment.applicantId, 'act');

    const targetState =
      input.outcome === AppointmentOutcome.ATTENDED
        ? AppointmentState.COMPLETED
        : input.outcome === AppointmentOutcome.NO_SHOW
          ? AppointmentState.NO_SHOW
          : AppointmentState.CANCELED;
    assertTransition(appointmentTransitions, appointment.state, targetState, 'Appointment');

    await cancelReminders(tx, organizationId, appointment.id, `outcome recorded: ${input.outcome}`);

    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        state: targetState,
        outcome: input.outcome,
        outcomeNote: input.note ?? null,
        outcomeRecordedByMemberId: staff.member.id,
        outcomeRecordedAt: now(),
        version: { increment: 1 },
      },
    });

    await recordMetric(tx, {
      organizationId,
      kind:
        targetState === AppointmentState.COMPLETED
          ? MetricEventKind.APPOINTMENT_COMPLETED
          : targetState === AppointmentState.NO_SHOW
            ? MetricEventKind.APPOINTMENT_NO_SHOW
            : MetricEventKind.APPOINTMENT_CANCELED,
      applicantId: appointment.applicantId,
      memberId: appointment.recruiterMemberId,
    });
    await auditOperational(tx, ctx, {
      action: 'appointment.outcome_recorded',
      subjectType: 'appointment',
      subjectId: appointment.id,
      applicantId: appointment.applicantId,
      metadata: { outcome: input.outcome },
    });
    await ensureNextStep(tx, ctx, appointment.applicantId);
    return updated;
  });
}

/**
 * Applicant-side confirmation through a scoped, hashed, expiring credential.
 * It can confirm or decline, and nothing else — no access to notes, briefs,
 * tasks or other appointments.
 */
export async function confirmAppointmentByToken(
  token: string,
  action: 'confirm' | 'decline',
): Promise<{ status: 'ok'; startsAt: Date; timezone: string } | { status: 'invalid' | 'expired' | 'closed' }> {
  const appointment = await prisma.appointment.findUnique({
    where: { confirmTokenHash: hashToken(token) },
  });
  if (!appointment) return { status: 'invalid' };
  if (!appointment.confirmExpiresAt || appointment.confirmExpiresAt.getTime() <= now().getTime()) {
    return { status: 'expired' };
  }
  if (!ACTIVE_APPOINTMENT_STATES.includes(appointment.state)) return { status: 'closed' };

  const ctx = systemContext(appointment.organizationId, 'applicant-confirmation');
  await prisma.$transaction(async (tx) => {
    if (action === 'confirm') {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { state: AppointmentState.CONFIRMED, confirmedAt: now(), version: { increment: 1 } },
      });
    } else {
      await cancelReminders(tx, appointment.organizationId, appointment.id, 'applicant declined');
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          state: AppointmentState.CANCELED,
          canceledAt: now(),
          cancelReason: 'The applicant declined this time.',
          outcome: AppointmentOutcome.CANCELED_BY_APPLICANT,
          version: { increment: 1 },
        },
      });
      await ensureNextStep(tx, ctx, appointment.applicantId);
    }
    await auditOperational(tx, ctx, {
      action: action === 'confirm' ? 'appointment.confirmed_by_applicant' : 'appointment.declined_by_applicant',
      subjectType: 'appointment',
      subjectId: appointment.id,
      applicantId: appointment.applicantId,
    });
  });

  return { status: 'ok', startsAt: appointment.startsAt, timezone: appointment.timezone };
}

/**
 * Reminder execution. Re-reads current state, because the appointment may have
 * been moved or canceled after the job was scheduled.
 */
export async function executeReminder(input: {
  organizationId: string;
  appointmentId: string;
  reminderId: string;
}): Promise<{ status: 'dispatched' | 'skipped'; detail: string }> {
  const reminder = await prisma.appointmentReminder.findFirst({
    where: { id: input.reminderId, organizationId: input.organizationId, appointmentId: input.appointmentId },
  });
  if (!reminder) return { status: 'skipped', detail: 'Reminder no longer exists.' };
  if (reminder.status !== 'pending') return { status: 'skipped', detail: `Reminder is ${reminder.status}.` };

  const appointment = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, organizationId: input.organizationId },
    include: { applicant: { select: { id: true, displayName: true, preferredName: true } } },
  });
  if (!appointment || !ACTIVE_APPOINTMENT_STATES.includes(appointment.state)) {
    await prisma.appointmentReminder.update({
      where: { id: reminder.id },
      data: { status: 'skipped', skipReason: `appointment state is ${appointment?.state ?? 'missing'}` },
    });
    return { status: 'skipped', detail: 'The appointment is no longer active.' };
  }

  const { sendApprovedTemplate } = await import('./messaging');
  const contact = await prisma.contactPoint.findFirst({
    where: { organizationId: input.organizationId, applicantId: appointment.applicantId, channel: 'SMS' },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  if (!contact) {
    await prisma.appointmentReminder.update({
      where: { id: reminder.id },
      data: { status: 'skipped', skipReason: 'no SMS contact point' },
    });
    return { status: 'skipped', detail: 'No SMS contact point.' };
  }

  const result = await prisma.$transaction((tx) =>
    sendApprovedTemplate(tx, input.organizationId, {
      applicantId: appointment.applicantId,
      templateKey: 'appointment_reminder',
      purpose: ConsentPurpose.APPOINTMENT_REMINDER_SMS,
      toValue: contact.value,
      values: {
        when: `${formatInZone(appointment.startsAt, appointment.timezone)} ${zoneAbbreviation(appointment.startsAt, appointment.timezone)}`,
      },
      idempotencyKey: `reminder-send:${reminder.id}`,
      ignoreQuietHours: false,
    }),
  );

  if (result.status === 'blocked') {
    await prisma.appointmentReminder.update({
      where: { id: reminder.id },
      data: { status: 'skipped', skipReason: result.reason },
    });
    return { status: 'skipped', detail: result.reason };
  }

  await prisma.appointmentReminder.update({
    where: { id: reminder.id },
    data: { status: 'dispatched', dispatchedAt: now() },
  });
  return { status: 'dispatched', detail: `Queued message ${result.messageId}.` };
}

// ---------------------------------------------------------------------------
// Calendar export
// ---------------------------------------------------------------------------

function icsEscape(text: string) {
  return text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

function icsStamp(date: Date) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Minimal .ics. It deliberately discloses as little as possible: no applicant
 * phone number, no notes, no brief. A calendar file often ends up in a shared
 * account.
 */
export function buildIcs(appointment: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  medium: AppointmentMedium;
  locationDetail: string | null;
  reference: string;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RecruiterOS//Internal Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@recruiteros`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(appointment.startsAt)}`,
    `DTEND:${icsStamp(appointment.endsAt)}`,
    `SUMMARY:${icsEscape(`Recruiter appointment — ${appointment.reference}`)}`,
    `DESCRIPTION:${icsEscape(appointment.purpose)}`,
    ...(appointment.locationDetail
      ? [`LOCATION:${icsEscape(appointment.locationDetail)}`]
      : [`LOCATION:${icsEscape(appointment.medium)}`]),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function appointmentConfirmUrl(token: string) {
  return `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/appointment/${token}`;
}

export async function listAppointments(
  organizationId: string,
  filter: { from: Date; to: Date; recruiterMemberIds?: string[] },
) {
  return prisma.appointment.findMany({
    where: {
      organizationId,
      startsAt: { gte: filter.from, lt: filter.to },
      ...(filter.recruiterMemberIds ? { recruiterMemberId: { in: filter.recruiterMemberIds } } : {}),
    },
    orderBy: { startsAt: 'asc' },
    include: {
      applicant: { select: { id: true, displayName: true, reference: true } },
      recruiter: { select: { displayName: true } },
    },
  });
}

export async function listAppointmentsForCase(organizationId: string, applicantId: string) {
  return prisma.appointment.findMany({
    where: { organizationId, applicantId },
    orderBy: { startsAt: 'desc' },
    include: { recruiter: { select: { displayName: true } }, reminders: true },
  });
}

import { beforeEach, describe, expect, it } from 'vitest';
import { AppointmentOutcome, ConsentPurpose } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock } from '@/server/clock';
import {
  buildIcs,
  cancelAppointment,
  confirmAppointmentByToken,
  executeReminder,
  proposeAppointment,
  recordAppointmentOutcome,
  rescheduleAppointment,
} from '@/server/services/appointments';
import { createCase } from '@/server/services/cases';
import { createWorkspace, grantConsent, type Workspace } from '../setup/factories';

/**
 * Acceptance 10.
 *
 * Concurrency, daylight saving, reminder lifecycle and the rule that an
 * appointment is only complete once someone says what happened.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z'); // Monday 10:00 CDT
const PHONE = '+15125550701';

let workspace: Workspace;
let applicantId: string;

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
  const created = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: 'Jaylen Foster',
      timezone: 'America/Chicago',
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: PHONE, isPrimary: true }],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  applicantId = created.applicant.id;
  await prisma.applicant.update({ where: { id: applicantId }, data: { timezoneConfirmed: true } });
  await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.RECRUITER_SMS, PHONE);
  await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.APPOINTMENT_REMINDER_SMS, PHONE);
  // Availability windows are declared on every seeded member; give this one
  // office hours in the test too.
  for (const weekday of [1, 2, 3, 4, 5]) {
    await prisma.availabilityWindow.create({
      data: {
        organizationId: workspace.organization.id,
        memberId: workspace.recruiter.member.id,
        weekday,
        startMinute: 8 * 60,
        endMinute: 18 * 60,
        timezone: 'America/Chicago',
      },
    });
  }
});

const slot = (hour: number, day = 16) => ({ year: 2026, month: 6, day, hour, minute: 0 });

describe('10. scheduling correctness', () => {
  it('stores an instant plus the zone it was agreed in', async () => {
    const result = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(10),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });
    expect(result.appointment.startsAt.toISOString()).toBe('2026-06-16T15:00:00.000Z');
    expect(result.appointment.timezone).toBe('America/Chicago');
    expect(result.confirmToken).toBeTruthy();
  });

  it('refuses two concurrent bookings for the same recruiter and slot', async () => {
    const attempt = () =>
      proposeAppointment(workspace.recruiterCtx, {
        applicantId,
        local: slot(11),
        timezone: 'America/Chicago',
        durationMinutes: 60,
        medium: 'IN_PERSON',
        purpose: 'Initial conversation',
        acceptAmbiguous: false,
      });

    // Both requests are issued together; the database exclusion constraint
    // decides, so exactly one can win.
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/overlapping|already has/i);

    const active = await prisma.appointment.count({
      where: { organizationId: workspace.organization.id, state: { in: ['PROPOSED', 'SCHEDULED', 'CONFIRMED'] } },
    });
    expect(active).toBe(1);
  });

  it('refuses an overlapping slot even when it only partially overlaps', async () => {
    await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(13),
      timezone: 'America/Chicago',
      durationMinutes: 60,
      medium: 'IN_PERSON',
      purpose: 'First',
      acceptAmbiguous: false,
    });
    await expect(
      proposeAppointment(workspace.recruiterCtx, {
        applicantId,
        local: { ...slot(13), minute: 30 },
        timezone: 'America/Chicago',
        durationMinutes: 60,
        medium: 'IN_PERSON',
        purpose: 'Second',
        acceptAmbiguous: false,
      }),
    ).rejects.toThrow(/overlapping/i);
  });

  it('allows the same slot for a different recruiter', async () => {
    await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(14),
      timezone: 'America/Chicago',
      durationMinutes: 60,
      medium: 'IN_PERSON',
      purpose: 'First',
      acceptAmbiguous: false,
    });
    for (const weekday of [1, 2, 3, 4, 5]) {
      await prisma.availabilityWindow.create({
        data: {
          organizationId: workspace.organization.id,
          memberId: workspace.manager.member.id,
          weekday,
          startMinute: 8 * 60,
          endMinute: 18 * 60,
          timezone: 'America/Chicago',
        },
      });
    }
    const second = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      recruiterMemberId: workspace.manager.member.id,
      local: slot(14),
      timezone: 'America/Chicago',
      durationMinutes: 60,
      medium: 'PHONE',
      purpose: 'Second recruiter, same time',
      acceptAmbiguous: false,
    });
    expect(second.appointment.id).toBeTruthy();
  });

  it('refuses a local time that daylight saving skips', async () => {
    await expect(
      proposeAppointment(workspace.recruiterCtx, {
        applicantId,
        // 02:30 on 8 March 2026 does not exist in America/Chicago.
        local: { year: 2027, month: 3, day: 14, hour: 2, minute: 30 },
        timezone: 'America/Chicago',
        durationMinutes: 45,
        medium: 'PHONE',
        purpose: 'DST gap',
        acceptAmbiguous: false,
      }),
    ).rejects.toThrow(/does not exist|daylight/i);
  });

  it('asks which occurrence is meant when a local time happens twice', async () => {
    const ambiguous = {
      applicantId,
      local: { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'PHONE' as const,
      purpose: 'DST overlap',
    };
    await expect(
      proposeAppointment(workspace.recruiterCtx, { ...ambiguous, acceptAmbiguous: false }),
    ).rejects.toThrow(/happens twice/i);

    // Availability does not cover 01:30, so confirm the resolution separately.
    await prisma.availabilityWindow.deleteMany({
      where: { organizationId: workspace.organization.id, memberId: workspace.recruiter.member.id },
    });
    const accepted = await proposeAppointment(workspace.recruiterCtx, {
      ...ambiguous,
      acceptAmbiguous: true,
    });
    expect(accepted.note).toMatch(/Ambiguous local time/);
    // The earlier occurrence (CDT, 06:30Z) was used.
    expect(accepted.appointment.startsAt.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('refuses a time outside the recruiter’s declared availability', async () => {
    await expect(
      proposeAppointment(workspace.recruiterCtx, {
        applicantId,
        local: slot(22),
        timezone: 'America/Chicago',
        durationMinutes: 45,
        medium: 'PHONE',
        purpose: 'Too late',
        acceptAmbiguous: false,
      }),
    ).rejects.toThrow(/availability/i);
  });
});

describe('10. reminders and rescheduling', () => {
  it('schedules reminders and cancels the old ones on a reschedule', async () => {
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(10, 18),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });
    const first = created.appointment;
    const reminders = await prisma.appointmentReminder.findMany({ where: { appointmentId: first.id } });
    expect(reminders.length).toBe(2);
    expect(reminders.every((r) => r.status === 'pending')).toBe(true);

    const replacement = await rescheduleAppointment(workspace.recruiterCtx, {
      appointmentId: first.id,
      applicantId,
      local: slot(14, 18),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
      reason: 'The applicant asked for the afternoon.',
    });

    const oldReminders = await prisma.appointmentReminder.findMany({ where: { appointmentId: first.id } });
    expect(oldReminders.every((r) => r.status === 'canceled')).toBe(true);

    const old = await prisma.appointment.findFirstOrThrow({ where: { id: first.id } });
    expect(old.state).toBe('CANCELED');
    // Lineage is kept, and the superseded slot is never "attended".
    expect(old.outcome).toBe(AppointmentOutcome.RESCHEDULED);
    expect(old.supersededByAppointmentId).toBe(replacement.appointment.id);
    expect(replacement.appointment.supersedesAppointmentId).toBe(first.id);

    const newReminders = await prisma.appointmentReminder.findMany({
      where: { appointmentId: replacement.appointment.id },
    });
    expect(newReminders.length).toBeGreaterThan(0);
  });

  it('skips a reminder whose appointment is no longer active', async () => {
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(10, 18),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });
    const reminder = await prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: created.appointment.id, status: 'pending' },
    });

    await cancelAppointment(workspace.recruiterCtx, {
      appointmentId: created.appointment.id,
      reason: 'The applicant cancelled.',
      byApplicant: true,
    });

    // The reminder job re-reads current state when it runs.
    const result = await executeReminder({
      organizationId: workspace.organization.id,
      appointmentId: created.appointment.id,
      reminderId: reminder.id,
    });
    expect(result.status).toBe('skipped');
  });

  it('sends a reminder through the approved template when the appointment is live', async () => {
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(10, 18),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });
    const reminder = await prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: created.appointment.id, status: 'pending' },
    });
    const result = await executeReminder({
      organizationId: workspace.organization.id,
      appointmentId: created.appointment.id,
      reminderId: reminder.id,
    });
    expect(result.status).toBe('dispatched');

    const settled = await prisma.appointmentReminder.findFirstOrThrow({ where: { id: reminder.id } });
    expect(settled.status).toBe('dispatched');

    // Re-running the same job does not send a second reminder.
    const replay = await executeReminder({
      organizationId: workspace.organization.id,
      appointmentId: created.appointment.id,
      reminderId: reminder.id,
    });
    expect(replay.status).toBe('skipped');
  });
});

describe('10. completion requires a recorded outcome', () => {
  it('will not complete an appointment just because the time passed', async () => {
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(10, 16),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });

    // Move the clock past the appointment. Nothing marks it complete.
    __setClock(new Date('2026-06-17T15:00:00Z'));
    const stillScheduled = await prisma.appointment.findFirstOrThrow({ where: { id: created.appointment.id } });
    expect(stillScheduled.state).toBe('SCHEDULED');
    expect(stillScheduled.outcome).toBeNull();

    // The database itself refuses a completion with no recorded outcome.
    await expect(
      prisma.appointment.update({
        where: { id: created.appointment.id },
        data: { state: 'COMPLETED' },
      }),
    ).rejects.toThrow();

    const completed = await recordAppointmentOutcome(workspace.recruiterCtx, {
      appointmentId: created.appointment.id,
      outcome: AppointmentOutcome.ATTENDED,
      note: 'Came in and we talked it through.',
    });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.outcomeRecordedByMemberId).toBe(workspace.recruiter.member.id);
    expect(completed.outcomeRecordedAt).not.toBeNull();
  });

  it('records a no-show as its own outcome', async () => {
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(9, 16),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'PHONE',
      purpose: 'Phone conversation',
      acceptAmbiguous: false,
    });
    const result = await recordAppointmentOutcome(workspace.recruiterCtx, {
      appointmentId: created.appointment.id,
      outcome: AppointmentOutcome.NO_SHOW,
    });
    expect(result.state).toBe('NO_SHOW');
    const metrics = await prisma.metricEvent.findMany({
      where: { organizationId: workspace.organization.id, kind: 'APPOINTMENT_NO_SHOW' },
    });
    expect(metrics).toHaveLength(1);
  });
});

describe('10. the applicant-side confirmation flow is scoped to one appointment', () => {
  it('confirms, declines, and refuses a used or bogus credential', async () => {
    const created = await proposeAppointment(workspace.recruiterCtx, {
      applicantId,
      local: slot(11, 17),
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });

    expect(await confirmAppointmentByToken('not-a-token', 'confirm')).toEqual({ status: 'invalid' });

    const confirmed = await confirmAppointmentByToken(created.confirmToken, 'confirm');
    expect(confirmed.status).toBe('ok');
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { id: created.appointment.id } });
    expect(appointment.state).toBe('CONFIRMED');
    expect(appointment.confirmedAt).not.toBeNull();

    const declined = await confirmAppointmentByToken(created.confirmToken, 'decline');
    expect(declined.status).toBe('ok');
    const afterDecline = await prisma.appointment.findFirstOrThrow({ where: { id: created.appointment.id } });
    expect(afterDecline.state).toBe('CANCELED');
    expect(afterDecline.outcome).toBe(AppointmentOutcome.CANCELED_BY_APPLICANT);

    // Once the appointment is closed the credential stops working.
    expect(await confirmAppointmentByToken(created.confirmToken, 'confirm')).toEqual({ status: 'closed' });
  });
});

describe('10. the calendar export discloses as little as possible', () => {
  it('omits the applicant name and contact details', () => {
    const ics = buildIcs({
      id: 'appt-1',
      startsAt: new Date('2026-06-16T15:00:00Z'),
      endsAt: new Date('2026-06-16T15:45:00Z'),
      purpose: 'Initial conversation',
      medium: 'IN_PERSON',
      locationDetail: 'Central station, front office',
      reference: 'C26-0006',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('C26-0006');
    expect(ics).not.toContain('Jaylen');
    expect(ics).not.toContain(PHONE);
  });
});

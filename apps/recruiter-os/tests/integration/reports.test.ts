import { beforeEach, describe, expect, it } from 'vitest';
import { AppointmentOutcome, ConsentPurpose, GrantType } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import { buildReport, recordBaselineObservation } from '@/server/services/reports';
import { createCase } from '@/server/services/cases';
import { approveDraft, createDraft, dispatchMessage, queueApprovedMessage, recordInboundSms } from '@/server/services/messaging';
import { completeTask, snoozeTask } from '@/server/services/tasks';
import { handlers } from '../../worker/handlers';
import { proposeAppointment, recordAppointmentOutcome } from '@/server/services/appointments';
import { createWorkspace, grantConsent, grantPermission, OFFICE_NUMBER, staffContext, type Workspace } from '../setup/factories';

/**
 * Acceptance 14.
 *
 * The reports are only worth having if they are honest about what they count.
 * These tests pin the arithmetic against seeded events and check the places
 * where a reporting layer is usually tempted to flatter itself.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');

let workspace: Workspace;

const window = () => ({
  from: new Date(CLOCK.getTime() - 7 * 86_400_000),
  to: new Date(CLOCK.getTime() + 86_400_000),
});

async function makeCase(name: string, phone: string) {
  const created = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: name,
      timezone: 'America/Chicago',
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: phone, isPrimary: true }],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  await prisma.applicant.update({
    where: { id: created.applicant.id },
    data: { timezoneConfirmed: true, teamId: workspace.team.id },
  });
  await grantConsent(workspace.organization.id, created.applicant.id, ConsentPurpose.RECRUITER_SMS, phone);
  await grantConsent(workspace.organization.id, created.applicant.id, ConsentPurpose.INTAKE_SMS, phone);
  return created;
}

async function sendRecruiterMessage(applicantId: string, phone: string, body: string) {
  const draft = await createDraft(workspace.recruiterCtx, {
    applicantId,
    toValue: phone,
    body,
    purpose: ConsentPurpose.RECRUITER_SMS,
    aiGenerated: false,
    aiBriefId: null,
  });
  await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
  await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
  await dispatchMessage(workspace.organization.id, draft.id);
  return draft.id;
}

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
});

describe('14. contact timing metrics match the seeded events', () => {
  it('reports acceptance and delivery separately', async () => {
    const created = await makeCase('Ack Case', '+15125551201');
    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId: created.applicant.id } });

    // The acknowledgment is accepted 5 minutes after the inquiry opened.
    __setClock(new Date(CLOCK.getTime() + 5 * 60_000));
    await handlers['inquiry.acknowledge']({
      organizationId: workspace.organization.id,
      applicantId: created.applicant.id,
      inquiryEpisodeId: episode.id,
    });
    const ack = await prisma.message.findFirstOrThrow({
      where: { applicantId: created.applicant.id, authorKind: 'APPROVED_AUTOMATION' },
    });
    await dispatchMessage(workspace.organization.id, ack.id);

    let report = await buildReport(workspace.recruiterCtx, window());
    const accepted = report.metrics.find((m) => m.definition.key === 'ack_accepted')!;
    const delivered = report.metrics.find((m) => m.definition.key === 'ack_delivered')!;
    expect(accepted.value).toBe(5);
    expect(accepted.sampleCount).toBe(1);
    // No delivery receipt yet, so delivery is NOT measured rather than assumed.
    expect(delivered.value).toBeNull();
    expect(delivered.sampleCount).toBe(0);

    // The carrier confirms delivery 10 minutes in.
    __setClock(new Date(CLOCK.getTime() + 10 * 60_000));
    const { applyDeliveryEvent } = await import('@/server/services/messaging');
    const dispatched = await prisma.message.findFirstOrThrow({ where: { id: ack.id } });
    await applyDeliveryEvent({
      organizationId: workspace.organization.id,
      providerMessageId: dispatched.providerMessageId!,
      providerStatus: 'delivered',
      occurredAt: now(),
    });

    report = await buildReport(workspace.recruiterCtx, window());
    expect(report.metrics.find((m) => m.definition.key === 'ack_delivered')!.value).toBe(10);
  });

  it('does not count automation or a failed message as human contact', async () => {
    const created = await makeCase('Automation Case', '+15125551202');
    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId: created.applicant.id } });

    await handlers['inquiry.acknowledge']({
      organizationId: workspace.organization.id,
      applicantId: created.applicant.id,
      inquiryEpisodeId: episode.id,
    });
    const ack = await prisma.message.findFirstOrThrow({
      where: { applicantId: created.applicant.id, authorKind: 'APPROVED_AUTOMATION' },
    });
    await dispatchMessage(workspace.organization.id, ack.id);

    // The applicant replies to the automation.
    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: '+15125551202',
      to: OFFICE_NUMBER,
      body: 'ok',
      providerMessageId: 'SIMIN-REPORT-1',
      providerName: 'simulator',
      simulated: true,
    });

    const report = await buildReport(workspace.recruiterCtx, window());
    expect(report.metrics.find((m) => m.definition.key === 'first_human_outreach')!.value).toBeNull();
    expect(report.metrics.find((m) => m.definition.key === 'first_two_way_human')!.value).toBeNull();
    expect(report.metrics.find((m) => m.definition.key === 'progressed_to_two_way')!.value).toBe(0);
  });

  it('counts a genuine two-way exchange and shows its denominator', async () => {
    const one = await makeCase('Replied Case', '+15125551203');
    const two = await makeCase('Silent Case', '+15125551204');

    __setClock(new Date(CLOCK.getTime() + 30 * 60_000));
    await sendRecruiterMessage(one.applicant.id, '+15125551203', 'Austin here — when suits you?');
    await sendRecruiterMessage(two.applicant.id, '+15125551204', 'Austin here — when suits you?');

    __setClock(new Date(CLOCK.getTime() + 60 * 60_000));
    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: '+15125551203',
      to: OFFICE_NUMBER,
      body: 'Tomorrow afternoon works',
      providerMessageId: 'SIMIN-REPORT-2',
      providerName: 'simulator',
      simulated: true,
    });

    const report = await buildReport(workspace.recruiterCtx, window());
    const outreach = report.metrics.find((m) => m.definition.key === 'first_human_outreach')!;
    const twoWay = report.metrics.find((m) => m.definition.key === 'first_two_way_human')!;
    const progressed = report.metrics.find((m) => m.definition.key === 'progressed_to_two_way')!;

    expect(outreach.value).toBe(30);
    expect(outreach.sampleCount).toBe(2);
    expect(twoWay.value).toBe(60);
    expect(twoWay.sampleCount).toBe(1);
    // One of two episodes reached a two-way exchange.
    expect(progressed.value).toBe(50);
    expect(progressed.eligibleCount).toBe(2);
  });
});

describe('14. unanswered cases are shown next to the timings', () => {
  it('reports the count, the oldest age and the ageing buckets', async () => {
    await makeCase('Waiting One', '+15125551205');
    await makeCase('Waiting Two', '+15125551206');

    __setClock(new Date(CLOCK.getTime() + 5 * 86_400_000));
    const report = await buildReport(workspace.recruiterCtx, {
      from: new Date(CLOCK.getTime() - 86_400_000),
      to: new Date(CLOCK.getTime() + 6 * 86_400_000),
    });

    expect(report.unanswered.total).toBe(2);
    expect(report.unanswered.oldestAgeHours).toBe(120);
    expect(report.unanswered.buckets.find((b) => b.label === 'over 3 days')!.count).toBe(2);
  });
});

describe('14. follow-up punctuality is measured against the original promise', () => {
  it('counts a snoozed-then-completed task as late', async () => {
    const created = await makeCase('Punctuality Case', '+15125551207');
    const task = await prisma.task.findFirstOrThrow({
      where: { applicantId: created.applicant.id, status: 'OPEN' },
    });

    await snoozeTask(workspace.recruiterCtx, {
      taskId: task.id,
      newDueAt: new Date(CLOCK.getTime() + 3 * 86_400_000),
      reason: 'Applicant asked for later in the week.',
    });
    __setClock(new Date(CLOCK.getTime() + 3 * 86_400_000 + 60_000));
    await completeTask(workspace.recruiterCtx, { taskId: task.id, outcome: 'SPOKE_WITH_APPLICANT' });

    const report = await buildReport(workspace.recruiterCtx, {
      from: new Date(CLOCK.getTime() - 86_400_000),
      to: new Date(CLOCK.getTime() + 5 * 86_400_000),
    });
    const punctual = report.metrics.find((m) => m.definition.key === 'followups_on_time')!;
    expect(punctual.sampleCount).toBeGreaterThanOrEqual(1);
    expect(punctual.value).toBe(0);
    expect(punctual.definition.definition).toMatch(/FIRST promised/);
  });
});

describe('14. appointments distinguish attendance from rescheduling', () => {
  it('does not count a superseded slot as attended', async () => {
    const created = await makeCase('Appointment Case', '+15125551208');
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

    const scheduled = await proposeAppointment(workspace.recruiterCtx, {
      applicantId: created.applicant.id,
      local: { year: 2026, month: 6, day: 17, hour: 10, minute: 0 },
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
    });
    const { rescheduleAppointment } = await import('@/server/services/appointments');
    const replacement = await rescheduleAppointment(workspace.recruiterCtx, {
      appointmentId: scheduled.appointment.id,
      applicantId: created.applicant.id,
      local: { year: 2026, month: 6, day: 17, hour: 14, minute: 0 },
      timezone: 'America/Chicago',
      durationMinutes: 45,
      medium: 'IN_PERSON',
      purpose: 'Initial conversation',
      acceptAmbiguous: false,
      reason: 'The applicant asked for the afternoon.',
    });
    await recordAppointmentOutcome(workspace.recruiterCtx, {
      appointmentId: replacement.appointment.id,
      outcome: AppointmentOutcome.ATTENDED,
    });

    const report = await buildReport(workspace.recruiterCtx, window());
    expect(report.appointments.completed).toBe(1);
    expect(report.appointments.rescheduledSuperseded).toBe(1);
    // Two appointment rows exist, but only one was attended.
    expect(await prisma.appointment.count({ where: { applicantId: created.applicant.id } })).toBe(2);
  });
});

describe('14. time saved is only reported when it was measured', () => {
  it('says "Not measured" when there is no comparable pair', async () => {
    const report = await buildReport(workspace.recruiterCtx, window());
    expect(report.savings.status).toBe('not_measured');
    expect(report.savings.rows).toHaveLength(0);
  });

  it('refuses a measurement without the baseline-entry grant', async () => {
    await expect(
      recordBaselineObservation(workspace.recruiterCtx, {
        taskType: 'prepare-case-file',
        measurementKind: 'baseline',
        periodStart: new Date(CLOCK.getTime() - 30 * 86_400_000),
        periodEnd: CLOCK,
        sampleCount: 12,
        meanMinutes: 14,
        methodology: 'Timed by hand.',
      }),
    ).rejects.toThrow(/baseline-entry grant/);
  });

  it('reports a measured pair, including a negative result', async () => {
    await grantPermission(workspace.organization.id, workspace.manager.member.id, GrantType.BASELINE_ENTRY);
    const ctx = staffContext(workspace.manager.member, workspace.orgRef);

    await recordBaselineObservation(ctx, {
      taskType: 'prepare-case-file',
      measurementKind: 'baseline',
      periodStart: new Date(CLOCK.getTime() - 5 * 86_400_000),
      periodEnd: new Date(CLOCK.getTime() - 3 * 86_400_000),
      sampleCount: 18,
      meanMinutes: 14.5,
      methodology: 'Timed by hand over four weeks.',
    });
    await recordBaselineObservation(ctx, {
      taskType: 'prepare-case-file',
      measurementKind: 'observation',
      periodStart: new Date(CLOCK.getTime() - 2 * 86_400_000),
      periodEnd: CLOCK,
      sampleCount: 21,
      meanMinutes: 6.25,
      methodology: 'Same task against the prepared brief.',
    });
    // A task type that got SLOWER. The report must not hide it.
    await recordBaselineObservation(ctx, {
      taskType: 'manual-linking-review',
      measurementKind: 'baseline',
      periodStart: new Date(CLOCK.getTime() - 5 * 86_400_000),
      periodEnd: new Date(CLOCK.getTime() - 3 * 86_400_000),
      sampleCount: 6,
      meanMinutes: 3,
      methodology: 'Timed by hand.',
    });
    await recordBaselineObservation(ctx, {
      taskType: 'manual-linking-review',
      measurementKind: 'observation',
      periodStart: new Date(CLOCK.getTime() - 2 * 86_400_000),
      periodEnd: CLOCK,
      sampleCount: 6,
      meanMinutes: 5,
      methodology: 'Timed by hand with the new linking step.',
    });

    const report = await buildReport(ctx, window());
    expect(report.savings.status).toBe('measured');
    const better = report.savings.rows.find((r) => r.taskType === 'prepare-case-file')!;
    const worse = report.savings.rows.find((r) => r.taskType === 'manual-linking-review')!;
    expect(better.savedMinutesPerUnit).toBeCloseTo(8.25, 2);
    expect(worse.savedMinutesPerUnit).toBeCloseTo(-2, 2);
    expect(better.methodology).toMatch(/Baseline:.*Observation:/s);
  });

  it('does not report savings from a baseline alone', async () => {
    await grantPermission(workspace.organization.id, workspace.manager.member.id, GrantType.BASELINE_ENTRY);
    const ctx = staffContext(workspace.manager.member, workspace.orgRef);
    await recordBaselineObservation(ctx, {
      taskType: 'prepare-case-file',
      measurementKind: 'baseline',
      periodStart: new Date(CLOCK.getTime() - 5 * 86_400_000),
      periodEnd: CLOCK,
      sampleCount: 18,
      meanMinutes: 14.5,
      methodology: 'Timed by hand.',
    });
    const report = await buildReport(ctx, window());
    expect(report.savings.status).toBe('not_measured');
  });
});

describe('14. every metric declares its definition and exclusions', () => {
  it('ships a definition, a sample count and an exclusion note with each number', async () => {
    const report = await buildReport(workspace.recruiterCtx, window());
    expect(report.metrics.length).toBeGreaterThan(5);
    for (const metric of report.metrics) {
      expect(metric.definition.definition.length).toBeGreaterThan(20);
      expect(metric.definition.excludes.length).toBeGreaterThan(10);
      expect(typeof metric.sampleCount).toBe('number');
      expect(typeof metric.eligibleCount).toBe('number');
    }
    // Demo data is labelled as fictional.
    expect(report.demoData).toBe(true);
  });

  it('keeps a reopened case as its own episode in the denominator', async () => {
    const created = await makeCase('Reopened Case', '+15125551209');
    const { setCaseStatus } = await import('@/server/services/cases');
    await prisma.$transaction((tx) =>
      setCaseStatus(tx, workspace.recruiterCtx, {
        applicantId: created.applicant.id,
        status: 'CLOSED',
        closureReason: 'UNABLE_TO_REACH',
        reason: 'No answer after several attempts.',
      }),
    );
    __setClock(new Date(CLOCK.getTime() + 3_600_000));
    await prisma.$transaction((tx) =>
      setCaseStatus(tx, workspace.recruiterCtx, {
        applicantId: created.applicant.id,
        status: 'READY_FOR_RECRUITER',
        reason: 'They wrote back.',
      }),
    );

    const report = await buildReport(workspace.recruiterCtx, window());
    const progressed = report.metrics.find((m) => m.definition.key === 'progressed_to_two_way')!;
    // Two episodes for one case, counted separately and said so.
    expect(progressed.eligibleCount).toBe(2);
    expect(progressed.note).toMatch(/reopened/i);
  });
});

import 'server-only';
import { AppointmentState, MetricEventKind, TaskStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { authorizedOwnerScope, canExport, canViewTeamReports, requireStaff, type ActorContext } from '@/server/authz/policy';
import { auditSecurity } from '@/server/audit';
import { ConflictError } from '@/server/authz/errors';
import { toCsv } from '@/lib/csv';
import { isDemoMode } from '@/env';

/**
 * Operational reporting.
 *
 * Every number here is computed from PERSISTED EVENTS and ships with its
 * definition, its sample count, its eligible denominator and what it excludes.
 * The honesty rules that shape the code:
 *
 *   * A bot exchange, a failed outbound message and an unanswered call are
 *     never counted as human contact.
 *   * Provider acceptance and delivery are reported separately, because they
 *     are different facts.
 *   * Merging duplicates or changing owners does not reset an inquiry clock:
 *     the clock belongs to the inquiry EPISODE.
 *   * Reopened cases start a new episode, and the report says so.
 *   * Unanswered cases and their ages are shown NEXT TO completed-contact
 *     timings, so a good-looking average cannot hide the cases nobody reached.
 *   * "Time saved" shows "Not measured" unless a comparable recorded baseline
 *     and observation both exist. There is no invented figure and no accuracy
 *     score anywhere.
 */

export type MetricDefinition = {
  key: string;
  label: string;
  definition: string;
  excludes: string;
};

export type MetricValue = {
  definition: MetricDefinition;
  /** Null means "not measured", which is displayed as such. */
  value: number | null;
  unit: 'minutes' | 'count' | 'percent' | 'none';
  sampleCount: number;
  eligibleCount: number;
  note?: string;
};

export type ReportFilters = {
  from: Date;
  to: Date;
  teamId?: string | null;
  ownerMemberId?: string | null;
};

export type ReportBundle = {
  generatedAt: Date;
  filters: ReportFilters;
  demoData: boolean;
  scopeNote: string;
  metrics: MetricValue[];
  unanswered: {
    total: number;
    oldestAgeHours: number | null;
    buckets: Array<{ label: string; count: number }>;
  };
  appointments: {
    scheduled: number;
    completed: number;
    canceled: number;
    noShow: number;
    rescheduledSuperseded: number;
  };
  savings: {
    status: 'measured' | 'not_measured';
    rows: Array<{
      taskType: string;
      baselineMinutes: number;
      observedMinutes: number;
      baselineSample: number;
      observedSample: number;
      savedMinutesPerUnit: number;
      methodology: string;
    }>;
  };
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

async function scopedApplicantIds(ctx: ActorContext, filters: ReportFilters): Promise<string[] | null> {
  const staff = requireStaff(ctx);
  const scope = await authorizedOwnerScope(staff);
  if (scope.wholeOrganization && !filters.teamId && !filters.ownerMemberId) return null;

  const rows = await prisma.applicant.findMany({
    where: {
      organizationId: staff.member.organizationId,
      ...(filters.teamId ? { teamId: filters.teamId } : {}),
      ...(filters.ownerMemberId ? { ownerMemberId: filters.ownerMemberId } : {}),
      ...(scope.wholeOrganization
        ? {}
        : {
            OR: [
              { ownerMemberId: { in: scope.ownerMemberIds } },
              ...(scope.teamIds.length ? [{ teamId: { in: scope.teamIds } }] : []),
              ...(scope.applicantIds.length ? [{ id: { in: scope.applicantIds } }] : []),
            ],
          }),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function buildReport(ctx: ActorContext, filters: ReportFilters): Promise<ReportBundle> {
  const staff = requireStaff(ctx);
  if (!(await canViewTeamReports(ctx)) && (filters.teamId || filters.ownerMemberId)) {
    throw new ConflictError('Filtering reports by team or owner needs the team-reports grant.');
  }
  const organizationId = staff.member.organizationId;
  const at = now();
  const applicantIds = await scopedApplicantIds(ctx, filters);
  const idFilter = applicantIds === null ? {} : { applicantId: { in: applicantIds } };

  const episodes = await prisma.inquiryEpisode.findMany({
    where: {
      organizationId,
      openedAt: { gte: filters.from, lt: filters.to },
      ...(applicantIds === null ? {} : { applicantId: { in: applicantIds } }),
    },
  });

  const eligible = episodes.length;

  const ackAccepted = episodes
    .filter((e) => e.acknowledgedAcceptedAt)
    .map((e) => Math.round((e.acknowledgedAcceptedAt!.getTime() - e.openedAt.getTime()) / 60000));
  const ackDelivered = episodes
    .filter((e) => e.acknowledgedDeliveredAt)
    .map((e) => Math.round((e.acknowledgedDeliveredAt!.getTime() - e.openedAt.getTime()) / 60000));
  const firstHuman = episodes
    .filter((e) => e.firstHumanOutreachAt)
    .map((e) => Math.round((e.firstHumanOutreachAt!.getTime() - e.openedAt.getTime()) / 60000));
  const firstTwoWay = episodes
    .filter((e) => e.firstTwoWayHumanAt)
    .map((e) => Math.round((e.firstTwoWayHumanAt!.getTime() - e.openedAt.getTime()) / 60000));

  const reopened = episodes.filter((e) => e.originKind === 'reopened').length;

  const [appointmentRows, taskRows, briefReviews, briefCorrections] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['state'],
      where: {
        organizationId,
        createdAt: { gte: filters.from, lt: filters.to },
        ...(applicantIds === null ? {} : { applicantId: { in: applicantIds } }),
      },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: {
        organizationId,
        status: TaskStatus.COMPLETED,
        completedAt: { gte: filters.from, lt: filters.to },
        ...(applicantIds === null ? {} : { applicantId: { in: applicantIds } }),
      },
      select: { completedAt: true, originalDueAt: true },
    }),
    prisma.metricEvent.count({
      where: {
        organizationId,
        kind: MetricEventKind.BRIEF_REVIEWED,
        occurredAt: { gte: filters.from, lt: filters.to },
        ...idFilter,
      },
    }),
    prisma.metricEvent.aggregate({
      where: {
        organizationId,
        kind: MetricEventKind.BRIEF_CORRECTED,
        occurredAt: { gte: filters.from, lt: filters.to },
        ...idFilter,
      },
      _count: { _all: true },
      _sum: { numericValue: true },
    }),
  ]);

  const appointmentCount = (state: AppointmentState) =>
    appointmentRows.find((r) => r.state === state)?._count._all ?? 0;
  const rescheduledSuperseded = await prisma.appointment.count({
    where: {
      organizationId,
      supersededByAppointmentId: { not: null },
      createdAt: { gte: filters.from, lt: filters.to },
      ...(applicantIds === null ? {} : { applicantId: { in: applicantIds } }),
    },
  });

  const onTimeTasks = taskRows.filter((t) => t.completedAt! <= t.originalDueAt).length;

  // Unanswered: an open episode with no human outreach at all.
  const unansweredEpisodes = episodes.filter((e) => !e.firstHumanOutreachAt && !e.closedAt);
  const ages = unansweredEpisodes.map((e) => (at.getTime() - e.openedAt.getTime()) / 3600_000);
  const buckets = [
    { label: 'under 4h', count: ages.filter((h) => h < 4).length },
    { label: '4–24h', count: ages.filter((h) => h >= 4 && h < 24).length },
    { label: '1–3 days', count: ages.filter((h) => h >= 24 && h < 72).length },
    { label: 'over 3 days', count: ages.filter((h) => h >= 72).length },
  ];

  const metrics: MetricValue[] = [
    {
      definition: {
        key: 'ack_accepted',
        label: 'Time to automated acknowledgment (provider accepted)',
        definition:
          'Median minutes from inquiry opening to the carrier ACCEPTING the automated acknowledgment. Acceptance is not delivery.',
        excludes: 'Episodes with no acknowledgment attempt, and acknowledgments blocked by consent or quiet hours.',
      },
      value: median(ackAccepted),
      unit: 'minutes',
      sampleCount: ackAccepted.length,
      eligibleCount: eligible,
    },
    {
      definition: {
        key: 'ack_delivered',
        label: 'Time to automated acknowledgment (delivered)',
        definition:
          'Median minutes from inquiry opening to a carrier DELIVERY confirmation. Reported separately from acceptance, and only where the carrier told us.',
        excludes: 'Episodes where no delivery confirmation was received. Absence of a receipt is not counted as failure.',
      },
      value: median(ackDelivered),
      unit: 'minutes',
      sampleCount: ackDelivered.length,
      eligibleCount: ackAccepted.length,
      note: ackDelivered.length < ackAccepted.length ? 'Some carriers never send a delivery receipt.' : undefined,
    },
    {
      definition: {
        key: 'first_human_outreach',
        label: 'Time to first human outreach',
        definition:
          'Median minutes from inquiry opening to the first outbound attempt authored by a recruiter (a sent message or a logged call).',
        excludes: 'Automated acknowledgments, drafts that were never sent, and outbound messages the carrier refused.',
      },
      value: median(firstHuman),
      unit: 'minutes',
      sampleCount: firstHuman.length,
      eligibleCount: eligible,
    },
    {
      definition: {
        key: 'first_two_way_human',
        label: 'Time to first genuine two-way human contact',
        definition:
          'Median minutes from inquiry opening to the applicant responding to a HUMAN, or to a connected call. Requires that a human had already reached out.',
        excludes:
          'Bot exchanges, replies to automated acknowledgments, STOP/START/HELP keywords, and unanswered calls.',
      },
      value: median(firstTwoWay),
      unit: 'minutes',
      sampleCount: firstTwoWay.length,
      eligibleCount: firstHuman.length,
    },
    {
      definition: {
        key: 'progressed_to_two_way',
        label: 'Inquiries that became two-way conversations',
        definition: 'Share of inquiry episodes in the window that reached genuine two-way human contact.',
        excludes: 'Episodes opened outside the window. Reopened cases count as their own episode.',
      },
      value: eligible ? Math.round((firstTwoWay.length / eligible) * 100) : null,
      unit: 'percent',
      sampleCount: firstTwoWay.length,
      eligibleCount: eligible,
      note: reopened ? `${reopened} of these episodes are reopened cases, counted separately from the original.` : undefined,
    },
    {
      definition: {
        key: 'followups_on_time',
        label: 'Follow-ups completed by the original promised deadline',
        definition:
          'Share of completed follow-ups finished at or before the date FIRST promised. Snoozing moves the working date, never this one.',
        excludes: 'Canceled tasks, and tasks still open.',
      },
      value: taskRows.length ? Math.round((onTimeTasks / taskRows.length) * 100) : null,
      unit: 'percent',
      sampleCount: taskRows.length,
      eligibleCount: taskRows.length,
    },
    {
      definition: {
        key: 'briefs_reviewed',
        label: 'AI briefs reviewed',
        definition: 'Count of recruiter review actions on prepared briefs (approve or reject).',
        excludes: 'Generations that failed, and briefs nobody has looked at yet.',
      },
      value: briefReviews,
      unit: 'count',
      sampleCount: briefReviews,
      eligibleCount: briefReviews,
    },
    {
      definition: {
        key: 'brief_corrections',
        label: 'Brief items a recruiter corrected',
        definition:
          'Count of brief items with a recruiter correction. This is a count of real review actions — deliberately NOT an accuracy score.',
        excludes: 'Anything inferred. No model is asked to grade itself.',
      },
      value: briefCorrections._sum.numericValue ?? 0,
      unit: 'count',
      sampleCount: briefCorrections._count._all,
      eligibleCount: briefReviews,
    },
  ];

  const savings = await buildSavings(organizationId, filters);

  return {
    generatedAt: at,
    filters,
    demoData: isDemoMode || staff.organization.dataScope === 'DEMO',
    scopeNote:
      applicantIds === null
        ? 'All cases in this organization.'
        : `${applicantIds.length} case(s) you are authorized to see.`,
    metrics,
    unanswered: {
      total: unansweredEpisodes.length,
      oldestAgeHours: ages.length ? Math.round(Math.max(...ages)) : null,
      buckets,
    },
    appointments: {
      scheduled:
        appointmentCount(AppointmentState.SCHEDULED) +
        appointmentCount(AppointmentState.CONFIRMED) +
        appointmentCount(AppointmentState.COMPLETED) +
        appointmentCount(AppointmentState.NO_SHOW),
      completed: appointmentCount(AppointmentState.COMPLETED),
      canceled: appointmentCount(AppointmentState.CANCELED),
      noShow: appointmentCount(AppointmentState.NO_SHOW),
      rescheduledSuperseded,
    },
    savings,
  };
}

/**
 * Administrative time saved.
 *
 * Only reported where a comparable BASELINE and OBSERVATION both exist for the
 * same task type. Negative savings are shown as negative. Everything else
 * reads "Not measured".
 */
async function buildSavings(organizationId: string, filters: ReportFilters): Promise<ReportBundle['savings']> {
  const records = await prisma.baselineObservation.findMany({
    where: { organizationId, periodStart: { lt: filters.to }, periodEnd: { gt: filters.from } },
    orderBy: { createdAt: 'desc' },
  });

  const byType = new Map<string, { baseline?: (typeof records)[number]; observation?: (typeof records)[number] }>();
  for (const record of records) {
    const entry = byType.get(record.taskType) ?? {};
    if (record.measurementKind === 'baseline' && !entry.baseline) entry.baseline = record;
    if (record.measurementKind === 'observation' && !entry.observation) entry.observation = record;
    byType.set(record.taskType, entry);
  }

  const rows: ReportBundle['savings']['rows'] = [];
  for (const [taskType, entry] of byType) {
    if (!entry.baseline || !entry.observation) continue;
    rows.push({
      taskType,
      baselineMinutes: entry.baseline.meanMinutes,
      observedMinutes: entry.observation.meanMinutes,
      baselineSample: entry.baseline.sampleCount,
      observedSample: entry.observation.sampleCount,
      // Can be negative. That is a real result and it is displayed.
      savedMinutesPerUnit: Number((entry.baseline.meanMinutes - entry.observation.meanMinutes).toFixed(2)),
      methodology: `Baseline: ${entry.baseline.methodology}. Observation: ${entry.observation.methodology}.`,
    });
  }

  return { status: rows.length ? 'measured' : 'not_measured', rows };
}

export async function recordBaselineObservation(
  ctx: ActorContext,
  input: {
    taskType: string;
    measurementKind: 'baseline' | 'observation';
    periodStart: Date;
    periodEnd: Date;
    sampleCount: number;
    meanMinutes: number;
    methodology: string;
  },
) {
  const staff = requireStaff(ctx);
  const { canEnterBaselines } = await import('@/server/authz/policy');
  if (!(await canEnterBaselines(ctx))) {
    throw new ConflictError('Recording a measurement needs the baseline-entry grant.');
  }
  return prisma.$transaction(async (tx) => {
    const record = await tx.baselineObservation.create({
      data: {
        organizationId: staff.member.organizationId,
        taskType: input.taskType,
        measurementKind: input.measurementKind,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        sampleCount: input.sampleCount,
        meanMinutes: input.meanMinutes,
        methodology: input.methodology,
        recordedByMemberId: staff.member.id,
      },
    });
    await auditSecurity(tx, ctx, {
      action: 'report.measurement_recorded',
      subjectType: 'baseline_observation',
      subjectId: record.id,
      metadata: {
        taskType: input.taskType,
        kind: input.measurementKind,
        sampleCount: input.sampleCount,
        meanMinutes: input.meanMinutes,
      },
    });
    return record;
  });
}

/**
 * CSV export. Requires the EXPORT grant, writes an audit entry, keeps the
 * field set minimal, and escapes formula-triggering cells.
 */
export async function exportReportCsv(ctx: ActorContext, filters: ReportFilters) {
  const staff = requireStaff(ctx);
  if (!(await canExport(ctx))) {
    throw new ConflictError('Exporting needs the export grant.');
  }
  const report = await buildReport(ctx, filters);

  const csv = toCsv(
    ['metric', 'definition', 'value', 'unit', 'sample_count', 'eligible_count', 'excludes'],
    report.metrics.map((m) => [
      m.definition.label,
      m.definition.definition,
      m.value === null ? 'Not measured' : m.value,
      m.unit,
      m.sampleCount,
      m.eligibleCount,
      m.definition.excludes,
    ]),
  );

  await auditSecurity(prisma, ctx, {
    action: 'report.exported',
    subjectType: 'report',
    metadata: {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      teamId: filters.teamId ?? null,
      rowCount: report.metrics.length,
      // Field NAMES, so the audit trail says what left without copying it.
      fields: ['metric', 'definition', 'value', 'unit', 'sample_count', 'eligible_count', 'excludes'],
    },
  });

  return {
    csv,
    filename: `recruiteros-report-${filters.from.toISOString().slice(0, 10)}-to-${filters.to.toISOString().slice(0, 10)}${report.demoData ? '-FICTIONAL-DEMO' : ''}.csv`,
    demoData: report.demoData,
    organizationId: staff.member.organizationId,
  };
}

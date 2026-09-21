import { AlertTriangle, FlaskConical, Info } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Notice, SectionTitle } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { buildReport } from '@/server/services/reports';
import { canEnterBaselines, canExport, canViewTeamReports } from '@/server/authz/policy';
import { now } from '@/server/clock';
import { addDays, formatInZone, startOfLocalDay } from '@/lib/time';
import { prisma } from '@/server/db';
import { MeasurementForm } from '@/components/app/MeasurementForm';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const params = await searchParams;
  const days = Number(typeof params.days === 'string' ? params.days : '30') || 30;
  const teamId = typeof params.team === 'string' && params.team ? params.team : null;

  const at = now();
  const to = addDays(startOfLocalDay(at, ctx.timezone), 1);
  const from = addDays(to, -days);

  const [report, teams, mayExport, mayEnter, mayFilter] = await Promise.all([
    buildReport(ctx, { from, to, teamId }),
    prisma.team.findMany({
      where: { organizationId: ctx.member.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    canExport(ctx),
    canEnterBaselines(ctx),
    canViewTeamReports(ctx),
  ]);

  const exportHref = `/api/exports/report?days=${days}${teamId ? `&team=${teamId}` : ''}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Reports</h1>
          <p className="text-[13px] text-ink-faint">
            {formatInZone(from, ctx.timezone, { dateStyle: 'medium' })} –{' '}
            {formatInZone(to, ctx.timezone, { dateStyle: 'medium' })} · {report.scopeNote}
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-[12px]">
            <span className="mb-1 block font-medium text-ink">Window</span>
            <select
              name="days"
              defaultValue={String(days)}
              className="min-h-[38px] rounded-md border border-line-strong bg-surface px-2.5 text-[14px]"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          {mayFilter && teams.length ? (
            <label className="text-[12px]">
              <span className="mb-1 block font-medium text-ink">Team</span>
              <select
                name="team"
                defaultValue={teamId ?? ''}
                className="min-h-[38px] rounded-md border border-line-strong bg-surface px-2.5 text-[14px]"
              >
                <option value="">All authorized</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="submit"
            className="touch-target rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium"
          >
            Apply
          </button>
          {mayExport ? (
            <a
              href={exportHref}
              className="touch-target rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium"
            >
              Export CSV
            </a>
          ) : null}
        </form>
      </div>

      {report.demoData ? (
        <Notice tone="pending" icon={<FlaskConical size={14} />} title="These numbers come from fictional demo data">
          Every figure below is computed from the seeded demo dataset. Exported files are named to say so.
        </Notice>
      ) : null}

      <Notice tone="neutral" icon={<Info size={14} />}>
        Each metric shows its definition, its sample count, the eligible denominator and what it
        excludes. Carrier acceptance and delivery are reported separately. A bot exchange, a failed
        outbound message and an unanswered call are never counted as human contact.
      </Notice>

      <div className="grid gap-3 md:grid-cols-2">
        {report.metrics.map((metric) => (
          <Card key={metric.definition.key}>
            <CardBody className="space-y-1.5">
              <p className="text-[13px] font-semibold text-ink">{metric.definition.label}</p>
              <p className="text-[24px] font-semibold leading-tight text-ink">
                {metric.value === null ? (
                  <span className="text-[16px] font-medium text-ink-faint">Not measured</span>
                ) : (
                  <>
                    {metric.value}
                    <span className="ml-1 text-[13px] font-normal text-ink-faint">
                      {metric.unit === 'minutes' ? 'min (median)' : metric.unit === 'percent' ? '%' : ''}
                    </span>
                  </>
                )}
              </p>
              <p className="text-[12px] text-ink-faint">
                sample {metric.sampleCount} of {metric.eligibleCount} eligible
              </p>
              <details>
                <summary className="cursor-pointer text-[12px] text-accent">Definition and exclusions</summary>
                <p className="mt-1 text-[12.5px] text-ink-soft">{metric.definition.definition}</p>
                <p className="mt-1 text-[12.5px] text-ink-faint">Excludes: {metric.definition.excludes}</p>
              </details>
              {metric.note ? <p className="text-[12px] text-pending">{metric.note}</p> : null}
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Unanswered inquiries and their age"
          description="Shown beside the timing metrics on purpose: an average cannot hide the cases nobody reached."
        />
        <CardBody className="space-y-2">
          <p className="text-[13px] text-ink">
            {report.unanswered.total} open inquir{report.unanswered.total === 1 ? 'y' : 'ies'} with no
            human outreach yet
            {report.unanswered.oldestAgeHours !== null
              ? `, oldest ${report.unanswered.oldestAgeHours}h`
              : ''}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {report.unanswered.buckets.map((bucket) => (
              <Badge
                key={bucket.label}
                tone={bucket.label === 'over 3 days' && bucket.count ? 'review' : 'neutral'}
                icon={bucket.label === 'over 3 days' && bucket.count ? <AlertTriangle size={12} /> : undefined}
              >
                {bucket.label}: {bucket.count}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Appointments"
          description="Superseded slots from a reschedule are never counted as attended."
        />
        <CardBody className="grid gap-3 sm:grid-cols-5">
          {[
            ['Scheduled', report.appointments.scheduled],
            ['Completed', report.appointments.completed],
            ['Canceled', report.appointments.canceled],
            ['No-show', report.appointments.noShow],
            ['Rescheduled away', report.appointments.rescheduledSuperseded],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <p className="text-[12px] uppercase tracking-wide text-ink-faint">{label}</p>
              <p className="text-[20px] font-semibold text-ink">{value}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Administrative time saved"
          description="Reported only where a comparable recorded baseline and an observed measurement both exist."
        />
        <CardBody className="space-y-3">
          {report.savings.status === 'not_measured' ? (
            <Notice tone="neutral">
              <strong className="font-semibold">Not measured.</strong> No comparable baseline and
              observation pair has been recorded for this window. No figure is estimated in its place.
            </Notice>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <caption className="sr-only">Measured time saved per task type</caption>
                <thead className="border-b border-line bg-surface-muted text-[12px] uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Task</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Baseline (min)</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Observed (min)</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Saved per unit</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Samples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.savings.rows.map((row) => (
                    <tr key={row.taskType}>
                      <td className="px-3 py-2 text-[13px] text-ink">{row.taskType}</td>
                      <td className="px-3 py-2 text-[13px] text-ink">{row.baselineMinutes}</td>
                      <td className="px-3 py-2 text-[13px] text-ink">{row.observedMinutes}</td>
                      <td className="px-3 py-2 text-[13px]">
                        <Badge tone={row.savedMinutesPerUnit >= 0 ? 'ready' : 'review'}>
                          {row.savedMinutesPerUnit >= 0 ? '+' : ''}
                          {row.savedMinutesPerUnit} min
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-[12.5px] text-ink-faint">
                        {row.baselineSample} / {row.observedSample}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 space-y-1">
                <SectionTitle>Methodology</SectionTitle>
                {report.savings.rows.map((row) => (
                  <p key={row.taskType} className="text-[12.5px] text-ink-faint">
                    {row.taskType}: {row.methodology}
                  </p>
                ))}
              </div>
            </div>
          )}

          {mayEnter ? <MeasurementForm /> : (
            <Notice tone="neutral">Recording a measurement needs the baseline-entry grant.</Notice>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

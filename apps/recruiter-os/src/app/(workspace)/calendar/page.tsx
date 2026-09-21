import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice } from '@/components/ui';
import { requireStaffContext, applicantScopeWhere } from '@/server/context';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { addDays, formatInZone, localDateKey, startOfLocalDay, zoneAbbreviation } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const params = await searchParams;
  const offset = Number(typeof params.week === 'string' ? params.week : '0') || 0;
  const at = now();
  const weekStart = startOfLocalDay(addDays(at, offset * 7), ctx.timezone);
  const weekEnd = addDays(weekStart, 7);

  const scope = await applicantScopeWhere(ctx);
  const scoped = await prisma.applicant.findMany({ where: scope, select: { id: true } });
  const ids = scoped.map((s) => s.id);

  const appointments = ids.length
    ? await prisma.appointment.findMany({
        where: {
          organizationId: ctx.member.organizationId,
          applicantId: { in: ids },
          startsAt: { gte: weekStart, lt: weekEnd },
        },
        orderBy: { startsAt: 'asc' },
        include: {
          applicant: { select: { id: true, displayName: true, reference: true } },
          recruiter: { select: { displayName: true } },
        },
      })
    : [];

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Calendar</h1>
          <p className="text-[13px] text-ink-faint">
            {formatInZone(weekStart, ctx.timezone, { dateStyle: 'medium' })} –{' '}
            {formatInZone(addDays(weekStart, 6), ctx.timezone, { dateStyle: 'medium' })} ·{' '}
            {ctx.timezone} ({zoneAbbreviation(weekStart, ctx.timezone)})
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/calendar?week=${offset - 1}`}
            className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
          >
            Previous week
          </Link>
          <Link
            href="/calendar"
            className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
          >
            This week
          </Link>
          <Link
            href={`/calendar?week=${offset + 1}`}
            className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
          >
            Next week
          </Link>
        </div>
      </div>

      <Notice tone="neutral">
        This is the internal calendar. Each appointment offers an .ics download with minimal detail.
        There is no Google or Microsoft calendar synchronization in this build.
      </Notice>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {days.map((day) => {
          const key = localDateKey(day, ctx.timezone);
          const dayAppointments = appointments.filter(
            (a) => localDateKey(a.startsAt, ctx.timezone) === key,
          );
          const isToday = key === localDateKey(at, ctx.timezone);
          return (
            <Card key={key} className={isToday ? 'border-accent' : undefined}>
              <CardHeader
                title={formatInZone(day, ctx.timezone, { weekday: 'long', month: 'short', day: 'numeric' })}
                description={isToday ? 'Today' : undefined}
              />
              <CardBody className="space-y-1.5">
                {dayAppointments.length === 0 ? (
                  <p className="text-[13px] text-ink-faint">Nothing scheduled.</p>
                ) : null}
                {dayAppointments.map((appointment) => (
                  <Link
                    key={appointment.id}
                    href={`/applicants/${appointment.applicant.id}?view=tasks`}
                    className="block rounded-md border border-line px-2.5 py-1.5 hover:bg-surface-muted"
                  >
                    <p className="text-[13px] font-medium text-ink">
                      {formatInZone(appointment.startsAt, ctx.timezone, { timeStyle: 'short' })} ·{' '}
                      {appointment.applicant.displayName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      {appointment.purpose} · {appointment.recruiter.displayName}
                    </p>
                    <Badge
                      tone={
                        appointment.state === 'CONFIRMED' || appointment.state === 'COMPLETED'
                          ? 'ready'
                          : appointment.state === 'NO_SHOW'
                            ? 'review'
                            : appointment.state === 'CANCELED'
                              ? 'neutral'
                              : 'pending'
                      }
                      className="mt-1"
                    >
                      {appointment.state.replace('_', ' ').toLowerCase()}
                    </Badge>
                  </Link>
                ))}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {appointments.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<CalendarClock size={20} />}
              title="No appointments this week"
              description="Schedule one from a case file. The applicant gets a scoped confirmation link."
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

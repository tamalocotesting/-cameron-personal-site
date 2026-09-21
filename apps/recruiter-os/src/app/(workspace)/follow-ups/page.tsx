import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, Select } from '@/components/ui';
import { requireStaffContext, applicantScopeWhere } from '@/server/context';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { formatInZone, relativeLabel, zoneAbbreviation } from '@/lib/time';
import { TaskStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const params = await searchParams;
  const scopeFilter = typeof params.scope === 'string' ? params.scope : 'mine';
  const at = now();

  const applicantScope = await applicantScopeWhere(ctx);
  const scoped = await prisma.applicant.findMany({ where: applicantScope, select: { id: true } });
  const ids = scoped.map((s) => s.id);

  const where = {
    organizationId: ctx.member.organizationId,
    applicantId: { in: ids.length ? ids : ['-'] },
    status: { in: [TaskStatus.OPEN, TaskStatus.SNOOZED] },
    ...(scopeFilter === 'mine' ? { ownerMemberId: ctx.member.id } : {}),
  };

  const [tasks, overdueCount] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }],
      take: 200,
      include: {
        applicant: { select: { id: true, displayName: true, reference: true } },
        owner: { select: { displayName: true } },
      },
    }),
    prisma.task.count({ where: { ...where, originalDueAt: { lt: at } } }),
  ]);

  const overdue = tasks.filter((t) => t.originalDueAt < at);
  const upcoming = tasks.filter((t) => t.originalDueAt >= at);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Follow-ups</h1>
          <p className="text-[13px] text-ink-faint">
            {tasks.length} open · {overdueCount} past the date originally promised · times in{' '}
            {ctx.timezone} ({zoneAbbreviation(at, ctx.timezone)})
          </p>
        </div>
        <form method="get">
          <label className="flex items-center gap-2 text-[12px]">
            <span className="text-ink-faint">Show</span>
            <Select name="scope" defaultValue={scopeFilter} aria-label="Whose follow-ups to show">
              <option value="mine">Mine</option>
              <option value="all">Everyone I can see</option>
            </Select>
            <button type="submit" className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5">
              Apply
            </button>
          </label>
        </form>
      </div>

      <Notice tone="neutral">
        A follow-up is completed only by recording an outcome. Moving one keeps the date it was first
        promised, which is what the on-time report measures against.
      </Notice>

      {[
        { label: 'Overdue', rows: overdue, tone: 'review' as const, icon: <AlertTriangle size={14} /> },
        { label: 'Upcoming', rows: upcoming, tone: 'pending' as const, icon: <Clock size={14} /> },
      ].map((group) => (
        <Card key={group.label}>
          <CardHeader title={`${group.label} (${group.rows.length})`} />
          <CardBody className="space-y-1.5">
            {group.rows.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 size={18} />}
                title={`Nothing ${group.label.toLowerCase()}`}
                description="Work shows up here as soon as it has a due date."
              />
            ) : null}
            {group.rows.map((task) => (
              <div key={task.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line px-3 py-2">
                <div className="min-w-0">
                  <Link
                    href={`/applicants/${task.applicant.id}?view=tasks`}
                    className="text-[13.5px] font-medium text-accent underline underline-offset-2"
                  >
                    {task.title}
                  </Link>
                  <p className="mt-0.5 text-[12.5px] text-ink-faint">{task.reason}</p>
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    {task.applicant.displayName} · {task.applicant.reference} · owner {task.owner.displayName}
                  </p>
                </div>
                <div className="text-right">
                  <Badge tone={group.tone} icon={group.icon}>
                    {relativeLabel(task.dueAt, at)}
                  </Badge>
                  <p className="mt-0.5 text-[12px] text-ink-faint">{formatInZone(task.dueAt, ctx.timezone)}</p>
                  {task.dueAt.getTime() !== task.originalDueAt.getTime() ? (
                    <p className="text-[11.5px] text-ink-faint">
                      promised {formatInZone(task.originalDueAt, ctx.timezone, { dateStyle: 'short' })}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

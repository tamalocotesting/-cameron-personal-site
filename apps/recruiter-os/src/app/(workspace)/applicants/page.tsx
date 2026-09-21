import Link from 'next/link';
import { Search } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, Select } from '@/components/ui';
import { requireStaffContext, applicantScopeWhere } from '@/server/context';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { formatInZone } from '@/lib/time';
import { maskContact } from '@/lib/redact';
import { AddApplicantDialog } from '@/components/app/AddApplicantDialog';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function ApplicantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return typeof value === 'string' && value.length ? value : undefined;
  };

  const page = Math.max(1, Number(pick('page') ?? '1') || 1);
  const search = pick('q');
  const status = pick('status');

  // Scope first, then filters. The same fragment limits the count, so the
  // pagination total cannot leak the existence of cases you cannot see.
  const scope = await applicantScopeWhere(ctx);
  const where = {
    ...scope,
    ...(status ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { reference: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total, owners] = await Promise.all([
    prisma.applicant.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        owner: { select: { displayName: true } },
        contactPoints: { where: { isPrimary: true }, take: 1 },
        _count: { select: { tasks: true } },
      },
    }),
    prisma.applicant.count({ where }),
    prisma.member.findMany({
      where: { organizationId: ctx.member.organizationId, active: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Applicants</h1>
          <p className="text-[13px] text-ink-faint">
            {total} case{total === 1 ? '' : 's'} you are authorized to see.
          </p>
        </div>
        <AddApplicantDialog members={owners} defaultTimezone={ctx.timezone} />
      </div>

      <Card>
        <CardHeader title="Search and filter" />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[12px] font-medium text-ink">Search</span>
              <span className="relative block">
                <Search
                  size={14}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <Input name="q" defaultValue={search ?? ''} className="pl-8" placeholder="Name or reference" />
              </span>
            </label>
            <label>
              <span className="mb-1 block text-[12px] font-medium text-ink">Status</span>
              <Select name="status" defaultValue={status ?? ''}>
                <option value="">Any status</option>
                {[
                  'NEW_INQUIRY',
                  'INTAKE_IN_PROGRESS',
                  'READY_FOR_RECRUITER',
                  'CONTACT_ATTEMPTED',
                  'TWO_WAY_CONVERSATION',
                  'APPOINTMENT_SCHEDULED',
                  'AWAITING_APPLICANT',
                  'CLOSED',
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </label>
            <button
              type="submit"
              className="touch-target rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium"
            >
              Apply
            </button>
          </form>
        </CardBody>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <CardBody>
            <EmptyState
              title="No cases match"
              description="Adjust the filters, or add an applicant to create the first case."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <caption className="sr-only">Applicant cases you are authorized to see</caption>
              <thead className="border-b border-line bg-surface-muted">
                <tr className="text-[12px] uppercase tracking-wide text-ink-faint">
                  <th scope="col" className="px-4 py-2 font-semibold">Case</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Owner</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Primary contact</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-2">
                      <Link
                        href={`/applicants/${row.id}`}
                        className="text-[13.5px] font-medium text-accent underline underline-offset-2"
                      >
                        {row.displayName}
                      </Link>
                      <p className="font-mono text-[11.5px] text-ink-faint">{row.reference}</p>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={row.status === 'CLOSED' ? 'neutral' : 'accent'}>
                        {row.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-[13px] text-ink">{row.owner?.displayName ?? '—'}</td>
                    <td className="px-4 py-2 text-[13px] text-ink">
                      {/* Masked in list views on purpose: full contact details
                          belong on the case file, not in a browsable table. */}
                      {row.contactPoints[0] ? maskContact(row.contactPoints[0].value) : '—'}
                    </td>
                    <td className="px-4 py-2 text-[12.5px] text-ink-faint">
                      {formatInZone(row.updatedAt, ctx.timezone, { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <CardBody className="flex items-center justify-between border-t border-line">
            <span className="text-[12px] text-ink-faint">
              Page {page} of {pageCount}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={`/applicants?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(status ? { status } : {}), page: String(page - 1) })}`}
                  className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                >
                  Previous
                </Link>
              ) : null}
              {page < pageCount ? (
                <Link
                  href={`/applicants?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(status ? { status } : {}), page: String(page + 1) })}`}
                  className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                >
                  Next
                </Link>
              ) : null}
            </span>
          </CardBody>
        ) : null}
      </Card>

      <p className="text-[12px] text-ink-faint">Times shown in {ctx.timezone}. Now: {formatInZone(now(), ctx.timezone)}.</p>
    </div>
  );
}

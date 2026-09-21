import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { listAuditHistory } from '@/server/services/settings';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const params = await searchParams;
  const page = Number(typeof params.page === 'string' ? params.page : '1') || 1;
  const category = params.category === 'SECURITY' || params.category === 'OPERATIONAL' ? params.category : undefined;

  const result = await listAuditHistory(ctx.member.organizationId, { page, pageSize: 50, category });
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        Two streams share this table. <strong className="font-semibold">Security</strong> covers
        sensitive reads, exports, grants, settings and integrations;{' '}
        <strong className="font-semibold">operational</strong> is ordinary workflow activity. Metadata is
        redacted on the way in: rows say which fields moved, never what an applicant said.
        Append-only through the application is <em>not</em> tamper-proof against a database
        administrator — see SECURITY.md.
      </Notice>

      <Card>
        <CardHeader
          title={`${result.total} event${result.total === 1 ? '' : 's'}`}
          actions={
            <div className="flex gap-1.5">
              {[
                ['', 'All'],
                ['SECURITY', 'Security'],
                ['OPERATIONAL', 'Operational'],
              ].map(([value, label]) => (
                <Link
                  key={label}
                  href={value ? `/settings/audit?category=${value}` : '/settings/audit'}
                  className={
                    (category ?? '') === value
                      ? 'touch-target rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[13px] text-white'
                      : 'touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]'
                  }
                >
                  {label}
                </Link>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left">
            <caption className="sr-only">Audit history</caption>
            <thead className="border-b border-line bg-surface-muted text-[12px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">When</th>
                <th scope="col" className="px-4 py-2 font-semibold">Action</th>
                <th scope="col" className="px-4 py-2 font-semibold">Actor</th>
                <th scope="col" className="px-4 py-2 font-semibold">Subject</th>
                <th scope="col" className="px-4 py-2 font-semibold">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-[12.5px] text-ink-faint">
                    {formatInZone(row.occurredAt, ctx.timezone, { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td className="px-4 py-2 text-[13px] text-ink">
                    {row.action}
                    {row.category === 'SECURITY' ? (
                      <Badge tone="accent" className="ml-1.5">
                        security
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-[12.5px] text-ink-faint">{row.actorLabel ?? row.actorKind}</td>
                  <td className="px-4 py-2 text-[12.5px] text-ink-faint">
                    {row.subjectType}
                    {row.applicantId ? (
                      <>
                        {' · '}
                        <Link
                          href={`/applicants/${row.applicantId}`}
                          className="text-accent underline underline-offset-2"
                        >
                          case
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11.5px] text-ink-faint">
                    {JSON.stringify(row.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
          <CardBody className="flex items-center justify-between border-t border-line">
            <span className="text-[12px] text-ink-faint">
              Page {result.page} of {pageCount}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={`/settings/audit?page=${page - 1}${category ? `&category=${category}` : ''}`}
                  className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                >
                  Previous
                </Link>
              ) : null}
              {page < pageCount ? (
                <Link
                  href={`/settings/audit?page=${page + 1}${category ? `&category=${category}` : ''}`}
                  className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                >
                  Next
                </Link>
              ) : null}
            </span>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

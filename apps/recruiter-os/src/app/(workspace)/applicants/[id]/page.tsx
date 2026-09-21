import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireStaffContext } from '@/server/context';
import { loadCaseFile } from '@/server/services/case-view';
import { CaseFile, type CaseView } from '@/components/app/case/CaseFile';
import { now } from '@/server/clock';
import { NotFoundError } from '@/server/authz/errors';
import { HandoffPanel } from '@/components/app/HandoffPanel';

export const dynamic = 'force-dynamic';

const VIEW_KEYS: CaseView[] = ['overview', 'conversation', 'intake', 'notes', 'tasks', 'activity'];

export default async function ApplicantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const { id } = await params;
  const query = await searchParams;
  const requested = typeof query.view === 'string' ? (query.view as CaseView) : 'overview';
  const view = VIEW_KEYS.includes(requested) ? requested : 'overview';

  let data;
  try {
    data = await loadCaseFile(ctx, id);
  } catch (error) {
    // An unauthorized case and a missing case look the same from outside.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="space-y-3">
      <Link
        href="/today"
        className="inline-flex items-center gap-1.5 text-[13px] text-accent underline underline-offset-2"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to Today
      </Link>

      <CaseFile
        data={data}
        view={view}
        timezone={ctx.timezone}
        basePath={`/applicants/${id}`}
        nowInstant={now()}
      />

      {data.access.content ? (
        <HandoffPanel
          applicantId={id}
          handoffs={data.handoffs.map((h) => ({
            id: h.id,
            state: h.state,
            packageVersion: h.packageVersion,
            createdAt: h.createdAt.toISOString(),
            transportDetail: h.transportDetail,
            externalReferenceId: h.externalReferenceId,
          }))}
          canExport={data.access.act}
        />
      ) : null}
    </div>
  );
}

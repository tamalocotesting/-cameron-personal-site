import Link from 'next/link';
import { ExternalLink, Inbox, UserPlus, Wrench } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, EmptyState, LinkButton, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { loadQueue, loadQueueCounts, type QueueFilter } from '@/server/services/queue';
import { loadCaseFile } from '@/server/services/case-view';
import { CaseFile, type CaseView } from '@/components/app/case/CaseFile';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { demoToolsEnabled } from '@/env';
import { AddApplicantDialog } from '@/components/app/AddApplicantDialog';
import { isAppError } from '@/server/authz/errors';

export const dynamic = 'force-dynamic';

const FILTER_KEYS: QueueFilter[] = [
  'my_queue',
  'team_queue',
  'due_today',
  'overdue',
  'review_requested',
  'awaiting_applicant',
  'upcoming',
];

const VIEW_KEYS: CaseView[] = ['overview', 'conversation', 'intake', 'notes', 'tasks', 'activity'];

export default async function TodayPage({
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

  const filter = (FILTER_KEYS.includes(pick('filter') as QueueFilter) ? pick('filter') : 'my_queue') as QueueFilter;
  const view = (VIEW_KEYS.includes(pick('view') as CaseView) ? pick('view') : 'overview') as CaseView;
  const channel = (['SMS', 'PHONE_CALL', 'EMAIL'] as const).find((c) => c === pick('channel')) ?? null;

  const [page, counts, owners] = await Promise.all([
    loadQueue(ctx, {
      filter,
      search: pick('q'),
      ownerMemberId: pick('owner') ?? null,
      channel,
      page: Number(pick('page') ?? '1') || 1,
    }),
    loadQueueCounts(ctx),
    prisma.member.findMany({
      where: { organizationId: ctx.member.organizationId, active: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
  ]);

  const selectedId = pick('case') ?? page.rows[0]?.applicantId ?? null;

  // A case the URL names but this member may not see resolves to "not found",
  // which is also what an unauthorized read returns.
  let caseData = null;
  let caseError: string | null = null;
  if (selectedId) {
    try {
      caseData = await loadCaseFile(ctx, selectedId);
    } catch (error) {
      caseError = isAppError(error) ? error.message : 'That case could not be opened.';
    }
  }

  const searchRecord: Record<string, string | undefined> = {
    filter,
    q: pick('q'),
    owner: pick('owner'),
    channel: pick('channel'),
    page: pick('page'),
    case: selectedId ?? undefined,
    view,
  };

  const { QueuePanel } = await import('@/components/app/QueuePanel');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Today</h1>
          <p className="text-[13px] text-ink-faint">
            Who needs attention, what happened, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddApplicantDialog members={owners} defaultTimezone={ctx.timezone} />
          {demoToolsEnabled ? (
            <>
              <LinkButton href={`/intake/${ctx.organization.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" /> Open intake preview
              </LinkButton>
              <LinkButton href="/demo-console">
                <Wrench size={14} aria-hidden="true" /> Demo event console
              </LinkButton>
            </>
          ) : null}
        </div>
      </div>

      {demoToolsEnabled ? (
        <Notice tone="pending">
          Intake preview submissions land in this demo organization only. Nothing leaves the demo
          dataset, and no message reaches a real phone.
        </Notice>
      ) : null}

      {/* Desktop: a queue panel beside a larger case panel.
          Mobile: the queue, then the case, as separate stacked sections with
          the selection and filters preserved in the URL. */}
      <div className="grid min-h-0 items-start gap-3 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-3 lg:max-h-[calc(100dvh-7rem)]">
          <QueuePanel
            page={page}
            counts={counts}
            selectedApplicantId={selectedId}
            owners={owners}
            searchParams={searchRecord}
            basePath="/today"
          />
        </div>

        <div className="min-w-0" id="case-panel">
          {caseData ? (
            <CaseFile
              data={caseData}
              view={view}
              timezone={ctx.timezone}
              basePath={`/today?${new URLSearchParams(
                Object.entries(searchRecord).filter(([k, v]) => Boolean(v) && k !== 'view') as [string, string][],
              ).toString()}`}
              nowInstant={now()}
            />
          ) : caseError ? (
            <Card>
              <CardHeader title="Case not available" />
              <CardBody>
                <Notice tone="review">{caseError}</Notice>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<Inbox size={22} />}
                  title="Nothing selected"
                  description="Pick a case from the queue, or add an applicant to start one."
                  action={
                    <Link href="/applicants" className="text-[13px] text-accent underline underline-offset-2">
                      Browse all applicants
                    </Link>
                  }
                />
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {page.total} cases in the {filter.replace('_', ' ')} view.
      </p>

      <noscript>
        <Notice tone="neutral">
          <UserPlus size={14} aria-hidden="true" /> Navigation and filters work without JavaScript;
          dialog-based actions need it.
        </Notice>
      </noscript>

      <Button className="sr-only" aria-hidden="true" tabIndex={-1}>
        hidden
      </Button>
    </div>
  );
}

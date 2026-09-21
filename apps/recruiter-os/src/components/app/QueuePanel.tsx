import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Info,
  MessageSquare,
  PhoneIncoming,
  Search,
} from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, Notice, Select } from '@/components/ui';
import { formatInZone, relativeLabel, zoneAbbreviation } from '@/lib/time';
import { explainCategory, QUEUE_CATEGORIES, type QueueFilter, type QueuePage } from '@/server/services/queue';
import { cn } from '@/lib/utils';

/**
 * Today's Priority Queue.
 *
 * Each row states its reasons in words. The grouping header explains the rule
 * that put the row there, so the order is inspectable rather than magical.
 */

const FILTERS: Array<{ key: QueueFilter; label: string }> = [
  { key: 'my_queue', label: 'My queue' },
  { key: 'team_queue', label: 'Team queue' },
  { key: 'due_today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'review_requested', label: 'Review requested' },
  { key: 'awaiting_applicant', label: 'Awaiting applicant' },
  { key: 'upcoming', label: 'Upcoming' },
];

const REASON_ICON: Record<string, React.ReactNode> = {
  'Human review requested': <AlertTriangle size={12} />,
  'Follow-up overdue': <Clock size={12} />,
  'Callback requested': <PhoneIncoming size={12} />,
  'New reply': <MessageSquare size={12} />,
};

function reasonTone(reason: string) {
  if (reason === 'Human review requested') return 'review' as const;
  if (reason === 'Follow-up overdue') return 'review' as const;
  if (reason === 'Callback requested') return 'ready' as const;
  if (reason === 'New reply') return 'accent' as const;
  return 'pending' as const;
}

export function QueuePanel({
  page,
  counts,
  selectedApplicantId,
  owners,
  searchParams,
  basePath,
}: {
  page: QueuePage;
  counts: Record<QueueFilter, number>;
  selectedApplicantId: string | null;
  owners: Array<{ id: string; displayName: string }>;
  searchParams: Record<string, string | undefined>;
  basePath: string;
}) {
  const buildHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...searchParams, ...overrides })) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };


  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader
        title="Today’s priority queue"
        description={`${page.total} case${page.total === 1 ? '' : 's'} · times shown in ${page.timezone} (${zoneAbbreviation(page.generatedAt, page.timezone)})`}
        actions={
          <span className="text-[12px] text-ink-faint">
            Refreshed {relativeLabel(page.generatedAt, new Date())}
          </span>
        }
      />

      <CardBody className="space-y-2 border-b border-line">
        {/* Filters are links so the state is in the URL: shareable, bookmarkable,
            and preserved when you come back from a case. */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Queue filters">
          {FILTERS.map((filter) => {
            const active = page.filter === filter.key;
            return (
              <Link
                key={filter.key}
                href={buildHref({ filter: filter.key, page: undefined })}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'touch-target inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px]',
                  active
                    ? 'border-accent bg-accent text-white'
                    : 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
                )}
              >
                {filter.label}
                {/* Full-strength white: a translucent count on the accent
                    background does not clear the contrast threshold. */}
                <span className={active ? 'text-white' : 'text-ink-faint'}>{counts[filter.key]}</span>
              </Link>
            );
          })}
        </div>

        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="filter" value={page.filter} />
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[12px] font-medium text-ink">Search</span>
            <span className="relative block">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Input
                name="q"
                defaultValue={searchParams.q ?? ''}
                placeholder="Name or case reference"
                className="pl-8"
                aria-label="Search cases by name or reference"
              />
            </span>
          </label>
          <label>
            <span className="mb-1 block text-[12px] font-medium text-ink">Owner</span>
            <Select name="owner" defaultValue={searchParams.owner ?? ''} aria-label="Filter by owner">
              <option value="">Anyone</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.displayName}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="mb-1 block text-[12px] font-medium text-ink">Channel</span>
            <Select name="channel" defaultValue={searchParams.channel ?? ''} aria-label="Filter by channel">
              <option value="">Any</option>
              <option value="SMS">Text</option>
              <option value="PHONE_CALL">Phone</option>
              <option value="EMAIL">Email</option>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {page.rows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={20} />}
            title="Nothing waiting in this view"
            description="Try another filter. Every active case keeps an owner and a dated next step, so nothing disappears — it may simply be scheduled for later."
          />
        ) : (
          <ul className="divide-y divide-line">
            {page.rows.map((row, index) => {
              // The rows arrive grouped by category, so a header belongs
              // wherever the rank changes from the row before it.
              const showHeader = row.categoryRank !== page.rows[index - 1]?.categoryRank;
              const category = QUEUE_CATEGORIES.find((c) => c.rank === row.categoryRank);
              const selected = row.applicantId === selectedApplicantId;

              return (
                <li key={row.applicantId}>
                  {showHeader && category ? (
                    <div className="border-b border-line bg-surface-muted px-4 py-1.5">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                        {category.label}
                      </p>
                      <p className="mt-0.5 flex items-start gap-1 text-[11.5px] text-ink-faint">
                        <Info size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {explainCategory(category.key)}
                      </p>
                    </div>
                  ) : null}

                  <Link
                    href={buildHref({ case: row.applicantId, view: undefined })}
                    data-testid="queue-row"
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'block px-4 py-2.5 hover:bg-surface-muted',
                      selected && 'border-l-[3px] border-accent bg-accent-soft/50 pl-[13px]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-ink">{row.displayName}</p>
                        <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-faint">
                          {row.reference} · {row.ownerName ?? 'no owner'}
                        </p>
                      </div>
                      <ArrowRight size={14} aria-hidden="true" className="mt-1 shrink-0 text-ink-faint" />
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.reasons.map((reason) => (
                        <Badge key={reason} tone={reasonTone(reason)} icon={REASON_ICON[reason]}>
                          {reason}
                        </Badge>
                      ))}
                      {row.simulatedTraffic ? (
                        <Badge tone="pending" icon={<Bot size={12} />}>
                          simulated traffic
                        </Badge>
                      ) : null}
                    </div>

                    <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]">
                      <div>
                        <dt className="inline text-ink-faint">Next: </dt>
                        <dd className="inline text-ink">
                          {row.nextActionTitle ?? 'needs a next step'}
                          {row.nextDueAt ? (
                            <span className={row.overdue ? 'font-semibold text-review' : 'text-ink-faint'}>
                              {' '}
                              ({relativeLabel(row.nextDueAt, page.generatedAt)})
                            </span>
                          ) : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-faint">Last: </dt>
                        <dd className="inline text-ink">
                          {row.lastInteractionAt
                            ? `${formatInZone(row.lastInteractionAt, page.timezone, { dateStyle: 'short', timeStyle: 'short' })}`
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {page.total > page.pageSize ? (
        <CardBody className="flex items-center justify-between border-t border-line">
          <span className="text-[12px] text-ink-faint">
            Page {page.page} of {Math.ceil(page.total / page.pageSize)}
          </span>
          <span className="flex gap-2">
            {page.page > 1 ? (
              <Link
                href={buildHref({ page: String(page.page - 1) })}
                className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
              >
                Previous
              </Link>
            ) : null}
            {page.page * page.pageSize < page.total ? (
              <Link
                href={buildHref({ page: String(page.page + 1) })}
                className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
              >
                Next
              </Link>
            ) : null}
          </span>
        </CardBody>
      ) : null}

      {page.filter === 'team_queue' ? (
        <CardBody className="border-t border-line">
          <Notice tone="neutral" icon={<Info size={14} />}>
            The team queue shows only cases you are authorized to see. A manager sees operational
            metadata by role; reading conversations needs a separate grant.
          </Notice>
        </CardBody>
      ) : null}
    </Card>
  );
}

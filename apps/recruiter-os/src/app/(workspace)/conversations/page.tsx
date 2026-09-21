import Link from 'next/link';
import { Bot, MessageSquare } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, Select } from '@/components/ui';
import { requireStaffContext, applicantScopeWhere } from '@/server/context';
import { prisma } from '@/server/db';
import { formatInZone } from '@/lib/time';
import { truncate } from '@/lib/utils';
import { GrantType } from '@prisma/client';
import { hasOrgGrant } from '@/server/authz/policy';

export const dynamic = 'force-dynamic';

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaffContext();
  const params = await searchParams;
  const state = typeof params.state === 'string' ? params.state : '';

  const scope = await applicantScopeWhere(ctx);
  const scopedCases = await prisma.applicant.findMany({ where: scope, select: { id: true } });
  const ids = scopedCases.map((c) => c.id);

  // A manager with metadata-only rights sees that conversations exist and
  // when, but not what they say.
  const canReadContent =
    ctx.member.staffRole === 'RECRUITER' ||
    (await hasOrgGrant(ctx, GrantType.CASE_CONTENT)) ||
    (await hasOrgGrant(ctx, GrantType.TEAM_CONVERSATION_CONTENT));

  const conversations = ids.length
    ? await prisma.conversation.findMany({
        where: { organizationId: ctx.member.organizationId, applicantId: { in: ids } },
        orderBy: { lastEventAt: 'desc' },
        take: 60,
        include: {
          applicant: { select: { id: true, displayName: true, reference: true, ownerMemberId: true } },
          messages: {
            orderBy: { occurredAt: 'desc' },
            take: 1,
            select: { body: true, direction: true, state: true, simulated: true, occurredAt: true },
          },
        },
      })
    : [];

  const filtered = state ? conversations.filter((c) => c.messages[0]?.state === state) : conversations;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[17px] font-semibold text-ink">Conversations</h1>
        <p className="text-[13px] text-ink-faint">
          Threads across every case you are authorized to see, newest activity first.
        </p>
      </div>

      {!canReadContent ? (
        <Notice tone="neutral">
          Your role gives you operational metadata for these conversations. Reading the messages needs a
          case-content or team-conversation grant.
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title={`${filtered.length} thread${filtered.length === 1 ? '' : 's'}`}
          actions={
            <form method="get">
              <label className="flex items-center gap-2 text-[12px]">
                <span className="text-ink-faint">Last message state</span>
                <Select name="state" defaultValue={state} aria-label="Filter by last message state">
                  <option value="">Any</option>
                  {['RECEIVED', 'DRAFT', 'APPROVED', 'SCHEDULED', 'QUEUED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'BLOCKED', 'OUTCOME_UNKNOWN'].map(
                    (value) => (
                      <option key={value} value={value}>
                        {value.replace(/_/g, ' ').toLowerCase()}
                      </option>
                    ),
                  )}
                </Select>
                <button
                  type="submit"
                  className="touch-target rounded-md border border-line-strong bg-surface px-2.5 py-1.5"
                >
                  Apply
                </button>
              </label>
            </form>
          }
        />
        <CardBody className="space-y-2">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={20} />}
              title="No threads yet"
              description="A thread appears when an applicant writes in, or when a recruiter sends something."
            />
          ) : null}
          {filtered.map((conversation) => {
            const last = conversation.messages[0];
            return (
              <Link
                key={conversation.id}
                href={`/applicants/${conversation.applicant.id}?view=conversation`}
                className="block rounded-md border border-line px-3 py-2 hover:bg-surface-muted"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium text-ink">{conversation.applicant.displayName}</span>
                  <span className="font-mono text-[11.5px] text-ink-faint">{conversation.applicant.reference}</span>
                  <Badge tone="neutral">{conversation.channel.toLowerCase()}</Badge>
                  {last ? <Badge tone={last.direction === 'INBOUND' ? 'accent' : 'neutral'}>{last.state.replace(/_/g, ' ').toLowerCase()}</Badge> : null}
                  {last?.simulated ? (
                    <Badge tone="pending" icon={<Bot size={12} />}>
                      simulated
                    </Badge>
                  ) : null}
                  <span className="ml-auto text-[12px] text-ink-faint">
                    {formatInZone(conversation.lastEventAt, ctx.timezone, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {canReadContent && last
                    ? truncate(last.body.replace(/\s+/g, ' '), 160)
                    : 'Message content is not shown for your access level.'}
                </p>
              </Link>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}

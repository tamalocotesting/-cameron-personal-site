import 'server-only';
import { Prisma, CaseStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { authorizedOwnerScope, type StaffContext } from '@/server/authz/policy';
import { endOfLocalDay, startOfLocalDay } from '@/lib/time';

/**
 * Today's Priority Queue.
 *
 * The ordering is DETERMINISTIC and derived only from workflow events. There
 * is no hidden applicant-quality score, no "seriousness", no predicted
 * suitability, and nothing about the person enters the sort. Every row can
 * explain, in words, why it is where it is.
 *
 * Categories, in order:
 *   1. HUMAN HANDOFF          an open human-requested or sensitive-topic flag
 *   2. OVERDUE PROMISE        an open task past the date we promised
 *   3. CALLBACK WINDOW OPEN   an open callback task whose window is now
 *   4. NEW INQUIRY WAITING    no human has reached out on this episode yet
 *   5. DUE WORK               everything else with an open commitment
 *   6. WAITING / LATER        dated waiting states and future work
 *
 * Within a category: due time ascending, then the oldest waiting event, then
 * the case reference as a stable tie-breaker. Ranking and pagination happen in
 * SQL over indexed columns; nothing is filtered in application memory.
 */

export const QUEUE_CATEGORIES = [
  { rank: 1, key: 'human_handoff', label: 'Human review requested', tone: 'review' },
  { rank: 2, key: 'overdue_promise', label: 'Overdue promised action', tone: 'review' },
  { rank: 3, key: 'callback_window', label: 'Callback window open', tone: 'ready' },
  { rank: 4, key: 'new_inquiry', label: 'New inquiry awaiting a recruiter', tone: 'ready' },
  { rank: 5, key: 'due_work', label: 'Due work', tone: 'pending' },
  { rank: 6, key: 'waiting', label: 'Waiting / upcoming', tone: 'pending' },
] as const;

export type QueueCategoryKey = (typeof QUEUE_CATEGORIES)[number]['key'];

export type QueueFilter =
  | 'my_queue'
  | 'team_queue'
  | 'due_today'
  | 'overdue'
  | 'review_requested'
  | 'awaiting_applicant'
  | 'upcoming';

export type QueueRow = {
  applicantId: string;
  reference: string;
  displayName: string;
  status: CaseStatus;
  ownerMemberId: string | null;
  ownerName: string | null;
  teamId: string | null;
  categoryRank: number;
  categoryKey: QueueCategoryKey;
  /** Transparent attention reasons, shown verbatim in the UI. */
  reasons: string[];
  nextActionTitle: string | null;
  nextDueAt: Date | null;
  lastInteractionAt: Date | null;
  lastInteractionKind: string | null;
  openTaskCount: number;
  handoffFlag: boolean;
  overdue: boolean;
  unansweredReply: boolean;
  simulatedTraffic: boolean;
};

export type QueuePage = {
  rows: QueueRow[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: Date;
  timezone: string;
  filter: QueueFilter;
};

type RawRow = {
  id: string;
  reference: string;
  displayName: string;
  status: CaseStatus;
  ownerMemberId: string | null;
  ownerName: string | null;
  teamId: string | null;
  category_rank: number;
  next_due: Date | null;
  next_title: string | null;
  open_tasks: bigint;
  handoff_flag: boolean;
  overdue: boolean;
  oldest_waiting: Date | null;
  last_interaction: Date | null;
  last_interaction_kind: string | null;
  unanswered_reply: boolean;
  has_callback_now: boolean;
  simulated: boolean;
  total_count: bigint;
};

async function scopePredicate(ctx: StaffContext, filter: QueueFilter): Promise<Prisma.Sql> {
  const scope = await authorizedOwnerScope(ctx);

  // "My queue" is always exactly what this member is accountable for.
  if (filter === 'my_queue') {
    return Prisma.sql`a."ownerMemberId" = ${ctx.member.id}`;
  }

  if (scope.wholeOrganization) return Prisma.sql`TRUE`;

  const clauses: Prisma.Sql[] = [
    Prisma.sql`a."ownerMemberId" IN (${Prisma.join(scope.ownerMemberIds.length ? scope.ownerMemberIds : ['-'])})`,
  ];
  if (scope.teamIds.length) {
    clauses.push(Prisma.sql`a."teamId" IN (${Prisma.join(scope.teamIds)})`);
  }
  if (scope.applicantIds.length) {
    clauses.push(Prisma.sql`a."id" IN (${Prisma.join(scope.applicantIds)})`);
  }
  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`;
}

function filterPredicate(filter: QueueFilter, at: Date, dayStart: Date, dayEnd: Date): Prisma.Sql {
  switch (filter) {
    case 'overdue':
      return Prisma.sql`t.overdue IS TRUE`;
    case 'due_today':
      return Prisma.sql`t.next_due >= ${dayStart} AND t.next_due < ${dayEnd}`;
    case 'review_requested':
      return Prisma.sql`f.handoff IS TRUE`;
    case 'awaiting_applicant':
      return Prisma.sql`a."status" = 'AWAITING_APPLICANT'`;
    case 'upcoming':
      return Prisma.sql`t.next_due > ${dayEnd}`;
    case 'my_queue':
    case 'team_queue':
    default:
      void at;
      return Prisma.sql`TRUE`;
  }
}

export async function loadQueue(
  ctx: StaffContext,
  options: {
    filter?: QueueFilter;
    search?: string;
    ownerMemberId?: string | null;
    channel?: 'SMS' | 'PHONE_CALL' | 'EMAIL' | null;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<QueuePage> {
  const at = now();
  const filter = options.filter ?? 'my_queue';
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, options.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const timezone = ctx.timezone;
  const dayStart = startOfLocalDay(at, timezone);
  const dayEnd = endOfLocalDay(at, timezone);

  const scope = await scopePredicate(ctx, filter);
  const extra = filterPredicate(filter, at, dayStart, dayEnd);

  const search = (options.search ?? '').trim();
  const searchClause = search
    ? Prisma.sql`AND (a."displayName" ILIKE ${`%${search}%`} OR a."reference" ILIKE ${`%${search}%`})`
    : Prisma.empty;
  const ownerClause = options.ownerMemberId
    ? Prisma.sql`AND a."ownerMemberId" = ${options.ownerMemberId}`
    : Prisma.empty;
  const channelClause = options.channel
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "contact_point" cp
        WHERE cp."organizationId" = a."organizationId" AND cp."applicantId" = a."id"
          AND cp."channel" = ${options.channel}::"ContactChannel")`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    WITH flags AS (
      SELECT rf."applicantId",
             bool_or(rf."kind" IN ('HUMAN_REQUESTED','SENSITIVE_QUESTION')) AS handoff,
             min(rf."raisedAt") AS oldest_flag
      FROM "review_flag" rf
      WHERE rf."organizationId" = ${ctx.member.organizationId} AND rf."status" = 'OPEN'
      GROUP BY rf."applicantId"
    ),
    tasks AS (
      SELECT tk."applicantId",
             count(*) AS open_tasks,
             min(tk."dueAt") AS next_due,
             bool_or(tk."originalDueAt" < ${at}) AS overdue,
             -- Category 2 is "an overdue PROMISE". A callback that has simply
             -- come due gets its own category below, because the database
             -- guarantees originalDueAt <= dueAt and a callback would
             -- otherwise always read as a broken promise the moment its
             -- window opened.
             bool_or(tk."originalDueAt" < ${at} AND tk."type" <> 'CALLBACK') AS overdue_promise,
             bool_or(tk."type" = 'CALLBACK' AND tk."dueAt" <= ${at}) AS has_callback_now,
             min(tk."createdAt") AS oldest_task
      FROM "task" tk
      WHERE tk."organizationId" = ${ctx.member.organizationId} AND tk."status" IN ('OPEN','SNOOZED')
      GROUP BY tk."applicantId"
    ),
    next_task AS (
      SELECT DISTINCT ON (tk."applicantId") tk."applicantId", tk."title", tk."dueAt"
      FROM "task" tk
      WHERE tk."organizationId" = ${ctx.member.organizationId} AND tk."status" IN ('OPEN','SNOOZED')
      ORDER BY tk."applicantId", tk."dueAt" ASC, tk."id" ASC
    ),
    last_msg AS (
      SELECT DISTINCT ON (m."applicantId") m."applicantId", m."occurredAt", m."direction", m."simulated"
      FROM "message" m
      WHERE m."organizationId" = ${ctx.member.organizationId}
      ORDER BY m."applicantId", m."occurredAt" DESC, m."id" DESC
    ),
    last_call AS (
      SELECT DISTINCT ON (c."applicantId") c."applicantId", c."occurredAt", c."outcome"
      FROM "call_event" c
      WHERE c."organizationId" = ${ctx.member.organizationId} AND c."applicantId" IS NOT NULL
      ORDER BY c."applicantId", c."occurredAt" DESC, c."id" DESC
    ),
    episode AS (
      SELECT DISTINCT ON (e."applicantId") e."applicantId", e."openedAt", e."firstHumanOutreachAt"
      FROM "inquiry_episode" e
      WHERE e."organizationId" = ${ctx.member.organizationId} AND e."supersededAt" IS NULL
      ORDER BY e."applicantId", e."openedAt" DESC
    ),
    base AS (
      SELECT
        a."id",
        a."reference",
        a."displayName",
        a."status",
        a."ownerMemberId",
        mem."displayName" AS "ownerName",
        a."teamId",
        CASE
          WHEN COALESCE(f.handoff, FALSE) THEN 1
          WHEN COALESCE(t.overdue_promise, FALSE) THEN 2
          WHEN COALESCE(t.has_callback_now, FALSE) THEN 3
          WHEN ep."firstHumanOutreachAt" IS NULL
               AND a."status" IN ('NEW_INQUIRY','INTAKE_IN_PROGRESS','READY_FOR_RECRUITER') THEN 4
          WHEN t.next_due IS NOT NULL AND t.next_due < ${dayEnd} THEN 5
          ELSE 6
        END AS category_rank,
        t.next_due,
        nt."title" AS next_title,
        COALESCE(t.open_tasks, 0) AS open_tasks,
        COALESCE(f.handoff, FALSE) AS handoff_flag,
        COALESCE(t.overdue, FALSE) AS overdue,
        COALESCE(f.oldest_flag, t.oldest_task, ep."openedAt", a."createdAt") AS oldest_waiting,
        GREATEST(COALESCE(lm."occurredAt", a."createdAt"), COALESCE(lc."occurredAt", a."createdAt")) AS last_interaction,
        CASE
          WHEN lc."occurredAt" IS NOT NULL AND (lm."occurredAt" IS NULL OR lc."occurredAt" > lm."occurredAt")
            THEN 'call:' || lc."outcome"
          WHEN lm."occurredAt" IS NOT NULL THEN 'message:' || lm."direction"
          ELSE 'created'
        END AS last_interaction_kind,
        (lm."direction" = 'INBOUND') AS unanswered_reply,
        COALESCE(t.has_callback_now, FALSE) AS has_callback_now,
        COALESCE(lm."simulated", FALSE) AS simulated
      FROM "applicant" a
      LEFT JOIN "member" mem ON mem."organizationId" = a."organizationId" AND mem."id" = a."ownerMemberId"
      LEFT JOIN flags f ON f."applicantId" = a."id"
      LEFT JOIN tasks t ON t."applicantId" = a."id"
      LEFT JOIN next_task nt ON nt."applicantId" = a."id"
      LEFT JOIN last_msg lm ON lm."applicantId" = a."id"
      LEFT JOIN last_call lc ON lc."applicantId" = a."id"
      LEFT JOIN episode ep ON ep."applicantId" = a."id"
      WHERE a."organizationId" = ${ctx.member.organizationId}
        AND a."mergedIntoApplicantId" IS NULL
        AND a."status" <> 'CLOSED'
        AND ${scope}
        AND ${extra}
        ${searchClause}
        ${ownerClause}
        ${channelClause}
    )
    SELECT base.*, count(*) OVER () AS total_count
    FROM base
    ORDER BY
      base.category_rank ASC,
      base.next_due ASC NULLS LAST,
      base.oldest_waiting ASC,
      base."reference" ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  /**
   * `count(*) OVER ()` gives the total for free, but only when the page
   * actually returned a row. A page past the end would otherwise report a
   * total of zero and make the pager disagree with itself, so the count is
   * re-read from the first page in that case.
   */
  let total = rows.length ? Number(rows[0]!.total_count) : 0;
  if (!rows.length && page > 1) {
    const firstPage = await loadQueue(ctx, { ...options, page: 1, pageSize });
    total = firstPage.total;
  }

  return {
    rows: rows.map((r) => ({
      applicantId: r.id,
      reference: r.reference,
      displayName: r.displayName,
      status: r.status,
      ownerMemberId: r.ownerMemberId,
      ownerName: r.ownerName,
      teamId: r.teamId,
      categoryRank: r.category_rank,
      categoryKey: (QUEUE_CATEGORIES.find((c) => c.rank === r.category_rank)?.key ?? 'waiting') as QueueCategoryKey,
      reasons: buildReasons(r, at),
      nextActionTitle: r.next_title,
      nextDueAt: r.next_due,
      lastInteractionAt: r.last_interaction,
      lastInteractionKind: r.last_interaction_kind,
      openTaskCount: Number(r.open_tasks),
      handoffFlag: r.handoff_flag,
      overdue: r.overdue,
      unansweredReply: r.unanswered_reply,
      simulatedTraffic: r.simulated,
    })),
    total,
    page,
    pageSize,
    generatedAt: at,
    timezone,
    filter,
  };
}

function buildReasons(row: RawRow, at: Date): string[] {
  const reasons: string[] = [];
  if (row.handoff_flag) reasons.push('Human review requested');
  if (row.overdue) reasons.push('Follow-up overdue');
  if (row.has_callback_now) reasons.push('Callback requested');
  if (row.unanswered_reply) reasons.push('New reply');
  if (row.category_rank === 4) reasons.push('New inquiry — no recruiter outreach yet');
  if (row.status === CaseStatus.AWAITING_APPLICANT) reasons.push('Awaiting applicant');
  if (!reasons.length && row.next_due) {
    reasons.push(row.next_due.getTime() <= at.getTime() ? 'Work is due' : 'Scheduled work');
  }
  if (!reasons.length) reasons.push('No open commitment — needs a next step');
  return reasons;
}

/** Counts for the filter chips. Respects exactly the same scope. */
export async function loadQueueCounts(ctx: StaffContext): Promise<Record<QueueFilter, number>> {
  const filters: QueueFilter[] = [
    'my_queue',
    'team_queue',
    'due_today',
    'overdue',
    'review_requested',
    'awaiting_applicant',
    'upcoming',
  ];
  const entries = await Promise.all(
    filters.map(async (filter) => {
      const page = await loadQueue(ctx, { filter, page: 1, pageSize: 5 });
      return [filter, page.total] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<QueueFilter, number>;
}

/**
 * Why is this case here? Shown in the UI next to the row, so the ordering is
 * never a black box.
 */
export function explainCategory(key: QueueCategoryKey): string {
  switch (key) {
    case 'human_handoff':
      return 'A person asked for a human, or a topic came up that automation must not answer. These come first.';
    case 'overdue_promise':
      return 'An action is past the date it was originally promised. Snoozing does not change that date.';
    case 'callback_window':
      return 'A callback was requested and its window is open now.';
    case 'new_inquiry':
      return 'A new inquiry where no recruiter has reached out yet on this episode.';
    case 'due_work':
      return 'An open commitment due today.';
    case 'waiting':
      return 'A dated waiting state or work scheduled for later. Still reviewed, never forgotten.';
  }
}

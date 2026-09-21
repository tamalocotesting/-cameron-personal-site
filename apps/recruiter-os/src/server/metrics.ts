import 'server-only';
import { MetricEventKind } from '@prisma/client';
import type { DbOrTx } from '@/server/db';
import { now } from '@/server/clock';

/**
 * Reports read persisted metric events, not live aggregates over mutable rows.
 * That is what makes "time to first human outreach" stable when a case is
 * later merged, reassigned or reopened.
 *
 * A metric event carries identifiers and at most one small number. Never
 * applicant content.
 */
export async function recordMetric(
  db: DbOrTx,
  input: {
    organizationId: string;
    kind: MetricEventKind;
    applicantId?: string | null;
    inquiryEpisodeId?: string | null;
    teamId?: string | null;
    memberId?: string | null;
    numericValue?: number | null;
    detail?: string | null;
    occurredAt?: Date;
  },
) {
  return db.metricEvent.create({
    data: {
      organizationId: input.organizationId,
      kind: input.kind,
      applicantId: input.applicantId ?? null,
      inquiryEpisodeId: input.inquiryEpisodeId ?? null,
      teamId: input.teamId ?? null,
      memberId: input.memberId ?? null,
      numericValue: input.numericValue ?? null,
      detail: input.detail ?? null,
      occurredAt: input.occurredAt ?? now(),
    },
  });
}

export { MetricEventKind };

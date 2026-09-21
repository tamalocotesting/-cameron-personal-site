import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Quote } from 'lucide-react';
import { Card, CardBody, CardHeader, DefinitionList, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { resolveCitation } from '@/server/services/briefs';
import { formatInZone } from '@/lib/time';
import { isAppError, NotFoundError } from '@/server/authz/errors';

export const dynamic = 'force-dynamic';

/**
 * The supporting source behind a brief citation.
 *
 * Opening it is authorized in its own right — seeing the brief does not imply
 * permission to read the underlying message, answer or note — and the read is
 * written to the security audit trail.
 */
export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string; refId: string }>;
}) {
  const ctx = await requireStaffContext();
  const { id, refId } = await params;

  let source;
  try {
    source = await resolveCitation(ctx, { sourceRefId: refId });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return (
      <Card>
        <CardHeader title="Source not available" />
        <CardBody>
          <Notice tone="review">
            {isAppError(error) ? error.message : 'That source could not be opened.'}
          </Notice>
        </CardBody>
      </Card>
    );
  }

  if (source.applicantId !== id) notFound();

  const highlightIndex = source.text.toLowerCase().indexOf(source.excerpt.toLowerCase());
  const before = highlightIndex >= 0 ? source.text.slice(0, highlightIndex) : source.text;
  const match = highlightIndex >= 0 ? source.text.slice(highlightIndex, highlightIndex + source.excerpt.length) : '';
  const after = highlightIndex >= 0 ? source.text.slice(highlightIndex + source.excerpt.length) : '';

  return (
    <div className="space-y-3">
      <Link
        href={`/applicants/${id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-accent underline underline-offset-2"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to the case file
      </Link>

      <Card>
        <CardHeader
          title="Supporting source"
          description="The exact record a brief line was drawn from."
        />
        <CardBody className="space-y-3">
          <DefinitionList
            items={[
              { label: 'Kind', value: source.kind.replace('_', ' ').toLowerCase() },
              { label: 'Label', value: source.label },
              { label: 'Recorded', value: formatInZone(source.occurredAt, ctx.timezone) },
            ]}
          />
          <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              <Quote size={12} aria-hidden="true" /> Stored text
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-ink">
              {highlightIndex >= 0 ? (
                <>
                  {before}
                  <mark className="rounded bg-pending-soft px-0.5 font-medium">{match}</mark>
                  {after}
                </>
              ) : (
                source.text
              )}
            </p>
          </div>
          {highlightIndex < 0 ? (
            <Notice tone="review">
              The cited excerpt does not appear in the stored text. That citation should not have been
              saved — report it.
            </Notice>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

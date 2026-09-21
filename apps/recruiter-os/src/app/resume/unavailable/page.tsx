import { Card, CardBody, CardHeader, Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

const REASONS: Record<string, string> = {
  expired: 'That link has expired. Links last 72 hours.',
  invalid: 'That link is not usable any more.',
  locked: 'Too many attempts from this connection. Please wait a few minutes and try again.',
  missing: 'This page needs the private link from your text or email.',
};

export default async function ResumeUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <Card>
        <CardHeader title="That link is not available" />
        <CardBody className="space-y-3">
          {/* Deliberately identical wording for "no such token" and "wrong
              token": this page must not help anyone find a valid one. */}
          <Notice tone="pending">{REASONS[reason ?? 'invalid'] ?? REASONS.invalid}</Notice>
          <p className="text-[13.5px] text-ink-soft">
            Ask the recruiter you were speaking with for a new link, or start again from your office’s
            intake page. Nothing you sent before has been lost.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

import { notFound, redirect } from 'next/navigation';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { buildIntakeView, findOrganizationBySlug } from '@/server/services/intake';
import { readIntakeCookies } from '@/server/actions/intake-actions';
import { QuestionForm } from './QuestionForm';
import { VerifyForm } from './VerifyForm';
import { isDemoMode } from '@/env';
import { NotFoundError } from '@/server/authz/errors';

export const dynamic = 'force-dynamic';

export default async function IntakeSessionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = await findOrganizationBySlug(slug);
  if (!organization) notFound();

  const { sessionId, verified } = await readIntakeCookies();
  if (!sessionId) redirect(`/intake/${slug}`);

  let view;
  try {
    view = await buildIntakeView(sessionId, { answersVisible: verified });
  } catch (error) {
    if (error instanceof NotFoundError) redirect(`/intake/${slug}`);
    throw error;
  }

  // A session belongs to exactly one organization; a cookie from elsewhere
  // cannot be used to read it here.
  if (view.organizationSlug !== slug) redirect(`/intake/${view.organizationSlug}`);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] text-ink-faint">{view.organizationName}</p>
        <h1 className="mt-0.5 text-[19px] font-semibold text-ink">
          {view.pathway === 'CALLBACK_REQUEST' ? 'Request a callback' : 'A few questions'}
        </h1>
      </div>

      {isDemoMode ? (
        <Notice tone="pending">Demonstration only. Nothing here reaches a real phone or inbox.</Notice>
      ) : null}

      {view.handedOff ? (
        <Card>
          <CardHeader title="Passed to a recruiter" />
          <CardBody className="space-y-2">
            {/* Neutral handoff language. No eligibility answer, no advice, and
                no invented response-time promise. */}
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{view.handoffMessage}</p>
            <p className="text-[13px] text-ink-faint">
              You do not need to do anything else here. If you want to add something, a recruiter can
              take it when they contact you.
            </p>
          </CardBody>
        </Card>
      ) : view.status === 'COMPLETED' ? (
        <Card>
          <CardHeader title="All set" />
          <CardBody>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{view.completionText}</p>
          </CardBody>
        </Card>
      ) : !verified ? (
        <Card>
          <CardHeader
            title="One quick check"
            description="You are on a new device, so we need one detail before showing what you sent before."
          />
          <CardBody>
            <VerifyForm />
          </CardBody>
        </Card>
      ) : view.question ? (
        <Card>
          <CardHeader
            title={`Question ${view.question.index} of ${view.question.total}`}
            description={view.question.required ? 'Needed to pass this to a recruiter.' : 'Optional — you can skip it.'}
          />
          <CardBody>
            <QuestionForm question={view.question} />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Nothing left to ask" />
          <CardBody>
            <p className="text-[14px] text-ink">{view.completionText}</p>
          </CardBody>
        </Card>
      )}

      {verified && view.answered.length ? (
        <Card>
          <CardHeader title="What you have shared" />
          <CardBody>
            <dl className="divide-y divide-line">
              {view.answered.map((answer) => (
                <div key={`${answer.questionKey}-${answer.revision}`} className="py-2">
                  <dt className="text-[12.5px] text-ink-faint">{answer.prompt}</dt>
                  <dd className="mt-0.5 text-[14px] text-ink">
                    {answer.skipped ? <span className="text-ink-faint">skipped</span> : answer.valueText}
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      <p className="text-[12px] leading-relaxed text-ink-faint">
        You can stop at any point and ask for a person instead — just say so in any answer box. Nothing
        you have entered is lost if you close this page.
      </p>
    </div>
  );
}

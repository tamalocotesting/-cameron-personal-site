import { notFound } from 'next/navigation';
import { PhoneCall, MessageSquare } from 'lucide-react';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { findOrganizationBySlug, getPublishedIntake } from '@/server/services/intake';
import { StartButtons } from './StartButtons';
import { isDemoMode } from '@/env';

export const dynamic = 'force-dynamic';

export default async function IntakeStartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = await findOrganizationBySlug(slug);
  if (!organization) notFound();

  const version = await getPublishedIntake(organization.id);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] text-ink-faint">{organization.name}</p>
        <h1 className="mt-0.5 text-[20px] font-semibold text-ink">Talk to a recruiter</h1>
      </div>

      {isDemoMode || organization.dataScope === 'DEMO' ? (
        <Notice tone="pending" title="Demonstration only">
          This is a demonstration. Anything you enter stays in a fictional demo dataset, and no message
          is sent to a real phone or email address. Please do not enter real personal information.
        </Notice>
      ) : null}

      {!version ? (
        <Card>
          <CardBody>
            <Notice tone="review">
              This office has not published its question set yet, so the form is not available. Nothing
              you could type would reach anyone.
            </Notice>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-3">
              {/* The greeting says plainly what this is, that a person will
                  look, and that a callback can be requested at any point. */}
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{version.greeting}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Choose how to start" description="Either one reaches a recruiter." />
            <CardBody className="space-y-3">
              <StartButtons slug={slug} />
              <ul className="space-y-1.5 text-[13px] text-ink-faint">
                <li className="flex items-start gap-2">
                  <PhoneCall size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  A callback needs only a way to reach you, when you are free, and your permission to
                  call. You do not have to agree to text messages to ask for a call.
                </li>
                <li className="flex items-start gap-2">
                  <MessageSquare size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  Sharing more is a short set of questions. Every one is optional unless it is needed to
                  reach you, you can skip anything, and you can ask for a person at any point.
                </li>
              </ul>
            </CardBody>
          </Card>

          <p className="text-[12px] leading-relaxed text-ink-faint">
            This assistant collects information for a recruiter to read. It does not decide anything
            about you, cannot tell you whether you qualify for anything, and will not answer medical,
            legal or eligibility questions — those go to a person. We do not ask for a Social Security
            number, an exact date of birth, documents, or medical or legal histories here.
          </p>
        </>
      )}
    </div>
  );
}

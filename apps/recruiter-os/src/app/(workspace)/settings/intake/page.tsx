import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { listIntakeVersions } from '@/server/services/settings';
import { formatInZone } from '@/lib/time';
import { IntakeVersionForms } from '@/components/app/settings/IntakeVersionForms';

export const dynamic = 'force-dynamic';

export default async function IntakeSettingsPage() {
  const ctx = await requireStaffContext();
  const versions = await listIntakeVersions(ctx.member.organizationId);

  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        A published question set is immutable. Editing one creates a new draft version; sessions already
        in progress keep the version the applicant started on. Citizenship questions are off unless the
        organization enables them, and this build never collects SSNs, exact dates of birth, government
        identifiers, documents, or medical/legal histories.
      </Notice>

      {versions.map((version) => (
        <Card key={version.id}>
          <CardHeader
            title={`${version.definition.name} — version ${version.version}`}
            description={
              version.publishedAt
                ? `Published ${formatInZone(version.publishedAt, ctx.timezone)}`
                : 'Not published'
            }
            actions={
              <Badge
                tone={
                  version.state === 'PUBLISHED' ? 'ready' : version.state === 'RETIRED' ? 'neutral' : 'pending'
                }
              >
                {version.state.replace('_', ' ').toLowerCase()}
              </Badge>
            }
          />
          <CardBody className="space-y-3">
            <div className="grid gap-2 text-[13px] sm:grid-cols-3">
              <div>
                <p className="text-[12px] uppercase tracking-wide text-ink-faint">Greeting</p>
                <p className="mt-0.5 text-ink">{version.greeting}</p>
              </div>
              <div>
                <p className="text-[12px] uppercase tracking-wide text-ink-faint">Completion text</p>
                <p className="mt-0.5 text-ink">{version.completionText}</p>
              </div>
              <div>
                <p className="text-[12px] uppercase tracking-wide text-ink-faint">Handoff text</p>
                <p className="mt-0.5 text-ink">{version.handoffText}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <caption className="sr-only">Questions in version {version.version}</caption>
                <thead className="border-b border-line bg-surface-muted text-[12px] uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Key</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Pathway</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Prompt</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Type</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {version.questions.map((question) => (
                    <tr key={question.id}>
                      <td className="px-3 py-2 font-mono text-[12px] text-ink-faint">{question.key}</td>
                      <td className="px-3 py-2 text-[12.5px] text-ink">
                        {question.pathway === 'CALLBACK_REQUEST' ? 'callback' : 'full intake'}
                      </td>
                      <td className="px-3 py-2 text-[13px] text-ink">
                        {question.prompt}
                        {question.consentPurpose ? (
                          <Badge tone="accent" className="ml-1.5">
                            consent
                          </Badge>
                        ) : null}
                        {question.sensitiveCategory ? (
                          <Badge tone="pending" className="ml-1.5">
                            {question.sensitiveCategory}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[12.5px] text-ink-faint">{question.type.toLowerCase()}</td>
                      <td className="px-3 py-2 text-[12.5px]">
                        {question.required ? (
                          <Badge tone="pending">required</Badge>
                        ) : (
                          <span className="text-ink-faint">optional</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <IntakeVersionForms
              versionId={version.id}
              state={version.state}
              greeting={version.greeting}
              completionText={version.completionText}
              handoffText={version.handoffText}
            />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

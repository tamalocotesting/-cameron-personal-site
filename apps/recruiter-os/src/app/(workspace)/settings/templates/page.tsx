import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { listTemplates } from '@/server/services/settings';
import { formatInZone } from '@/lib/time';
import { TemplateForms } from '@/components/app/settings/TemplateForms';

export const dynamic = 'force-dynamic';

export default async function TemplatesSettingsPage() {
  const ctx = await requireStaffContext();
  const templates = await listTemplates(ctx.member.organizationId);

  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        Only approved, published versions of the three allowlisted kinds — acknowledgment, intake
        invitation and appointment reminder — can be sent without a recruiter. Everything else needs a
        person to approve the exact text. Templates cannot promise eligibility, jobs, waivers or
        benefits; the editor refuses that language.
      </Notice>

      {templates.map((template) => (
        <Card key={template.id}>
          <CardHeader
            title={template.name}
            description={`key: ${template.key} · ${template.kind.replace('_', ' ').toLowerCase()} · ${template.channel.toLowerCase()}`}
            actions={
              template.automatable ? (
                <Badge tone="accent">automatable</Badge>
              ) : (
                <Badge tone="neutral">recruiter-sent only</Badge>
              )
            }
          />
          <CardBody className="space-y-2">
            {template.versions.map((version) => (
              <div key={version.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={version.state === 'PUBLISHED' ? 'ready' : version.state === 'RETIRED' ? 'neutral' : 'pending'}
                  >
                    v{version.version} · {version.state.toLowerCase()}
                  </Badge>
                  {version.approvedAt ? (
                    <span className="text-[12px] text-ink-faint">
                      approved {formatInZone(version.approvedAt, ctx.timezone)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-ink">{version.body}</p>
                {version.placeholders.length ? (
                  <p className="mt-1 font-mono text-[11.5px] text-ink-faint">
                    placeholders: {version.placeholders.join(', ')}
                  </p>
                ) : null}
                {version.state === 'DRAFT' ? (
                  <div className="mt-2">
                    <TemplateForms mode="publish" templateVersionId={version.id} />
                  </div>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader title="New template draft" />
        <CardBody>
          <TemplateForms mode="create" />
        </CardBody>
      </Card>
    </div>
  );
}

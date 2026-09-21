import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { listPolicies } from '@/server/services/retention';
import { canRunRetention } from '@/server/authz/policy';
import { formatInZone } from '@/lib/time';
import { RetentionForms } from '@/components/app/settings/RetentionForms';

export const dynamic = 'force-dynamic';

export default async function RetentionPage() {
  const ctx = await requireStaffContext();
  const [policies, mayRun] = await Promise.all([listPolicies(ctx.member.organizationId), canRunRetention(ctx)]);

  return (
    <div className="space-y-3">
      <Notice tone="pending" title="There is no destructive default">
        A retention policy does nothing until it is created, approved and enabled. A preview is a dry run
        that deletes nothing and reports what a legal hold protected. Deletion covers derived material
        too — briefs and their citations, stored provider payloads, pending jobs and exports.
      </Notice>

      <Notice tone="neutral">
        A database delete does not erase backups, replicas or copies a provider holds; those expire on
        their own schedules. Minimal audit metadata is kept so the deletion itself stays accountable, and
        it holds identifiers and field names — never deleted content. SECURITY.md has the detail.
      </Notice>

      {policies.map((policy) => (
        <Card key={policy.id}>
          <CardHeader
            title={policy.name}
            actions={
              <div className="flex gap-1.5">
                {policy.approvedAt ? <Badge tone="ready">approved</Badge> : <Badge tone="pending">not approved</Badge>}
                {policy.enabled ? <Badge tone="accent">enabled</Badge> : <Badge tone="neutral">disabled</Badge>}
              </div>
            }
          />
          <CardBody className="space-y-3">
            <dl className="grid gap-2 text-[13px] sm:grid-cols-4">
              {[
                ['Closed cases', policy.closedCaseRetentionDays],
                ['Briefs', policy.briefRetentionDays],
                ['Webhook payloads', policy.webhookPayloadRetentionDays],
                ['Audit metadata', policy.auditMetadataRetentionDays],
              ].map(([label, days]) => (
                <div key={String(label)}>
                  <dt className="text-[12px] uppercase tracking-wide text-ink-faint">{label}</dt>
                  <dd className="mt-0.5 text-ink">{days === null ? 'keep indefinitely' : `${days} days`}</dd>
                </div>
              ))}
            </dl>

            {policy.runs.length ? (
              <div>
                <p className="text-[12px] uppercase tracking-wide text-ink-faint">Recent runs</p>
                <ul className="mt-1 space-y-1">
                  {policy.runs.map((run) => (
                    <li key={run.id} className="rounded-md border border-line px-3 py-2 text-[12.5px]">
                      <span className="font-medium text-ink">{run.mode}</span>{' '}
                      <span className="text-ink-faint">
                        started {formatInZone(run.startedAt, ctx.timezone)}
                        {run.finishedAt ? ` · finished ${formatInZone(run.finishedAt, ctx.timezone)}` : ' · running'}
                      </span>
                      <pre className="mt-1 overflow-x-auto rounded bg-surface-muted p-2 font-mono text-[11.5px] text-ink-faint">
                        {JSON.stringify(run.summary, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <RetentionForms
              policyId={policy.id}
              approved={Boolean(policy.approvedAt)}
              enabled={policy.enabled}
              mayRun={mayRun}
            />
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader title="New retention policy" />
        <CardBody>
          <RetentionForms mode="create" mayRun={mayRun} />
        </CardBody>
      </Card>
    </div>
  );
}

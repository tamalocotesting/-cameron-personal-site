import Link from 'next/link';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { loadOperations } from '@/server/services/operations';
import { canManageOrganization } from '@/server/authz/policy';
import { formatInZone } from '@/lib/time';
import { OperationsForms } from '@/components/app/OperationsForms';

export const dynamic = 'force-dynamic';

export default async function OperationsPage() {
  const ctx = await requireStaffContext();
  if (!canManageOrganization(ctx)) {
    return (
      <div className="space-y-3">
        <h1 className="text-[17px] font-semibold text-ink">Operations</h1>
        <Notice tone="neutral" icon={<AlertTriangle size={14} />}>
          The operations view is limited to organization administrators.
        </Notice>
      </div>
    );
  }

  const ops = await loadOperations(ctx);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[17px] font-semibold text-ink">Operations</h1>
        <p className="text-[13px] text-ink-faint">
          Background work, blocked sends and provider callbacks. Diagnostics are redacted — they say
          what failed, not what an applicant said.
        </p>
      </div>

      {ops.heartbeat.healthy ? (
        <Notice tone="ready" icon={<ShieldCheck size={14} />}>
          {ops.heartbeat.detail} {ops.pendingJobs} job(s) pending.
        </Notice>
      ) : (
        <Notice tone="review" icon={<AlertTriangle size={14} />} title="The background worker is not reporting">
          {ops.heartbeat.detail} Start it with <code className="font-mono text-[12px]">pnpm worker</code>.
        </Notice>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={`Failed and dead-lettered jobs (${ops.failedJobs.length})`}
            description={`${ops.deadLetteredJobs} have exhausted their retries.`}
          />
          <CardBody className="space-y-2">
            {ops.failedJobs.length === 0 ? (
              <EmptyState title="No failed jobs" description="Everything the worker picked up completed." />
            ) : null}
            {ops.failedJobs.map((job) => (
              <div key={job.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-ink">{job.jobName}</span>
                  <Badge tone={job.deadLetteredAt ? 'review' : 'pending'}>
                    {job.deadLetteredAt ? 'dead-lettered' : `attempt ${job.attempts}`}
                  </Badge>
                  <span className="ml-auto text-[12px] text-ink-faint">
                    {formatInZone(job.updatedAt, ctx.timezone, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <p className="mt-1 break-words text-[12.5px] text-review">{job.lastError}</p>
                <pre className="mt-1 overflow-x-auto rounded bg-surface-muted p-2 font-mono text-[11.5px] text-ink-faint">
                  {JSON.stringify(job.payload, null, 2)}
                </pre>
                <div className="mt-2">
                  <OperationsForms kind="retry-job" id={job.id} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader
              title={`Blocked sends (${ops.blockedMessages.length})`}
              description="Refused before dispatch. The reason is the actual check that failed."
            />
            <CardBody className="space-y-1.5">
              {ops.blockedMessages.length === 0 ? (
                <EmptyState title="Nothing blocked" description="No outbound message is waiting on a decision." />
              ) : null}
              {ops.blockedMessages.map((message) => (
                <div key={message.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                  <Link
                    href={`/applicants/${message.applicantId}?view=conversation`}
                    className="text-accent underline underline-offset-2"
                  >
                    {message.applicant.reference} · {message.applicant.displayName}
                  </Link>
                  <p className="mt-0.5 text-[12.5px] text-review">{message.blockedReason}</p>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`Unknown send outcomes (${ops.unknownOutcome.length})`}
              description="Submitted, never confirmed. These are reconciled with the provider, never re-sent blindly."
            />
            <CardBody className="space-y-1.5">
              {ops.unknownOutcome.length === 0 ? (
                <EmptyState title="None outstanding" description="Every submission has a known outcome." />
              ) : null}
              {ops.unknownOutcome.map((message) => (
                <div key={message.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                  <Link
                    href={`/applicants/${message.applicantId}?view=conversation`}
                    className="text-accent underline underline-offset-2"
                  >
                    {message.applicant.reference}
                  </Link>
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">
                    {message.failureDetail} (attempt {message.attemptCount})
                  </p>
                  <div className="mt-1.5">
                    <OperationsForms kind="reconcile" id={message.id} />
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Recent provider callbacks"
          description="Every inbound webhook is recorded durably, with whether its signature verified."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">Recent provider webhook receipts</caption>
            <thead className="border-b border-line bg-surface-muted text-[12px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Received</th>
                <th scope="col" className="px-4 py-2 font-semibold">Provider</th>
                <th scope="col" className="px-4 py-2 font-semibold">Endpoint</th>
                <th scope="col" className="px-4 py-2 font-semibold">Signature</th>
                <th scope="col" className="px-4 py-2 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ops.recentWebhooks.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="px-4 py-2 text-[12.5px] text-ink-faint">
                    {formatInZone(receipt.receivedAt, ctx.timezone, { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td className="px-4 py-2 text-[13px] text-ink">{receipt.provider}</td>
                  <td className="px-4 py-2 font-mono text-[12px] text-ink-faint">{receipt.endpoint}</td>
                  <td className="px-4 py-2">
                    <Badge tone={receipt.signatureValid ? 'ready' : 'review'}>
                      {receipt.signatureValid ? 'verified' : 'rejected'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-[12.5px] text-ink-soft">
                    {receipt.outcome}
                    {receipt.outcomeDetail ? ` — ${receipt.outcomeDetail}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

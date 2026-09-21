'use client';
import { Badge, Card, CardBody, CardHeader, Field, Input, Notice } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import {
  approveHandoffAction,
  confirmHandoffReceiptAction,
  prepareHandoffAction,
  sendHandoffWebhookAction,
} from '@/server/actions/workspace-actions';

/**
 * Handoff to an existing recruiting system.
 *
 * The wording here is the product being honest: this produces a reviewed
 * package and a manual export. It is not proof of import into any official
 * system, and there is no AFRISS API behind it.
 */
export function HandoffPanel({
  applicantId,
  handoffs,
  canExport,
}: {
  applicantId: string;
  handoffs: Array<{
    id: string;
    state: string;
    packageVersion: string;
    createdAt: string;
    transportDetail: string | null;
    externalReferenceId: string | null;
  }>;
  canExport: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Handoff package"
        description="An allowlisted, versioned, recruiter-reviewed export. A manual handoff — not an import into an official system."
      />
      <CardBody className="space-y-3">
        <Notice tone="neutral">
          Fields are allowlisted and sensitive free text is excluded. Exporting writes an audit entry
          and needs the export grant.
        </Notice>

        {canExport ? (
          <ActionForm action={prepareHandoffAction} submitLabel="Prepare a package">
            <input type="hidden" name="applicantId" value={applicantId} />
            <Field
              label="External reference id"
              htmlFor="handoff-ref"
              hint="Optional. The identifier the receiving office uses, if you have one."
            >
              <Input id="handoff-ref" name="externalReferenceId" />
            </Field>
          </ActionForm>
        ) : null}

        {handoffs.length ? (
          <ul className="space-y-2">
            {handoffs.map((handoff) => (
              <li key={handoff.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      handoff.state === 'EXTERNALLY_CONFIRMED'
                        ? 'ready'
                        : handoff.state === 'TRANSPORT_FAILED'
                          ? 'review'
                          : 'pending'
                    }
                  >
                    {handoff.state.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  <span className="font-mono text-[11.5px] text-ink-faint">{handoff.packageVersion}</span>
                  {handoff.externalReferenceId ? (
                    <span className="text-[12px] text-ink-faint">ref {handoff.externalReferenceId}</span>
                  ) : null}
                </div>
                {handoff.transportDetail ? (
                  <p className="mt-1 text-[12.5px] text-ink-soft">{handoff.transportDetail}</p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-start gap-3">
                  <a
                    href={`/api/handoffs/${handoff.id}/preview`}
                    className="touch-target inline-flex items-center rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                  >
                    Preview JSON
                  </a>
                  {canExport && handoff.state === 'DRAFT' ? (
                    <ActionForm action={approveHandoffAction} submitLabel="Approve package" submitVariant="ready">
                      <input type="hidden" name="applicantId" value={applicantId} />
                      <input type="hidden" name="handoffId" value={handoff.id} />
                    </ActionForm>
                  ) : null}
                  {canExport && handoff.state !== 'DRAFT' ? (
                    <>
                      <a
                        href={`/api/handoffs/${handoff.id}/export?format=json`}
                        className="touch-target inline-flex items-center rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                      >
                        Download JSON
                      </a>
                      <a
                        href={`/api/handoffs/${handoff.id}/export?format=csv`}
                        className="touch-target inline-flex items-center rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                      >
                        Download CSV
                      </a>
                      <ActionForm action={sendHandoffWebhookAction} submitLabel="Send to webhook">
                        <input type="hidden" name="applicantId" value={applicantId} />
                        <input type="hidden" name="handoffId" value={handoff.id} />
                      </ActionForm>
                      <ActionForm action={confirmHandoffReceiptAction} submitLabel="Record external confirmation">
                        <input type="hidden" name="applicantId" value={applicantId} />
                        <input type="hidden" name="handoffId" value={handoff.id} />
                        <Field
                          label="Their reference"
                          htmlFor={`confirm-${handoff.id}`}
                          required
                          hint="Only record this when someone on the receiving side confirmed it landed."
                        >
                          <Input id={`confirm-${handoff.id}`} name="externalReferenceId" required />
                        </Field>
                      </ActionForm>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-faint">No handoff package has been prepared for this case.</p>
        )}
      </CardBody>
    </Card>
  );
}

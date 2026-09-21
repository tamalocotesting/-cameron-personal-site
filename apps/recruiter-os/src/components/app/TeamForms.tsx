'use client';
import { Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import {
  grantCoverageAction,
  recordAbsenceAction,
  revokeCoverageAction,
  setFallbackOwnerAction,
} from '@/server/actions/workspace-actions';

export function TeamForms({
  members,
  coverages,
  isAdmin,
  selfMemberId,
}: {
  members: Array<{ id: string; displayName: string; active: boolean }>;
  coverages: Array<{ id: string; label: string }>;
  isAdmin: boolean;
  selfMemberId: string;
}) {
  const active = members.filter((m) => m.active);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Grant coverage"
          description="Time-bounded. The end date is required and enforced by the database."
        />
        <CardBody>
          <ActionForm action={grantCoverageAction} submitLabel="Grant coverage">
            <Field label="Cases owned by" htmlFor="cov-from" required>
              <Select id="cov-from" name="fromMemberId" required defaultValue={selfMemberId}>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Covered by" htmlFor="cov-to" required>
              <Select id="cov-to" name="toMemberId" required>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts" htmlFor="cov-start" required>
                <Input id="cov-start" name="startsAt" type="datetime-local" required />
              </Field>
              <Field label="Expires" htmlFor="cov-end" required>
                <Input id="cov-end" name="expiresAt" type="datetime-local" required />
              </Field>
            </div>
            <Field label="Reason" htmlFor="cov-reason" required>
              <Input id="cov-reason" name="reason" required />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Record an absence" description="New inquiries route away from an absent recruiter." />
        <CardBody className="space-y-4">
          <ActionForm action={recordAbsenceAction} submitLabel="Record absence">
            <Field label="Member" htmlFor="abs-member" required>
              <Select id="abs-member" name="memberId" required defaultValue={selfMemberId}>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="abs-start" required>
                <Input id="abs-start" name="startsAt" type="datetime-local" required />
              </Field>
              <Field label="Until" htmlFor="abs-end" required>
                <Input id="abs-end" name="endsAt" type="datetime-local" required />
              </Field>
            </div>
            <Field label="Note" htmlFor="abs-note">
              <Textarea id="abs-note" name="note" rows={2} />
            </Field>
          </ActionForm>

          {coverages.length ? (
            <ActionForm action={revokeCoverageAction} submitLabel="Revoke coverage" submitVariant="danger">
              <Field label="Coverage" htmlFor="rev-coverage" required>
                <Select id="rev-coverage" name="coverageId" required>
                  {coverages.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason" htmlFor="rev-reason" required>
                <Input id="rev-reason" name="reason" required />
              </Field>
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>

      {isAdmin ? (
        <Card className="lg:col-span-2">
          <CardHeader
            title="Fallback owner"
            description="The always-active recruiter who picks up a new inquiry when the routed owner is away."
          />
          <CardBody>
            <ActionForm action={setFallbackOwnerAction} submitLabel="Set fallback owner">
              <Field label="Member" htmlFor="fallback-member" required>
                <Select id="fallback-member" name="memberId" required>
                  {active.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

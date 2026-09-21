'use client';
import { Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { ActionForm, FieldError } from '@/components/ui/form';
import {
  inviteMemberAction,
  issueGrantAction,
  revokeGrantAction,
  setMemberActiveAction,
} from '@/server/actions/workspace-actions';

const GRANTS = [
  ['CASE_CONTENT', 'Read case content (conversation, intake, notes)'],
  ['TEAM_CONVERSATION_CONTENT', 'Read conversation content across a team'],
  ['REASSIGNMENT', 'Reassign ownership and merge cases'],
  ['EXPORT', 'Produce exports'],
  ['SENSITIVE_SOURCE', 'Read sensitive original text'],
  ['TEAM_REPORTS', 'Read team operational reports'],
  ['BASELINE_ENTRY', 'Record baseline / observation measurements'],
  ['RETENTION_ADMIN', 'Run retention previews and executions'],
] as const;

export function UserForms({
  members,
  grants,
}: {
  members: Array<{ id: string; displayName: string; active: boolean }>;
  grants: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader title="Invite a staff member" description="The invitation email carries the only route to an account." />
        <CardBody>
          <ActionForm action={inviteMemberAction} submitLabel="Send invitation">
            {(state) => (
              <>
                <Field label="Email address" htmlFor="invite-email" required>
                  <Input id="invite-email" name="email" type="email" required />
                  <FieldError state={state} name="email" />
                </Field>
                <Field label="Role" htmlFor="invite-role" required>
                  <Select id="invite-role" name="staffRole" required defaultValue="RECRUITER">
                    <option value="RECRUITER">Recruiter</option>
                    <option value="MANAGER">Manager</option>
                    <option value="ORG_ADMIN">Organization administrator</option>
                  </Select>
                </Field>
              </>
            )}
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Activate or deactivate" description="Deactivation revokes coverage and grants immediately." />
        <CardBody>
          <ActionForm action={setMemberActiveAction} submitLabel="Apply">
            <Field label="Member" htmlFor="active-member" required>
              <Select id="active-member" name="memberId" required>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} {m.active ? '(active)' : '(deactivated)'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Set to" htmlFor="active-state" required>
              <Select id="active-state" name="active" required defaultValue="false">
                <option value="true">Active</option>
                <option value="false">Deactivated</option>
              </Select>
            </Field>
            <Field label="Reason" htmlFor="active-reason" required>
              <Input id="active-reason" name="reason" required />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Issue a grant" description="Scope it to one case or one team wherever you can." />
        <CardBody>
          <ActionForm action={issueGrantAction} submitLabel="Issue grant">
            <Field label="Member" htmlFor="grant-member" required>
              <Select id="grant-member" name="subjectMemberId" required>
                {members
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Grant" htmlFor="grant-kind" required>
              <Select id="grant-kind" name="grant" required defaultValue="CASE_CONTENT">
                {GRANTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Limit to one case" htmlFor="grant-case" hint="Case id. Leave blank for wider scope.">
              <Input id="grant-case" name="applicantId" />
            </Field>
            <Field label="Limit to one team" htmlFor="grant-team" hint="Team id.">
              <Input id="grant-team" name="teamId" />
            </Field>
            <Field label="Expires" htmlFor="grant-expiry" hint="Strongly recommended.">
              <Input id="grant-expiry" name="expiresAt" type="datetime-local" />
            </Field>
            <Field label="Reason" htmlFor="grant-reason" required>
              <Input id="grant-reason" name="reason" required />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>

      {grants.length ? (
        <Card>
          <CardHeader title="Revoke a grant" description="Revocation takes effect on the next request." />
          <CardBody>
            <ActionForm action={revokeGrantAction} submitLabel="Revoke grant" submitVariant="danger">
              <Field label="Grant" htmlFor="revoke-grant" required>
                <Select id="revoke-grant" name="grantId" required>
                  {grants.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason" htmlFor="revoke-grant-reason" required>
                <Input id="revoke-grant-reason" name="reason" required />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

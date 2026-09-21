import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { listGrants, listMembers } from '@/server/services/team';
import { prisma } from '@/server/db';
import { formatInZone } from '@/lib/time';
import { UserForms } from '@/components/app/settings/UserForms';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage() {
  const ctx = await requireStaffContext();
  const [members, grants, invitations, settings] = await Promise.all([
    listMembers(ctx.member.organizationId),
    listGrants(ctx.member.organizationId),
    prisma.invitation.findMany({
      where: { organizationId: ctx.member.organizationId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.organizationSettings.findUnique({ where: { organizationId: ctx.member.organizationId } }),
  ]);

  const activeSeats = members.filter((m) => m.active).length;

  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        Staff access is invitation only. Roles set a floor; anything above it is an explicit, revocable
        grant that is written to the audit trail. Being an organization administrator does not by itself
        grant access to conversation content.
      </Notice>

      <Card>
        <CardHeader
          title={`Members (${activeSeats} active of ${settings?.seatLimit ?? '—'} seats)`}
          description="Deactivating a member with live work is refused until it is reassigned."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">Organization members</caption>
            <thead className="border-b border-line bg-surface-muted text-[12px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Member</th>
                <th scope="col" className="px-4 py-2 font-semibold">Email</th>
                <th scope="col" className="px-4 py-2 font-semibold">Role</th>
                <th scope="col" className="px-4 py-2 font-semibold">MFA</th>
                <th scope="col" className="px-4 py-2 font-semibold">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-2 text-[13.5px] text-ink">{member.displayName || member.user.name}</td>
                  <td className="px-4 py-2 text-[13px] text-ink-faint">{member.user.email}</td>
                  <td className="px-4 py-2 text-[13px] text-ink">
                    {member.staffRole.replace('_', ' ').toLowerCase()}
                  </td>
                  <td className="px-4 py-2">
                    {member.user.twoFactorEnabled ? (
                      <Badge tone="ready">enabled</Badge>
                    ) : (
                      <Badge tone="pending">not enrolled</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {member.active ? <Badge tone="ready">active</Badge> : <Badge tone="neutral">deactivated</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {invitations.length ? (
        <Card>
          <CardHeader title={`Pending invitations (${invitations.length})`} />
          <CardBody className="space-y-1.5">
            {invitations.map((invitation) => (
              <p key={invitation.id} className="text-[13px] text-ink">
                {invitation.email} · {invitation.staffRole.replace('_', ' ').toLowerCase()} · expires{' '}
                {formatInZone(invitation.expiresAt, ctx.timezone)}
              </p>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`Active grants (${grants.length})`}
          description="Each one names who has it, over what, why, and when it expires."
        />
        <CardBody className="space-y-1.5">
          {grants.length === 0 ? <p className="text-[13px] text-ink-faint">No grants are in force.</p> : null}
          {grants.map((grant) => (
            <div key={grant.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{grant.grant.replace(/_/g, ' ').toLowerCase()}</Badge>
                <span className="text-ink">{grant.subject.displayName}</span>
                <span className="text-ink-faint">
                  {grant.applicantId ? 'one case' : grant.teamId ? 'one team' : 'organization-wide'}
                </span>
                {grant.expiresAt ? (
                  <span className="text-[12px] text-ink-faint">
                    expires {formatInZone(grant.expiresAt, ctx.timezone)}
                  </span>
                ) : (
                  <Badge tone="pending">no expiry</Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">{grant.reason}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <UserForms
        members={members.map((m) => ({ id: m.id, displayName: m.displayName || m.user.name, active: m.active }))}
        grants={grants.map((g) => ({
          id: g.id,
          label: `${g.subject.displayName} — ${g.grant.replace(/_/g, ' ').toLowerCase()}`,
        }))}
      />
    </div>
  );
}

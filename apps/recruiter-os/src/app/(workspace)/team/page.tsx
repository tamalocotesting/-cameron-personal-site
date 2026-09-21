import { AlertTriangle, Users } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { loadTeamWorkload, listMembers, listTeams } from '@/server/services/team';
import { canViewTeamReports } from '@/server/authz/policy';
import { formatInZone } from '@/lib/time';
import { prisma } from '@/server/db';
import { TeamForms } from '@/components/app/TeamForms';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const ctx = await requireStaffContext();
  const authorized = await canViewTeamReports(ctx);

  if (!authorized) {
    return (
      <div className="space-y-3">
        <h1 className="text-[17px] font-semibold text-ink">Team</h1>
        <Notice tone="neutral" icon={<AlertTriangle size={14} />} title="Not available for your role">
          Team workload and assignment need a manager role or the team-reports grant. Your own queue and
          cases are unaffected.
        </Notice>
      </div>
    );
  }

  const [workload, members, teams, settings] = await Promise.all([
    loadTeamWorkload(ctx),
    listMembers(ctx.member.organizationId),
    listTeams(ctx.member.organizationId),
    prisma.organizationSettings.findUnique({ where: { organizationId: ctx.member.organizationId } }),
  ]);

  const fallback = members.find((m) => m.id === settings?.fallbackOwnerMemberId);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[17px] font-semibold text-ink">Team</h1>
        <p className="text-[13px] text-ink-faint">
          Workload, coverage and absence. Operational metadata only — conversation content needs a
          separate grant.
        </p>
      </div>

      {!fallback ? (
        <Notice tone="review" icon={<AlertTriangle size={14} />} title="No fallback owner is set">
          Without one, a new inquiry that routes to an absent recruiter has no always-active owner to
          fall back to. Set one below.
        </Notice>
      ) : (
        <Notice tone="ready">Fallback owner: {fallback.displayName}. New inquiries never land on nobody.</Notice>
      )}

      <Card>
        <CardHeader
          title="Workload"
          description="Concentration and overdue work per member, as of this page load."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <caption className="sr-only">Workload per member</caption>
            <thead className="border-b border-line bg-surface-muted text-[12px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Member</th>
                <th scope="col" className="px-4 py-2 font-semibold">Role</th>
                <th scope="col" className="px-4 py-2 font-semibold">Active cases</th>
                <th scope="col" className="px-4 py-2 font-semibold">Open follow-ups</th>
                <th scope="col" className="px-4 py-2 font-semibold">Overdue</th>
                <th scope="col" className="px-4 py-2 font-semibold">Present</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {workload.members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-2 text-[13.5px] text-ink">{member.displayName}</td>
                  <td className="px-4 py-2 text-[13px] text-ink-faint">
                    {member.staffRole.replace('_', ' ').toLowerCase()}
                  </td>
                  <td className="px-4 py-2 text-[13px] text-ink">{member.activeCases}</td>
                  <td className="px-4 py-2 text-[13px] text-ink">{member.openTasks}</td>
                  <td className="px-4 py-2">
                    {member.overdueTasks ? (
                      <Badge tone="review" icon={<AlertTriangle size={12} />}>
                        {member.overdueTasks}
                      </Badge>
                    ) : (
                      <span className="text-[13px] text-ink-faint">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {member.absent ? <Badge tone="pending">away</Badge> : <Badge tone="ready">present</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Active coverage" description="Coverage always expires. There is no open-ended grant." />
          <CardBody className="space-y-1.5">
            {workload.coverages.length === 0 ? (
              <p className="text-[13px] text-ink-faint">No coverage is in force.</p>
            ) : null}
            {workload.coverages.map((coverage) => (
              <div key={coverage.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                <p className="text-ink">
                  {coverage.toMember.displayName} is covering {coverage.fromMember.displayName}
                  {coverage.applicantId ? ' for one case' : ''}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-faint">
                  until {formatInZone(coverage.expiresAt, ctx.timezone)} · {coverage.reason}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Upcoming and current absence" />
          <CardBody className="space-y-1.5">
            {workload.absences.length === 0 ? (
              <p className="text-[13px] text-ink-faint">None recorded.</p>
            ) : null}
            {workload.absences.map((absence) => {
              const member = members.find((m) => m.id === absence.memberId);
              return (
                <div key={absence.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                  <p className="text-ink">{member?.displayName ?? absence.memberId}</p>
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    {formatInZone(absence.startsAt, ctx.timezone, { dateStyle: 'medium' })} –{' '}
                    {formatInZone(absence.endsAt, ctx.timezone, { dateStyle: 'medium' })}
                    {absence.note ? ` · ${absence.note}` : ''}
                  </p>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <TeamForms
        members={members.map((m) => ({ id: m.id, displayName: m.displayName, active: m.active }))}
        coverages={workload.coverages.map((c) => ({
          id: c.id,
          label: `${c.toMember.displayName} covering ${c.fromMember.displayName}`,
        }))}
        isAdmin={ctx.member.staffRole === 'ORG_ADMIN'}
        selfMemberId={ctx.member.id}
      />

      <Card>
        <CardHeader title="Teams" description="Team membership decides a manager's authorized scope." />
        <CardBody className="space-y-2">
          {teams.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[13px] text-ink-faint">
              <Users size={14} aria-hidden="true" /> No teams defined.
            </p>
          ) : null}
          {teams.map((team) => (
            <div key={team.id} className="rounded-md border border-line px-3 py-2">
              <p className="text-[13.5px] font-medium text-ink">{team.name}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">
                Manager: {team.manager?.displayName ?? 'none'} · members:{' '}
                {team.members.map((m) => m.member.displayName).join(', ') || 'none'}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

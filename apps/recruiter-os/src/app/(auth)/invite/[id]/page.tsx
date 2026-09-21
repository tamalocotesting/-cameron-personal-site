import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { AcceptInviteForm } from './AcceptInviteForm';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: { organization: { select: { name: true } } },
  });

  if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= now()) {
    return (
      <Card>
        <CardHeader title="Invitation not available" />
        <CardBody>
          <Notice tone="review">
            This invitation is not valid any more. Ask an administrator in your office to send a new one.
          </Notice>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`Join ${invitation.organization.name}`}
        description={`Invited as ${invitation.staffRole.replace('_', ' ').toLowerCase()}.`}
      />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-soft">
          Set a password for <strong className="font-medium">{invitation.email}</strong>. Staff accounts
          exist only by invitation; there is no public sign-up.
        </p>
        <AcceptInviteForm invitationId={invitation.id} email={invitation.email} />
      </CardBody>
    </Card>
  );
}

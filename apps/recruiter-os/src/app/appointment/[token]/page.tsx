import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { prisma } from '@/server/db';
import { hashToken } from '@/lib/crypto';
import { now } from '@/server/clock';
import { formatInZone, zoneAbbreviation } from '@/lib/time';
import { ConfirmForm } from './ConfirmForm';

export const dynamic = 'force-dynamic';

/**
 * A scoped applicant flow: confirm or decline ONE appointment.
 *
 * It exposes the time, the kind of meeting and where — and nothing else. No
 * notes, no brief, no tasks, no other appointment, no other applicant.
 */
export default async function AppointmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const appointment = await prisma.appointment.findUnique({
    where: { confirmTokenHash: hashToken(token) },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      medium: true,
      locationDetail: true,
      purpose: true,
      state: true,
      confirmExpiresAt: true,
      organization: { select: { name: true } },
    },
  });

  const unavailable =
    !appointment ||
    !appointment.confirmExpiresAt ||
    appointment.confirmExpiresAt.getTime() <= now().getTime() ||
    !['PROPOSED', 'SCHEDULED', 'CONFIRMED'].includes(appointment.state);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      {unavailable ? (
        <Card>
          <CardHeader title="This link is not available" />
          <CardBody>
            <Notice tone="pending">
              This appointment link is no longer usable. If you need to change a time, reply to the
              recruiter who contacted you.
            </Notice>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Confirm your appointment"
            description={appointment.organization.name}
          />
          <CardBody className="space-y-3">
            <dl className="space-y-2">
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-ink-faint">When</dt>
                <dd className="mt-0.5 text-[16px] font-medium text-ink">
                  {formatInZone(appointment.startsAt, appointment.timezone, {
                    dateStyle: 'full',
                    timeStyle: 'short',
                  })}{' '}
                  {zoneAbbreviation(appointment.startsAt, appointment.timezone)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-ink-faint">How</dt>
                <dd className="mt-0.5 text-[14px] text-ink">
                  {appointment.medium.replace('_', ' ').toLowerCase()}
                  {appointment.locationDetail ? ` · ${appointment.locationDetail}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-ink-faint">What it is about</dt>
                <dd className="mt-0.5 text-[14px] text-ink">{appointment.purpose}</dd>
              </div>
            </dl>
            <ConfirmForm token={token} alreadyConfirmed={appointment.state === 'CONFIRMED'} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

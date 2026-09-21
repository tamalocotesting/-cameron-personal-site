import { NextResponse } from 'next/server';
import { requireStaffContext } from '@/server/context';
import { prisma } from '@/server/db';
import { requireCase } from '@/server/authz/policy';
import { buildIcs } from '@/server/services/appointments';
import { auditRead } from '@/server/audit';

export const dynamic = 'force-dynamic';

/**
 * .ics download. Minimal disclosure by design: a calendar file often lands in
 * a shared account, so it carries the case reference and the purpose, not the
 * applicant's name or contact details.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffContext();
  const { id } = await params;

  const appointment = await prisma.appointment.findFirst({
    where: { id, organizationId: ctx.member.organizationId },
    include: { applicant: { select: { id: true, reference: true } } },
  });
  if (!appointment) return new NextResponse('Not found', { status: 404 });

  await requireCase(ctx, appointment.applicantId, 'metadata');

  const body = buildIcs({
    id: appointment.id,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    purpose: appointment.purpose,
    medium: appointment.medium,
    locationDetail: appointment.locationDetail,
    reference: appointment.applicant.reference,
  });

  await auditRead(ctx, {
    action: 'appointment.ics_downloaded',
    subjectType: 'appointment',
    subjectId: appointment.id,
    applicantId: appointment.applicantId,
  });

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="appointment-${appointment.applicant.reference}.ics"`,
      // Private case data must never sit in a shared cache.
      'cache-control': 'no-store, private',
    },
  });
}

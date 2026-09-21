import { NextResponse } from 'next/server';
import { requireStaffContext } from '@/server/context';
import { prisma } from '@/server/db';
import { requireCase } from '@/server/authz/policy';
import { auditRead } from '@/server/audit';

export const dynamic = 'force-dynamic';

/** Permissioned preview of a prepared handoff package. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffContext();
  const { id } = await params;

  const record = await prisma.handoffExport.findFirst({
    where: { id, organizationId: ctx.member.organizationId },
  });
  if (!record) return new NextResponse('Not found', { status: 404 });
  await requireCase(ctx, record.applicantId, 'content');

  await auditRead(ctx, {
    action: 'handoff.previewed',
    subjectType: 'handoff_export',
    subjectId: record.id,
    applicantId: record.applicantId,
  });

  return NextResponse.json(record.payload, { headers: { 'cache-control': 'no-store, private' } });
}

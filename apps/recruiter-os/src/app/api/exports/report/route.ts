import { NextResponse } from 'next/server';
import { requireStaffContext } from '@/server/context';
import { exportReportCsv } from '@/server/services/reports';
import { now } from '@/server/clock';
import { addDays, startOfLocalDay } from '@/lib/time';
import { isAppError } from '@/server/authz/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await requireStaffContext();
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? '30') || 30));
  const teamId = url.searchParams.get('team');

  const to = addDays(startOfLocalDay(now(), ctx.timezone), 1);
  const from = addDays(to, -days);

  try {
    const result = await exportReportCsv(ctx, { from, to, teamId });
    return new NextResponse(result.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${result.filename}"`,
        'cache-control': 'no-store, private',
      },
    });
  } catch (error) {
    return new NextResponse(isAppError(error) ? error.message : 'Export failed.', {
      status: isAppError(error) ? error.status : 500,
    });
  }
}

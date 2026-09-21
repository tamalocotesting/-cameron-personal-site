import { NextResponse } from 'next/server';
import { requireStaffContext } from '@/server/context';
import { exportHandoff } from '@/server/services/handoff';
import { isAppError } from '@/server/authz/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffContext();
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';

  try {
    const result = await exportHandoff(ctx, { handoffId: id, format });
    return new NextResponse(result.body, {
      headers: {
        'content-type': `${result.contentType}; charset=utf-8`,
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

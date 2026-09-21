import { NextResponse } from 'next/server';
import { env } from '@/env';
import { clockDescription } from '@/server/clock';

/** Liveness. Deliberately does not touch the database. */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', mode: env.APP_MODE, clock: clockDescription() },
    { headers: { 'cache-control': 'no-store' } },
  );
}

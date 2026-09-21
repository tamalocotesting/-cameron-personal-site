import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { env } from '@/env';
import { workerHeartbeat } from '@/server/services/operations';
import { redactError } from '@/lib/redact';

/**
 * Readiness: the database answers, migrations are applied, and the worker has
 * reported in recently. A missing worker is reported as degraded rather than
 * healthy, because scheduled sends and reminders would not be running.
 */
export async function GET() {
  try {
    const [, migrations, heartbeat] = await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `,
      workerHeartbeat(),
    ]);

    const body = {
      status: heartbeat.healthy ? 'ready' : 'degraded',
      mode: env.APP_MODE,
      migrationsApplied: Number(migrations[0]?.count ?? 0),
      worker: heartbeat,
    };
    return NextResponse.json(body, {
      status: heartbeat.healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', detail: redactError(error).message },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}

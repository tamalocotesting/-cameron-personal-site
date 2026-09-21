import 'dotenv/config';
import http from 'node:http';
import { PgBoss } from 'pg-boss';
import type { Job } from 'pg-boss';
import { OutboxStatus } from '@prisma/client';
import { env } from '@/env';
import { prisma } from '@/server/db';
import { now, clockDescription } from '@/server/clock';
import { redactError } from '@/lib/redact';
import { JOB, jobRetryPolicy, type JobName } from '@/server/domain/jobs';
import { recordWorkerHeartbeat, workerHeartbeat } from '@/server/services/operations';
import { handlers, settleOutbox, failOutbox } from './handlers';
import { sweepRateLimits } from '@/server/rate-limit';

/**
 * The durable worker.
 *
 * Scheduled work lives HERE, in a separate process, not in a browser timer and
 * not in a web-request setTimeout. Two loops run:
 *
 *   1. The OUTBOX PUBLISHER reads PENDING rows that the web process wrote
 *      inside a business transaction and hands them to pg-boss. That is what
 *      makes "the case changed AND the job exists" a single atomic fact.
 *   2. pg-boss WORKERS execute the jobs, with per-job retry limits, backoff
 *      and dead-letter visibility.
 *
 * A worker restart loses nothing: every job's source of truth is a database
 * row, and every handler re-reads current state before acting.
 */

const POLL_INTERVAL_MS = 2000;
const connectionString = env.WORKER_DATABASE_URL || env.DATABASE_URL;

let stopping = false;

async function main() {
  console.log(
    `[worker] starting — mode=${env.APP_MODE} clock=${clockDescription()} concurrency=${env.WORKER_CONCURRENCY}`,
  );

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    // The outbox publisher is the pacer; per-queue polling is set in work().

  });

  boss.on('error', (error: unknown) => {
    const info = redactError(error);
    console.error(`[worker] pg-boss error ${info.name}: ${info.message}`);
  });

  await boss.start();

  for (const jobName of Object.values(JOB) as JobName[]) {
    const policy = jobRetryPolicy[jobName];
    await boss.createQueue(jobName, {
      retryLimit: policy.retryLimit,
      retryDelay: policy.retryDelaySeconds,
      retryBackoff: policy.retryLimit > 0,
      expireInSeconds: 120,
      retentionSeconds: 7 * 24 * 3600,
    });

    await boss.work<{ idempotencyKey: string; payload: unknown }>(
      jobName,
      { batchSize: 1, pollingIntervalSeconds: 2 },
      async (jobs: Job<{ idempotencyKey: string; payload: unknown }>[]) => {
        for (const job of jobs) {
          const { idempotencyKey, payload } = job.data;
          try {
            const result = await handlers[jobName](payload);
            await settleOutbox(idempotencyKey, result);
            console.log(`[worker] ${jobName} ${idempotencyKey} -> ${result.detail}`);
          } catch (error) {
            const info = redactError(error);
            // Telemetry carries the failure, never the applicant's words.
            console.error(`[worker] ${jobName} ${idempotencyKey} FAILED ${info.name}: ${info.message}`);
            await failOutbox(idempotencyKey, error, policy.retryLimit);
            throw error;
          }
        }
      },
    );
  }

  startHealthServer();
  void publishLoop(boss);
  void maintenanceLoop();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received; finishing in-flight work`);
    try {
      await boss.stop({ graceful: true, timeout: 20_000 });
    } catch (error) {
      console.error(`[worker] stop error: ${redactError(error).message}`);
    }
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * Outbox publisher.
 *
 * Claims rows one at a time with a conditional update, so two workers cannot
 * publish the same row. `singletonKey` on the send gives pg-boss the same
 * business idempotency key, so even a double publish produces one job.
 */
async function publishLoop(boss: PgBoss) {
  while (!stopping) {
    try {
      await recordWorkerHeartbeat();

      const due = await prisma.outboxRecord.findMany({
        where: { status: OutboxStatus.PENDING, availableAt: { lte: now() } },
        orderBy: { availableAt: 'asc' },
        take: 25,
      });

      for (const record of due) {
        // Conditional claim: only the worker that flips the row publishes it.
        const claimed = await prisma.outboxRecord.updateMany({
          where: { id: record.id, status: OutboxStatus.PENDING },
          data: { status: OutboxStatus.PENDING, attempts: { increment: 0 } },
        });
        if (!claimed.count) continue;

        try {
          await boss.send(
            record.jobName,
            { idempotencyKey: record.idempotencyKey, payload: record.payload },
            { singletonKey: record.idempotencyKey, startAfter: record.availableAt },
          );
          await prisma.outboxRecord.update({
            where: { id: record.id },
            data: { publishedAt: now() },
          });
        } catch (error) {
          const info = redactError(error);
          await prisma.outboxRecord.update({
            where: { id: record.id },
            data: {
              attempts: { increment: 1 },
              lastError: `publish failed: ${info.name}: ${info.message}`,
              availableAt: new Date(now().getTime() + 30_000),
              ...(record.attempts >= 5 ? { status: OutboxStatus.FAILED, deadLetteredAt: now() } : {}),
            },
          });
        }
      }
    } catch (error) {
      console.error(`[worker] publish loop error: ${redactError(error).message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Periodic sweeps: the overdue next-step scan and rate-limit housekeeping. */
async function maintenanceLoop() {
  while (!stopping) {
    await sleep(60_000);
    if (stopping) break;
    try {
      sweepRateLimits();
      const organizations = await prisma.organization.findMany({ select: { id: true } });
      for (const org of organizations) {
        await prisma.outboxRecord.upsert({
          where: { idempotencyKey: `overdue-scan:${org.id}:${now().toISOString().slice(0, 13)}` },
          create: {
            organizationId: org.id,
            jobName: JOB.scanOverdueTasks,
            payload: { organizationId: org.id },
            idempotencyKey: `overdue-scan:${org.id}:${now().toISOString().slice(0, 13)}`,
          },
          update: {},
        });
      }
    } catch (error) {
      console.error(`[worker] maintenance error: ${redactError(error).message}`);
    }
  }
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: env.APP_MODE, clock: clockDescription() }));
      return;
    }
    if (req.url === '/ready') {
      void (async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          const heartbeat = await workerHeartbeat();
          res.writeHead(heartbeat.healthy ? 200 : 503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: heartbeat.healthy ? 'ready' : 'degraded', detail: heartbeat.detail }));
        } catch (error) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', detail: redactError(error).message }));
        }
      })();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(env.WORKER_PORT, () => {
    console.log(`[worker] health server on :${env.WORKER_PORT}`);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('[worker] fatal', redactError(error));
  process.exit(1);
});

import 'server-only';
// This file is the one place allowed to construct the client; the lint rule
// exists to keep every other module importing `prisma` from here.
// eslint-disable-next-line no-restricted-imports
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@/env';

/**
 * One Prisma client per process. Prisma 7 takes its connection through a
 * driver adapter rather than the schema, so the URL lives here and nowhere
 * else in the app.
 */
function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as { __recruiterOsPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__recruiterOsPrisma ?? createClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__recruiterOsPrisma = prisma;
}

/** Transaction handle type used across the services. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

export type DbOrTx = PrismaClient | Tx;

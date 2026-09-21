import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 keeps connection URLs out of the schema. Migration and
 * introspection commands read the URL from here; the runtime client gets it
 * through the pg driver adapter in src/server/db.ts.
 *
 * Tests point DATABASE_URL at TEST_DATABASE_URL before invoking migrate, so
 * the same config serves both.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx --tsconfig tsconfig.scripts.json prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // Only used by `prisma migrate diff --from-migrations`, which replays the
    // committed migrations into a throwaway database to prove they still
    // produce exactly this schema. Nothing at runtime touches it.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? '',
  },
});

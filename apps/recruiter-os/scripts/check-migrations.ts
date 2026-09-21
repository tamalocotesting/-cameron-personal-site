/**
 * Proves the committed migrations still produce exactly prisma/schema.prisma.
 *
 * `prisma migrate diff --from-migrations` replays every committed migration
 * into a throwaway "shadow" database and compares the result with the schema.
 * A schema edit with no matching migration fails here rather than in
 * somebody's deployment.
 *
 * Prisma requires the shadow database to exist already, so this creates it
 * first — and drops it afterwards, because it holds nothing worth keeping.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

const shadowUrl =
  process.env.SHADOW_DATABASE_URL ??
  process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?|$)/, '/recruiteros_shadow$2');

if (!shadowUrl) {
  console.error('Set SHADOW_DATABASE_URL (or DATABASE_URL) first. See .env.example.');
  process.exit(1);
}

const parsed = new URL(shadowUrl);
const shadowName = parsed.pathname.replace(/^\//, '');
if (!shadowName) {
  console.error(`SHADOW_DATABASE_URL has no database name: ${parsed.origin}`);
  process.exit(1);
}

/** The maintenance connection used to create and drop the shadow database. */
function adminUrl() {
  const url = new URL(shadowUrl!);
  url.pathname = '/postgres';
  return url.toString();
}

async function withAdmin(fn: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

function quoteIdent(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

async function main() {
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(shadowName)}`);
    await client.query(`CREATE DATABASE ${quoteIdent(shadowName)}`);
  });

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { stdio: 'inherit', env: { ...process.env, SHADOW_DATABASE_URL: shadowUrl } },
  );

  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(shadowName)}`);
  });

  if (result.status === 0) {
    console.log('\nThe committed migrations reproduce prisma/schema.prisma exactly.');
    process.exit(0);
  }

  console.error(
    result.status === 2
      ? '\nThe schema and the committed migrations disagree. Add a migration for the change above.'
      : '\nThe migration check could not run.',
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

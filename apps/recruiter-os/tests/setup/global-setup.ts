import { execFileSync } from 'node:child_process';
import 'dotenv/config';

/**
 * Applies the committed migrations to the TEST database once per run.
 *
 * The suite runs against real PostgreSQL rather than a stub, because most of
 * what is worth testing here lives in the database: compound foreign keys,
 * check constraints, the appointment exclusion constraint, partial unique
 * indexes and transactional behaviour.
 */
export default async function globalSetup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/recruiteros_test?schema=public';

  if (!/test/i.test(url)) {
    throw new Error(
      `Refusing to run the suite against ${url}: the database name must contain "test", because the suite truncates it.`,
    );
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { resolveDatabaseUrl } from './resolve-database';

/**
 * Local setup, in one command.
 *
 *   pnpm dev:setup
 *
 * Deliberately NOT named `setup`: `pnpm setup` is a built-in pnpm command
 * that configures pnpm's own global bin directory, and it silently shadows a
 * script of the same name — so `pnpm setup` looked like it succeeded while
 * doing nothing at all. `pnpm run setup` still works if you prefer it.
 *
 * It creates .env from the example if it is missing, applies the committed
 * migrations, generates the client and seeds the fictional demo workspace. It
 * does NOT start anything: `pnpm dev` and `pnpm dev:worker` do that, so the
 * two processes stay visible.
 */

const root = process.cwd();

function run(command: string, args: string[], extraEnv: Record<string, string> = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

async function main() {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) {
    copyFileSync(path.join(root, '.env.example'), envPath);
    console.log('Created .env from .env.example.');
    console.log('Set BETTER_AUTH_SECRET to a real value before using this for anything but local work:');
    console.log('  openssl rand -base64 48');
  } else {
    console.log('.env already exists; leaving it alone.');
  }

  // Check the database BEFORE prisma touches it, and repair the URL if some
  // other Postgres has the port. A failure here is a clear sentence rather
  // than a P1000 stack trace three commands later.
  const url = await resolveDatabaseUrl(root);

  run('pnpm', ['exec', 'prisma', 'generate']);
  run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: url });
  run('pnpm', ['run', 'seed'], { DATABASE_URL: url });

  console.log('\nSetup finished. Start the two processes in separate terminals:');
  console.log('  pnpm dev          # the application on http://localhost:3000');
  console.log('  pnpm dev:worker   # the durable worker');
  console.log('\nWithout the worker, scheduled sends, reminders and brief preparation do not run — and the');
  console.log('workspace says so in the mode strip rather than pretending otherwise.');
}

main().catch((error: unknown) => {
  // One readable problem, not a stack trace.
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Work out a DATABASE_URL that actually connects, and write it into .env.
 *
 * This exists because of a genuinely nasty failure mode. On a machine with
 * more than one Postgres — a system install plus a Docker container, a
 * Supabase stack, another project — they fight over port 5432, and the loser
 * binds only one IP stack. Docker takes `127.0.0.1:5432`, the system server
 * ends up on `[::1]:5432`, and then:
 *
 *   * `psql ...@localhost:5432` works, because it resolves ::1 first
 *   * Prisma fails, because its engine resolves IPv4 first and lands on a
 *     DIFFERENT Postgres whose password is not yours
 *
 * The error you get is "authentication failed", which sends you off checking
 * credentials that were never wrong. The connection succeeded. It just went
 * to the wrong server.
 *
 * So rather than make somebody debug that, we try the candidates in order and
 * keep the first that answers.
 */

export type Candidate = { label: string; url: string };

/** Variants of a URL worth trying, in the order most likely to be right. */
export function candidatesFor(url: string): Candidate[] {
  const out: Candidate[] = [{ label: 'as configured', url }];
  const seen = new Set([url]);

  const add = (label: string, next: string) => {
    if (!seen.has(next)) {
      seen.add(next);
      out.push({ label, url: next });
    }
  };

  // Swap the host for each loopback form. A bracketed IPv6 literal is what
  // forces a client off IPv4 and onto the server that actually owns ::1.
  for (const [label, host] of [
    ['IPv6 loopback', '[::1]'],
    ['IPv4 loopback', '127.0.0.1'],
    ['localhost', 'localhost'],
  ] as const) {
    add(`${label} (${host})`, replaceHost(url, host));
  }

  // The unix socket sidesteps ports entirely, so no other server can be in
  // the way. It needs an OS user whose name matches a Postgres role.
  const socketDir = ['/var/run/postgresql', '/tmp'].find((d) => existsSync(d));
  if (socketDir) {
    const asSocket = toSocketUrl(url, socketDir);
    if (asSocket) add(`unix socket (${socketDir})`, asSocket);
  }

  return out;
}

function replaceHost(url: string, host: string): string {
  // Matches everything between the credentials and the port/path, including a
  // bracketed IPv6 literal.
  return url.replace(/^(postgres(?:ql)?:\/\/[^@/]*@)(\[[^\]]*\]|[^:/?]*)/, `$1${host}`);
}

function toSocketUrl(url: string, socketDir: string): string | null {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '');
    if (!database) return null;
    const user = process.env.USER || process.env.LOGNAME || parsed.username;
    if (!user) return null;
    const params = new URLSearchParams(parsed.search);
    params.set('host', socketDir);
    // No password: a socket connection is authenticated by the OS user.
    return `postgresql://${encodeURIComponent(user)}@localhost/${database}?${params.toString()}`;
  } catch {
    return null;
  }
}

/**
 * Connect to the maintenance database, because the application database may
 * not exist yet — that is what migrate is about to create.
 */
function maintenanceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = '/postgres';
    return parsed.toString();
  } catch {
    return url;
  }
}

export type ProbeResult = { ok: true } | { ok: false; error: string };

export async function probe(url: string, timeoutMs = 4000): Promise<ProbeResult> {
  const client = new Client({ connectionString: maintenanceUrl(url), connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.query('select 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Replace DATABASE_URL and its siblings in .env, keeping their databases. */
export function rewriteEnv(envPath: string, host: string, extraParams: string | null) {
  const original = readFileSync(envPath, 'utf8');
  const updated = original
    .split('\n')
    .map((line) => {
      const match = /^(DATABASE_URL|TEST_DATABASE_URL|SHADOW_DATABASE_URL)=(.*)$/.exec(line);
      if (!match) return line;
      const [, key, value] = match;
      if (!value) return line;
      let next = replaceHost(value, host);
      if (extraParams) {
        // Socket form: strip credentials and append the host parameter.
        try {
          const parsed = new URL(next);
          const database = parsed.pathname.replace(/^\//, '');
          const params = new URLSearchParams(parsed.search);
          for (const [k, v] of new URLSearchParams(extraParams)) params.set(k, v);
          const user = process.env.USER || process.env.LOGNAME || parsed.username;
          next = `postgresql://${encodeURIComponent(user!)}@localhost/${database}?${params.toString()}`;
        } catch {
          /* leave it alone rather than mangle it */
        }
      }
      return `${key}=${next}`;
    })
    .join('\n');
  if (updated !== original) writeFileSync(envPath, updated);
  return updated !== original;
}

/**
 * Find a working URL, write it into .env, and return it. Throws with a
 * diagnosis naming the likely culprit if nothing connects.
 */
export async function resolveDatabaseUrl(root: string): Promise<string> {
  const envPath = path.join(root, '.env');
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const candidates = candidatesFor(configured);
  const failures: string[] = [];

  for (const candidate of candidates) {
    const result = await probe(candidate.url);
    if (result.ok) {
      if (candidate.label === 'as configured') {
        console.log('Database connection: ok.');
        return candidate.url;
      }

      console.log(`\nThe configured DATABASE_URL did not connect, but ${candidate.label} did.`);
      console.log('That almost always means another Postgres owns the port on the other IP stack —');
      console.log('a Docker container, a Supabase stack, or a second cluster. Your credentials were');
      console.log('never wrong; the connection was reaching the wrong server.\n');

      const parsed = new URL(candidate.url);
      const socketHost = new URLSearchParams(parsed.search).get('host');
      const changed = rewriteEnv(
        envPath,
        socketHost ? 'localhost' : parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname,
        socketHost ? `host=${socketHost}` : null,
      );
      console.log(changed ? `Updated .env to use ${candidate.label}.` : 'Left .env unchanged.');
      process.env.DATABASE_URL = candidate.url;
      return candidate.url;
    }
    failures.push(`  ${candidate.label}: ${result.error}`);
  }

  throw new Error(
    [
      'Could not reach a Postgres server with any of these:',
      ...failures,
      '',
      'Things worth checking, in order:',
      '  1. Is Postgres running?            pg_lsclusters   (or: systemctl status postgresql)',
      '  2. Who owns the port?              sudo ss -ltnp | grep 5432',
      '     If a docker-proxy owns it, another Postgres is in the way. Either stop that',
      '     container, or point DATABASE_URL at the one you want.',
      '  3. Does the role have a password?  sudo -u postgres psql -c "ALTER USER postgres PASSWORD \'postgres\'"',
    ].join('\n'),
  );
}

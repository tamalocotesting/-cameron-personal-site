import 'dotenv/config';
import { env, demoToolsEnabled } from '../src/env';
import { prisma } from '../src/server/db';

/**
 * Production configuration validator.
 *
 *   pnpm config:check
 *
 * It separates what the APPLICATION can check from what only the HOSTING and
 * OPERATIONS layers can provide, and it says which is which. A clean run here
 * is not an assertion that a deployment is safe or authorized — see
 * SECURITY.md and DEPLOYMENT.md for the checklist a person has to work
 * through.
 */

type Finding = { level: 'error' | 'warning' | 'note'; message: string };

const findings: Finding[] = [];
const fail = (message: string) => findings.push({ level: 'error', message });
const warn = (message: string) => findings.push({ level: 'warning', message });
const note = (message: string) => findings.push({ level: 'note', message });

async function main() {
  console.log('');
  console.log('RecruiterOS configuration check');
  console.log('-------------------------------');
  console.log(`NODE_ENV: ${env.NODE_ENV}`);
  console.log(`APP_MODE: ${env.APP_MODE}`);
  console.log('');

  // ---- application-enforced ---------------------------------------------
  if (env.APP_MODE === 'LIVE' && demoToolsEnabled) {
    fail('Demo tools are enabled in LIVE mode. The application refuses to start in this state.');
  }
  if (env.NODE_ENV === 'production' && env.DEMO_TOOLS_ENABLED) {
    warn(
      'DEMO_TOOLS_ENABLED=true in a production build. That is only acceptable for an explicitly isolated demo deployment: it exposes demo sign-in and the event console.',
    );
  }
  if (env.BETTER_AUTH_SECRET.length < 48) {
    warn('BETTER_AUTH_SECRET is shorter than 48 characters. Use `openssl rand -base64 48`.');
  }
  if (/replace-me|local-development|changeme|secret/i.test(env.BETTER_AUTH_SECRET)) {
    fail('BETTER_AUTH_SECRET still looks like the example value. Generate a real one.');
  }
  if (env.NODE_ENV === 'production' && !env.PUBLIC_APP_URL.startsWith('https://')) {
    fail('PUBLIC_APP_URL is not https. Session cookies will not be marked secure.');
  }
  if (env.PUBLIC_APP_URL !== env.BETTER_AUTH_URL) {
    warn('PUBLIC_APP_URL and BETTER_AUTH_URL differ. Auth callbacks and cookies use BETTER_AUTH_URL.');
  }
  if (env.DEMO_CLOCK && env.APP_MODE === 'LIVE') {
    fail('DEMO_CLOCK is set in LIVE mode. Every due date, quiet-hour check and report would be wrong.');
  }
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    fail('SMTP_HOST is not configured. Invitations and password resets cannot be delivered, so nobody can be onboarded.');
  }
  if (env.SMTP_HOST === 'localhost' && env.NODE_ENV === 'production') {
    warn('SMTP_HOST is localhost in production. That is the local Mailpit capture, not a real mail path.');
  }

  // ---- provider configuration -------------------------------------------
  if (env.APP_MODE === 'LIVE') {
    if (env.TWILIO_ACCOUNT_SID && !env.TWILIO_WEBHOOK_BASE_URL) {
      fail(
        'Twilio credentials are present but TWILIO_WEBHOOK_BASE_URL is not set. Behind a proxy, signature validation will reject every callback.',
      );
    }
    if (env.TWILIO_WEBHOOK_BASE_URL && !env.TWILIO_WEBHOOK_BASE_URL.startsWith('https://')) {
      fail('TWILIO_WEBHOOK_BASE_URL must be https.');
    }
    if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_MODEL) {
      fail('ANTHROPIC_API_KEY is set but ANTHROPIC_MODEL is not. The model id is configuration, not a default.');
    }
    if (env.outboundWebhookAllowedOrigins.length && !env.OUTBOUND_WEBHOOK_SIGNING_SECRET) {
      fail('An outbound webhook allowlist exists but there is no signing secret.');
    }
    for (const origin of env.outboundWebhookAllowedOrigins) {
      if (!origin.startsWith('https://')) fail(`Outbound webhook origin ${origin} is not https.`);
    }
  } else {
    note('DEMO mode: outbound messaging and external AI are blocked regardless of the credentials present.');
  }

  if (env.TRUST_PROXY_HEADERS) {
    warn(
      'TRUST_PROXY_HEADERS=true. Only set this when a proxy you control sets X-Forwarded-*; otherwise a client can spoof its own address.',
    );
  }

  // ---- database ----------------------------------------------------------
  try {
    const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    console.log(`Migrations applied: ${Number(migrations[0]?.count ?? 0)}`);

    // A row with rolled_back_at set has been resolved and is not pending; a
    // row with neither timestamp is a migration that stopped part-way.
    const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `;
    if (Number(pending[0]?.count ?? 0) > 0) fail('There are unfinished migrations. Run `pnpm db:migrate`.');

    const demoOrgs = await prisma.organization.count({ where: { dataScope: 'DEMO' } });
    const liveOrgs = await prisma.organization.count({ where: { dataScope: 'LIVE' } });
    console.log(`Organizations: ${liveOrgs} live, ${demoOrgs} demo`);
    if (env.APP_MODE === 'LIVE' && demoOrgs > 0) {
      warn(
        `${demoOrgs} demo-scoped organization(s) exist in a LIVE deployment. They cannot reach a provider, but they should not be in a live database.`,
      );
    }

    const unpublished = await prisma.organization.findMany({
      where: { dataScope: 'LIVE', intakeDefinitions: { every: { versions: { none: { state: 'PUBLISHED' } } } } },
      select: { slug: true },
    });
    for (const org of unpublished) {
      warn(`${org.slug} has no published intake question set, so its public intake page will refuse to collect anything.`);
    }

    const unapprovedRetention = await prisma.retentionPolicy.count({ where: { enabled: true, approvedAt: null } });
    if (unapprovedRetention > 0) fail(`${unapprovedRetention} retention policy(ies) are enabled without an approval.`);
  } catch (error) {
    fail(`Could not reach the database: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }

  // ---- what only operations can answer -----------------------------------
  console.log('');
  console.log('Checked by this command (application layer)');
  console.log('  · mode and demo-tool coherence, auth secret, origins, clock override');
  console.log('  · provider credential/configuration pairs that would otherwise fail silently');
  console.log('  · migration state, organization data scope, retention approval');
  console.log('');
  console.log('NOT checked here — these are hosting and operations responsibilities');
  console.log('  · TLS termination, HSTS, and certificate management');
  console.log('  · database encryption at rest, backup schedule, and a tested restore');
  console.log('  · secret storage and rotation in a secret manager');
  console.log('  · network restrictions in front of the app and the database');
  console.log('  · log retention and access review');
  console.log('  · a provider’s own data-handling contract with you');
  console.log('  · every organizational approval needed before real applicant data is collected');
  console.log('  See SECURITY.md and DEPLOYMENT.md for the full checklist.');
  console.log('');

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');
  const notes = findings.filter((f) => f.level === 'note');

  for (const group of [
    ['ERROR', errors],
    ['WARNING', warnings],
    ['NOTE', notes],
  ] as const) {
    for (const finding of group[1]) console.log(`${group[0]}: ${finding.message}`);
  }

  console.log('');
  if (errors.length) {
    console.log(`${errors.length} error(s) and ${warnings.length} warning(s). This configuration is not ready.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `No configuration errors. ${warnings.length} warning(s). This says the CONFIGURATION is coherent — it does not say the deployment is authorized or secure.`,
  );
}

main().finally(async () => {
  await prisma.$disconnect();
});

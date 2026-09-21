import 'server-only';
import { z } from 'zod';

/**
 * Environment is validated once, at module load, on the server only.
 *
 * Two rules this file exists to enforce:
 *   1. The application MODE is independent of NODE_ENV. A production build in
 *      DEMO mode is a legitimate, useful thing.
 *   2. Demo shortcuts cannot coexist with LIVE mode. That combination is a
 *      startup failure, not a warning.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_MODE: z.enum(['DEMO', 'LIVE']).default('DEMO'),
  DEMO_TOOLS_ENABLED: boolish.default(false),
  DEMO_CLOCK: z.string().trim().optional().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  PUBLIC_APP_URL: z.string().url(),
  TRUSTED_ORIGINS: z.string().optional().default(''),
  TRUST_PROXY_HEADERS: boolish.default(false),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(1025),
  SMTP_SECURE: boolish.default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default('RecruiterOS <no-reply@recruiteros.invalid>'),

  WORKER_DATABASE_URL: z.string().optional().default(''),
  WORKER_PORT: z.coerce.number().int().positive().optional().default(3001),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().optional().default(4),

  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_WEBHOOK_BASE_URL: z.string().optional().default(''),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().optional().default(''),

  OUTBOUND_WEBHOOK_ALLOWED_ORIGINS: z.string().optional().default(''),
  OUTBOUND_WEBHOOK_SIGNING_SECRET: z.string().optional().default(''),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;

  // Hard invariant. A LIVE deployment must never carry demo authentication
  // shortcuts, the demo event console, or the destructive demo reset.
  if (value.APP_MODE === 'LIVE' && value.DEMO_TOOLS_ENABLED) {
    throw new Error(
      'DEMO_TOOLS_ENABLED=true is not permitted with APP_MODE=LIVE. ' +
        'Demo sign-in shortcuts, the event console and dataset reset must never exist in a live deployment.',
    );
  }
  if (value.NODE_ENV === 'production' && value.DEMO_TOOLS_ENABLED && value.APP_MODE === 'DEMO') {
    // Allowed, but only for an explicitly isolated demo deployment. The
    // production config checker prints this loudly.
  }

  return {
    ...value,
    trustedOrigins: value.TRUSTED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    outboundWebhookAllowedOrigins: value.OUTBOUND_WEBHOOK_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const env = load();

export type AppMode = (typeof env)['APP_MODE'];

export const isDemoMode = env.APP_MODE === 'DEMO';
export const isLiveMode = env.APP_MODE === 'LIVE';
/** Demo sign-in shortcuts, the event console and the dataset reset. */
export const demoToolsEnabled = env.DEMO_TOOLS_ENABLED && env.APP_MODE === 'DEMO';

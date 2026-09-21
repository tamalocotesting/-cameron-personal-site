import { defineConfig } from 'vitest/config';
import path from 'node:path';
import 'dotenv/config';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/recruiteros_test?schema=public';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@worker': path.resolve(import.meta.dirname, 'worker'),
      // The real `server-only` package throws outside Next's server bundle.
      // Tests exercise the same server modules from plain Node, so the guard
      // is swapped for a no-op here and stays active in the application.
      'server-only': path.resolve(import.meta.dirname, 'scripts/shims/server-only.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    setupFiles: ['tests/setup/each.ts'],
    // Integration tests share one database, so they run in a single file at a
    // time rather than fighting over TRUNCATE.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      APP_MODE: 'DEMO',
      DEMO_TOOLS_ENABLED: 'true',
      // Tests pin the clock themselves; the default is the real one.
      DEMO_CLOCK: '',
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-to-pass-validation',
      BETTER_AUTH_URL: 'http://localhost:3000',
      PUBLIC_APP_URL: 'http://localhost:3000',
      SMTP_HOST: '',
      LOG_LEVEL: 'error',
    },
  },
});

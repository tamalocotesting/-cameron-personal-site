import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const baseURL = process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * Browser tests.
 *
 * They run against the real application with the seeded fictional dataset —
 * no request interception and no stubbed data — because the point is to prove
 * the critical workflow works in a browser, at desktop and at 375px.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      // Some environments ship a preinstalled Chromium whose build number does
      // not match this Playwright release. PLAYWRIGHT_CHROMIUM_EXECUTABLE lets
      // the suite use it instead of downloading another copy.
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    },
  },
  projects: [
    {
      // Signs in once per role and saves the sessions the other projects use.
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      dependencies: ['auth-setup'],
    },
    {
      name: 'mobile-375',
      testIgnore: /auth\.setup\.ts/,
      // 375px wide is the constraint the layout has to survive. The device
      // descriptor is a Chromium one on purpose: this suite runs against a
      // single installed browser, and the width and touch behaviour are what
      // is being tested, not a particular engine.
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 375, height: 720 },
        isMobile: true,
        hasTouch: true,
      },
      dependencies: ['auth-setup'],
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

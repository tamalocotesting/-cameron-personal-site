import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://stationops:localdev@localhost:5432/stationops_test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Tests share one database and reset it, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    env: { DATABASE_URL: TEST_DATABASE_URL, INSECURE_COOKIES: 'true' },
  },
});

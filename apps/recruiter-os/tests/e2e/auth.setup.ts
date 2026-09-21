import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNTS, DEMO_PASSWORD, storageStatePath } from './helpers';

/**
 * Signs in once per role and saves the session.
 *
 * Every other test reuses the saved state, which keeps the suite off the
 * deliberately tight sign-in rate limit and makes the runs faster.
 */
setup.describe.configure({ mode: 'serial' });

for (const [role, email] of Object.entries(ACCOUNTS)) {
  setup(`sign in as the ${role}`, async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form').filter({ has: page.getByLabel('Password') });
    await form.getByLabel('Email address').fill(email);
    await form.getByLabel('Password').fill(DEMO_PASSWORD);
    await form.getByRole('button', { name: /^Sign in$/ }).click();
    await page.waitForURL(/\/today/, { timeout: 30_000 });

    const target = storageStatePath(role);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.context().storageState({ path: target });
  });
}

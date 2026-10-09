import { expect, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { migrate } from '../../scripts/migrate';
import { seedDemo } from '../../scripts/seed-demo';
import { TEST_DATABASE_URL } from '../../playwright.config';

export const PASSWORDS = { manager: 'test-manager-pass', employee: 'test-employee-pass' };

let pool: Pool | null = null;
export function db() {
  pool ??= new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  return pool;
}

/** Wipe the test database and load fresh demo data. */
export async function resetDatabase() {
  await db().query('drop schema public cascade; create schema public;');
  await migrate(TEST_DATABASE_URL, () => {});
  await seedDemo({ reset: true, managerPassword: PASSWORDS.manager, employeePassword: PASSWORDS.employee, databaseUrl: TEST_DATABASE_URL });
}

export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAs(page: Page, who: 'manager' | 'alex' | 'jordan') {
  const username = who === 'manager' ? 'demo.manager' : `demo.${who}`;
  await signIn(page, username, who === 'manager' ? PASSWORDS.manager : PASSWORDS.employee);
  await expect(page).toHaveURL(who === 'manager' ? /\/manager$/ : /\/station$/);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login\?signedOut=1/);
}

export const tasks = (page: Page) => page.getByTestId('task');

export async function markDone(page: Page, index: number) {
  const task = tasks(page).nth(index);
  await task.getByRole('checkbox').click();
  await expect(task).toHaveAttribute('data-status', 'done');
}

export async function startChecklist(page: Page) {
  await page.getByRole('button', { name: /Start checklist|Continue checklist/ }).click();
  await expect(page).toHaveURL(/\/station\/checklist$/);
}

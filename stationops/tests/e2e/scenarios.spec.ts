import { expect, test } from '@playwright/test';
import { db, markDone, resetDatabase, signIn, signInAs, signOut, startChecklist, tasks, PASSWORDS } from './helpers';

test.beforeEach(async () => {
  await resetDatabase();
});

test('1. employee opens and completes a checklist; progress persists; manager sees the submission', async ({ page, browser }) => {
  await signInAs(page, 'alex');
  await expect(page.getByText('Bagel Prep Station')).toBeVisible();
  await expect(page.getByText('Not started')).toBeVisible();
  await startChecklist(page);
  await expect(tasks(page)).toHaveCount(8);

  for (let i = 0; i < 4; i++) await markDone(page, i);
  await tasks(page).nth(0).getByRole('button', { name: 'Add note' }).click();
  await tasks(page).nth(0).getByLabel('Note').fill('Used fresh sanitizer bucket');
  await tasks(page).nth(0).getByRole('button', { name: 'Save note' }).click();
  await expect(tasks(page).nth(0).getByText('Used fresh sanitizer bucket')).toBeVisible();

  // Persistence: a full reload reads the state back from the database.
  await page.reload();
  await expect(page.locator('[data-status=done]')).toHaveCount(4);
  await expect(tasks(page).nth(0).getByText('Used fresh sanitizer bucket')).toBeVisible();
  await expect(tasks(page).nth(0).getByText(/Done \d{1,2}:\d{2}\s?[AP]M · Alex Demo/)).toBeVisible();

  // Leave and come back through the dashboard.
  await page.goto('/station');
  await expect(page.getByText('In progress')).toBeVisible();
  await expect(page.getByText('4 of 7')).toBeVisible();
  await startChecklist(page);

  for (let i = 4; i < 8; i++) await markDone(page, i);
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('heading', { name: 'Submit checklist?' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Checklist submitted. Thank you!')).toBeVisible();
  await expect(page.getByText('Every required task was done.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review and submit' })).toHaveCount(0);
  await expect(tasks(page).first().getByRole('checkbox')).toBeDisabled();

  // Duplicate prevention: a second employee on the same station sees the submitted run, not a new one.
  const other = await browser.newPage();
  await signInAs(other, 'jordan');
  await expect(other.getByText(/Submitted at .* by Alex Demo/)).toBeVisible();
  await expect(other.getByRole('button', { name: /Start checklist/ })).toHaveCount(0);
  const runs = await db().query(`select count(*)::int as n from checklist_runs r join restaurants x on x.id = r.restaurant_id
                                 where r.shift_date = (now() at time zone x.timezone)::date`);
  expect(runs.rows[0].n).toBe(1);
  await other.close();

  // Manager sees it as complete with the employee name.
  await signOut(page);
  await signInAs(page, 'manager');
  await expect(page.getByText('Completed today').locator('..').getByText('1', { exact: true })).toBeVisible();
  const todayRow = page.getByRole('row').filter({ hasText: 'Alex Demo' }).filter({ hasText: 'Complete' }).first();
  await expect(todayRow).toBeVisible();
  await expect(todayRow.getByText('7/7')).toBeVisible();
});

test('2. a required task left incomplete is submitted as an exception, never as complete', async ({ page }) => {
  await signInAs(page, 'alex');
  await startChecklist(page);
  for (const i of [0, 1, 2, 3, 5, 7]) await markDone(page, i); // task 5 (labels) and optional task 7 left undone
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('heading', { name: 'Submit with exceptions?' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Verify food labels and dates.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit with exceptions' }).click();
  await expect(page.getByText('Checklist submitted. Thank you!')).toBeVisible();
  await expect(page.getByText(/1 required task not done/)).toBeVisible();

  const { rows } = await db().query(`select outcome from checklist_runs where not is_sample`);
  expect(rows).toEqual([{ outcome: 'exceptions' }]);

  await signOut(page);
  await signInAs(page, 'manager');
  await page.getByRole('row').filter({ hasText: 'Alex Demo' }).filter({ hasText: 'Submitted with exceptions' }).first().getByRole('link').click();
  await expect(page.getByText('6 of 7 (86%)')).toBeVisible();
  const item = page.locator('li', { hasText: 'Verify food labels and dates.' });
  await expect(item.getByText('Not done')).toBeVisible();
});

test('3. employee flags a problem; manager sees it and records a resolution', async ({ page }) => {
  await signInAs(page, 'alex');
  await startChecklist(page);
  const fridge = tasks(page).nth(1);
  await fridge.getByRole('button', { name: 'Report a problem' }).click();

  // Validation: a flag needs a description.
  await fridge.getByLabel('What is the problem?').fill('  ');
  await fridge.getByRole('button', { name: 'Flag problem' }).click();
  await expect(fridge.getByText('Describe the problem in a few words')).toBeVisible();

  await fridge.getByLabel('What is the problem?').fill('Walk-in reads 45°F');
  await fridge.getByRole('button', { name: 'Flag problem' }).click();
  await expect(fridge).toHaveAttribute('data-status', 'blocked');
  await expect(fridge.getByText('Walk-in reads 45°F')).toBeVisible();

  for (const i of [0, 2, 3, 4, 5, 6, 7]) await markDone(page, i);
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await expect(page.getByRole('dialog').getByText('Flagged problems (1)')).toBeVisible();
  await page.getByRole('button', { name: 'Submit with exceptions' }).click();
  await expect(page.getByText('Checklist submitted. Thank you!')).toBeVisible();

  await signOut(page);
  await signInAs(page, 'manager');
  await expect(page.getByText('Walk-in reads 45°F')).toBeVisible();
  await page.goto('/manager/issues');
  const issue = page.locator('li', { hasText: 'Walk-in reads 45°F' });
  await issue.getByLabel('Resolution').fill('x');
  await issue.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(issue.getByText('Describe what was done')).toBeVisible();
  await issue.getByLabel('Resolution').fill('Moved product to reach-in; service call booked for 2 PM.');
  await issue.getByRole('button', { name: 'Mark resolved' }).click();
  // The issue leaves the open list (one sample issue stays open) and appears under "Recently resolved" with its resolution.
  await expect(page.getByRole('heading', { name: 'Open (1)' })).toBeVisible();
  await expect(page.locator('li', { hasText: 'Walk-in reads 45°F' }).getByText('service call booked for 2 PM')).toBeVisible();

  const { rows } = await db().query(`select i.status, i.resolution, u.username from issues i join users u on u.id = i.resolved_by
                                      where i.description = 'Walk-in reads 45°F'`);
  expect(rows).toEqual([{ status: 'resolved', resolution: 'Moved product to reach-in; service call booked for 2 PM.', username: 'demo.manager' }]);
});

test('4. editing a template creates a new version and leaves history unchanged', async ({ page }) => {
  // An employee starts today's checklist on version 1 before the edit.
  await signInAs(page, 'alex');
  await startChecklist(page);
  await markDone(page, 0);
  await signOut(page);

  await signInAs(page, 'manager');
  await page.goto('/manager/templates');
  await page.getByRole('link', { name: 'Edit tasks' }).click();
  const editorTasks = page.getByTestId('template-task');
  await expect(editorTasks).toHaveCount(8);
  await page.getByLabel('Task 1 description').fill('Sanitize surfaces and log sanitizer strength.');
  await page.getByRole('button', { name: 'Move task 3 up' }).click();
  await page.getByRole('button', { name: 'Remove task 8' }).click();
  await page.getByRole('button', { name: '+ Add task' }).click();
  await page.getByLabel('Task 8 description').fill('Restock to-go lids.');
  await editorTasks.nth(7).getByLabel('Required').uncheck();

  // Validation: empty task text is rejected.
  await page.getByRole('button', { name: '+ Add task' }).click();
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText('Each task needs a description')).toBeVisible();
  await page.getByRole('button', { name: 'Remove task 9' }).click();

  await page.getByLabel('What changed? (optional)').fill('Test edit');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText('Saved as version 2')).toBeVisible();
  await expect(page.getByLabel('Task 1 description')).toHaveValue('Sanitize surfaces and log sanitizer strength.');
  await expect(page.getByLabel('Task 2 description')).toHaveValue('Confirm ingredient availability.');

  // Historical sample run (version 1) still shows original wording.
  await page.goto('/manager/history');
  await page.getByRole('row').filter({ hasText: 'Submitted with exceptions' }).first().getByRole('link').click();
  await expect(page.getByText('checklist version 1')).toBeVisible();
  await expect(page.getByText('Sanitize preparation surfaces.')).toBeVisible();
  await expect(page.getByText('Complete station readiness inspection.')).toBeVisible();
  await expect(page.getByText('log sanitizer strength')).toHaveCount(0);

  // Today's already-started run keeps version 1, including its progress.
  await signOut(page);
  await signInAs(page, 'alex');
  await startChecklist(page);
  await expect(tasks(page).nth(0)).toContainText('Sanitize preparation surfaces.');
  await expect(tasks(page).nth(0)).toHaveAttribute('data-status', 'done');

  // A checklist started after the edit uses version 2. (Simulate the next shift by removing today's run.)
  await db().query('delete from checklist_runs where not is_sample');
  await page.goto('/station');
  await startChecklist(page);
  await expect(tasks(page)).toHaveCount(8);
  await expect(tasks(page).nth(0)).toContainText('log sanitizer strength');
  await expect(tasks(page).nth(7)).toContainText('Restock to-go lids.');
  await expect(tasks(page).nth(7)).toContainText('Optional');

  const versions = await db().query('select count(*)::int as n from template_versions');
  expect(versions.rows[0].n).toBe(2);
  const v1 = await db().query('select description from template_tasks tt join template_versions v on v.id = tt.version_id where v.version_number = 1 and tt.position = 1');
  expect(v1.rows[0].description).toBe('Sanitize preparation surfaces.');
});

test('5. employees are denied manager pages, exports and actions', async ({ page }) => {
  await signInAs(page, 'alex');
  for (const path of ['/manager', '/manager/history', '/manager/templates/1', '/manager/staff', '/manager/issues', '/manager/pilot']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/denied$/);
    await expect(page.getByRole('heading', { name: 'That page is for managers' })).toBeVisible();
  }
  const res = await page.request.get('/manager/history/export');
  expect(res.status()).toBe(403);
  expect(await res.text()).not.toContain('run_id');

  // Signed-out requests are refused too.
  const anon = await page.context().browser()!.newContext();
  const anonRes = await anon.request.get('/manager/history/export', { maxRedirects: 0 });
  expect(anonRes.status()).toBe(401);
  await anon.close();
});

test('logout ends the session on the server, not just in the browser', async ({ page }) => {
  await signInAs(page, 'alex');
  const cookie = (await page.context().cookies()).find((c) => c.name === 'stationops_session')!;
  expect(cookie.httpOnly).toBe(true);
  await signOut(page);
  await page.goto('/station');
  await expect(page).toHaveURL(/\/login$/);

  // Replaying the old cookie must not work.
  await page.context().addCookies([cookie]);
  await page.goto('/station');
  await expect(page).toHaveURL(/\/login$/);
});

test('login errors are clear and repeated failures lock the account', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your username.')).toBeVisible();

  for (let i = 0; i < 5; i++) {
    await signIn(page, 'demo.jordan', 'not-the-password');
    await expect(page.getByText('That username and password do not match')).toBeVisible();
  }
  await signIn(page, 'demo.jordan', PASSWORDS.employee);
  await expect(page.getByText(/Too many incorrect attempts/)).toBeVisible();
});

test('CSV export contains filtered records with local times and neutralises formulas', async ({ page }) => {
  await signInAs(page, 'alex');
  await startChecklist(page);
  await tasks(page).nth(0).getByRole('button', { name: 'Add note' }).click();
  await tasks(page).nth(0).getByLabel('Note').fill('=HYPERLINK("http://example.com")');
  await tasks(page).nth(0).getByRole('button', { name: 'Save note' }).click();
  await expect(tasks(page).nth(0).getByText('Saved')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'manager');
  await page.goto('/manager/history');
  const [summary] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV (summary)' }).click()]);
  const text = (await (await summary.createReadStream()).toArray()).join('');
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  expect(lines[0]).toContain('run_id,shift_date,station,checklist');
  expect(lines[0]).toContain('submitted_at (America/Indiana/Indianapolis)');
  expect(lines).toHaveLength(1 + 7); // 6 sample runs + today's
  expect(text).toContain('Submitted with exceptions');
  expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

  // Filtered export.
  await page.getByLabel('Status').selectOption('complete');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('3 runs')).toBeVisible();
  const [filtered] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV (summary)' }).click()]);
  const filteredText = (await (await filtered.createReadStream()).toArray()).join('');
  expect(filteredText.trim().split('\r\n')).toHaveLength(1 + 3);

  await page.goto('/manager/history');
  const [detail] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV (every task)' }).click()]);
  const detailText = (await (await detail.createReadStream()).toArray()).join('');
  expect(detailText).toContain(`"'=HYPERLINK(""http://example.com"")"`);
  expect(detailText).not.toMatch(/,=HYPERLINK/);
});

test('pilot metric counts only fully completed runs and validates input', async ({ page }) => {
  await signInAs(page, 'manager');
  await page.goto('/manager/pilot');
  const { rows } = await db().query<{ start: string; end: string }>(
    `select to_char(d - 7, 'YYYY-MM-DD') as start, to_char(d - 1, 'YYYY-MM-DD') as end
       from (select (now() at time zone timezone)::date as d from restaurants) x`,
  );
  const form = page.getByRole('form', { name: 'Add measurement period' });
  await form.getByLabel('Label').fill('Sample pilot week');
  await form.getByLabel('Type').selectOption('pilot');
  await form.getByLabel('Expected checklists').fill('0');
  await form.getByLabel('Start date').fill(rows[0].start);
  await form.getByLabel('End date').fill(rows[0].end);
  await form.getByLabel('Expected checklists').evaluate((el: HTMLInputElement) => el.removeAttribute('min'));
  await form.getByRole('button', { name: 'Add period' }).click();
  await expect(page.getByText('Expected checklists must be at least 1.')).toBeVisible();

  await form.getByLabel('Expected checklists').fill('7');
  await form.getByRole('button', { name: 'Add period' }).click();
  await expect(page.getByText('Period added.')).toBeVisible();
  // Sample week: 3 complete, 2 with exceptions, 1 never submitted, 1 missing day → 3 / 7.
  await expect(page.getByText('42.9%').first()).toBeVisible();
  await expect(page.getByText('3 complete, 2 with exceptions, 1 never submitted, 1 expected with no record')).toBeVisible();

  await form.getByLabel('Label').fill('Paper baseline');
  await form.getByLabel('Type').selectOption('baseline');
  await form.getByLabel('Expected checklists').fill('14');
  await form.getByLabel('Start date').fill('2026-01-01');
  await form.getByLabel('End date').fill('2026-01-14');
  await form.getByLabel('Entered manually (e.g. paper checklists)').check();
  await form.getByLabel('Fully completed checklists').fill('7');
  await form.getByRole('button', { name: 'Add period' }).click();
  await expect(page.getByText('Baseline vs. pilot')).toBeVisible();
  await expect(page.getByText('-7.1 pts')).toBeVisible();
});

test('manager can add an employee who can then sign in', async ({ page }) => {
  await signInAs(page, 'manager');
  await page.goto('/manager/staff');
  const form = page.getByRole('form', { name: 'Add a person' });
  await form.getByLabel('Name', { exact: true }).fill('Casey Sample');
  await form.getByLabel('Username').fill('casey.sample');
  await form.getByLabel('Temporary password').fill('short');
  await form.getByLabel('Temporary password').evaluate((el: HTMLInputElement) => el.removeAttribute('minlength'));
  await form.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Passwords need at least 8 characters.')).toBeVisible();
  await form.getByLabel('Temporary password').fill('casey-temp-123');
  await form.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText(/Added Casey Sample/)).toBeVisible();
  await signOut(page);
  await signIn(page, 'casey.sample', 'casey-temp-123');
  await expect(page).toHaveURL(/\/station$/);
  await expect(page.getByRole('heading', { name: 'Welcome, Casey' })).toBeVisible();
});

test('no page scrolls sideways at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInAs(page, 'manager');
  for (const path of ['/manager', '/manager/history', '/manager/issues', '/manager/templates', '/manager/pilot', '/manager/staff']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
  await signOut(page);
  await signInAs(page, 'alex');
  await startChecklist(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

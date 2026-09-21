import { expect, test } from '@playwright/test';
import {
  checkAccessibility,
  expectNoHorizontalOverflow,
  openToday,
  screenshot,
  storageStatePath,
} from './helpers';

/**
 * Acceptance 16.
 *
 * The critical workflow in a real browser, at 1440px and at 375px, with an
 * accessibility pass and screenshots on the way through. Nothing is stubbed:
 * these run against the application and the seeded fictional dataset.
 */

test.describe('the recruiter workspace', () => {
  test.use({ storageState: storageStatePath('recruiter') });

  test('shows a priority queue that explains itself', async ({ page }, testInfo) => {
    await openToday(page);

    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    // The governing rule is stated in the workspace, understated.
    await expect(page.getByText('AI prepares. Recruiter decides.')).toBeVisible();
    // And the mode is never in doubt.
    await expect(page.getByText(/Demo mode — fictional data/)).toBeVisible();

    // Rows state their attention reasons in words.
    const reasons = page.getByText(/Callback requested|Human review requested|Follow-up overdue|New reply/);
    expect(await reasons.count()).toBeGreaterThan(0);

    // And the grouping explains the rule that put them there.
    await expect(
      page.getByText(/These come first|past the date it was originally promised|window is open now/).first(),
    ).toBeVisible();

    await screenshot(page, `today-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
    expect(await checkAccessibility(page, `today (${testInfo.project.name})`)).toEqual([]);
  });

  test('opens a case file with a source-linked brief above the transcript', async ({ page }, testInfo) => {
    await openToday(page);
    await page.getByTestId('queue-row').first().click();
    await page.waitForURL(/case=/);

    const casePanel = page.locator('#case-panel');
    await expect(casePanel.getByRole('heading', { name: 'Recruiter brief' })).toBeVisible();

    // The four questions a recruiter needs answered.
    for (const question of [
      'What does this person want?',
      'What have they already told us?',
      'What needs clarification?',
      'What should the recruiter do next?',
    ]) {
      await expect(casePanel.getByText(question)).toBeVisible();
    }

    // Source links are present and honest about what they prove.
    await expect(casePanel.getByText(/They do not prove it is right/)).toBeVisible();
    await expect(casePanel.locator('a[href*="/source/"]').first()).toBeVisible();

    await screenshot(page, `case-file-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
    expect(await checkAccessibility(page, `case file (${testInfo.project.name})`)).toEqual([]);
  });

  test('follows a brief citation through to the exact supporting source', async ({ page }) => {
    await openToday(page);
    await page.getByTestId('queue-row').first().click();
    await page.waitForURL(/case=/);

    await page.locator('a[href*="/source/"]').first().click();
    await page.waitForURL(/\/source\//);

    await expect(page.getByRole('heading', { name: 'Supporting source' })).toBeVisible();
    await expect(page.getByText('Stored text')).toBeVisible();
    // The quoted span is highlighted inside the stored text.
    await expect(page.locator('mark').first()).toBeVisible();
  });

  test('moves between the case sections, and each is deep-linkable', async ({ page }) => {
    await page.goto('/applicants');
    await page.getByRole('link', { name: 'Tasha Alvarez' }).first().click();
    await page.waitForURL(/\/applicants\/[a-z0-9]/);

    for (const [tab, marker] of [
      ['Conversation', /Authorship, approval and transport/],
      ['Intake', /immutable revisions/],
      ['Tasks & appointments', /needs an outcome/],
      ['Activity', /Metadata only/],
    ] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByText(marker).first()).toBeVisible();
    }

    const url = page.url().split('?')[0];
    await page.goto(`${url}?view=conversation`);
    await expect(page.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps the queue filter in the URL and in every case link', async ({ page }) => {
    await openToday(page);

    await page.getByRole('link', { name: /^Overdue/ }).click();
    await page.waitForURL(/filter=overdue/);
    await expect(page.getByRole('link', { name: /^Overdue/ })).toHaveAttribute('aria-current', 'true');

    // The filter travels with every case link, so the view is reproducible
    // from the URL alone rather than held in client memory.
    const hrefs = await page
      .getByTestId('queue-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(1);
    for (const href of hrefs) {
      expect(href).toContain('filter=overdue');
    }

    // Opening a different case keeps the filter, and browser back returns to
    // the filtered view it was opened from.
    const filteredUrl = page.url();
    const other = hrefs.find((href) => !filteredUrl.includes(href.split('case=')[1]!))!;
    const otherCaseId = other.split('case=')[1]!;

    await page.locator(`a[data-testid="queue-row"][href="${other}"]`).click();
    await page.waitForURL(new RegExp(`case=${otherCaseId}`));
    expect(page.url()).toContain('filter=overdue');

    await page.goBack();
    await page.waitForURL(filteredUrl);
    await expect(page.getByRole('link', { name: /^Overdue/ })).toHaveAttribute('aria-current', 'true');
  });

  test('records a call outcome without pretending it was a conversation', async ({ page }) => {
    await page.goto('/applicants');
    await page.getByRole('link', { name: 'Devon Brooks' }).first().click();
    await page.waitForURL(/\/applicants\/[a-z0-9]/);

    await page.getByRole('button', { name: /Record call/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Opening the dialler records nothing; what happened is entered here.
    await expect(dialog.getByText(/Opening the dialler does not record anything/)).toBeVisible();

    await dialog.getByLabel(/What happened/).selectOption('VOICEMAIL');
    await dialog.getByLabel(/^Note/).fill('Left a voicemail asking for a good time.');
    await dialog.getByRole('button', { name: 'Save call' }).click();

    // Dialogs close on success, so the outcome is confirmed on the case.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.getByRole('tab', { name: 'Conversation' }).click();
    await expect(page.getByText(/voicemail/i).first()).toBeVisible();
  });

  test('keeps drafting, approving and queueing as three separate steps', async ({ page }) => {
    await page.goto('/applicants');
    await page.getByRole('link', { name: 'Tasha Alvarez' }).first().click();
    await page.waitForURL(/\/applicants\/[a-z0-9]/);

    await page.getByRole('button', { name: /Prepare message/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Saving a draft is not sending/)).toBeVisible();
    await dialog
      .getByLabel(/^Message/)
      .fill('Hi Tasha — Austin here. Is tomorrow morning any good for a call?');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Conversation' }).click();
    // A draft is visibly NOT sent.
    await expect(page.getByText('Draft — not sent').first()).toBeVisible();

    await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
    // Approved is still not sent.
    await expect(page.getByText('Approved — not sent').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Send…' }).first()).toBeVisible();
  });
});

test.describe('a call nobody answered, answered by text', () => {
  test.use({ storageState: storageStatePath('recruiter') });

  /**
   * The scenario the product exists for: somebody rings while the recruiter
   * is busy, a script takes a few details by text, and the case is waiting in
   * the morning. This drives the real console, the real worker and the real
   * queue — nothing here is stubbed.
   */
  test('turns a missed call into a case the recruiter can open', async ({ page }, testInfo) => {
    // A number nobody in the demo dataset has ever contacted from.
    const caller = `+1512555${String(Date.now()).slice(-4)}`;

    await page.goto('/demo-console');
    await expect(page.getByText(/These are real code paths/)).toBeVisible();

    const call = page.locator('section').filter({ hasText: 'Inbound call' });
    await call.getByLabel('From').fill(caller);
    await call.getByLabel(/Forwarded leg outcome/).selectOption('no-answer');
    await call.getByRole('button', { name: /Place inbound call/ }).click();
    await expect(page.getByText(/taskCreated=true/)).toBeVisible({ timeout: 20_000 });

    const sms = page.locator('section').filter({ hasText: 'Inbound text message' });
    async function say(body: string) {
      await sms.getByLabel('From').fill(caller);
      await sms.getByLabel('Body').fill(body);
      await sms.getByRole('button', { name: /Deliver inbound text/ }).click();
      await expect(page.getByText(/Inbound message recorded/)).toBeVisible({ timeout: 20_000 });
      // The script runs in the worker, so give it a moment to answer.
      await page.waitForTimeout(2500);
    }

    await say('GO');
    await say('Playwright Caller');

    // The next morning: the case is listed under the name they gave, not the
    // phone number it started as. The pages are server-rendered, so this
    // reloads rather than waiting on a static DOM.
    await expect(async () => {
      await page.goto('/applicants?q=Playwright');
      await expect(page.getByRole('link', { name: /Playwright Caller/ }).first()).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });

    await page.getByRole('link', { name: /Playwright Caller/ }).first().click();
    await page.waitForURL(/\/applicants\/[a-z0-9]/);

    await page.getByRole('tab', { name: 'Conversation' }).click();
    // The automated messages are labelled as automation, never as the recruiter.
    await expect(page.getByText(/could not pick up/).first()).toBeVisible();
    await expect(page.getByText(/What name should the recruiter ask for/).first()).toBeVisible();

    // And the callback the caller actually asked for is still outstanding.
    await page.getByRole('tab', { name: 'Tasks & appointments' }).click();
    await expect(page.getByText(/Call back/).first()).toBeVisible();

    await screenshot(page, `text-back-case-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('the applicant experience', () => {
  // Deliberately no session: these pages are public.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('offers both paths and says plainly what it is', async ({ page }, testInfo) => {
    await page.goto('/intake/central-demo');

    await expect(page.getByRole('heading', { name: 'Talk to a recruiter' })).toBeVisible();
    await expect(page.getByText(/automated intake assistant/)).toBeVisible();
    await expect(page.getByText(/A recruiter reads/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request a callback' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share a little more information' })).toBeVisible();

    // The boundaries are stated, not buried.
    await expect(page.getByText(/cannot tell you whether you qualify/)).toBeVisible();
    await expect(page.getByText(/do not ask for a Social Security number/)).toBeVisible();
    // And a demo is labelled as a demo.
    await expect(page.getByText(/Demonstration only/)).toBeVisible();

    await screenshot(page, `intake-start-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
    expect(await checkAccessibility(page, `intake start (${testInfo.project.name})`)).toEqual([]);
  });

  test('walks the callback path with a human request always available', async ({ page }, testInfo) => {
    await page.goto('/intake/central-demo');
    await page.getByRole('button', { name: 'Request a callback' }).click();
    await page.waitForURL(/\/intake\/central-demo\/session/);

    await expect(page.getByRole('heading', { name: 'Request a callback' })).toBeVisible();
    await expect(page.getByText(/Prefer to talk to a person/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and finish later' })).toBeVisible();

    await page.getByLabel(/What name should the recruiter ask for/).fill('Playwright Applicant');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel(/What number should they call/)).toBeVisible();

    await screenshot(page, `intake-question-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
    expect(await checkAccessibility(page, `intake question (${testInfo.project.name})`)).toEqual([]);
  });

  test('stops the questions when a person is asked for, and answers nothing', async ({ page }) => {
    await page.goto('/intake/central-demo');
    await page.getByRole('button', { name: 'Share a little more information' }).click();
    await page.waitForURL(/\/session/);

    await page.getByLabel(/What name should the recruiter ask for/).fill('Handoff Applicant');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/best phone number/).fill('5125559999');
    await page.getByRole('button', { name: 'Continue' }).click();
    // The email question is optional, so it can simply be skipped.
    await page.getByRole('button', { name: 'Skip this one' }).click();
    await expect(page.getByLabel(/Which town or area/)).toBeVisible();

    await page.getByLabel(/Which town or area/).fill('Can I talk to a real person please');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Passed to a recruiter' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/stopped the questions/i).first()).toBeVisible();
    // No eligibility answer of any kind.
    await expect(page.getByText(/you qualify|you are eligible|disqualif/i)).toHaveCount(0);
  });

  test('refuses an unusable resume link without hinting why', async ({ page }) => {
    await page.goto('/resume?t=definitely-not-a-real-token');
    await expect(page.getByRole('heading', { name: /link is not available/i })).toBeVisible();
    await expect(page.getByText(/Nothing you sent before has been lost/)).toBeVisible();
  });

  test('refuses the workspace outright', async ({ page }) => {
    await page.goto('/today');
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('the manager boundary', () => {
  test.use({ storageState: storageStatePath('manager') });

  test('sees operational metadata and is told why content is withheld', async ({ page }) => {
    await page.goto('/applicants');
    await page.getByRole('link', { name: 'Tasha Alvarez' }).first().click();
    await page.waitForURL(/\/applicants\/[a-z0-9]/);

    await expect(page.getByText(/Conversation content is not shown/)).toBeVisible();
    await expect(page.getByText(/needs a case-content grant/)).toBeVisible();
    // The operational metadata they are entitled to is still there.
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();
    await expect(page.getByText('Next action', { exact: true })).toBeVisible();
  });

  test('can read team reporting', async ({ page }, testInfo) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(page.getByText(/fictional demo data/i)).toBeVisible();
    await expect(page.getByText(/never counted as human contact/)).toBeVisible();
    await expect(page.getByText('Time to automated acknowledgment (provider accepted)')).toBeVisible();
    await expect(page.getByText('Time to automated acknowledgment (delivered)')).toBeVisible();
    await expect(page.getByText(/Unanswered inquiries and their age/)).toBeVisible();

    await screenshot(page, `reports-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
    expect(await checkAccessibility(page, `reports (${testInfo.project.name})`)).toEqual([]);
  });
});

test.describe('the recruiter cannot reach administration', () => {
  test.use({ storageState: storageStatePath('recruiter') });

  test('refuses the settings and operations URLs directly', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/limited to organization/i).first()).toBeVisible();
    await page.goto('/operations');
    await expect(page.getByText(/limited to organization administrators/i)).toBeVisible();
  });
});

test.describe('the administrator boundary', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('manages settings without gaining case content by role alone', async ({ page }) => {
    await page.goto('/settings/users');
    await expect(
      page.getByText(/does not by itself grant access to conversation content/i),
    ).toBeVisible();
  });

  test('shows integration status without ever claiming unverified health', async ({ page }, testInfo) => {
    await page.goto('/settings/integrations');

    await expect(page.getByText(/Demo mode blocks every real provider/)).toBeVisible();
    await expect(page.getByText(/Credentials are never stored here/)).toBeVisible();
    // The disabled Twilio adapter names the variables it would need.
    await expect(page.getByText('TWILIO_ACCOUNT_SID missing').first()).toBeVisible();
    await expect(page.getByText(/No check has run/).first()).toBeVisible();

    await screenshot(page, `integrations-${testInfo.project.name}`);
    await expectNoHorizontalOverflow(page);
    expect(await checkAccessibility(page, `integrations (${testInfo.project.name})`)).toEqual([]);
  });

  test('shows the operations view with redacted diagnostics', async ({ page }) => {
    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Operations', level: 1 })).toBeVisible();
    await expect(page.getByText(/Diagnostics are redacted/)).toBeVisible();
    await expect(page.getByText(/Worker (reported|has not reported)/)).toBeVisible();
  });
});

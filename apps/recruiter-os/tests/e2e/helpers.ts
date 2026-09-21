import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

/** The demo password is a fixed, documented value that only exists in the seeded demo organizations. */
export const DEMO_PASSWORD = 'demo-password-not-for-live-use';

export const ACCOUNTS = {
  recruiter: 'austin.reyes@central.invalid',
  manager: 'dana.whitfield@central.invalid',
  admin: 'priya.nandi@central.invalid',
} as const;

export type Role = keyof typeof ACCOUNTS;

/**
 * Where auth.setup.ts saves each role's session.
 *
 * Tests reuse a saved session instead of signing in through the form every
 * time: the sign-in endpoint is deliberately rate limited, and re-using the
 * session keeps the suite testing the workspace rather than the login page.
 */
export function storageStatePath(role: string) {
  return path.join('test-results', 'auth', `${role}.json`);
}

/** The page must never scroll sideways — least of all at 375px. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  // One pixel of slack for sub-pixel layout rounding.
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

export type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
};

/**
 * Runs axe-core in the page and returns serious and critical violations.
 * Moderate and minor findings are printed but do not fail a test, so the
 * suite stays a signal rather than a wall.
 */
export async function checkAccessibility(page: Page, label: string): Promise<AxeViolation[]> {
  const axeSource = fs.readFileSync(
    path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
    'utf8',
  );
  await page.addScriptTag({ content: axeSource });

  const results = (await page.evaluate(async () => {
    // @ts-expect-error -- axe is injected above.
    return window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  })) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: unknown[] }> };

  const all = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
  }));
  const blocking = all.filter((v) => v.impact === 'serious' || v.impact === 'critical');

  if (all.length) {
    console.log(`[a11y] ${label}: ${all.length} violation type(s)`);
    for (const violation of all) {
      console.log(
        `  ${violation.impact ?? 'unknown'} · ${violation.id} · ${violation.nodes} node(s) · ${violation.help}`,
      );
    }
  } else {
    console.log(`[a11y] ${label}: clean`);
  }
  return blocking;
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
}

/** Opens Today and waits for the queue to be present. */
export async function openToday(page: Page) {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: /priority queue/i })).toBeVisible();
}

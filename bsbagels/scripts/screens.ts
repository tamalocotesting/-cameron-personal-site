/**
 * Screenshots of a crew shift on a phone and a manager session on a desktop.
 * Requires a running server (npm start) and demo accounts (npm run seed -- --demo).
 *   BASE=http://127.0.0.1:8787 npm run screens
 * Output: private/screenshots (contains business figures — never commit).
 */
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DATA_DIR } from '../server/db.ts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const OUT = join(ROOT, 'private', 'screenshots');
mkdirSync(OUT, { recursive: true });
const creds = Object.fromEntries(readFileSync(join(DATA_DIR, 'initial-credentials.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [, u, s] = l.trim().split(/\s+/); return [u, s]; }));

const browser = await chromium.launch();
const shot = async (page: any, name: string, full = false) => { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, name), fullPage: full }); console.log('saved', name); };

// ── Crew on a phone ──
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await shot(p, 'phone-01-login.png');
  await p.getByRole('button', { name: /María/ }).click();
  for (const d of creds.maria) await p.getByRole('button', { name: d, exact: true }).click();
  await shot(p, 'phone-02-pin.png');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForSelector('.dayhead');
  await p.getByRole('button', { name: 'ES', exact: true }).first().click();
  await p.waitForTimeout(400);
  await shot(p, 'phone-03-rail-top-es.png');
  await p.locator('.railgroup').first().scrollIntoViewIfNeeded();
  await shot(p, 'phone-04-rail-oven.png');
  await p.locator('.ticket .check').first().click();
  await p.waitForTimeout(500);
  await shot(p, 'phone-05-ticket-done.png');
  await p.locator('.ticket .qty').nth(1).click();
  await p.waitForSelector('.sheet');
  await shot(p, 'phone-06-ticket-why.png');
  await p.keyboard.press('Escape');
  await p.locator('.card .btn', { hasText: 'Cream cheese' }).click();
  await shot(p, 'phone-07-cream-cheese.png');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'EN', exact: true }).first().click();
  await p.waitForTimeout(300);
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, 'phone-08-rail-top-en.png');
  await p.locator('nav.tabs button').nth(1).click();
  await p.locator('button.card', { hasText: 'Rise & Grind' }).first().click();
  await shot(p, 'phone-09-build-card.png');
  await p.getByRole('button', { name: 'ES', exact: true }).first().click();
  await shot(p, 'phone-10-build-card-es.png');
  await p.getByRole('button', { name: 'EN', exact: true }).first().click();
  await p.locator('nav.tabs button').nth(2).click();
  await p.waitForSelector('h1');
  await shot(p, 'phone-11-count.png');
  await p.locator('nav.tabs button').nth(3).click();
  await p.getByRole('textbox', { name: 'Handoff note' }).fill('Ran low on Everything at 9:40 — baked 32 more from thawed. Bacon tray 3 still in walk-in.');
  await p.getByRole('button', { name: /Save handoff/ }).click();
  await p.waitForTimeout(500);
  await shot(p, 'phone-12-handoff.png');
  await p.locator('nav.tabs button').nth(4).click();
  await shot(p, 'phone-13-ask.png');
  await ctx.close();
}

// ── Manager on a desktop ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.getByRole('button', { name: /Manager/ }).click();
  await p.getByLabel('Username').fill('owner');
  await p.getByLabel(/Password/).fill(creds.owner);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForSelector('.dayhead');
  await shot(p, 'desktop-01-today.png');
  await shot(p, 'desktop-02-today-full.png', true);
  await p.goto(BASE + '/#ledger/forecast'); await p.waitForSelector('.kpi', { timeout: 60000 }); await p.waitForSelector('text=Thanksgiving Day', { timeout: 60000 });
  await shot(p, 'desktop-03-forecast.png', true);
  await p.goto(BASE + '/#ledger/history'); await p.waitForSelector('.kpi');
  await p.getByRole('button', { name: /Compare with same days/ }).click(); await p.waitForTimeout(800);
  await shot(p, 'desktop-04-history.png', true);
  await p.goto(BASE + '/#ledger/assumptions'); await p.waitForSelector('table');
  await shot(p, 'desktop-05-assumptions.png', true);
  await p.goto(BASE + '/#ledger/catering'); await p.waitForSelector('h1');
  await shot(p, 'desktop-06-catering.png');
  await p.goto(BASE + '/#ledger/imports'); await p.waitForSelector('table');
  await shot(p, 'desktop-07-imports.png');
  await p.goto(BASE + '/#ledger/recipes'); await p.waitForSelector('table');
  await shot(p, 'desktop-08-recipes.png');
  await p.goto(BASE + '/#ledger/audit'); await p.waitForSelector('table');
  await shot(p, 'desktop-09-audit.png');
  await p.goto(BASE + '/#ledger/backups'); await p.waitForSelector('h1');
  await shot(p, 'desktop-10-backups.png');
  await ctx.close();
}
await browser.close();

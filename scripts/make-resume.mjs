/**
 * Renders public/resume.pdf from the site's own /resume page, so the PDF and
 * the page can never disagree — same data, same typography, same status
 * labels on the projects.
 *
 * Needs a local Chromium and a running preview, so it is a manual step rather
 * than part of the build:
 *
 *   npm run build:fast && npx astro preview --port 4321 &
 *   node scripts/make-resume.mjs
 */
import { chromium } from 'playwright';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.PREVIEW_URL || 'http://localhost:4321';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

const res = await page.goto(`${url}/resume`, { waitUntil: 'networkidle' });
if (!res || !res.ok()) {
  throw new Error(`Could not load ${url}/resume — is the preview server running?`);
}
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

await page.pdf({
  path: join(root, 'public/resume.pdf'),
  format: 'A4',
  printBackground: true,
  margin: { top: '15mm', right: '14mm', bottom: '15mm', left: '14mm' },
});

await browser.close();
console.log('public/resume.pdf written');

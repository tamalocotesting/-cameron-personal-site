/**
 * Renders the social cards in public/ with the site's own typefaces.
 *
 * Needs a local Chromium, so it is a deliberate manual step rather than part
 * of the build — Netlify never runs it. Re-run after changing a project title,
 * tagline or status:  node scripts/make-og.mjs
 *
 * Project copy is read straight out of src/data/projects.ts so the cards can
 * never drift from the pages. If that file's shape changes, this throws rather
 * than quietly rendering something stale.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

// ---- pull the project copy out of the data module ---------------------------
const src = readFileSync(join(root, 'src/data/projects.ts'), 'utf8');
const field = (block, name) => {
  const m = block.match(new RegExp(`${name}:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return m ? m[2].replace(/\s+/g, ' ').trim() : null;
};
const stageLabels = { built: 'Built', 'in-progress': 'In progress', concept: 'Concept' };

const blocks = src.split(/\n  \{\n/).slice(1);
const projects = blocks
  .map((b) => ({
    slug: field(b, 'slug'),
    title: field(b, 'title'),
    tagline: field(b, 'tagline'),
    stage: field(b, 'stage'),
  }))
  .filter((p) => p.slug && p.title && p.tagline && stageLabels[p.stage]);

if (projects.length !== 3) {
  throw new Error(`Expected 3 projects from projects.ts, parsed ${projects.length}. Check the file's shape.`);
}

// ---- cards to render --------------------------------------------------------
const cards = [
  {
    file: 'og.png',
    eyebrow: 'Implementation · operations · training',
    title: 'Before it was called implementation,',
    sub: 'it was called opening a restaurant.',
    rail: [
      ['Now', 'Back-of-House Manager, B&rsquo;s Bagels'],
      ['Before', 'New-location opening trainer'],
      ['Based', 'Carmel, Indiana'],
    ],
  },
  {
    file: 'og-background.png',
    eyebrow: 'Background',
    title: 'I didn’t set out to build software.',
    sub: 'I set out to stop losing the same twenty minutes every morning.',
    rail: [
      ['Span', '10+ years, hospitality and retail'],
      ['Now', 'Back of house, and building around it'],
      ['Wants', 'Onboarding · implementation'],
    ],
  },
  {
    file: 'og-resume.png',
    eyebrow: 'Résumé',
    title: 'Cameron Macek',
    sub: 'Customer onboarding · implementation · operations & training.',
    rail: [
      ['Span', '10+ years'],
      ['Now', 'Back-of-House Manager'],
      ['Based', 'Carmel, Indiana'],
    ],
  },
  ...projects.map((p) => ({
    file: `og-${p.slug}.png`,
    eyebrow: 'Selected work',
    title: p.title,
    sub: p.tagline,
    badge: stageLabels[p.stage],
  })),
];

// ---- template ---------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'og-'));
for (const f of ['archivo-var-latin.woff2', 'source-serif-4-var-latin.woff2', 'plex-mono-500-latin.woff2']) {
  copyFileSync(join(pub, 'fonts', f), join(work, f));
}

const page = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'A';src:url('archivo-var-latin.woff2') format('woff2');font-weight:100 900;font-display:block}
@font-face{font-family:'S';src:url('source-serif-4-var-latin.woff2') format('woff2');font-weight:200 900;font-display:block}
@font-face{font-family:'M';src:url('plex-mono-500-latin.woff2') format('woff2');font-weight:500;font-display:block}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px}
body{background:#f4f1e9;color:#16130f;font-family:'A',sans-serif;padding:70px 80px;
 display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;align-items:center;gap:15px}
.mark{width:20px;height:20px;background:#d4490f;border-radius:2px;transform:rotate(45deg)}
.who{font-size:26px;font-weight:620;letter-spacing:-.02em}
.eyebrow{font-family:'M',monospace;font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:#625b50;margin-bottom:22px}
h1{font-size:${c.title.length > 34 ? 66 : 78}px;font-weight:620;letter-spacing:-.036em;line-height:1;max-width:17ch}
.sub{margin-top:18px;font-family:'S',serif;font-size:30px;line-height:1.3;color:#413b32;max-width:30ch}
.rail{display:flex;gap:44px;border-top:1px solid rgba(22,19,15,.2);padding-top:24px}
.cell{display:flex;flex-direction:column;gap:6px}
.k{font-family:'M',monospace;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#625b50}
.v{font-size:19px;font-weight:520;letter-spacing:-.01em}
.badge{display:inline-flex;align-items:center;gap:9px;font-family:'M',monospace;font-size:15px;
 letter-spacing:.12em;text-transform:uppercase;padding:9px 15px;border:1px solid rgba(22,19,15,.4);
 border-radius:4px;color:#413b32;align-self:flex-start}
.badge i{width:8px;height:8px;border-radius:50%;background:#d4490f;display:block}
</style></head><body>
<div class="top"><span class="mark"></span><span class="who">Cameron Macek</span></div>
<div>
  <div class="eyebrow">${c.eyebrow}</div>
  <h1>${c.title}</h1>
  <div class="sub">${c.sub}</div>
</div>
${
  c.badge
    ? `<div class="badge"><i></i>${c.badge}</div>`
    : `<div class="rail">${c.rail.map(([k, v]) => `<div class="cell"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>`
}
</body></html>`;

// ---- render -----------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
for (const c of cards) {
  const html = join(work, 'card.html');
  writeFileSync(html, page(c));
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await tab.goto('file://' + html, { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(350);
  await tab.screenshot({ path: join(pub, c.file) });
  await tab.close();
  console.log(`  ${c.file}`);
}
await browser.close();
console.log(`${cards.length} social cards rendered`);

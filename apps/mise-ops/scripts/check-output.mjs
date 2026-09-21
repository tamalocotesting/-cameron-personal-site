/**
 * Post-build checks on the generated HTML.
 *
 * These catch the mistakes that are invisible in source review but obvious to
 * a visitor or a crawler:
 *
 *   1. An HTML entity written inside a component prop or a data file, which
 *      Astro escapes — so `&rsquo;` ships to the page as literal text.
 *   2. A straight quote or apostrophe in rendered copy, next to typographic
 *      ones everywhere else.
 *   3. A link to a page or an anchor that does not exist. The site points at
 *      routes that have not been built yet during phased delivery, and a dead
 *      nav item is the fastest way to lose an owner's trust.
 *   4. A heading outline that skips a level, or a page with no or many h1.
 *   5. An image with no alt attribute.
 *
 * Runs as part of `npm run build` and `npm run build:fast`.
 */
import { globSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

const files = globSync('dist/**/*.html');
if (files.length === 0) {
  console.error('check-output: no HTML found in dist/ — did the build run?');
  process.exit(1);
}

const decode = (t) =>
  t
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const textOf = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  );

/** Every route the build produced, as a site-absolute path. */
const routes = new Set(
  files.map((f) => {
    const rel = relative('dist', f).replace(/\\/g, '/');
    return '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
  })
);
routes.add('/');

const problems = [];

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const text = textOf(html);
  const where = relative('dist', file);

  // 1. Escaped entities that leaked through as visible text.
  for (const m of text.matchAll(/&amp;(#?\w{2,10});/g)) {
    problems.push(`${where}: literal entity "&${m[1]};" in visible text — write the character itself`);
  }

  // 2. Straight apostrophes and quotes in prose.
  for (const m of text.matchAll(/\w'\w|\s"[A-Za-z]/g)) {
    const at = m.index ?? 0;
    problems.push(
      `${where}: straight quote in "${text.slice(Math.max(0, at - 28), at + 28).replace(/\s+/g, ' ').trim()}"`
    );
  }

  // 3. Links that go nowhere.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:)/.test(href)) continue;

    const [path, hash] = href.split('#');
    if (!path && hash) {
      if (!ids.has(hash)) problems.push(`${where}: anchor "#${hash}" has no matching id on the page`);
      continue;
    }
    const clean = path.replace(/\/$/, '') || '/';
    if (!routes.has(clean)) {
      problems.push(`${where}: link to "${href}" — no such page was built`);
    }
  }

  // 4. Heading outline.
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) problems.push(`${where}: ${h1s} <h1> elements — expected exactly 1`);
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) {
      problems.push(`${where}: heading jumps from h${levels[i - 1]} to h${levels[i]}`);
    }
  }

  // 5. Images without alt text.
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt=/.test(m[0])) problems.push(`${where}: <img> with no alt attribute`);
  }
}

if (problems.length) {
  console.error(`\ncheck-output: ${problems.length} problem(s)\n`);
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

console.log(`check-output: ${files.length} page(s) clean`);

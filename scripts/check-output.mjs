/**
 * Post-build checks on the generated HTML.
 *
 * These catch the two mistakes that are invisible in source review but obvious
 * to a visitor:
 *   1. An HTML entity written inside a component prop or a data file, which
 *      Astro escapes — so `&rsquo;` ships to the page as literal text.
 *   2. A straight quote or apostrophe in rendered copy, which looks wrong next
 *      to the typographic ones used everywhere else.
 *
 * Run automatically as part of `npm run build`.
 */
import { globSync, readFileSync } from 'node:fs';

const files = globSync('dist/**/*.html');
if (files.length === 0) {
  console.error('check-output: no HTML found in dist/ — did the build run?');
  process.exit(1);
}

// Text content only: strip scripts, styles, tags and JSON-LD, then decode the
// entities Astro emits — otherwise a straight quote hides behind &#39; and the
// straight-quote check below silently passes.
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

const problems = [];

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const text = textOf(html);

  // 1. Escaped entities that leaked through as visible text.
  for (const m of text.matchAll(/&amp;(#?\w{2,10});/g)) {
    problems.push(`${file}: literal entity "&${m[1]};" in visible text — write the character itself`);
  }

  // 2. Straight apostrophes and quotes in prose.
  for (const m of text.matchAll(/\w'\w|\s"[A-Za-z]/g)) {
    const at = m.index ?? 0;
    problems.push(
      `${file}: straight quote in "${text.slice(Math.max(0, at - 28), at + 28).replace(/\s+/g, ' ').trim()}"`
    );
  }
}

if (problems.length) {
  console.error(`\ncheck-output: ${problems.length} problem(s)\n`);
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

console.log(`check-output: ${files.length} pages clean`);

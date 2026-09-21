/**
 * Copies only the Latin font files this site uses out of node_modules and into
 * public/fonts, so the deploy ships the two faces we set rather than every
 * subset Fontsource publishes (Cyrillic, Greek, Vietnamese — none of them used).
 *
 * Run after bumping a @fontsource dependency:  npm run fonts
 *
 * NOTE: netlify.toml caches /fonts/* as immutable for a year and these names
 * are not content-hashed. If a font file's *contents* ever change, rename it
 * here and in the @font-face rules in src/styles/global.css, or returning
 * visitors keep the stale copy forever.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/fonts');
mkdirSync(out, { recursive: true });

const files = [
  [
    '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
    'schibsted-grotesk-var-latin.woff2',
  ],
  [
    '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
    'jetbrains-mono-var-latin.woff2',
  ],
];

for (const [from, to] of files) {
  copyFileSync(resolve(root, 'node_modules', from), resolve(out, to));
  console.log(`  ${to}`);
}
console.log(`${files.length} font files synced to public/fonts`);

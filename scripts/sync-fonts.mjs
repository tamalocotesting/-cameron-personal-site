/**
 * Copies just the Latin font files this site uses out of node_modules and into
 * public/fonts, so the deploy ships ~113kB of type instead of every subset
 * Fontsource publishes (Cyrillic, Greek, Vietnamese — none of which we set).
 *
 * Run after bumping a @fontsource dependency:  npm run fonts
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/fonts');
mkdirSync(out, { recursive: true });

const files = [
  ['@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2', 'archivo-var-latin.woff2'],
  ['@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2', 'source-serif-4-var-latin.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400-latin.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'plex-mono-500-latin.woff2'],
];

for (const [from, to] of files) {
  copyFileSync(resolve(root, 'node_modules', from), resolve(out, to));
  console.log(`  ${to}`);
}
console.log(`${files.length} font files synced to public/fonts`);

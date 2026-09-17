// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://cameronmacek.com',
  trailingSlash: 'never',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  vite: {
    build: {
      // Lightning CSS owns vendor prefixing, and with no targets declared it
      // assumes the newest browsers and strips prefixes it thinks are dead —
      // which silently dropped -webkit-backdrop-filter and
      // -webkit-text-decoration-color, both still required on iOS 15-17.
      // Declaring the floor explicitly makes it emit the prefixed and standard
      // properties together, so source CSS can stay unprefixed.
      cssTarget: ['safari15', 'firefox103', 'chrome90', 'edge90'],
    },
  },
});

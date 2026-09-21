// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { resolveSiteUrl, isProductionDeploy } from './site.config.mjs';

// A deploy preview must not advertise itself as miseops.com — canonical tags,
// the sitemap and OG image URLs all derive from this one value.
const site = resolveSiteUrl();

export default defineConfig({
  site,
  trailingSlash: 'never',
  integrations: [
    // Previews are noindex (see src/pages/robots.txt.ts), so there is nothing
    // for a sitemap to usefully point at either.
    ...(isProductionDeploy()
      ? [
          sitemap({
            // A thank-you page in the index skews conversion data and is
            // useless to a searcher. It carries noindex too.
            filter: (page) => !page.endsWith('/thanks'),
          }),
        ]
      : []),
  ],
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
      // Lightning CSS owns vendor prefixing. With no targets declared it
      // assumes the newest browsers and strips prefixes it thinks are dead —
      // including -webkit-backdrop-filter, which iOS 15-17 still needs.
      // Declaring the floor makes it emit prefixed and standard together.
      cssTarget: ['safari15', 'firefox103', 'chrome90', 'edge90'],
    },
  },
});

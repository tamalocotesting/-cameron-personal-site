/**
 * The one place the MISE OPS domain is written down.
 *
 * Nothing else in the codebase may hardcode a production URL. Pages read the
 * resolved value from `Astro.site`, which Astro populates from the `site`
 * field in astro.config.mjs — which is this function.
 *
 * Resolution order, highest first:
 *   1. SITE_URL          — explicit override, for a staging domain or a local
 *                          preview that needs absolute URLs.
 *   2. DEPLOY_PRIME_URL  — Netlify's per-deploy URL, set on deploy previews and
 *                          branch deploys. Using it means a preview's canonical
 *                          tags, sitemap and OG images point at the preview
 *                          itself rather than claiming to be production.
 *   3. PRODUCTION_URL    — the real domain.
 *
 * `isProductionDeploy` is deliberately separate from "did we get a URL": a
 * branch deploy has a perfectly good URL and still must not be indexed.
 */

/** The intended production domain. Change it here and nowhere else. */
export const PRODUCTION_URL = 'https://miseops.com';

const trim = (url) => (url && url.endsWith('/') ? url.slice(0, -1) : url);

/**
 * True only for a real production build. Netlify sets CONTEXT to one of
 * 'production' | 'deploy-preview' | 'branch-deploy' | 'dev'. Off Netlify
 * (local `npm run build`) there is no CONTEXT, and a local build is not a
 * production deploy — so previews and local builds behave the same way.
 */
export function isProductionDeploy(env = process.env) {
  return env.CONTEXT === 'production';
}

/** The absolute origin this build should describe itself with. */
export function resolveSiteUrl(env = process.env) {
  return trim(env.SITE_URL || (!isProductionDeploy(env) && env.DEPLOY_PRIME_URL) || PRODUCTION_URL);
}

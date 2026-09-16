/**
 * Site-wide identity and contact details.
 *
 * ── EDIT ME ────────────────────────────────────────────────────────────────
 * Everything a future you needs to change lives in this one file.
 *  • `email`     — the address the contact buttons open.
 *  • `profiles`  — add a URL to make the link appear in the header/footer.
 *                  Leave a URL empty and the link is simply not rendered, so
 *                  the site never ships a dead link.
 *  • `url`       — the production domain (also used for canonical + sitemap;
 *                  keep in sync with `site` in astro.config.mjs).
 * ───────────────────────────────────────────────────────────────────────────
 */

export const site = {
  name: 'Cameron Macek',
  shortName: 'Cameron Macek',
  url: 'https://cameronmacek.com',
  locale: 'en_US',
  location: 'Carmel, Indiana',
  locationLong: 'Carmel, Indiana — open to remote',

  /** Used in <title> suffixes and the header wordmark. */
  role: 'Implementation, Operations & Training',

  /** The one-line description used for SEO + social cards. */
  description:
    'Cameron Macek has spent ten years getting teams to standard — new-location openings, back-of-house management, customer-facing retail — and now builds the internal tools and AI workflows that do the same job.',

  email: 'cmacek91@gmail.com',

  /** Add a URL to switch a link on. Empty string = hidden everywhere. */
  profiles: [
    { label: 'LinkedIn', url: '' },
    { label: 'GitHub', url: '' },
  ] as const,
} as const;

export const nav = [
  { label: 'Work', href: '/#work' },
  { label: 'Approach', href: '/#approach' },
  { label: 'Background', href: '/background' },
] as const;

/** Links that actually exist, ready to render. */
export const activeProfiles = site.profiles.filter((p) => p.url.length > 0);

export const mailto = (subject?: string) =>
  subject ? `mailto:${site.email}?subject=${encodeURIComponent(subject)}` : `mailto:${site.email}`;

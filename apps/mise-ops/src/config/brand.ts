/**
 * MISE OPS — brand and business facts.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * Everything in this file is a claim the site makes in public. Nothing goes in
 * here that has not been supplied and confirmed. No invented address, no
 * invented opening hours, no invented customer count, no invented results.
 * A field left empty is simply not rendered anywhere, so the site can never
 * ship a placeholder or a dead link.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The production URL is deliberately NOT here — it lives in site.config.mjs,
 * and pages read it from `Astro.site`.
 */

export const brand = {
  name: 'MISE OPS',
  /** Used where the full name would be shouty mid-sentence. */
  shortName: 'MISE',
  tagline: 'Everything in its place. Including how your restaurant runs.',

  /** The one-sentence description used for SEO, social cards and schema. */
  description:
    'MISE OPS turns the knowledge trapped in your restaurant’s owners and managers into a simple operating system your entire team can follow.',

  /** CONFIRM BEFORE LAUNCH: this mailbox must exist. */
  email: 'hello@miseops.com',

  /**
   * Empty until a real business line exists. Empty = hidden everywhere.
   * Typed as string rather than inferred as the '' literal, so the guards that
   * hide it still typecheck once a real number is filled in.
   */
  phone: '' as string,

  /**
   * No street address is published. MISE OPS works on-site in client
   * restaurants; it has not supplied a business address, and inventing one
   * would be a fabricated business fact. Schema uses areaServed instead.
   */
  address: null,

  /** Region for schema and copy. */
  region: 'Central Indiana',
} as const;

/** Calls to action. Every CTA on the site reads from this object. */
export const cta = {
  primary: { label: 'Book an Operations Walkthrough', href: '/contact' },
  secondary: { label: 'See How MISE Works', href: '/how-it-works' },
} as const;

export const nav = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Sprint', href: '/sprint' },
  { label: 'Care', href: '/care' },
  { label: 'Examples', href: '/examples' },
  { label: 'About', href: '/about' },
] as const;

export const footerNav = {
  service: [
    { label: 'How it works', href: '/how-it-works' },
    { label: 'MISE OPS Sprint', href: '/sprint' },
    { label: 'MISE OPS Care', href: '/care' },
    { label: 'Examples', href: '/examples' },
    { label: 'What it costs you now', href: '/how-it-works#calculator' },
  ],
  company: [
    { label: 'About', href: '/about' },
    { label: 'Book a walkthrough', href: '/contact' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
  ],
} as const;

/**
 * Pricing. "Starting around" is load-bearing — these are entry points for a
 * scoped engagement, not a fixed price list, and the copy must never imply
 * unlimited scope.
 */
export const pricing = {
  sprint: {
    name: 'MISE OPS Sprint',
    from: '$2,500',
    qualifier: 'Starting around',
    unit: 'one location',
  },
  care: {
    name: 'MISE OPS Care',
    from: '$349',
    qualifier: 'Starting around',
    unit: 'per month',
  },
} as const;

export const mailto = (subject?: string) =>
  subject ? `mailto:${brand.email}?subject=${encodeURIComponent(subject)}` : `mailto:${brand.email}`;

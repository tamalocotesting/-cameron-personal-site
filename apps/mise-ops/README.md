# MISE OPS — public site

The marketing and sales site for MISE OPS, a restaurant-operations service
business working in Carmel, Westfield, Fishers, Indianapolis, Noblesville and
Zionsville.

Static Astro. No database, no backend, no client framework. First load is
~107 kB including both typefaces, and **nothing on the page depends on
JavaScript** — the whole site renders and every control works with script
blocked.

---

## It is a separate application

This directory is a standalone project that happens to live in the same
repository as `cameronmacek.com`. It has its own `package.json`,
`node_modules`, Astro config, Netlify config, design system and deploy.

**It shares no code, no styling and no configuration with the site at the
repository root, and it must not start.** MISE OPS is its own brand. If
something here needs a thing the other site has, copy it.

### Extracting it into its own repository

Nothing in this directory reaches outside it, so extraction is one command and
keeps the full history:

```bash
git subtree split --prefix=apps/mise-ops -b mise-ops-standalone
```

Then push that branch as the new repository's `main`. The only thing to change
afterwards is the Netlify site's base directory (below).

## Running it

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # type-check, build, then check the output
npm run preview      # serve dist/
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | `astro check`, production build, then `check-output.mjs` |
| `npm run build:fast` | Build without the type-check — what Netlify runs |
| `npm run check:output` | Post-build HTML checks (entities, quotes, dead links, heading order, alt text) |
| `npm run verify` | Browser checks: contrast, overflow, tap targets, no-JS (needs a preview server) |
| `npm run og` | Re-render `public/og.png` and the PNG icons |
| `npm run fonts` | Re-copy the Latin font files after a `@fontsource` bump |

`verify` and `og` need Playwright, which is deliberately **not** a dependency:

```bash
npm install --no-save playwright
npm run build:fast
npx astro preview --port 4331 &
npm run verify
```

## The domain lives in exactly one place

`site.config.mjs` is the only file that names the production domain. Everything
else reads the resolved value from `Astro.site`.

```
SITE_URL           explicit override (staging, local absolute URLs)
DEPLOY_PRIME_URL   Netlify's per-deploy URL — used on previews and branch deploys
PRODUCTION_URL     the real domain, in site.config.mjs
```

A deploy preview therefore describes *itself* in its canonical tags, OG image
URLs and sitemap, and `robots.txt` (a route, not a static file) serves
`Disallow: /` with a `noindex` meta tag anywhere that is not a production
deploy. A preview can never compete with the real site in search.

## Deploying

Create a **second** Netlify site pointing at this repository:

- **Base directory:** `apps/mise-ops`
- Build command and publish directory come from `netlify.toml` in this folder.

The repository root has its own `netlify.toml` for `cameronmacek.com`. The two
sites build from the same repository and never touch each other.

> `public/_headers` mirrors the `[[headers]]` blocks in `netlify.toml`, because
> `netlify.toml` is only read when Netlify runs the build. Change one, change
> the other.

> `/fonts/*` is cached immutable for a year and the filenames are not
> content-hashed. If a font file's *contents* change, rename it in
> `scripts/sync-fonts.mjs` and in the `@font-face` rules in
> `src/styles/tokens.css`, or returning visitors keep the stale copy.

## Where to change things

**`src/config/brand.ts`** — name, tagline, email, phone, pricing, navigation,
calls to action. Everything in it is a claim the site makes in public, so
nothing goes in that has not been supplied and confirmed. A field left empty is
not rendered at all, so the site can never ship a placeholder or a dead link.

**`src/config/forms.ts`** — which lead provider is in use.

**`src/data/`** — the content that is really a list: the method, the FAQ, what
MISE OPS organizes, the service areas, the demonstration restaurant.

## Lead capture

Every form submits through `src/lib/leads.ts`, which is the seam between the
form and wherever leads actually go. Today it encodes for **Netlify Forms** —
no backend, no keys. Moving to a CRM, a scheduler or a webhook means changing
that module and `src/config/forms.ts`; no form component or field definition
changes.

`walkthroughFields` in that file is the single definition of the Operations
Walkthrough request: it renders the fields, and it is what a future CRM mapping
gets written against. Bot submissions are caught with a honeypot field, and a
filled honeypot returns success so the bot learns nothing.

Progressive enhancement is the rule: the form element is a real POST with the
right hidden fields, so a submission still works if the script never runs.

## Analytics

`src/lib/analytics.ts` defines the whole event vocabulary and one `track()`
function. **No third-party script is loaded, no cookie is set and no identifier
is stored**, so the site needs no consent banner. `track()` emits a DOM
CustomEvent and forwards to Plausible or Umami *if* one has been added to the
page; with neither present it is a no-op.

Instrument a control by adding an attribute, not a listener:

```html
<a href="/contact" data-track="cta_click" data-track-props='{"location":"hero"}'>
```

## Local SEO

`src/data/service-areas.ts` holds all six markets. Two separate jobs:

- **Every** entry appears in `areaServed` on the organisation schema and in the
  footer. That is a true statement about where the business works.
- Only an entry with `publish: true` gets its own page. The route generates
  from the data, but a location page that swaps a city name into the same
  paragraph is a doorway page — thin, obviously templated to an owner, and
  demoted by search engines. The bar for publishing is a real `angle` and real
  `detail` that are not true of the other cities.

All six are currently `publish: false`, because that content does not exist
yet. The capability is built; the pages wait for something worth reading.

## Honesty rules this site is built to keep

There are no MISE OPS customers to quote yet, so:

- No testimonials, no client logos, no customer counts, no ROI statistics.
- No business facts that were not supplied — there is no street address, no
  opening hours and no phone number anywhere, including in the structured data.
  Schema uses `ProfessionalService` with `areaServed` rather than
  `LocalBusiness` with an invented premises.
- The Before/After demonstration restaurant, Birch & Board, is fictional and is
  labelled as a demonstration everywhere it appears. See the header comment in
  `src/data/demo.ts`.
- Pricing says "starting around" because it is an entry point for a scoped
  engagement, and both offers state in writing what they do not include.

Verified testimonials and case studies can be added later without redesigning
anything. Inventing them now would cost the site the only thing it currently
has going for it.

## Design system

`src/styles/tokens.css` (custom properties) and `src/styles/global.css` (base
and primitives). Section-specific styling stays scoped inside its component.

- **Identity** — a clean stainless work surface under good light. Cool neutral
  ground, white cards that read as recipe cards, kraft tape labels, one
  confident green meaning *in place / verified / go*, and one clay red used
  only to show the before state.
- **Type** — Schibsted Grotesk for everything structural, JetBrains Mono for
  every label, quantity and station name, the way a kitchen writes things down.
  Latin subsets only, self-hosted, the display face preloaded.
- **Colour** — a light scheme and a "night service" dark scheme that lifts
  rather than inverts. Both pass WCAG AA on every text node.
- **Primitives** — `.tape` (the eyebrow, a strip of label stock), `.card` (a
  recipe card with a ruled head), `.steel-panel` (brushed stainless drawn with
  a repeating gradient), `.dot` (the colour-coded day dot numbering the method),
  `.checklist`.

> Astro scopes component CSS with a generated attribute, so elements created in
> script get none of it. Render every state on the server and toggle it with
> classes — never build result rows with `createElement` in a scoped component.

## The Before/After demo

The signature piece, and it contains **no JavaScript**. The toggle is two radio
inputs and sibling selectors; the English/Spanish switch inside it is another
pair. Both panels render on the server, so the section is complete and readable
with script blocked. Script only reports that the toggle was used.

The inputs are direct children of `.ba` on purpose — `~` needs them to be
siblings of what they control, and `:has()` is below the browser floor declared
in `astro.config.mjs`.

## What was verified

Checked with a headless browser against the built output, not assumed:

- WCAG AA contrast on every rendered text node, light and dark — 0 failures
- No horizontal overflow from 320 px to 1728 px
- Every interactive target at least 44 × 44 CSS px at 390 px
- Full content with JavaScript disabled, and no reveal element stuck invisible
- No console errors and no failed requests in either colour scheme
- One `h1`, no skipped heading levels, no dead internal link or anchor

## Phase 1 scope

This site exists to make restaurant owners understand MISE OPS, trust it, and
request a conversation. Deliberately **not** built: authentication, a database,
a client or staff portal, POS integration, scheduling, inventory, payroll,
billing, a CMS, a chatbot, a native app, an LMS.

### The future portal is a separate application

`app.miseops.com` may eventually hold organisations, locations, owners,
managers and staff, SOPs, recipes, checklists, equipment guides, training,
English/Spanish operational content, QR resources, approvals, version history,
source-document uploads and MISE OPS Care requests.

**None of that influences this codebase.** Phase 1 is a static marketing site;
the portal is a full-stack application whose stack should be chosen when there
are real customers and a real idea of what they need. Do not pre-build for it
here, and do not pick its technology now.

## Pages

| Route | What it is |
| --- | --- |
| `/` | The argument, end to end |
| `/how-it-works` | The five stages, what we need from you, and the calculator |
| `/sprint` | The build: who does what, what is and is not included |
| `/care` | Upkeep: how documentation drifts, and what Care covers |
| `/examples` | The Before/After demonstration and the rest of the system |
| `/about` | Why it exists, what we believe, where we work |
| `/contact` | The Operations Walkthrough request |
| `/thanks` | Where a no-JS submission lands. `noindex`, and kept out of the sitemap |
| `/privacy` | Written from what the site actually does |
| `/terms` | **Needs legal review — see below** |
| `/404` | `86'd` — kitchen shorthand for *we are out of it* |
| `/restaurant-operations/[city]` | Generates from data. Currently builds nothing, on purpose |

## The operations calculator

`/how-it-works#calculator`. The arithmetic lives in `src/lib/calculator.ts` so
the server-rendered defaults and the client-side updates cannot disagree, and
it renders correct numbers before any script runs.

It estimates what the current way of working consumes, from the visitor's own
inputs. It deliberately **does not estimate a saving**, and says so on the
page: MISE OPS has no customer results to derive one from, and a fabricated
"you will save $X" would be the least defensible thing on the site. Every
assumption — 60 shifts a month, fully-loaded manager cost — is printed
underneath it rather than buried in the code.

## ⚠ Terms needs a lawyer before launch

`src/pages/terms.astro` is a plain-language starting point describing how the
site and the engagements actually work. It is deliberately modest: it makes no
sweeping liability disclaimers and claims no protections that have not been
drafted, because terms that read authoritative without being reviewed are worse
than terms that are obviously a starting point.

**Have an Indiana attorney review it before the site goes live.** The sections
that matter most are limitation of liability, ownership of delivered materials,
and payment terms. The privacy page does not have this problem — it is written
from what the code does, and it is accurate.

## Before launch

- [ ] **`hello@miseops.com` must exist.** It is in `src/config/brand.ts` and
      every call to action and the structured data point at it.
- [ ] **A phone number, if you want one.** `brand.phone` is empty, which hides
      it everywhere rather than shipping a dead `tel:` link.
- [ ] **Terms reviewed** (above).
- [ ] **Point the domain at the Netlify site** and confirm `PRODUCTION_URL` in
      `site.config.mjs` matches it.
- [ ] **Check the form once in production.** Netlify registers a form by
      parsing the deployed HTML, so it only becomes real after the first
      deploy. Submit it and confirm the notification arrives.

## Status

Built and verified: all ten pages above, the design system, the Before/After
demonstration, the operations calculator, the Operations Walkthrough form, SEO
and schema, analytics, and the location-page capability.

Not built, by decision: authentication, a database, any portal, POS
integration, scheduling, inventory, payroll, billing, a CMS, a chatbot, a
native app, an LMS. See the boundary above.

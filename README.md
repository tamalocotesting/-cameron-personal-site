# cameronmacek.com

Personal site for Cameron Macek — operations, AI implementation and internal tools.

Static Astro site. No database, no backend, no client framework. Ships ~113 kB
on first load (almost all of it type) and zero JavaScript that the content
depends on.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # type-check, then build to dist/
npm run preview    # serve the built site
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | `astro check` (types) then a production build |
| `npm run build:fast` | Production build without the type-check — what Netlify runs |
| `npm run preview` | Serve `dist/` locally |
| `npm run fonts` | Re-copy the Latin font files into `public/fonts` after a dependency bump |

> `/fonts/*` is cached immutable for a year and the filenames are not
> content-hashed. If a font file's contents ever change, rename it in
> `scripts/sync-fonts.mjs` and in the `@font-face` rules in
> `src/styles/global.css`, or returning visitors keep the stale copy.

## Deploying

`netlify.toml` is committed and complete. Point Netlify at the repo and it will:

- build with `npm run build:fast`, publish `dist/`
- pin Node 22
- cache `/_astro/*` and `/fonts/*` for a year (both are content-addressed or versioned)
- send the security headers

Nothing else needs configuring. There are no environment variables and no
serverless functions.

### Deploying by hand instead

`netlify.toml` is only read when Netlify runs the build. For a drag-and-drop
deploy (app.netlify.com/drop) you upload the already-built `dist/` folder, so
`public/_headers` carries the same caching and security rules into the output.
If you change headers, change them in **both** files.

```bash
npm run build:fast
cd dist && zip -r ../site.zip .    # drop site.zip on app.netlify.com/drop
```

After the first deploy, set the real domain in **two** places so canonical URLs,
the sitemap and the social card all point at it:

- `site` in `astro.config.mjs`
- `site.url` in `src/data/site.ts`

## Where to change things

Almost everything you'd want to edit lives in two files.

**`src/data/site.ts`** — name, email, location, nav, social links.
Adding a URL to `profiles` makes that link appear in the footer; leaving it
empty hides it, so the site can never ship a dead link.

**`src/data/projects.ts`** — the project records shared by the homepage cards
and the case-study pages, so a title or status only ever changes in one place.

Case-study prose lives in its own page under `src/pages/work/`, written as plain
semantic HTML. The typography comes from `src/styles/prose.css`, so the pages
stay readable in source.

### Project status labels

Each project carries a `stage`, and the homepage prints a legend defining what
each one means:

| `stage` | Badge | Means |
| --- | --- | --- |
| `built` | Built | Working software, designed and built |
| `in-progress` | In progress | Under active development; core pieces work |
| `concept` | Concept | Designed and specified, not built |

Keep these honest. The legend is the reason the rest of the site is credible.

## Swapping in real screenshots

Every project image on the site goes through one component,
`src/components/ProjectVisual.astro`. Right now each project renders a
hand-built CSS sketch of its interface, clearly captioned as a sketch rather
than a screenshot.

When you have a real screenshot:

```astro
---
import portalShot from '../assets/portal.png';
---
<ProjectVisual visual="portal" src={portalShot} alt="The portal's search results" />
```

The sketch steps aside and nothing else changes. `src/assets/` is the place to
put the images so Astro optimises them.

## Structure

```
src/
  data/          site.ts, projects.ts — the two files you'll actually edit
  layouts/       Base.astro (head, SEO, chrome), CaseLayout.astro
  components/    Header, Footer, ProjectCard, Badge, SpecList, SectionMarker
    visuals/     the three CSS interface sketches
  pages/         index, background, 404, work/*
  styles/        global.css (tokens + primitives), prose.css (long-form)
public/          fonts, icons, og.png, robots.txt, manifest
scripts/         sync-fonts.mjs
```

## Design system

Defined as custom properties at the top of `src/styles/global.css`.

- **Type** — Archivo (display/UI), Source Serif 4 (long-form), IBM Plex Mono
  (labels, metadata, numbers). Latin subsets only, self-hosted from
  `public/fonts`, the two above-the-fold faces preloaded.
- **Colour** — warm paper and near-black ink with one saturated amber. A warm
  dark theme follows `prefers-color-scheme`; both pass WCAG AA on every text
  node on every page.
- **Scale** — fluid `clamp()` steps (`--step--2` … `--step-5`) and a spacing
  scale, so nothing is hard-coded per breakpoint.

## What was verified

Checked with a headless browser against the built output, not assumed:

- No horizontal overflow from 320 px to 1728 px
- WCAG AA contrast on every rendered text node, light and dark
- One `h1` per page, no skipped heading levels, every link named and resolving
- Full content with JavaScript disabled — the scroll reveal is gated behind a
  `.js` class, so a blocked script can never leave the page blank
- `prefers-reduced-motion` disables every transition and the blinking caret
- Keyboard order starts at the skip link and every control shows a focus ring
- No console errors or failed requests on any page

# Visual identity and design system

## Idea

**Deli paper, poppy-seed ink, toasted crust, and tickets on a steel rail.**

The kitchen already runs on paper tickets clipped to a rail. The Rail makes that object better: each ticket carries one job, one big number, the reason for it, and a provenance mark. Managers get **the Ledger**, the same materials in a calmer, tabular register for planning.

## Brand marks

- **Logo:** a bagel ring (crust gold `#D9A35B`) with sesame dots on a poppy-seed tile (`#1F1B17`). SVG in `web/public/icon.svg`. It also serves as the app icon and PWA icon.
- **Names:** "The Rail" (crew) and "The Ledger" (planning), both under "B's Bagels · Westfield".
- **Photos:** B's photos were not in the data kit. Every build card has a photo slot (`recipes.photo`). Drop original photos into `assets/photos/` and set the path. No stock imagery is used anywhere.

## Color tokens (`web/src/styles.css`, `:root`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F4EDE1` | `#171411` | page |
| `--card` | `#FFFCF6` | `#26211C` | tickets, cards |
| `--ink` / `--ink-2` / `--ink-3` | `#1F1B17` / `#5B5248` / `#8C8174` | inverted | text, day header, tab bar |
| `--crust` | `#B4561D` | `#E08245` | primary action, forecast mark |
| `--dill` | `#2E6A4D` | `#6FBF94` | done, verified |
| `--honey` | `#B07A12` | `#E2AE4A` | assumption, watch alerts |
| `--tomato` | `#B8352A` | `#F07A6C` | act-now alerts |
| `--rail` | `#9AA0A6` | `#5D646B` | the steel rail |
| `--c-actual` / `--c-forecast` | `#3F5A9A` / `#B4561D` | `#7A8FE0` / `#E08245` | charts (validated) |

**Charts:**
- The chart pair passed the dataviz validator in both modes: lightness band, chroma, CVD separation (ΔE 19.8) and contrast.
- Forecast lines are also **dashed**, so identity never depends on color alone.
- Missing days are hollow ticks on the baseline, never zero.

## Type

- **Atkinson Hyperlegible** (body): designed for low-vision legibility, with unambiguous 0/O and 1/l.
- **Bricolage Grotesque** (display and numbers, tabular figures).
- Both are self-hosted via Fontsource, so the app works offline and the CSP stays `'self'`.

## Provenance marks (the core component)

| Mark | Meaning | Visual |
|---|---|---|
| ● **Verified** | From Toast history or a count | solid dill dot, dill tint |
| ◌ **Forecast** | Model output; range shown when known | dashed crust ring |
| ▨ **Assumption** | Editable planning input with an owner | honey hatch |
| — **Missing** | No data. Not zero. | dashed outline, dash |
| ■ **Booked** | Known order (catering) | ink square |

In Spanish mode every mark reads "Pronóstico · Forecast", and so on.

## Components

- **Ticket:**
  - perforated top edge, hanging from a steel rail bar;
  - a 44 px check target (gloves);
  - title, with Spanish leading and English always beside it in ES mode;
  - a detail line;
  - a 40 px number with its unit;
  - "⋯" opens *Why this number*, plus adjust (lead+) and skip.
- **Day header:** an ink slab with the bake total, range, trays, holiday badge and four stat tiles (sandwiches, bacon, sausage, eggs).
- **Alerts:** act (tomato), watch (honey), info (steel). Info is collapsed by default on the crew rail.
- **Flavor chips:** a bagel-ring chip per flavor (speckled Everything, seeded Sesame, rainbow, and so on). GF chips carry a dill outline.
- **Build card:** numbered ink steps, a crust "amount" tag, B's Spanish with English beneath, and the planning portions as pills.
- **Bottom tab bar** (crew): five 56 px targets with bilingual labels in ES mode.
- **Ledger:** an ink sidebar, cards, tables and KPI tiles.

## Accessibility and kitchen ergonomics

- Minimum tap target 44–56 px. Body text 17 px. Quantities 40–64 px.
- Contrast meets WCAG AA on all text tokens.
- Focus rings are visible (3 px crust).
- `prefers-reduced-motion` respected. Dark mode follows the system.
- Language is a per-user setting, remembered on the server.
- Offline: the last plan per date is cached on the device and shown with an "offline" banner.

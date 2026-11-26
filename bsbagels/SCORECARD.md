# SCORECARD (public summary)

The **complete scorecard is confidential** because it contains bagel volumes, plans and recipe portions. It lives at `private/SCORECARD.md` and in the private handover package, and is regenerated with `npm run scorecard`. That file contains:
- the full backtest;
- the complete plans for **Wed Nov 25, 2026 (Thanksgiving Eve)** and **Sat Nov 28, 2026**: bake by flavor, pull, sandwiches by item, proteins, eggs, cream cheese to make and pack, each with its derivation;
- the double-counting proof on Nov 26, 2025;
- every assumption and open question;
- test results and screenshots;
- local run instructions.

This public summary contains only ratios and method.

## Walk-forward backtest — daily total bagels, Aug 1 – Oct 31, 2026 (92 days)

Each day is forecast using only data from before it. The metric is WAPE: Σ|actual − forecast| ÷ Σ actual. Days without a Toast record are skipped, never scored as zero.

| Segment | The Rail (rail-v1.1) | Avg of last 8 same weekdays | Same day last week |
|---|---|---|---|
| All days | **15.1%** | 15.9% | 19.5% |
| Weekdays (65) | **20.1%** | 20.8% | 27.4% |
| Weekends (27) | **10.7%** | 11.5% | 12.6% |

**Untuned windows:**

| Window | The Rail | Avg of last 8 | Same day last week |
|---|---|---|---|
| Jun–Dec 2025 | 21.5% | 22.4% | 29.3% |
| Mar–May 2026 | 17.1% | 18.1% | 21.9% |
| Jan–Feb 2026 | 30.1% | 31.7% | 32.9% |

**Known weakness:** in January and February the weekends are worse than avg-of-8, because there was no prior-December history to learn the January drop.

## Double counting (summary)

- **Unit rule:** physical bagels on a day = Toast flavor-modifier units. Sandwiches and singles carry one bagel modifier each. Dozen and half-dozen modifiers are already expanded to individual bagels.
- **Worked proof:** on a real day (Thanksgiving Eve 2025), item quantities × bagels-per-item equal flavor units exactly.
- **What double counting looks like:** adding the two views doubles the figure, and treating a dozen as one bagel undercounts.
- **Enforcement:** the rule is in `server/domain/units.ts` and tested in `tests/`.

## Tests

`npm test`: 33 tests (domain, API permissions and audit, imports, assistant loop, real-history checks). `npm run typecheck` is clean.

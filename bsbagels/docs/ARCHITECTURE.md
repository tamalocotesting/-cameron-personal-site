# Architecture

```
            ┌──────────── phones / kitchen tablet / laptop ────────────┐
            │  React SPA (Vite build)  — Rail · Cards · Ledger · Ask   │
            └───────────────▲───────────────────────────┬──────────────┘
                            │ JSON over HTTPS (cookie session, CSRF header)
┌───────────────────────────┴───────────────────────────▼──────────────┐
│ Node 22 server (TypeScript, run directly with type stripping)         │
│  http/router ─ auth (scrypt, server sessions, role guard)             │
│  domain/                                                              │
│    units      bagel-unit rules (the double-count guard)               │
│    calendar   holidays + Thanksgiving family                          │
│    forecast   daily bagel model, flavor split, ranges                 │
│    plan       bake / pull / sandwiches / proteins / eggs / cream      │
│               cheese → prep tickets                                   │
│    backtest   walk-forward evaluation                                 │
│  imports/     Toast CSV (Item Selection Details, Sales by day) +      │
│               master-workbook seed                                    │
│  assistant/   Claude manual tool loop; tools = the same domain        │
│               functions, filtered by the caller's role                │
│  audit/       append-only change log on every write                   │
│  backup/      online SQLite snapshot, JSON/CSV export, restore        │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ node:sqlite (built-in, WAL)
                    data/bsbagels.sqlite   (never committed)
```

## Why these choices

- **One language end to end (TypeScript).** The forecast that the crew sees, the backtest that produced the scorecard, and the numbers the assistant quotes all come from the same functions.
- **`node:sqlite`, no ORM, no native build.** The app installs with `npm ci` on any machine with Node 22+. The database is one file: backups are file snapshots, and restore is a file swap with an integrity check.
- **Server-side everything that matters:**
  - permissions;
  - forecasts;
  - Anthropic API calls (the key is read from the environment only).

  The client is a view.
- **No business data in the repository.** The repository is public. Seed data is read at setup time from the private source kit (`private/source_kit`). The database, backups, reports and screenshots live under `data/` and `private/`, which are git-ignored.

## Data model (summary; full DDL in `server/schema.sql`)

| Layer | Tables | Notes |
|---|---|---|
| Provenance | `sources` | Every imported file: kind, filename, SHA-256, period, row count, who/when |
| Verified history | `daily_sales`, `bagel_day`, `bagel_daily`, `item_monthly`, `modifier_monthly`, `item_daily`, `modifier_daily` | **Gaps are stored as explicit status rows, never as zeros** |
| Reference | `flavors`, `menu_items`, `recipes`, `recipe_steps`, `recipe_components` | Menu items carry `bagels_per_unit` (1 / 6 / 12 / 0) |
| Assumptions | `assumptions` | Key, value, unit, status (`assumption` / `confirmed`), owner, note, history in audit log |
| Operations | `inventory_counts`, `catering_orders`, `plan_adjustments`, `ticket_status`, `handoffs`, `waste_log`, `checklists`, `checklist_runs`, `training_signoffs` | All writes audited |
| Forecasting | `forecast_snapshots` | The plan that was shown for a date is frozen, so accuracy can be scored when actuals arrive |
| Security | `users`, `sessions`, `audit_log` | — |

## Provenance in the API

Every quantity the API returns is a `Figure`:

```ts
{ value: number | null, kind: 'verified' | 'forecast' | 'assumption' | 'missing', lo?, hi?, basis: string, sources: string[] }
```

The UI renders `kind` with the four provenance marks. The assistant receives the same objects and must cite them.

## Roles

| Capability | crew | lead | manager | owner |
|---|---|---|---|---|
| View rail, cards, checklists; tick tickets; log waste; record inventory counts; write handoff | ✔ | ✔ | ✔ | ✔ |
| Adjust ticket quantities (with reason), enter catering, training sign-off, remove waste entries | | ✔ | ✔ | ✔ |
| See sales dollars, history explorer, accuracy | | | ✔ | ✔ |
| Edit assumptions, recipes, checklists; run imports | | | ✔ | ✔ |
| Manage users, backups/restore, view full audit log | | | | ✔ |

The assistant's tools carry the same `minRole`. A crew member who asks about sales dollars gets a refusal that names the missing permission.

## AI assistant ("Ask B's")

- **Surface.** Anthropic Messages API, manual tool loop, model `claude-opus-5-5` by default (env `ANTHROPIC_MODEL`). Adaptive thinking, effort `medium`, and server-side refusal fallback enabled.
- **Tools.** Read-only and deterministic:
  - `get_day_plan`, `get_bagel_history`, `compare_periods`, `get_item_sales`, `get_forecast_accuracy`, `get_recipe`, `get_assumptions`, `get_inventory`, `get_handoffs`, `calculate`, `get_data_coverage`.
- **No guessing.** The system prompt requires every number to come from a tool result. Answers return a `sources` list (tool name, arguments, record references), which the UI shows under the answer.
- **Follow-ups.** The client keeps the conversation and sends it back. The server re-validates the role on every turn.
- **Without a key** the endpoint returns a clear "assistant not configured" message. The rest of the platform is unaffected.

## Imports

- **Item Selection Details CSV:** one row per item sold, with modifiers. This is the daily feed that matters, because it yields bagels by flavor (by the unit rules), sandwiches by item, spreads and add-ons.
- **Sales by day / Sales Summary CSV:** daily net sales and orders.

Every import is hashed. Re-importing the same file is a no-op. Overlapping dates are replaced only with explicit confirmation, and the replacement is logged.

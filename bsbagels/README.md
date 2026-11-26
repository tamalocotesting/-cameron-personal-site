# The Rail — kitchen operations platform for B's Bagels

An independent, clean-room platform for an independent bagel shop in Westfield, Indiana.

- **The Rail** is the crew's day as time-ordered prep tickets, on a shared tablet or a phone, in English and Spanish.
- **The Ledger** is where leads, the BOH manager and the owners plan, correct numbers, manage people and study trends.
- **Ask B's** answers plain-language questions from the shop's own records, with sources.

> **Confidentiality.** This repository is public and contains code only. Toast data, recipes, the database, reports, screenshots and the scorecard figures live in the git-ignored `private/` and `data/` folders and in the private handover package.

## What a crew member sees each morning

- Bagels to **bake by flavor**, with a likely range and tray counts, plus a 9:00 second-bake check.
- The **freezer pull** for the next *open* day. It skips likely-closed holidays and is netted against a thawed count.
- **Expected sandwiches** by item.
- **Bacon strips, sausage patties, shell eggs**, and line prep (potato pancakes, avocado, tomato, lox, salads).
- **Cream cheese**: oz used today, pounds to mix (Plain base on Mon/Fri, 3 lb flavored batches) and **8 oz tubs to pack**.
- **On hand vs. needed** wherever a count exists. Without a count, a value is *missing*, never zero.
- **What the previous shift completed**, plus handoff notes.
- **Alerts:** holidays ahead with their expected lift, likely-closed days, wide ranges, catering, stale data, unconfirmed assumptions.

Every number carries a provenance mark: **Verified · Forecast · Assumption · Missing**. Every number explains *why* it is what it is.

## Docs

| | |
|---|---|
| [docs/PRODUCT_THESIS.md](docs/PRODUCT_THESIS.md) | Thesis, the three concepts, why the Rail won |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, roles, provenance model |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Visual identity, tokens, components |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Historical database and schema (`server/schema.sql`) |
| [docs/SETUP.md](docs/SETUP.md) | Install, seed, run, deploy, back up, import Toast data |
| [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md) | Ask B's: how it works and how to configure it |
| [docs/EMPLOYEE_GUIDE.md](docs/EMPLOYEE_GUIDE.md) | Crew guide (English + Spanish) |
| [docs/MANAGER_GUIDE.md](docs/MANAGER_GUIDE.md) | Leads, manager and owner guide |
| [SCORECARD.md](SCORECARD.md) | Method and accuracy summary (full figures are in the private scorecard) |

## Quick start (about 5 minutes)

```bash
cd bsbagels && npm ci
# place the private kit: private/source_kit/01_Master_Toast_Workbook/master.xlsx + private/seed/*.json
npm run seed -- --demo && cat data/initial-credentials.txt
npm run build && BSB_INSECURE_COOKIE=1 npm start     # http://127.0.0.1:8787
npm test
```

## Stack

- Node 22, TypeScript run natively, and Express 5.
- Built-in `node:sqlite`, so there are no native dependencies.
- React 19 + Vite.
- Self-hosted fonts (Atkinson Hyperlegible, Bricolage Grotesque).
- The Anthropic SDK, used server-side only.

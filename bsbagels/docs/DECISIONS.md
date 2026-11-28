# Decision log

| # | Date | Decision | Why | Alternatives rejected |
|---|---|---|---|---|
| D1 | Nov 26 | Keep all business data out of git; app reads the private kit at setup | The repo is **public**; the workbook holds sales, payroll and employee names | Committing a sanitized DB (still confidential sales) |
| D2 | Nov 26 | Physical bagels per day = flavor modifier units only; sandwiches are a breakdown, never added | Proven equal on 27/31 Nov 2025 days; adding items double counts (DATA_AUDIT §4) | Item qty × bagels-per-item as primary (only one month of daily items) |
| D3 | Nov 26 | Daily series uses Toast **sent date**, summing "sent before report month" rows | Only daily basis available; summing makes the series complete | Dropping advance-order rows (loses real bagels) |
| D4 | Nov 26 | Catering bagels come from booked catering orders, not history | History excludes catering bundles; this avoids double counting and makes known demand explicit | Inflating forecast by an average catering share |
| D5 | Nov 26 | Forecast = trimmed mean of last 8 non-holiday same weekdays × holiday lift (prior occurrences, shrunk 20% toward 1) × ½-weight seasonal drift | Beats both baselines in walk-forward; explainable in one sentence to a lead | YoY (42% weekday WAPE), pure EWMA, ML models (too little data, unexplainable) |
| D6 | Nov 26 | Show forecast ranges (empirical P20–P80 by weekday) and plan a thawed buffer | Weekday demand is lumpy; honesty beats false precision | Point forecast only |
| D7 | Nov 26 | Sandwich forecast = bagel forecast × weekday sandwich share × recent item mix | Workbook's equal-mix assumption fails (weekend 32% vs weekday 16–24%) | Equal weekday mix |
| D8 | Nov 26 | Unknown portions (Goldie Lox cream cheese, bacon add-on strips, egg oz per shell egg) become owned, editable assumptions shown with an amber mark | Never fabricate; keep the plan computable | Leaving numbers blank (plan unusable) |
| D9 | Nov 26 | Concept "The Rail" chosen over "The Board" and "Ask the Kitchen" | See PRODUCT_THESIS | — |
| D10 | Nov 26 | TypeScript everywhere, Node 22 type stripping, `node:sqlite`, React+Vite | No native builds; single-file DB; one source of forecast truth | Python backend (two languages), Postgres (ops burden for one shop) |
| D11 | Nov 26 | Assistant on Messages API with a manual loop hosted in our server | Tools must execute against the local DB with the caller's role and be audited; confidential data should not persist in a hosted session | Managed Agents (hosted loop/sandbox, session history retained remotely) |
| D12 | Nov 26 | Build-card page 1 labelled "Turkey & Avocado (appears to be The Cali — confirm)" | Title missing from extracted text | Guessing the name silently |
| D13 | Nov 26 | Opening/closing checklists seeded from manual/BOH excerpts as **Draft – needs manager approval** | Full checklists not in the kit | Inventing a full checklist as if approved |
| D14 | Nov 26 | Crew sign in with name + 4–6 digit PIN on shared tablet; managers/owners with password; sessions server-side | Gloved, shared-device reality vs. confidentiality of manager data | One shared login (no audit trail) |
| D15 | Nov 26 | No B's photos available (not in folder; PDFs exceed connector limit) → original illustration + photo slots with upload | Brief asks for authentic photos; can't fabricate them | Stock photography |
| D16 | Nov 28 | Consolidation before expansion: an ecosystem audit found 28 B's assets with heavy duplication and none in verified daily use. A private OS master plan now governs all B's work. The Rail codebase is the candidate runtime for the Records Core; the Management Dashboard's validated controls and protocols are to be ported into it, not rebuilt. | One source of truth; nothing is adopted yet | Building more standalone tools |
| D17 | Nov 28 | Forecast accuracy is reported under the realistic data lag (20-day protocol), not 1-day | The 1-day figure overstated operating accuracy; per-flavor accuracy ties the prior method | Keeping the optimistic headline |

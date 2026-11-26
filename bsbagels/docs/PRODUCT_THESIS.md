# Product thesis — "The Rail"

## The kitchen's actual day

A bagel shop's day is decided before the doors open. The opener arrives in the dark and has roughly ninety minutes to:

- pull thawed bagels from the left side of the walk-in and bake in tray waves of 15–18;
- get bacon in the oven and sausage on;
- crack eggs;
- check the cream cheese pans;
- set the line.

All of this happens before the 7–10 am rush, which is where most of the day's sales land. Errors are asymmetric:
- **Under-bake on a Saturday** and you lose sandwiches you can't make back.
- **Over-bake on a Tuesday** and you throw away bagels that had a 7-day thawed life.
- **Forget the freezer pull** and tomorrow starts short.

The people doing this work are busy, wearing gloves, standing at a flat-top, and switching between English and Spanish. The decisions that shape the morning (how much to thaw, which holiday is coming, whether a catering order is real) belong to leads and managers, who plan a day or more ahead, usually on a laptop.

What the data supports, after the audit:
- **Bagel demand by flavor and day is well measured.** There are 22 months of daily flavor units that reconcile three ways.
- **Item-level daily history is thin.** Daily sandwich detail exists for one month only.
- **Weekend demand is predictable to about ±10%. Weekday demand is not**: it swings with unannounced bulk orders.
- **Holidays are large and repeatable** (roughly 1.3× to 3× normal).
- **Inventory, yields, and recipes for spreads are not in the data at all.**

## Thesis

> **The morning should arrive as a short stack of tickets, in the order the work happens, each one carrying a number the crew can trust, the reason for it, and where it came from. Planning is the managers' job. Doing is the crew's job. The platform is the rail between them.**

Four consequences:

1. **The unit of the product is the prep ticket, not the chart.** A ticket can be one of:
   - "Bake 54 Everything (3 trays)"
   - "Pull 4 boxes Plain → thaw side"
   - "Bacon: 62 strips"
   - "Pack 8 × 8 oz Knock Out"

   Each ticket has a quantity, a bilingual instruction, a due time, an owner station, and a done state.
2. **Every number shows its provenance.** It is labelled as one of:
   - **Verified** (from Toast)
   - **Forecast** (model output, with a range)
   - **Assumption** (an editable input someone owns)
   - **Missing** (shown as missing, never as zero)

   The same four marks appear on every screen, in every export, and in every answer from the assistant.
3. **Uncertainty becomes a buffer, not a guess.** Weekday forecasts are honest about their spread. The plan bakes to the expected number and holds the rest of the range as thawed-but-unbaked stock, so a surprise bulk order is a 15-minute bake rather than a stock-out.
4. **Known demand beats predicted demand.** Catering and large pre-orders are entered as orders and added on top of the forecast. History deliberately excludes them, so they are never counted twice.

## Three concepts

### A. "The Board" — a station whiteboard

A single day-board split into station columns (Oven, Prep, Eggs, Line), modelled on the whiteboard most kitchens already have. Quantities sit in cells. Crew tap a cell to mark it done. Managers write the board the night before.

- *For:* familiar; one glance shows the whole day; easy to print.
- *Against:* spatial rather than temporal. A whiteboard doesn't tell you that the freezer pull must happen today for Thursday, or that bacon is due before the first ticket. On a phone, four columns become four tabs and the glance is lost. It also has nowhere to put "why is this number what it is".

### B. "The Rail" — time-sequenced prep tickets (chosen)

The day is a rail of tickets ordered by when they are needed:
1. 5:00 oven waves
2. 5:30 proteins
3. 6:00 egg and spread checks
4. then mid-day packing and the freezer pull for tomorrow
5. close-out

The forecast engine generates the tickets. Leads can adjust a ticket, and the adjustment is audited. Whatever is unfinished at shift change *is* the handoff, together with a short note. Managers work on a separate surface, **the Ledger**, which holds the forecast, assumptions, imports, history, accuracy, and people. **Ask B's**, the assistant, answers questions over both.

- *For:* it matches how the morning actually runs (sequence and deadlines). It works one-handed on a phone. It gives every number a place to explain itself. Handoff becomes structural instead of a separate form.
- *Against:* it is a new mental model for managers who think in spreadsheets. That is why the Ledger is deliberately tabular.

### C. "Ask the Kitchen" — conversation-first

The primary interface is the assistant, by voice or text: "How many everything do I bake?" Screens are secondary.

- *For:* zero navigation; good for odd questions.
- *Against:* a noisy kitchen and gloved hands make voice and typing unreliable. An LLM outage would take down the morning plan. Production counts should be read, not chatted. It is also hard to audit what the crew was told.

### Also considered and dropped early

"The Ledger only" (a spreadsheet replacement for managers) fails the crew. A "KPI dashboard" is the generic shape the brief explicitly asked us to avoid, and it answers questions nobody at the flat-top is asking.

## Why the Rail

It is the only concept where:
- the crew's screen and the kitchen's sequence are the same shape;
- uncertainty, provenance, and handoff are built into the core object instead of bolted on.

The Board's whole-day glance is kept as the rail's **day header** (bake total, sandwiches, proteins, alerts). The Ask concept's strength is kept as an assistant inside the Rail, never in front of it.

## Who uses what

| Person | Device | Main surface | Typical job |
|---|---|---|---|
| Crew (oven, prep, eggs, line) | Shared kitchen tablet, own phone | **Rail**, Build cards | Do the next ticket; check a build; log waste |
| Shift lead | Phone, tablet | **Rail** with adjust rights, Handoff, Catering | Adjust counts, enter large orders, write handoff |
| BOH manager | Laptop, phone | **Ledger** | Inventory counts, pars, assumptions, imports, waste review |
| Owners | Laptop | **Ledger**, Ask B's | Trends, accuracy, people, backups |

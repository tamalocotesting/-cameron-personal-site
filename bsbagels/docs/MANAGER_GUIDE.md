# The Ledger: guide for leads, the BOH manager and owners

On a laptop, managers land on **the Ledger**. Everything the crew sees is also available on the Rail (sidebar › *Open the crew Rail*).

## Daily rhythm

| When | Who | What |
|---|---|---|
| Day before, afternoon | Manager or lead | **Today**: check tomorrow (date arrows). Book large orders in **Catering**. Review alerts (holidays, wide ranges, likely-closed days). |
| Close | Crew | Freezer pull ticket (it already skips closed days). Thawed count. Waste. Handoff note. |
| Open | Crew | Work the Rail top to bottom. 9:00 second-bake check. |
| Weekly | Manager | **Toast imports** (Modifier + Item Selection Details, Sales by day). **Forecast & accuracy**: did the shown forecasts hold? **Inventory**: freezer count before ordering. |
| Monthly | Owner | **Assumptions** review. **People**. Download a **backup** to private storage. |

## Reading a number

Every figure carries a mark: **Verified** (Toast or a count), **Forecast** (with range), **Assumption** (editable), **Missing** (unknown, not zero). Hover a number, or open a ticket, to see exactly how it was calculated.

**How the bagel forecast works:**
1. Start from the trimmed average of the last 8 normal same weekdays.
2. Multiply by the holiday lift learned from last year's same holiday, with 80% applied.
3. Multiply by a half-weighted seasonal drift.

**Flavors** follow that weekday's mix. **Sandwiches, cream cheese and proteins** scale from the bagel forecast, using recent Toast rates and B's build-card portions.

**Accuracy:** walk-forward error is about 10% on weekends and about 20% on weekdays. The weekday misses are mostly unannounced bulk orders. **The best lever you have is entering known big orders in Catering.** They become known demand and are never double counted.

## Adjusting the plan

- **Leads and above** can change any ticket quantity. A reason is required, and the change shows on the ticket and in the audit log.
- **Catering** adds bagels, sandwiches and cream cheese on top of the forecast for that date. "Assorted" bagels are split by the day's flavor mix.
- **Inventory counts** replace estimates:
  - thawed bagels → tomorrow's pull;
  - cream cheese pounds and tubs → mix and pack;
  - cooked proteins → cook quantities;
  - freezer counts → coverage.

## Assumptions register

Everything the data can't tell us (add-on portions, egg yield, batch size, tub par, buffers, model settings) lives in **Assumptions**, with a value, an owner, a basis and a status.

- Changing one updates every plan immediately and is audited with your reason.
- When management confirms a value, set it to **Confirmed**. Its amber mark then disappears from plans.

**Start here (open questions):**
1. Thanksgiving Day closure.
2. Is build-card page 1 "The Cali"?
3. Pastrami and turkey portions.
4. Goldie Lox portions.
5. Bacon per add-on.
6. Egg weight.
7. Bagels per tray.
8. Tub par and date-marking rule.
9. The BlueBakes wholesale order.
10. Delivery days.

## Recipes, checklists, training

- **Recipes & checklists:**
  - Approve build cards once confirmed.
  - Opening and closing checklists are **drafts built from manual excerpts**. Review each line, then approve.
- **Training:** leads sign off crew card by card. Every sign-off is audited.
- **Photos:** add B's original photos to the cards (`assets/photos/`).

## History and analysis

**History:**
- any date range, by flavor;
- "compare with same days last year", aligned 364 days so weekdays match;
- flavor mix;
- net sales (manager-only);
- a table view.

Missing days are shown as gaps, not zeros. Advance orders count on the day they were entered (Toast sent date).

**Ask B's** handles plain-language questions with sources, for example:
- "What was our best Saturday in October?"
- "How did Thanksgiving week compare with the week before?"

## Data, security, backups

**Roles:**

| Role | Can |
|---|---|
| Crew | Tick, count, log waste, write handoffs, read cards |
| Lead | Everything crew can, plus adjust tickets, catering, training sign-off |
| Manager | Everything a lead can, plus sales dollars, history, accuracy, assumptions, imports, recipes, exports |
| Owner | Everything, plus people, the audit log, backups and restore |

- **Server enforcement:** every rule is enforced on the server. Hiding a button is not the protection.
- **Audit log** (owner): every change, with before and after values and the reason.
- **Backups:** automatic daily snapshot. Restore takes a safety snapshot first.
- **Sensitive files:** exports and backups contain confidential sales and recipe data. Store them privately.
- **Offboarding:** deactivate leavers in **People**. Their sessions end immediately.

## When numbers look wrong

1. **Check the data banner** ("Toast history through …"). If it is old, import new exports.
2. **Open the number** to read its basis. Is a holiday lift applied? Is an assumption involved?
3. **Look for missing counts.** Without counts, pull and mix quantities assume the plan was followed.
4. **Still wrong?** Adjust the ticket with a reason and tell the owner. Forecast accuracy tracks what the crew was shown.

# Historical database & schema

- **The database** is a single SQLite file, `data/bsbagels.sqlite`.
- **The full DDL**, with comments, is in [`server/schema.sql`](../server/schema.sql). It is applied idempotently on every start.
- **Seeding:** `server/seed/run.ts` builds the historical tables from the workbook.
- **Imports:** `server/imports/toast.ts` extends them from new Toast exports.

## Verified history (what the seed loads)

| Table | Grain | Source sheets | Rows (seeded) | Notes |
|---|---|---|---|---|
| `daily_sales` | date | Daily History | 815 dates | `status`: actual / not_supplied / blank_in_source. Net sales NULL unless actual. |
| `bagel_day` | date | 2025/2026 Bagels Daily | 669 dates | `status`: recorded / no_records / not_covered. `total` NULL unless recorded. |
| `bagel_daily` | date × flavor | 2025/2026 Bagels Daily | — | Physical bagels by sent date. "Sent before report month" rows are summed into their sent date. |
| `item_monthly` | month × item | 2025/2026 Item Totals | 2,232 | Nov 2026 flagged partial (Nov 1–16) |
| `modifier_monthly` | month × group × parent × modifier | 2025/2026 Modifier Totals | 20,782 | Spreads, add-ons, sizes, flavor choices |
| `item_daily` | date × item | Item Detail Nov25 (+ imports) | 1,150 | Sent date |
| `modifier_daily` | date × group × parent × modifier | imports only | — | Feeds bagel_daily for new dates |
| `sources` | file or sheet | — | — | SHA-256, period, row count, who and when |

**Deliberately not imported:**
- employee names, shifts, wages, payments and per-order rows (personal or financial data the kitchen platform does not need);
- modelled profitability and bonus math;
- the wrong-scope Nov 7 exports (S048/S049).

## Example queries

```sql
-- Physical bagels per weekday, recorded days only (missing days excluded, never zero)
SELECT strftime('%w', date) dow, avg(total) FROM bagel_day WHERE status='recorded' GROUP BY dow;

-- Flavor mix for a month
SELECT flavor, sum(units) FROM bagel_daily WHERE date LIKE '2026-10-%' GROUP BY flavor ORDER BY 2 DESC;

-- What the crew was shown vs what happened
SELECT s.target_date, s.total_point, d.total FROM forecast_snapshots s LEFT JOIN bagel_day d ON d.date = s.target_date;
```

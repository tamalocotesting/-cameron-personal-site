# 8. Issue tracking

Two kinds of issues come up in a pilot. Keep them apart.

| Kind | Example | Where it lives |
| --- | --- | --- |
| **Operational issue**: something wrong at the station | "Walk-in cooler at 45°F" | Inside StationOps: employee flags the task; manager resolves it on **Issues** |
| **Project issue**: a bug, confusion, a change request, or a training gap with StationOps itself | "Submit button hidden on the tablet", "Task 4 wording is unclear" | The log below |

## Severity

| Level | Definition | Response during pilot |
| --- | --- | --- |
| **Critical** | Data lost or wrong; wrong status shown; someone can see or change records they shouldn't; nobody can sign in | Same day; pause go-live if before launch |
| **High** | A core step fails for some users or devices, and there is a workaround | Within 2 business days |
| **Medium** | Confusing or slow, but works | Batch for the next update |
| **Low** | Cosmetic, or a future idea | Record; review at handoff |

Change requests outside the scope (doc 2) are logged as **Low – future** and are not built during the pilot.

## Log

| ID | Date | Reported by | Kind (bug / change / training / question) | Severity | Description and steps to reproduce | Device/browser | Owner | Status (open / fixed / won't fix / deferred) | Resolution and date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-001 | | | | | | | | | |
| P-002 | | | | | | | | | |
| P-003 | | | | | | | | | |

## Weekly review

During the pilot, review the log with the restaurant manager once a week:

- Close anything fixed.
- Agree the severity of anything new.
- Note anything that affects the pilot metric (e.g. a day the app was unreachable).

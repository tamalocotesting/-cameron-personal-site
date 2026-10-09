# 1. Customer discovery and requirements

**Purpose:** find out how station opening works today before anything is configured. Run it as a 45-minute conversation with the general manager, plus 15 minutes watching one real opening.

Fill in the answers during the meeting. Leave blanks rather than guessing.

## Restaurant profile

| Question | Answer |
| --- | --- |
| Restaurant name and address | |
| Time zone (IANA name, e.g. `America/Chicago`) | |
| Days and hours open | |
| Opening shift start time(s) | |
| Stations in scope for the pilot (start with one) | |
| Employees who open that station (names, roughly how many) | |
| Managers who will review checklists | |
| Devices staff will use: own phones, a shared tablet, both? | |
| Wi-Fi coverage at the station (dead spots?) | |

## Current process

1. How is the station opening checked today: paper, a whiteboard, verbal, nothing?
2. Can we see a copy of the current checklist? (Attach a photo.)
3. Who fills it in, and when? Who looks at it afterwards, and when?
4. What happens when something is wrong (temperature out of range, shortage, broken equipment)? Who is told, and how?
5. What has gone wrong in the last month that a checklist should have caught?
6. Are paper checklists kept? For how long? Could we count the last 2–4 weeks for a baseline?
7. Do any health-department or franchise requirements dictate wording, temperature logs or record-keeping?

## Requirements to confirm

| # | Requirement | Must / Should / Not now | Notes |
| --- | --- | --- | --- |
| R1 | Employees complete their station's opening checklist on a phone | | |
| R2 | Each task records done/not done, who and when | | |
| R3 | Employees can flag a problem with a description | | |
| R4 | Managers see today's status and open problems | | |
| R5 | Managers record how each problem was resolved | | |
| R6 | Managers edit the checklist themselves | | |
| R7 | History and CSV export | | |
| R8 | Completion-rate measurement against a baseline | | |
| R9 | (Anything else raised) | | |

Anything from the "What NOT to build" list (scheduling, POS, inventory ordering, payroll, multi-location) is recorded as a future idea, not added to the pilot.

## Success metric agreement

- **Metric:** checklist completion rate = fully completed opening checklists ÷ expected opening checklists × 100.
- **Expected count source:** (e.g. "the schedule: 7 opening shifts per week × 1 station")
- **Baseline source and dates:** (e.g. paper checklists, two weeks before the pilot — or "no baseline available")
- **Who signs off on the numbers:**

## Sign-off

| | Name | Date |
| --- | --- | --- |
| Restaurant manager | | |
| Implementation lead | | |

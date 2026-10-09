# 4. User acceptance testing (testing checklist)

Run this on the **deployed** app, with the restaurant's real devices, **before go-live**. Use the demo database or a test station — not real records. Mark each row Pass or Fail, and log every Fail in the issue log (doc 8).

The "Dev result" column records what the automated suite verified in development: Playwright against a real PostgreSQL database, at phone and desktop sizes. It does not replace testing on site.

## A. Required scenarios

| # | Steps | Expected | Dev result | On-site result |
| --- | --- | --- | --- | --- |
| A1 | Employee signs in, taps **Start checklist**, marks every task done, taps **Review and submit → Submit** | "Checklist submitted. Thank you!"; status **Complete**; manager dashboard shows it with the employee's name and submit time | Pass | |
| A2 | Employee leaves one required task undone and submits | Dialog lists the task under "Required tasks not done"; status **Submitted with exceptions**; manager detail shows the task as *Not done* | Pass | |
| A3 | Employee taps **Report a problem**, submits an empty description, then a real one | Empty is rejected with a message; real one shows "Problem reported"; manager sees it under **Open issues** immediately; manager records a resolution and it moves to **Recently resolved** | Pass | |
| A4 | Manager edits the checklist (reword, reorder, remove, add, set one optional) and saves | Version number goes up; old submitted checklists still show the old wording; a checklist already started today keeps the old tasks; the next new checklist uses the new tasks | Pass | |
| A5 | Employee types `/manager`, `/manager/history` and `/manager/history/export` into the address bar | Manager pages show "That page is for managers"; export returns an error, not data | Pass | |

## B. Supporting checks

| # | Check | Expected | Dev result | On-site result |
| --- | --- | --- | --- | --- |
| B1 | Mark some tasks, close the browser, reopen and sign in | Same tasks are done; notes are still there | Pass | |
| B2 | Sign out, then press Back | Signed-out screen; protected pages send you to sign-in | Pass | |
| B3 | Times on tasks and submissions | Shown in the restaurant's local time and match the wall clock | Pass (time-zone unit tests and E2E) | |
| B4 | Wrong password 5 times | Clear error each time; then a lockout message for 15 minutes | Pass | |
| B5 | Pilot page: expected count of 0 | Rejected with a message | Pass | |
| B6 | History → Export CSV (summary and every task), open in Excel/Sheets | Opens cleanly; times in local time; filters respected | Pass | |
| B7 | Second employee on the same station after the first submitted | Sees "Submitted at … by …"; cannot start a second checklist | Pass | |
| B8 | Use the checklist on the restaurant's phone/tablet at the station | Buttons easy to hit; no sideways scrolling; saves work on the station's Wi-Fi | Pass at 375 px in emulation | |
| B9 | Turn Wi-Fi off mid-checklist and tap a task | "Could not save…" message; after reconnecting, tapping again saves | Not automated | |
| B10 | Manager adds an employee, then that employee signs in | Works; employee lands on their station | Pass | |
| B11 | Manager turns off an employee | That employee is signed out and cannot sign in | Not automated | |

## Sign-off

UAT passed with no open **critical** issues (anything that loses data, shows the wrong status, or lets the wrong person see or change records).

| | Name | Signature | Date |
| --- | --- | --- | --- |
| Restaurant manager | | | |
| Implementation lead | | | |

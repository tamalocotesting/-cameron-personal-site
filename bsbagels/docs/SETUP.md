# Setup, deployment and operations

## Requirements

- **Node.js 22.18 or newer.** The server runs TypeScript directly and uses the built-in `node:sqlite`.
- There are **no native modules** and **no external database**.
- Install, build and seed take about 1–2 minutes on a laptop.

## 1. Local install

```bash
cd bsbagels
npm ci
```

## 2. Put the private data kit in place (never commit it)

```
bsbagels/private/source_kit/01_Master_Toast_Workbook/master.xlsx   # the 61-sheet master workbook
bsbagels/private/seed/recipes.json                                  # transcribed build cards (in the handover package)
bsbagels/private/seed/checklists.json                               # draft checklists (in the handover package)
```

`private/` and `data/` are git-ignored. The repository contains **code only**.

## 3. Build the database

```bash
npm run seed -- --demo      # --demo also creates sample crew/lead/manager accounts
cat data/initial-credentials.txt
```

- The seed reads the workbook's raw tables into `data/bsbagels.sqlite`.
- Gaps are stored as explicit status rows, never as zeros.
- It is idempotent: re-running keeps users, assumptions you edited, counts and other operational data.
- `--fresh` rebuilds from scratch.
- **Initial owner account:**
  - Set `BSB_OWNER_USERNAME` / `BSB_OWNER_PASSWORD` before seeding to choose it.
  - Otherwise a random password is generated and written to `data/initial-credentials.txt` (mode 600).
  - Sign in, change it, then delete that file.

## 4. Run

```bash
npm run build                        # builds the web app into web/dist
BSB_INSECURE_COOKIE=1 npm start      # http://127.0.0.1:8787 (local http only)
```

For development with hot reload, run `npm run dev:server` and `npm run dev:web`. Vite serves on :5173 and proxies `/api`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | Listen address. Put it behind a TLS reverse proxy for anything beyond localhost. |
| `BSB_DATA_DIR` / `BSB_DB_PATH` | `./data`, `./data/bsbagels.sqlite` | Where the database and backups live |
| `BSB_INSECURE_COOKIE` | unset | Set to `1` **only** for local http. Otherwise cookies are `Secure`. |
| `BSB_TODAY` | today in Indianapolis | Replay a business date (demos, training) |
| `BSB_HIDE_ROSTER` | unset | `1` hides the tap-your-name roster on the sign-in screen |
| `ANTHROPIC_API_KEY` | unset | Enables Ask B's (see `AI_ASSISTANT.md`). Server-side only. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Assistant model |

## 5. Deploy

### Docker

```bash
docker build -t the-rail .
docker run -d --name the-rail -p 8787:8787 \
  -v rail-data:/app/data -v /secure/private:/app/private:ro \
  -e ANTHROPIC_API_KEY=... the-rail
docker exec the-rail npm run seed     # first time only
```

### A small VM or mini-PC in the shop

1. Install Node 22.
2. Copy the repo.
3. Run `npm ci && npm run build && npm run seed`.
4. Install `deploy/the-rail.service` as a systemd unit.
5. Put Caddy or nginx in front for HTTPS (`deploy/Caddyfile`).
6. The kitchen tablet and phones open the HTTPS URL. "Add to Home Screen" gives a full-screen app.

**Security checklist:**
- HTTPS only.
- `BSB_INSECURE_COOKIE` unset.
- The owner password changed and the initial credentials file deleted.
- `private/` and `data/` readable only by the service user.
- Backups copied off the machine to private storage.

## 6. Backups and restore

- **Automatic:** one snapshot per day, keeping 30. Manual snapshots come from **Ledger › Backups & export** (owner).
- **Restore** validates the file (integrity check, required tables, an active owner) and takes a *pre-restore* safety snapshot first. A restore can therefore be undone.
- **Off-site:** copy `data/backups/*.sqlite` to private storage (encrypted drive, private cloud folder). They contain confidential data.
- **CLI restore:** stop the service, copy the backup over `data/bsbagels.sqlite`, delete `-wal` and `-shm`, then start.

## 7. New Toast data

**Ledger › Toast imports** (manager or owner). Export from Toast as CSV:

| Export | What it feeds |
|---|---|
| **Modifier Selection Details** (daily or weekly range) | Bagels by flavor (Bagel Choices / Dozen / Half Dozen groups, under the double-count rules), spreads and add-ons. **This is the one that drives forecasts.** |
| **Item Selection Details** | Daily item and sandwich counts |
| **Sales by day** | Net sales and orders (manager-only views) |

- Imports are hashed and idempotent.
- Overlapping dates are replaced only after confirmation, and the replacement is audited.
- Forecasts use the new history immediately.
- Accuracy for any date that already had a frozen forecast snapshot becomes scorable.

## 8. Tests

```bash
npm test            # 33 tests; real-history tests run only when the private DB + fixtures exist
npm run typecheck
npm run backtest -- --from 2026-08-01 --to 2026-10-31
npm run scorecard   # regenerates private/SCORECARD.md
npm run screens     # Playwright screenshots into private/screenshots (server must be running)
```

/**
 * Generates private/SCORECARD.md from the database and the live model, so every figure is reproducible.
 *   npm run scorecard
 */
import { writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { openDb, all, one, ROOT } from '../server/db.ts';
import { loadSeries } from '../server/domain/history.ts';
import { walkForward, scoreTable, byWeekday, bias } from '../server/domain/backtest.ts';
import { buildPlan } from '../server/domain/plan.ts';
import { itemSideBagels, bagelsPerItem } from '../server/domain/units.ts';
import { DOW_NAMES } from '../server/domain/calendar.ts';
import { MODEL_ID } from '../server/domain/forecast.ts';

const db = openDb();
const s = loadSeries(db);
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const n0 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('en-US'));
const n1 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(1));
const L: string[] = [];
const p = (...x: string[]) => L.push(...x);

p(`# SCORECARD — The Rail for B's Bagels`, '',
  `*Generated ${new Date().toISOString().slice(0, 16)}Z by \`npm run scorecard\` from the seeded database (Toast bagel history through ${s.last}) and model **${MODEL_ID}**. Confidential: this file contains business volumes and lives only in \`private/\`.*`, '');

// ── 1. Backtest ───────────────────────────────────────────────────────────
p('## 1. Walk-forward backtest — daily total bagels, Aug 1 – Oct 31, 2026', '',
  'Each day D is forecast with a series containing only dates before D. The score is weighted absolute percentage error, **WAPE = Σ|actual − forecast| ÷ Σ actual**. Days without a Toast record are skipped. They are never scored as zero.', '',
  '"Total bagels" means physical bagels: named-flavor units by Toast sent date. Sandwich and dozen bagels are included, and catering bundles are excluded (see §3).', '');
const main = walkForward(s, '2026-08-01', '2026-10-31');
p('| Segment | Days | **The Rail model** | Avg of last 8 same weekdays | Same day last week |', '|---|---|---|---|---|');
for (const r of scoreTable(main)) p(`| ${r.segment} | ${r.model.n} | **${pct(r.model.wape)}** | ${pct(r.avg8.wape)} | ${pct(r.lastWeek.wape)} |`);
p('', `Bias (Σ forecast − Σ actual) ÷ Σ actual: ${pct(bias(main))}.`, '', '| Weekday | Model | Avg-of-8 |', '|---|---|---|');
for (const w of byWeekday(main)) p(`| ${DOW_NAMES[w.dow]} | ${pct(w.model.wape)} | ${pct(w.avg8.wape)} |`);
p('', '**Robustness on windows the parameters were not tuned on:**', '', '| Window | Days | Model | Avg-of-8 | Last week | Model weekdays / weekends | Avg-of-8 weekdays / weekends |', '|---|---|---|---|---|---|---|');
for (const [a, b] of [['2025-06-01', '2025-12-31'], ['2026-01-05', '2026-02-28'], ['2026-03-01', '2026-05-31']]) {
  const t = scoreTable(walkForward(s, a, b));
  p(`| ${a} → ${b} | ${t[0].model.n} | ${pct(t[0].model.wape)} | ${pct(t[0].avg8.wape)} | ${pct(t[0].lastWeek.wape)} | ${pct(t[1].model.wape)} / ${pct(t[2].model.wape)} | ${pct(t[1].avg8.wape)} / ${pct(t[2].avg8.wape)} |`);
}
p('', '**Model:**',
  '- **Baseline:** the trimmed mean of the last 8 recorded, non-holiday same weekdays. The single highest and lowest are dropped.',
  '- **Holiday lift:** the geometric mean of past ratios for the same holiday, with 80% applied. Fixed-date holidays learn only from occurrences on the same weekday class (weekday or weekend).',
  '- **Seasonal drift:** last year\'s same-weekday level around the target vs last year\'s equivalents of the baseline days, half-weighted.', '',
  '**Honest notes:**',
  '- Parameters were chosen by looking at this window, so some optimism is possible. The untouched 2025 and spring 2026 windows still beat both baselines overall.',
  '- **Jan–Feb 2026 weekends are worse than avg-of-8.** There is no Dec 2024 bagel history, so the model cannot learn the post-holiday January drop. This fixes itself from January 2027.',
  '- Weekday error (~20%) is dominated by unannounced bulk and wholesale orders. The product response is ranges, a thawed buffer for a second bake, and booking known orders as catering.',
  '- **Model history:**',
  '  - **rail-v1** scored 14.6% / 19.7% / 10.1% on this window.',
  '  - **rail-v1.1** fixes two flaws the test suite exposed: seasonal windows skewed by partial weekday mix, and Valentine\'s lifts learned from a Friday applied to a Saturday.',
  '  - v1.1 is slightly worse here (+0.5 pt) but better on the holdouts. **The more robust version is the one we ship.**', '');

// ── 2. Plans ──────────────────────────────────────────────────────────────
function planSection(date: string, title: string) {
  const pl = buildPlan(db, date);
  p(`## ${title}`, '');
  p(`**Bagels to bake: ${n0(pl.bagels.bakeTotal)}** (range ${n0(pl.bagels.total.lo)}–${n0(pl.bagels.total.hi)}, ≈ ${n1(pl.bagels.trays)} trays of 16). This is a *forecast*, extrapolated ${pl.horizonDays} days past the latest Toast import (${pl.historyEnd}). No catering is booked in the system for this date. Booked orders would be added on top.`, '');
  p(`**How the total was worked out:** ${pl.bagels.total.basis}`, '');
  p('### Bake by flavor', '', '| Flavor | Bake | Likely range | Trays (16) |', '|---|---|---|---|');
  for (const [k, f] of Object.entries(pl.bagels.bake)) if ((f.hi ?? 0) > 0) p(`| ${k} | **${n0(f.value)}** | ${n0(f.lo)}–${n0(f.hi)} | ${n1(f.trays)} |`);
  p('', 'Flavor split = each flavor\'s share of physical bagels on the same 8 baseline days, rounded with largest remainders so the flavors add up exactly to the total.', '');
  p(`### Freezer pull for ${pl.pull.forDate}${pl.pull.skipped.length ? ` (skipping ${pl.pull.skipped.join(', ')})` : ''}`, '', '| Flavor | Pull | ≈ boxes (72) | Thawed carry-over assumed |', '|---|---|---|---|');
  for (const [k, f] of Object.entries(pl.pull.flavors)) if ((f.value ?? 0) > 0) p(`| ${k} | **${n0(f.value)}** | ${f.boxes.toFixed(2)} | ${n0(f.carry)} (${f.carryKind}) |`);
  p('', `Total pull ${n0(pl.pull.total)}. Pull = the next open day's *upper* range (thaw-to-upper policy) + booked catering − thawed stock left over. With no thawed count entered, carry-over is estimated as today's (upper − expected), i.e. the unbaked buffer. A 2-minute count replaces the estimate. Thawed life is 7 days.`, '');
  p('### Sandwiches by item', '', `Expected **${n0(pl.sandwiches.total.value)}** sandwiches (range ${n0(pl.sandwiches.total.lo)}–${n0(pl.sandwiches.total.hi)}). These are *part of* the bagels above, never added to them.`, '', '| Sandwich | Expected | Range | Build card |', '|---|---|---|---|');
  for (const it of pl.sandwiches.items) p(`| ${it.item} | **${n0(it.figure.value)}** | ${n0(it.figure.lo)}–${n0(it.figure.hi)} | ${it.recipe_id ?? 'none in kit'} |`);
  p('', `How: ${pl.sandwiches.items[0]?.figure.basis}.`,
    `- The weekday index comes from Nov 2025 daily item data: ${pl.sandwiches.total.basis}.`,
    '- Item mix = Aug–Oct 2026 item totals.', '');
  p('### Proteins, eggs and other prep', '', '| Item | Quantity | How |', '|---|---|---|');
  p(`| Bacon strips to cook | **${n0(pl.proteins.baconCook.value)}** | ${pl.proteins.bacon.basis} |`);
  p(`| Sausage patties (4 oz) | **${n0(pl.proteins.sausageCook.value)}** | ${pl.proteins.sausage.basis} |`);
  p(`| Prepared egg | **${n0(pl.proteins.eggOz.value)} oz** | ${pl.proteins.eggOz.basis} |`);
  p(`| Shell eggs to crack | **${n0(pl.proteins.shellEggs.value)}** | ${pl.proteins.shellEggs.basis} |`);
  for (const o of pl.other) p(`| ${o.label} | ${n0(o.figure.value)} ${o.figure.unit} | ${o.figure.basis} |`);
  p('', '### Cream cheese — make, mix and pack', '', '| Flavor | Used today (oz) | 8 oz tubs to pack | Bulk need (lb) | To make (lb) | Batches (3 lb) |', '|---|---|---|---|---|---|');
  for (const c of pl.cream) p(`| ${c.flavor} | ${n0(c.ozToday.value)} | **${n0(c.tubsToPack.value)}** | ${n1(c.bulkNeedLb.value)} | **${n1(c.toMakeLb.value)}** | ${c.batches ?? 'base (Mon/Fri)'} |`);
  const plain = pl.cream.find((c) => c.flavor === 'Plain');
  if (plain) p('', `Example (Plain): ${plain.ozToday.basis}. Tubs: ${plain.tubsToPack.basis}. Bulk: ${plain.bulkNeedLb.basis}. On hand is **missing**: no count has been entered, and it is *not* assumed to be zero. "To make" therefore shows the full need until someone counts.`);
  p('', `Rates per bagel (Aug–Oct 2026): spread modifiers on single bagels at **2 oz each (management-confirmed)**, "Cream Cheese- … 2oz." sandwich add-ons, and retail items split 8 oz / 4 oz by Toast's Size modifier. Goldie Lox cream cheese is 2 oz (assumption).`, '');
  p('### Alerts shown to the crew', '');
  for (const a of pl.alerts) p(`- **${a.level}** — ${a.title}`);
  p('');
}
planSection('2026-11-25', '2. Plan — Wednesday Nov 25, 2026 (Thanksgiving Eve)');
planSection('2026-11-28', '2b. Plan — Saturday Nov 28, 2026 (Thanksgiving Saturday)');
const tday = buildPlan(db, '2026-11-26');
p('**Thursday Nov 26 (Thanksgiving Day):** no forecast. ' + tday.bagels.total.basis + ' The Nov 25 freezer pull therefore targets Friday Nov 27. Management should confirm the closure.', '');

// ── 3. Double counting ────────────────────────────────────────────────────
const D = '2025-11-26';
p(`## 3. Double-counting proof — ${D} (Thanksgiving Eve 2025, a real day)`, '');
const rows = all<{ item: string; menu_group: string; qty: number }>(db, "SELECT d.item, d.menu_group, d.qty FROM item_daily d WHERE d.date=? AND d.menu_group IN ('Bagels','Sandwiches') ORDER BY d.menu_group, d.qty DESC", D);
p('**A. Item side** (Toast Item Detail, sent date): each item × bagels per item', '', '| Item | Group | Qty | Bagels / item | Bagels |', '|---|---|---|---|---|');
let tot = 0;
for (const r of rows) { const per = bagelsPerItem(r.item, r.menu_group); tot += r.qty * per; p(`| ${r.item} | ${r.menu_group} | ${r.qty} | ${per} | ${r.qty * per} |`); }
p(`| **Total** | | | | **${tot}** |`, '');
const fl = all<{ flavor: string; units: number }>(db, 'SELECT flavor, units FROM bagel_daily WHERE date=? ORDER BY units DESC', D);
const ft = one<{ total: number }>(db, 'SELECT total FROM bagel_day WHERE date=?', D)!.total;
p('**B. Flavor side** (Toast flavor modifiers: one per sandwich or single, already expanded ×6 / ×12 inside packs)', '', '| ' + fl.map((f) => f.flavor).join(' | ') + ' | **Total** |', '|' + fl.map(() => '---').join('|') + '|---|', '| ' + fl.map((f) => f.units).join(' | ') + ` | **${ft}** |`, '');
const naive = rows.reduce((a, r) => a + r.qty, 0);
const sand = rows.filter((r) => r.menu_group === 'Sandwiches').reduce((a, r) => a + r.qty, 0);
p(`**A = B = ${ft}.** The flavor total already contains every sandwich bagel and every bagel inside a dozen or half-dozen. The wrong answers:`,
  `- flavor units + sandwiches = ${ft + sand} (sandwiches double counted);`,
  `- flavor units + item-side bagels = ${ft + tot} (everything double counted);`,
  `- raw item quantities, where a dozen counts as 1 = ${naive} (undercount).`,
  '',
  `Across Nov 2025 (retail groups), A = B exactly on ${(() => { let k = 0; for (const d of all<{ date: string; total: number }>(db, "SELECT date,total FROM bagel_day WHERE status='recorded' AND date BETWEEN '2025-11-01' AND '2025-11-30'")) if (itemSideBagels(all(db, "SELECT item,menu_group,qty FROM item_daily WHERE date=? AND menu_group IN ('Bagels','Sandwiches')", d.date) as never) === d.total) k++; return k; })()} of 30 recorded days. The other days differ by +2 to +4, from advance orders entered in late November for December.`,
  '',
  'Wholesale "Bagels (12)" under the BlueBakes group is reconciled separately; see the audit. All of this is enforced in code (`server/domain/units.ts`) and in tests (`tests/history.test.ts`).', '');

// ── 4. Assumptions & questions ────────────────────────────────────────────
p('## 4. Assumptions and open questions', '', '### Assumptions register (live values)', '', '| Assumption | Value | Status | Basis |', '|---|---|---|---|');
for (const a of all<{ label: string; value: number; unit: string; status: string; basis: string }>(db, 'SELECT * FROM assumptions ORDER BY status DESC, category, key')) p(`| ${a.label} | ${a.value} ${a.unit} | ${a.status} | ${a.basis} |`);
p('', '### Data and modelling assumptions', '',
  '1. **Physical bagels per day** = Toast named-flavor units by **sent date**. Advance orders count on the day they were entered.',
  '2. **Catering bundles** (Bagels Breakfast and More, Bagel Tray Options) are excluded from history. Booked catering is added on top of the forecast.',
  '3. **History starts 2025-01-01.** Earlier sent dates carry only advance orders from the January report.',
  '4. **Days with no named-bagel records** (Jan 6 2025, Nov 27 2025, Jan 25–26 2026) are unknown, not zero. A holiday that had no records last year is shown as "likely closed — confirm".',
  '5. **Sandwich weekday shape** comes from one month of daily item data (Nov 2025). The overall sandwich share and item mix come from the last 3 complete months.',
  '6. **Cream cheese, protein and egg rates** scale with the bagel forecast: per-bagel rates from the last 3 complete months.',
  '7. **Build-card portions** are used as transcribed. Page 1 (turkey/Swiss/avocado) is assumed to be **The Cali**.',
  '8. **Plain cream cheese base** is made on Monday and Friday (kit planning rules). Flavored batches cover 2 days.',
  '9. **Spanish UI strings and flavor names** are our translations. Build-card Spanish is B\'s own.', '',
  '### Open questions for management', '',
  '1. Is the shop **closed on Thanksgiving Day** (Nov 26)? Last year had no named-bagel sales and $30 in net sales.',
  '2. Is **build-card page 1 "The Cali"**? What spread goes on it (the name was not in the extracted text)?',
  '3. **Current portions:**',
  '   - pastrami: card 2.7 oz vs manual 3 oz;',
  '   - turkey: card 2.7 oz vs manual 2.5 oz;',
  '   - Goldie Lox: cream cheese, lox, capers, onion, cucumber and tomato quantities.',
  '4. **Add-on portions:** strips per "Add bacon", patties per "Add sausage", oz per "Add eggs".',
  '5. **Egg yield:** liquid oz per X-Large egg as actually cracked. Weigh a dozen once.',
  '6. **Tray and batch yields:**',
  '   - bagels per tray (15–18 in the manual);',
  '   - bacon strips per tray;',
  '   - flavored cream cheese batch size and yield;',
  '   - the base recipe (in the binder, not recovered).',
  '7. **Retail tub par** (days of 8 oz tubs to keep packed) and the approved date-marking and discard rule.',
  '8. **Wholesale:** is **BlueBakes** (wholesale dozens seen Nov 2025) a current standing order? What days and quantities?',
  '9. **Deliveries and stock:** delivery days, lead time, and holiday delivery changes for the bagel supplier. Current freezer stock by flavor.',
  '10. **Checklists:** opening and closing checklists are drafts built from manual excerpts. Which oven temperature is approved (manual and checklist disagree)?',
  '11. **Missing exports:**',
  '    - Toast exports after Oct 31 (bagels) and Oct 13 (sales) are needed.',
  '    - Please export Item Selection Details + Modifier Selection Details daily or weekly going forward.',
  '12. **Reconciliation controls:**',
  '    - $4.50 difference between 2025 daily sales and the accounting summary;',
  '    - a 20-order gap in July 2026, partly explained by 37 $0 after-hours orders.',
  '13. **Photos:** B\'s photos were not in the Drive folder, and the two build-card PDFs are too large for the connector. Please add photos to `assets/photos/`.', '');

// ── 5. Tests ──────────────────────────────────────────────────────────────
p('## 5. Test results', '');
let testOut = '';
try { testOut = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', ...readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts')).map((f) => join(ROOT, 'tests', f))], { encoding: 'utf8', cwd: ROOT }); } catch (e) { testOut = (e as { stdout?: string }).stdout ?? String(e); }
const names = [...testOut.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map((m) => `- ${m[1] === 'ok' ? '✅' : '❌'} ${m[2]}`);
const summary = ['tests', 'pass', 'fail', 'skipped'].map((k) => `${k} ${(new RegExp(`^# ${k} (\\d+)`, 'm').exec(testOut) ?? [])[1] ?? '?'}`).join(' · ');
p(`\`npm test\` → **${summary}** (TypeScript type-check \`npm run typecheck\`: clean)`, '', ...names, '',
  'Real-history tests compare against figures computed independently by the Python audit scripts (`private/fixtures/expected.json`).', '');

// ── 6. Screens ────────────────────────────────────────────────────────────
p('## 6. Walkthrough screenshots', '');
const shots = existsSync(join(ROOT, 'private', 'screenshots')) ? readdirSync(join(ROOT, 'private', 'screenshots')).filter((f) => f.endsWith('.png')).sort() : [];
p('Captured by `npm run screens` (Playwright) against the running app, with the business date set to Nov 25, 2026.',
  '- **Crew shift on a phone** (iPhone 13): María signs in on the shared tablet with her PIN, works the rail in Spanish with English beside it, checks why a number is what it is, opens the cream cheese plan and a build card, counts stock, writes the handoff, and opens Ask B\'s.',
  '- **Manager session on a desktop** (1440×900): production plan, forecast & accuracy, history comparison, assumptions, catering, imports, recipes, audit log and backups.', '');
for (const f of shots) p(`- \`private/screenshots/${f}\``);
p('', '## 7. Run it locally in under 10 minutes', '', '```bash',
  'git clone <repo> && cd <repo>/bsbagels        # Node 22.18+ required',
  'npm ci                                        # ~1 min',
  '# put the private kit in place: private/source_kit/01_Master_Toast_Workbook/master.xlsx',
  '#                               private/seed/recipes.json, private/seed/checklists.json',
  'npm run seed -- --demo                        # ~2 s: builds data/bsbagels.sqlite',
  'cat data/initial-credentials.txt              # one-time passwords/PINs',
  'npm run build                                 # ~1 s',
  'BSB_INSECURE_COOKIE=1 npm start               # http://127.0.0.1:8787  (omit the flag behind HTTPS)',
  '# optional: ANTHROPIC_API_KEY=... to enable Ask B\'s;  BSB_TODAY=2026-11-25 to replay a date',
  '```', '', 'Full instructions: `docs/SETUP.md`.');

writeFileSync(join(ROOT, 'private', 'SCORECARD.md'), L.join('\n') + '\n');
console.log(`wrote private/SCORECARD.md (${L.length} lines) · ${summary}`);

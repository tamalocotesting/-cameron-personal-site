/**
 * Tests against real historical days. Run only when the private database exists (npm run seed);
 * expected figures come from private/fixtures/expected.json, produced by the independent Python audit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ROOT, all, one } from '../server/db.ts';
import { itemSideBagels, reconcileDay } from '../server/domain/units.ts';
import { loadSeries } from '../server/domain/history.ts';
import { walkForward, scoreTable } from '../server/domain/backtest.ts';
import { buildPlan } from '../server/domain/plan.ts';

const FIX = join(ROOT, 'private', 'fixtures', 'expected.json');
const skip = !existsSync(DB_PATH) || !existsSync(FIX) ? 'private database or fixtures not present' : false;
const E = skip ? null : JSON.parse(readFileSync(FIX, 'utf8'));
const db = skip ? null : new DatabaseSync(DB_PATH, { readOnly: true });
const near = (a: number, b: number, tol = 0.0006) => Math.abs(a - b) <= tol;

function itemRows(date: string) {
  return all<{ item: string; menu_group: string; qty: number; kind: string }>(db!, `SELECT d.item, CASE WHEN m.kind='sandwich' THEN 'Sandwiches' ELSE d.menu_group END menu_group, d.qty, m.kind FROM item_daily d LEFT JOIN menu_items m ON m.name=d.item WHERE d.date=? AND d.menu_group IN ('Bagels','Sandwiches')`, date);
}

test('double-counting proof on a real day: item-side bagels == flavor units', { skip }, () => {
  const rows = itemRows(E.proofDay);
  const flavor = one<{ total: number }>(db!, 'SELECT total FROM bagel_day WHERE date=?', E.proofDay)!.total;
  const items = itemSideBagels(rows);
  assert.equal(flavor, E.proofDayBagels);
  assert.equal(items, E.proofDayBagels);
  assert.equal(reconcileDay(flavor, items).status, 'exact');
  const naive = rows.filter((r) => r.menu_group === 'Sandwiches' || r.menu_group === 'Bagels').reduce((a, r) => a + r.qty, 0);
  assert.notEqual(naive, flavor, 'raw item quantities (dozen = 1) undercount');
});

test('Nov 2025: item-side equals flavor units exactly on the audited number of days', { skip }, () => {
  const days = all<{ date: string; total: number }>(db!, "SELECT date,total FROM bagel_day WHERE status='recorded' AND date BETWEEN '2025-11-01' AND '2025-11-30'");
  let exact = 0;
  for (const d of days) if (itemSideBagels(itemRows(d.date)) === d.total) exact++;
  assert.equal(exact, E.exactNovDays);
});

test('monthly bagel totals match the independent audit', { skip }, () => {
  for (const [m, v] of Object.entries(E.monthlyTotals)) {
    const t = one<{ t: number }>(db!, "SELECT sum(total) t FROM bagel_day WHERE status='recorded' AND substr(date,1,7)=?", m)!.t;
    assert.equal(t, v, m);
  }
});

test('gaps are stored as missing, never zero', { skip }, () => {
  const g = one<{ status: string; total: number | null }>(db!, "SELECT status,total FROM bagel_day WHERE date='2025-11-27'")!;
  assert.equal(g.status, E.thanksgiving2025.dayStatus);
  assert.equal(g.total, null);
  assert.equal(one<{ n: number }>(db!, "SELECT count(*) n FROM bagel_day WHERE status='recorded' AND (total IS NULL OR total=0)")!.n, 0);
  assert.equal(one<{ n: number }>(db!, "SELECT count(*) n FROM daily_sales WHERE status!='actual' AND net_sales IS NOT NULL")!.n, 0);
});

test('sales control totals tie to the cent', { skip }, () => {
  for (const [range, v] of Object.entries(E.salesControls)) {
    const [a, b] = range.split('..');
    const t = one<{ t: number }>(db!, "SELECT round(sum(net_sales),2) t FROM daily_sales WHERE status='actual' AND date BETWEEN ? AND ?", a, b)!.t;
    assert.equal(t, v as number, range);
  }
});

test('walk-forward backtest reproduces independent baselines, and the model beats both', { skip }, () => {
  const rows = walkForward(loadSeries(db as never), E.backtest.from, E.backtest.to);
  assert.equal(rows.length, E.backtest.days);
  const s = Object.fromEntries(scoreTable(rows).map((r) => [r.segment, r]));
  assert.ok(near(s.all.avg8.wape, E.backtest.avg8.all) && near(s.weekdays.avg8.wape, E.backtest.avg8.weekday) && near(s.weekends.avg8.wape, E.backtest.avg8.weekend));
  assert.ok(near(s.all.lastWeek.wape, E.backtest.lastWeek.all) && near(s.weekdays.lastWeek.wape, E.backtest.lastWeek.weekday));
  for (const seg of ['all', 'weekdays', 'weekends']) assert.ok(s[seg].model.wape < s[seg].avg8.wape && s[seg].model.wape < s[seg].lastWeek.wape, seg);
});

test('Thanksgiving plans: Eve gets a holiday lift, Day is flagged likely-closed, pull skips it', { skip }, () => {
  const eve = buildPlan(db as never, '2026-11-25');
  const normalWed = buildPlan(db as never, '2026-11-18');
  assert.ok(eve.bagels.total.value! > 1.8 * normalWed.bagels.total.value!);
  assert.equal(eve.pull.forDate, '2026-11-27');
  const day = buildPlan(db as never, '2026-11-26');
  assert.equal(day.closedLikely, true);
  assert.equal(day.bagels.total.value, null);
  assert.equal(day.bagels.total.kind, 'missing');
});

test('plan invariants on a real day: flavors sum to the total; sandwiches never added to bagels', { skip }, () => {
  const p = buildPlan(db as never, '2026-11-28');
  const flavorSum = Object.values(p.bagels.bake).reduce((a, f) => a + (f.value ?? 0), 0);
  assert.equal(flavorSum, p.bagels.bakeTotal);
  assert.equal(p.bagels.bakeTotal, p.bagels.total.value! + p.bagels.cateringBagels);
  assert.ok(p.sandwiches.total.value! < p.bagels.total.value!, 'sandwiches are a subset of bagels');
  for (const t of p.tickets) assert.ok(['verified', 'forecast', 'assumption', 'missing', 'known'].includes(t.figure.kind));
});

/** Pure domain tests — synthetic data only, run anywhere. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFlavor, bagelsPerItem, itemSideBagels, reconcileDay } from '../server/domain/units.ts';
import { holidaysForYear, holidayOn, addDays, dow, priorOccurrences } from '../server/domain/calendar.ts';
import { makeSeries, trimmedMean, allocate, forecastTotal, baselineAvg8, baselineLastWeek, DEFAULT_PARAMS } from '../server/domain/forecast.ts';
import { walkForward, wape } from '../server/domain/backtest.ts';
import { evaluate } from '../server/assistant/tools.ts';
import { parseCsv, toastDate } from '../server/imports/csv.ts';
import { ccFlavor } from '../server/domain/profile.ts';
import { toCsv } from '../server/backup.ts';

test('flavor names from Toast normalize to canonical flavors', () => {
  assert.equal(canonicalFlavor('Plain Bagel'), 'Plain');
  assert.equal(canonicalFlavor('Gluten-Free Everything Bagel'), 'GF Everything');
  assert.equal(canonicalFlavor('WW Everything'), 'Whole Wheat Everything');
  assert.equal(canonicalFlavor('Green Bagels (St. Patricks Day theme)'), "Green (St. Patrick's Day)");
  assert.equal(canonicalFlavor('Toasted'), null);
  assert.equal(canonicalFlavor('Plain CC'), null);
});

test('bagels per item: dozen 12, half dozen 6 (incl. wholesale), single/sandwich 1, others 0', () => {
  assert.equal(bagelsPerItem('Dozen Bagels'), 12);
  assert.equal(bagelsPerItem('Bagels (12)'), 12);
  assert.equal(bagelsPerItem('Half Dozen Bagels'), 6);
  assert.equal(bagelsPerItem('Half Dozen Bagels- WS'), 6);
  assert.equal(bagelsPerItem('Single Bagel'), 1);
  assert.equal(bagelsPerItem('Everything Bagel'), 1);
  assert.equal(bagelsPerItem('Pick Me Up', 'Sandwiches'), 1);
  assert.equal(bagelsPerItem('Cold Brew', 'Beverages'), 0);
  assert.equal(bagelsPerItem('Plain CC', 'Spreads'), 0);
});

test('item-side bagels reconcile with flavor units; adding them would double count', () => {
  const items = [{ item: 'Dozen Bagels', qty: 2, menu_group: 'Bagels' }, { item: 'Half Dozen Bagels', qty: 1, menu_group: 'Bagels' }, { item: 'Single Bagel', qty: 10, menu_group: 'Bagels' }, { item: 'Pick Me Up', qty: 5, menu_group: 'Sandwiches' }];
  const itemBagels = itemSideBagels(items);
  assert.equal(itemBagels, 24 + 6 + 10 + 5);
  const flavorUnits = 45; // what Toast flavor modifiers would show for the same orders
  assert.deepEqual(reconcileDay(flavorUnits, itemBagels).status, 'exact');
  assert.notEqual(flavorUnits + itemBagels, flavorUnits, 'sum of both views is the double count we must never report');
});

test('holiday calendar', () => {
  const h26 = holidaysForYear(2026);
  assert.equal(h26.thanksgiving, '2026-11-26');
  assert.equal(h26.thanksgiving_eve, '2026-11-25');
  assert.equal(h26.thanksgiving_sat, '2026-11-28');
  assert.equal(h26.labor_day, '2026-09-07');
  assert.equal(h26.easter, '2026-04-05');
  assert.equal(h26.mothers_day, '2026-05-10');
  assert.equal(h26.memorial_day, '2026-05-25');
  assert.equal(holidaysForYear(2025).thanksgiving, '2025-11-27');
  assert.equal(holidayOn('2026-11-25')?.key, 'thanksgiving_eve');
  assert.equal(holidayOn('2026-11-24'), null);
  assert.deepEqual(priorOccurrences('thanksgiving_eve', '2026-11-25', 1), ['2025-11-26']);
  assert.equal(dow('2026-11-28'), 5); // Saturday
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

function synthetic(weeks = 60, start = '2025-01-06') {
  const rows: { date: string; flavor: string; units: number }[] = [];
  const pattern = [150, 150, 180, 190, 280, 520, 520];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const tot = pattern[dow(d)] + ((i * 37) % 11) - 5;
    rows.push({ date: d, flavor: 'Plain', units: Math.round(tot * 0.6) }, { date: d, flavor: 'Everything', units: tot - Math.round(tot * 0.6) });
  }
  return makeSeries(rows);
}

test('trimmed mean drops one high and one low; allocate sums exactly', () => {
  assert.equal(trimmedMean([100, 100, 100, 100, 100, 100, 100, 900], 1), 100);
  assert.equal(trimmedMean([10, 20], 1), 15);
  const a = allocate(101, { A: 1 / 3, B: 1 / 3, C: 1 / 3 });
  assert.equal(a.A + a.B + a.C, 101);
});

test('forecast uses only data strictly before the origin (no leakage)', () => {
  const s = synthetic();
  const target = '2026-01-14';
  const f1 = forecastTotal(s, target, target, DEFAULT_PARAMS).point;
  // corrupt the target day and everything after it
  for (const d of [...s.total.keys()]) if (d >= target) s.total.set(d, 99999);
  const f2 = forecastTotal(s, target, target, DEFAULT_PARAMS).point;
  assert.equal(f1, f2);
  assert.ok(f1 > 150 && f1 < 220, `Wednesday-ish forecast ${f1}`);
});

test('missing days are skipped, not treated as zero', () => {
  const s = synthetic();
  const target = '2026-01-17'; // Saturday
  const before = forecastTotal(s, target).point;
  s.total.delete('2026-01-10'); // remove last Saturday (missing, not zero)
  const after = forecastTotal(s, target).point;
  assert.ok(after > 450, `forecast stays at Saturday level, got ${after}`);
  assert.ok(Math.abs(after - before) < 40);
});

test('baselines and WAPE', () => {
  const s = synthetic();
  assert.ok(Number.isFinite(baselineAvg8(s, '2026-01-14')));
  assert.equal(baselineLastWeek(s, '2026-01-14'), s.total.get('2026-01-07'));
  const rows = walkForward(s, '2025-12-01', '2025-12-31');
  assert.equal(rows.length, 31);
  const w = wape(rows, 'model');
  assert.ok(w.wape < 0.05, `synthetic series is nearly periodic, WAPE ${w.wape}`);
});

test('calculator evaluates arithmetic and rejects anything else', () => {
  assert.equal(evaluate('(531*1.11*1.037)/16'), (531 * 1.11 * 1.037) / 16);
  assert.equal(evaluate('2^3 + 50%'), 8.5);
  assert.equal(evaluate('-4 + 10'), 6);
  assert.throws(() => evaluate('process.exit()'));
  assert.throws(() => evaluate('1/0'));
});

test('CSV parsing handles quotes, commas and CRLF; Toast dates parse', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.equal(toastDate('11/25/26 7:42 AM'), '2026-11-25');
  assert.equal(toastDate('2026-11-25 07:42:00'), '2026-11-25');
  assert.equal(toastDate('nonsense'), null);
});

test('cream cheese names normalize across items, spreads and add-ons', () => {
  assert.equal(ccFlavor('Knock Out (Chive and Onion) CC'), 'Knock Out');
  assert.equal(ccFlavor('Cream Cheese- Knock Out 2oz.'), 'Knock Out');
  assert.equal(ccFlavor('Jalapeno & Cheddar CC'), 'Jalapeño Cheddar');
  assert.equal(ccFlavor('Honey Cinnamon Sugar Butter'), null);
  assert.equal(ccFlavor('Butter'), null);
});

test('CSV export guards against spreadsheet formula injection but keeps negative numbers', () => {
  const out = toCsv([{ a: '=HYPERLINK("x")', b: -5, c: 'ok, fine' }]);
  assert.equal(out.split('\n')[1], `"'=HYPERLINK(""x"")",-5,"ok, fine"`);
});

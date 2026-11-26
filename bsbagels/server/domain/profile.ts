/**
 * Demand profile: per-bagel rates derived from verified monthly Toast totals, so every secondary
 * forecast (sandwiches, spreads, proteins) scales off the bagel forecast and inherits its range.
 *
 *   rate(x) = Σ x over the profile months ÷ Σ physical bagels over the same months
 *
 * Profile months = the latest 3 complete months that have both item and bagel data.
 */
import type { DB } from '../db.ts';
import { all } from '../db.ts';
import { dow } from './calendar.ts';

export interface Profile {
  months: string[];
  bagels: number;
  sandwichShare: number;                 // sandwiches ÷ bagels
  weekdayIndex: number[];                // sandwich-share multiplier by weekday (Mon..Sun), mean 1 across week
  weekdayIndexBasis: string;
  sandwichMix: { item: string; recipe_id: string | null; share: number; units: number }[];
  spreadPerBagel: Record<string, number>;      // cream-cheese flavor → 2 oz servings per bagel
  addonCcPerSandwich: Record<string, number>;  // flavor → 2 oz add-ons per sandwich
  retailPerBagel: Record<string, { per: number; share8: number; share8Known: boolean }>; // retail CC items
  addons: { bacon: number; sausage: number; eggs: number };  // per sandwich
  potatoPancakeSidePerBagel: number;           // "Potato Pancakes (2)" items per bagel
  saladSplit: Record<string, number>;          // tuna/chicken/egg share of salad sandwiches
  saladSplitKnown: boolean;
}

/** Normalize Toast cream-cheese names: "Knock Out (Chive and Onion) CC", "Cream Cheese- Knock Out 2oz." → "Knock Out". */
export function ccFlavor(name: string): string | null {
  const s = name.toLowerCase();
  if (s.includes('butter') || s.includes('amazeball')) return null;
  const table: [RegExp, string][] = [
    [/knock ?out|chive/, 'Knock Out'], [/jalape/, 'Jalapeño Cheddar'], [/cinn?amon sugar|cinn sugar/, 'Cinnamon Sugar'],
    [/strawberry/, 'Strawberry'], [/veggie/, 'Veggie'], [/blueberry/, 'Blueberry'], [/lox/, 'Lox'], [/funnel/, 'Funnel Cake'],
    [/s'?mores/, "S'mores"], [/artichoke/, 'Artichoke Parm'], [/sun dried/, 'Sun-Dried Tomato'], [/plain/, 'Plain'],
  ];
  if (!/(cc|cream cheese)/.test(s)) return null;
  for (const [re, n] of table) if (re.test(s)) return n;
  return null;
}

const SPREAD_GROUPS = ['Spreads - Cream Cheeses & Butters', 'Spreads- Cream Cheese & Butters'];

export function buildProfile(db: DB, asOfMonth?: string): Profile {
  // complete months with bagel data
  const bagelMonths = all<{ m: string; tot: number; days: number }>(db,
    `SELECT substr(date,1,7) m, sum(total) tot, count(*) days FROM bagel_day WHERE status='recorded' GROUP BY m ORDER BY m`);
  const itemMonths = new Set(all<{ month: string }>(db, `SELECT DISTINCT month FROM item_monthly WHERE partial_note IS NULL`).map((r) => r.month));
  const usable = bagelMonths.filter((r) => itemMonths.has(r.m) && r.days >= 25 && (!asOfMonth || r.m < asOfMonth));
  const months = usable.slice(-3).map((r) => r.m);
  const bagels = usable.slice(-3).reduce((a, r) => a + r.tot, 0);
  const ph = months.map(() => '?').join(',');

  const sand = all<{ item: string; recipe_id: string | null; q: number }>(db,
    `SELECT i.item, mi.recipe_id, sum(i.qty) q FROM item_monthly i JOIN menu_items mi ON mi.name=i.item
      WHERE mi.kind='sandwich' AND i.month IN (${ph}) GROUP BY i.item ORDER BY q DESC`, ...months);
  const sandTotal = sand.reduce((a, r) => a + r.q, 0);

  // weekday index from the only daily item data (Nov 2025)
  const wd = all<{ date: string; s: number; b: number }>(db,
    `SELECT d.date, sum(CASE WHEN mi.kind='sandwich' THEN d.qty ELSE 0 END) s, bd.total b
       FROM item_daily d JOIN menu_items mi ON mi.name=d.item JOIN bagel_day bd ON bd.date=d.date AND bd.status='recorded'
      GROUP BY d.date`);
  const accS = Array(7).fill(0), accB = Array(7).fill(0);
  for (const r of wd) { accS[dow(r.date)] += r.s; accB[dow(r.date)] += r.b; }
  const overall = accS.reduce((a, b) => a + b, 0) / Math.max(1, accB.reduce((a, b) => a + b, 0));
  let weekdayIndex = accB.map((b, i) => (b > 0 ? accS[i] / b / overall : 1));
  // Daily bagel volume differs by weekday, so normalize the index to preserve the monthly sandwich total:
  // Σ_w bagels_w × share × idx_w = Σ_w bagels_w × share.
  const wsum = accB.reduce((a, b, i) => a + b * weekdayIndex[i], 0) / Math.max(1, accB.reduce((a, b) => a + b, 0));
  weekdayIndex = weekdayIndex.map((x) => x / (wsum || 1));

  const mods = all<{ option_group: string | null; parent: string | null; modifier: string; q: number }>(db,
    `SELECT option_group, parent, modifier, sum(qty) q FROM modifier_monthly WHERE month IN (${ph}) GROUP BY option_group, parent, modifier`, ...months);
  const spreadPerBagel: Record<string, number> = {};
  const addonCcPerSandwich: Record<string, number> = {};
  const addons = { bacon: 0, sausage: 0, eggs: 0 };
  const size: Record<string, { s8: number; s4: number }> = {};
  const salad: Record<string, number> = {};
  for (const m of mods) {
    const g = m.option_group ?? '';
    if (SPREAD_GROUPS.includes(g)) { const f = ccFlavor(m.modifier); if (f) spreadPerBagel[f] = (spreadPerBagel[f] ?? 0) + m.q; }
    else if (g === 'Add Condiments/Cream Cheese') { const f = ccFlavor(m.modifier); if (f) addonCcPerSandwich[f] = (addonCcPerSandwich[f] ?? 0) + m.q; }
    else if (g === 'Add Protein') {
      if (/^bacon$/i.test(m.modifier)) addons.bacon += m.q;
      else if (/^sausage$/i.test(m.modifier)) addons.sausage += m.q;
      else if (/^eggs?$/i.test(m.modifier)) addons.eggs += m.q;
    } else if (g === 'Size' && m.parent) {
      const f = ccFlavor(m.parent); if (!f) continue;
      const z = (size[f] ??= { s8: 0, s4: 0 });
      if (/8\s*oz/i.test(m.modifier)) z.s8 += m.q; else if (/4\s*oz/i.test(m.modifier)) z.s4 += m.q;
    } else if (/tuna|chicken|egg salad/i.test(g) && /salad/i.test(m.parent ?? '')) {
      const k = /tuna/i.test(m.modifier) ? 'Tuna' : /chicken/i.test(m.modifier) ? 'Chicken' : /egg/i.test(m.modifier) ? 'Egg' : null;
      if (k) salad[k] = (salad[k] ?? 0) + m.q;
    }
  }
  for (const k of Object.keys(spreadPerBagel)) spreadPerBagel[k] /= bagels;
  for (const k of Object.keys(addonCcPerSandwich)) addonCcPerSandwich[k] /= sandTotal;
  addons.bacon /= sandTotal; addons.sausage /= sandTotal; addons.eggs /= sandTotal;

  const retail = all<{ item: string; q: number }>(db,
    `SELECT i.item, sum(i.qty) q FROM item_monthly i WHERE i.month IN (${ph}) AND i.menu_group IN ('Spreads','Cream Cheese') GROUP BY i.item`, ...months);
  const known8 = Object.values(size).reduce((a, z) => a + z.s8, 0), known4 = Object.values(size).reduce((a, z) => a + z.s4, 0);
  const overall8 = known8 + known4 > 0 ? known8 / (known8 + known4) : 0.5;
  const retailPerBagel: Profile['retailPerBagel'] = {};
  for (const r of retail) {
    const f = ccFlavor(r.item); if (!f) continue;
    const z = size[f];
    const e = (retailPerBagel[f] ??= { per: 0, share8: overall8, share8Known: false });
    e.per += r.q / bagels;
    if (z && z.s8 + z.s4 > 0) { e.share8 = z.s8 / (z.s8 + z.s4); e.share8Known = true; }
  }
  const pp = all<{ q: number }>(db, `SELECT coalesce(sum(qty),0) q FROM item_monthly WHERE month IN (${ph}) AND item LIKE 'Potato Pancakes%'`, ...months)[0].q;
  const saladTot = Object.values(salad).reduce((a, b) => a + b, 0);

  return {
    months, bagels,
    sandwichShare: sandTotal / bagels,
    weekdayIndex,
    weekdayIndexBasis: `Sandwich share by weekday from daily item detail (${wd.length} days, Nov 2025 only) — single-month estimate`,
    sandwichMix: sand.map((r) => ({ item: r.item, recipe_id: r.recipe_id, units: r.q, share: r.q / sandTotal })),
    spreadPerBagel, addonCcPerSandwich, retailPerBagel, addons,
    potatoPancakeSidePerBagel: pp / bagels,
    saladSplit: saladTot ? Object.fromEntries(Object.entries(salad).map(([k, v]) => [k, v / saladTot])) : { Tuna: 1 / 3, Chicken: 1 / 3, Egg: 1 / 3 },
    saladSplitKnown: saladTot > 0,
  };
}

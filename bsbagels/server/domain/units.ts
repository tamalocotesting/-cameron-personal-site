/**
 * Bagel unit rules — the double-count guard.
 *
 * Toast records each physical bagel as ONE flavor modifier in one of the groups below.
 * Sandwiches and Single Bagel carry one `Bagel Choices` modifier; Dozen / Half Dozen carry
 * per-bagel flavor modifiers that are ALREADY expanded (12 / 6 per item). Therefore:
 *
 *   physical bagels on a day = Σ flavor modifier units   (never + sandwich items, never × 12 again)
 *
 * Proven against Item Detail Nov25 on 27 of 31 days (DATA_AUDIT §4.4).
 */

export const CANONICAL_FLAVORS = [
  'Plain', 'Everything', 'Sesame', 'Cinnamon Raisin', 'Blueberry', 'Onion', 'Rainbow', 'Pumpernickel',
  'Poppy', 'Whole Wheat', 'Whole Wheat Everything', 'GF Plain', 'GF Everything',
  "Green (St. Patrick's Day)", 'Multigrain',
] as const;
export type Flavor = (typeof CANONICAL_FLAVORS)[number];

/** Spanish names are our translations (B's cards don't name flavors) — flagged for B's review. */
export const FLAVOR_META: Record<string, { es: string; short: string; gf?: boolean; seasonal?: boolean; sort: number }> = {
  Plain: { es: 'Natural', short: 'PL', sort: 1 },
  Everything: { es: 'Everything (con todo)', short: 'EV', sort: 2 },
  Sesame: { es: 'Ajonjolí', short: 'SE', sort: 3 },
  'Cinnamon Raisin': { es: 'Canela y pasas', short: 'CR', sort: 4 },
  Blueberry: { es: 'Mora azul', short: 'BB', sort: 5 },
  Onion: { es: 'Cebolla', short: 'ON', sort: 6 },
  Rainbow: { es: 'Arcoíris', short: 'RB', sort: 7 },
  Pumpernickel: { es: 'Pumpernickel', short: 'PU', sort: 8 },
  Poppy: { es: 'Amapola', short: 'PO', sort: 9 },
  'Whole Wheat': { es: 'Integral', short: 'WW', sort: 10 },
  'Whole Wheat Everything': { es: 'Integral con todo', short: 'WE', sort: 11 },
  'GF Plain': { es: 'Sin gluten natural', short: 'GP', gf: true, sort: 12 },
  'GF Everything': { es: 'Sin gluten con todo', short: 'GE', gf: true, sort: 13 },
  "Green (St. Patrick's Day)": { es: 'Verde (San Patricio)', short: 'GR', seasonal: true, sort: 14 },
  Multigrain: { es: 'Multigrano', short: 'MG', seasonal: true, sort: 15 },
};

/** Option groups whose flavor modifiers are physical bagels. */
export const BAGEL_GROUPS = new Set(['Bagel Choices', 'Dozen Bagels', 'Half Dozen Bagels', 'BAGELS (6)', 'Bagels (12)']);

/** Catering bundle groups: real bagels, but excluded from the named-flavor history (DATA_AUDIT §4.1). */
export const CATERING_BAGEL_GROUPS = new Set(['Bagels Breakfast and More- Bagels', 'Bagel Options']);

const FLAVOR_ALIASES: Record<string, Flavor> = {
  plain: 'Plain', everything: 'Everything', sesame: 'Sesame', 'cinnamon raisin': 'Cinnamon Raisin',
  blueberry: 'Blueberry', onion: 'Onion', rainbow: 'Rainbow', pumpernickel: 'Pumpernickel', poppy: 'Poppy',
  'whole wheat': 'Whole Wheat', 'ww everything': 'Whole Wheat Everything', 'whole wheat everything': 'Whole Wheat Everything',
  'gluten-free plain': 'GF Plain', 'gluten free plain': 'GF Plain', 'gf plain': 'GF Plain',
  'gluten-free everything': 'GF Everything', 'gluten free everything': 'GF Everything', 'gf everything': 'GF Everything',
  'green bagels (st. patricks day theme)': "Green (St. Patrick's Day)", "green (st. patrick's day)": "Green (St. Patrick's Day)",
  multigrain: 'Multigrain',
};

/** Map a Toast modifier / item name to a canonical flavor, or null. Accepts "Plain Bagel", "Plain", etc. */
export function canonicalFlavor(name: string | null | undefined): Flavor | null {
  if (!name) return null;
  let s = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s.endsWith(' bagel')) s = s.slice(0, -' bagel'.length);
  return FLAVOR_ALIASES[s] ?? null;
}

/** Bagels contained in one unit of a Toast menu item (used for item-side reconciliation only). */
export function bagelsPerItem(item: string, menuGroup?: string | null): number {
  const s = item.trim();
  if (/^(Dozen Bagels|Dozen|Bagels \(12\))$/i.test(s)) return 12;
  if (/^(Half Dozen Bagels(- WS)?|Half Dozen|BAGELS \(6\))$/i.test(s)) return 6;
  if (/^Single Bagel$/i.test(s)) return 1;
  if (canonicalFlavor(s) && / bagel$/i.test(s)) return 1; // direct named items (Jan–Feb 2025 menu)
  if ((menuGroup ?? '') === 'Sandwiches') return 1;
  return 0;
}

/**
 * Item-side bagel count for a day: Σ qty × bagelsPerItem. Used ONLY to cross-check the flavor side.
 * Adding this to flavor units would double count — see assertNoDoubleCount.
 */
export function itemSideBagels(rows: { item: string; menu_group?: string | null; qty: number }[]): number {
  return rows.reduce((s, r) => s + r.qty * bagelsPerItem(r.item, r.menu_group), 0);
}

/** Classify an item-vs-flavor comparison for a day. */
export function reconcileDay(flavorUnits: number, itemBagels: number) {
  const diff = flavorUnits - itemBagels;
  return { flavorUnits, itemBagels, diff, status: diff === 0 ? 'exact' : Math.abs(diff) <= Math.max(5, flavorUnits * 0.01) ? 'within_tolerance' : 'mismatch' } as const;
}

/**
 * The demonstration restaurant.
 *
 * ── THIS IS FICTIONAL ──────────────────────────────────────────────────────
 * Birch & Board does not exist and is not a MISE OPS customer. It is here to
 * show what the transformation looks like on something concrete, because an
 * abstract before/after is not persuasive to anyone who has run a kitchen.
 * Every surface that renders this data must label it as a demonstration.
 * Nothing in this file may be presented as a customer, a result or a review.
 * ───────────────────────────────────────────────────────────────────────────
 */

export const demoRestaurant = {
  name: 'Birch & Board',
  kind: 'Demonstration restaurant',
  subject: 'House Ranch',
  disclaimer:
    'A demonstration, not a customer. Birch & Board is fictional — it exists to show the change in a concrete form.',
} as const;

/** The five places the answer lives before there is a system. */
export interface BeforeArtifact {
  kind: string;
  label: string;
  /** Rendered as the artifact's content. Deliberately incomplete. */
  lines: readonly string[];
  /** What is actually wrong with this as a source of truth. */
  problem: string;
}

export const before: readonly BeforeArtifact[] = [
  {
    kind: 'recipe-card',
    label: 'Handwritten card',
    lines: ['House Ranch', 'mayo — 2 qt (big tub)', 'b.milk — fill to line', 'dill, garlic, S+P', 'whisk til right'],
    problem: 'No yield, no measurements you could repeat, and “til right” is a judgement only one person has.',
  },
  {
    kind: 'text',
    label: 'Text from the manager',
    lines: ['Sat 9:14 PM', 'just do it like last time', 'the one from thursday not the', 'other one'],
    problem: 'The correct version is identified by memory of a shift, which nobody else has.',
  },
  {
    kind: 'sticky',
    label: 'Sticky note on the wall',
    lines: ['USE THE BIG WHISK', 'NOT the small one!!', '— it breaks'],
    problem: 'Real knowledge, posted where it will fall off, addressed to whoever already knows the context.',
  },
  {
    kind: 'laminate',
    label: 'Laminated sheet, 2019',
    lines: ['CLEANING — MIXER', 'Model HL-200', 'Step 1: remove guard…'],
    problem: 'For equipment the restaurant replaced two years ago. Still on the wall, still being half-followed.',
  },
  {
    kind: 'memory',
    label: 'Maria',
    lines: ['Knows the ratio.', 'Knows why the last batch split.', 'Off Tuesdays.'],
    problem: 'The most reliable source in the building is a person, and she is allowed to have a day off.',
  },
];

/** The same knowledge, once it is a system. */
export const after = {
  recipe: {
    title: 'House Ranch',
    station: 'PREP · 01',
    yield: '1 gal / 128 fl oz',
    time: '10 min',
    allergens: ['Egg', 'Milk'],
    ingredients: [
      { qty: '2 qt', item: 'Mayonnaise', note: 'full-fat' },
      { qty: '1 qt', item: 'Buttermilk', note: 'cold' },
      { qty: '1 cup', item: 'Sour cream', note: '' },
      { qty: '3 Tbsp', item: 'Fresh dill', note: 'chopped fine' },
      { qty: '2 Tbsp', item: 'Garlic powder', note: '' },
      { qty: '2 tsp', item: 'Kosher salt', note: '' },
    ],
  },
  procedure: [
    'Combine mayonnaise and sour cream in the 8 qt bowl. Whisk smooth before adding liquid.',
    'Add buttermilk in three additions, whisking between each. Adding it all at once is what breaks the batch.',
    'Fold in dill, garlic powder and salt. Do not over-whisk once the dill is in.',
    'Rest covered, 30 minutes, before service.',
  ],
  standard: {
    title: 'What it should look like',
    good: 'Coats the back of a spoon. Dill visible and evenly through it.',
    bad: 'Thin and separating at the edge — the buttermilk went in too fast.',
  },
  checklist: {
    title: 'Prep close — cold station',
    items: ['Ranch dated and labelled', 'Pars checked against tomorrow’s prep list', 'Walk-in temp logged', 'Station broken down and wiped'],
  },
  /** The bilingual example. Spanish is the same procedure, not a summary. */
  bilingual: {
    en: 'Add buttermilk in three additions, whisking between each. Adding it all at once is what breaks the batch.',
    es: 'Agrega el suero de leche en tres partes, batiendo entre cada una. Agregarlo todo de una vez es lo que corta la mezcla.',
  },
  equipment: {
    label: 'EQUIP · 04',
    name: 'Slicer — daily clean',
    steps: ['Unplug. Confirm the blade is at zero.', 'Remove guard, carriage and deflector.', 'Wash, rinse, sanitise. Air dry.'],
  },
} as const;

/**
 * Demo content for the live search on the homepage and the portal case study.
 *
 * This is a small, representative slice written to show the retrieval model —
 * how questions map to answers — not a copy of B's Bagels' real operating
 * content. The component says so on screen.
 *
 * `find` is the same matcher the browser runs, exported so the server can
 * render a sensible default state and the page works before (or without) JS.
 */

export interface Entry {
  kind: 'Build' | 'Prep' | 'SOP' | 'Clean' | 'Equipment' | 'Allergen';
  title: string;
  answer: string;
  /** Extra words people actually type. */
  also?: string[];
}

export const entries: Entry[] = [
  {
    kind: 'Build',
    title: 'Everything bagel — sandwich build',
    answer: 'Bottom, plain schmear edge to edge, egg, cheese, meat, top. Cut once, wrap seam down.',
    also: ['sandwich', 'egg', 'order', 'assembly'],
  },
  {
    kind: 'Prep',
    title: 'Everything seasoning — batch',
    answer: 'Sesame, poppy, dried garlic, dried onion, flaked salt. Mix dry, store sealed, label with the date.',
    also: ['seasoning', 'topping', 'mix'],
  },
  {
    kind: 'Allergen',
    title: 'Everything bagel — allergens',
    answer: 'Sesame, poppy, wheat. Shared toaster: tell the guest if they ask about cross-contact.',
    also: ['allergy', 'sesame', 'gluten', 'celiac'],
  },
  {
    kind: 'Prep',
    title: 'Cream cheese — plain schmear',
    answer: 'Temper 20 minutes before service. Whip smooth. Portion into 1/6 pans, lid, date.',
    also: ['schmear', 'cheese', 'spread'],
  },
  {
    kind: 'Equipment',
    title: 'Proofer — humid room, dough moving too fast',
    answer: 'Drop to 78°F and crack the door for ten minutes. Do not add water on a humid day.',
    also: ['proof', 'humidity', 'dough', 'rising', 'over-proof'],
  },
  {
    kind: 'SOP',
    title: 'Closing — back of house',
    answer: 'Break down and wash, cool and label leftovers, pull tomorrow’s dough, sweep and mop, take the temp log, lock the walk-in.',
    also: ['close', 'end of day', 'shut down', 'night'],
  },
  {
    kind: 'SOP',
    title: 'Opening — back of house',
    answer: 'Boil on, oven on, pull dough, check the walk-in temp, stock the line, taste the schmears before the door opens.',
    also: ['open', 'morning', 'start', 'am'],
  },
  {
    kind: 'Prep',
    title: 'Boiling and baking bagels',
    answer: 'Boil 45 seconds a side, drain, seed wet, bake until the bottoms sound hollow.',
    also: ['boil', 'bake', 'kettle', 'oven'],
  },
  {
    kind: 'Clean',
    title: 'Slicer — daily breakdown',
    answer: 'Unplug first. Blade guard off, wash, sanitise, air-dry. Blade last, with the cut glove on.',
    also: ['slicer', 'blade', 'sanitise', 'sanitize'],
  },
  {
    kind: 'Equipment',
    title: 'Toaster conveyor — bagels coming out pale',
    answer: 'Slow the belt before you raise the heat. Pale usually means speed, not temperature.',
    also: ['toaster', 'conveyor', 'pale', 'burnt', 'colour'],
  },
  {
    kind: 'Prep',
    title: 'Onions — blanching for the spread',
    answer: 'Two minutes in boiling water, straight into ice. Drain hard or the spread goes loose.',
    also: ['onion', 'blanch', 'boil'],
  },
  {
    kind: 'SOP',
    title: 'Walk-in temperature log',
    answer: 'Twice a shift, open and close. Above 41°F: move product, tell a manager, write the time.',
    also: ['temp', 'temperature', 'log', 'cooler', 'fridge', 'haccp'],
  },
  {
    kind: 'Clean',
    title: 'End-of-night floor and drains',
    answer: 'Sweep, degrease under the line, mop with the red bucket, pull and rinse the drain covers.',
    also: ['floor', 'mop', 'drain', 'grease'],
  },
  {
    kind: 'Build',
    title: 'Lox build',
    answer: 'Plain schmear, salmon, red onion, tomato, capers, dill. Salmon flat, never bunched.',
    also: ['salmon', 'lox', 'bagel'],
  },
  {
    kind: 'SOP',
    title: 'New hire — first shift',
    answer: 'Handwashing, allergen basics, where the log lives, one station only. Shadow, then do it watched.',
    also: ['training', 'onboarding', 'new', 'first day'],
  },
  {
    kind: 'Equipment',
    title: 'Mixer — dough climbing the hook',
    answer: 'Stop, scrape down, drop one speed. Climbing means the dough is too warm or the batch is too small.',
    also: ['mixer', 'hook', 'dough', 'climbing'],
  },
];

/** Simple, forgiving matcher — the same one the browser runs. */
export function find(query: string, limit = 4): Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const terms = q.split(/\s+/);
  return entries
    .map((e) => {
      const hay = [e.title, e.kind, e.answer, ...(e.also ?? [])].join(' ').toLowerCase();
      const title = e.title.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) return { e, score: -1 };
        score += title.includes(t) ? 3 : 1;
        if (title.startsWith(t)) score += 2;
      }
      return { e, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.e);
}

/** Prompts for anyone who would rather click than type. */
export const suggestions = ['everything bagel', 'proofer', 'closing', 'allergens'];

/**
 * Project records — the single source of truth shared by the homepage cards
 * and the individual case-study pages, so a status or spec only changes once.
 *
 * `stage` maps to the honesty legend shown in the work section. Keep it
 * accurate: the legend is the reason the rest of the site is believable.
 *   built       → working software, designed and built
 *   in-progress → under active development, core pieces working
 *   concept     → designed and specified, not built
 */

export type Stage = 'built' | 'in-progress' | 'concept';

export const stageMeta: Record<Stage, { label: string; tone: 'live' | 'building' | 'concept'; note: string }> = {
  built: {
    label: 'Built',
    tone: 'live',
    note: 'Working software I designed and built, now being tested with the crew it was made for.',
  },
  'in-progress': {
    label: 'In progress',
    tone: 'building',
    note: 'Under active development. Core pieces work; it is not finished.',
  },
  concept: {
    label: 'Concept',
    tone: 'concept',
    note: 'Designed and specified. Not built, and not sold to anyone.',
  },
};

export interface Project {
  slug: string;
  index: string;
  title: string;
  /** Short line used on the card and as the case-study deck. */
  tagline: string;
  /** Two or three sentences. Card body. */
  summary: string;
  stage: Stage;
  href: string;
  /** Equipment-plate metadata. */
  spec: { key: string; val: string }[];
  /** Case-study page <title> + meta description. */
  seoTitle: string;
  seoDescription: string;
  visual: 'portal' | 'cost' | 'standard';
}

export const projects: Project[] = [
  {
    slug: 'bs-bagels-operations-portal',
    index: '01',
    title: "B’s Bagels Operations Portal",
    tagline: 'Every operational answer, on the phone already in their hand.',
    summary:
      'A mobile-first internal portal that replaces the binder, the group text and the one person who knows. Recipes, builds, prep, SOPs, cleaning, equipment and training — organised around the questions people actually ask mid-shift.',
    stage: 'built',
    href: '/work/bs-bagels-operations-portal',
    spec: [
      { key: 'Context', val: "B’s Bagels — Indiana" },
      { key: 'Role', val: 'Designed, wrote and built it' },
      { key: 'Covers', val: 'Recipes · builds · prep · SOPs · cleaning · equipment · training' },
    ],
    seoTitle: "B’s Bagels Operations Portal",
    seoDescription:
      "A mobile-first internal operations portal for a working bagel shop: recipes, builds, prep, SOPs, cleaning, equipment and training, searchable in seconds from the floor.",
    visual: 'portal',
  },
  {
    slug: 'kitchencost-watch',
    index: '02',
    title: 'KitchenCost Watch',
    tagline: 'Food cost changes one invoice line at a time. Nobody has time to read them.',
    summary:
      'An AI-assisted invoice system: read the invoice, match each line to a real product, normalise the units, and track what a case actually costs over time. The engineering that matters is not the extraction — it is everything built for the times the model is wrong.',
    stage: 'in-progress',
    href: '/work/kitchencost-watch',
    spec: [
      { key: 'Problem', val: 'Costs move weeks before the P&L shows it' },
      { key: 'Role', val: 'Concept, data model, AI workflow, operator UI' },
      { key: 'AI role', val: 'Extraction and matching — with a human review path' },
    ],
    seoTitle: 'KitchenCost Watch',
    seoDescription:
      'An AI-assisted restaurant invoice system: extraction, product matching, confidence handling and unit-cost history — designed around what happens when the model gets it wrong.',
    visual: 'cost',
  },
  {
    slug: 'service-and-standard',
    index: '03',
    title: 'Service & Standard',
    tagline: 'Most of what a business knows has never been written down.',
    summary:
      'The repeatable version of the portal: a method for capturing how a service business actually runs — shadow it, structure it, build it, hand it over — before the people who know it leave.',
    stage: 'concept',
    href: '/work/service-and-standard',
    spec: [
      { key: 'Thesis', val: 'Institutional knowledge is an asset nobody files' },
      { key: 'Method', val: 'Shadow → capture → structure → build → hand over' },
      { key: 'Status', val: 'Concept. No clients, no revenue, no launch date.' },
    ],
    seoTitle: 'Service & Standard',
    seoDescription:
      'A method for turning the undocumented knowledge inside a service business into a searchable operations system people can use from a phone.',
    visual: 'standard',
  },
];

export const getProject = (slug: string): Project => {
  const found = projects.find((p) => p.slug === slug);
  if (!found) throw new Error(`Unknown project slug: ${slug}`);
  return found;
};

/**
 * One thing that was genuinely explored and genuinely set down. Listed because
 * leaving it out would be tidier than it is honest — not padded out with
 * features of the portal dressed up as separate projects.
 */
export const exploration = {
  title: 'RecruiterOS',
  stage: 'concept' as Stage,
  body: 'A missed-call recovery concept: treat every unanswered call as a lead with a state, not a voicemail nobody returns. I designed the follow-up workflow, then stopped \u2014 the operations work was the better use of the same hours, and saying so is more useful than keeping a third project on the shelf.',
};

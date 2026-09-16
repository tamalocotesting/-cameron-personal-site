/**
 * The actual work history, from Cameron’s résumé.
 *
 * It exists on the site because the whole argument depends on it: the roles
 * below are implementation work under different names — training unfamiliar
 * teams to standard, opening new locations, explaining technology to customers
 * who don’t care how it works. Without the dates and titles, "operator who
 * builds" is a claim. With them, it’s a record.
 *
 * `key` marks the roles that carry the argument; they get a line of detail.
 * The rest are there for continuity and scan quickly.
 */

export interface Role {
  from: string;
  to: string;
  title: string;
  org: string;
  where?: string;
  /** Why this one matters to the story. Only on the roles that carry it. */
  note?: string;
  key?: boolean;
}

export const roles: Role[] = [
  {
    from: '2024',
    to: 'Now',
    title: 'Back-of-House Manager',
    org: "B’s Bagels",
    where: 'Westfield, Indiana',
    note: 'Running the operation: production priorities, staffing, equipment, inventory and whatever breaks during a rush. Training and coaching the people who do the work.',
    key: true,
  },
  {
    from: '2022',
    to: '2024',
    title: 'Kitchen Supervisor · New-Location Opening Trainer',
    org: "Cooper’s Hawk Winery & Restaurants",
    where: 'Indianapolis area',
    note: 'Went into new restaurants and got teams who had never done the job to standard — station setup, prep, plating, opening and closing — against an opening date.',
    key: true,
  },
  {
    from: '2015',
    to: '2017',
    title: 'Retail Sales Consultant',
    org: 'AT&T / Spring Mobile',
    where: 'Illinois',
    note: 'Two years explaining technology to people who did not care how it worked, only whether it solved their problem. Contracts, orders and the documentation behind them.',
    key: true,
  },
  { from: '2022', to: '2022', title: 'Line Cook', org: "Matt the Miller’s Tavern" },
  { from: '2018', to: '2020', title: 'Kitchen Supervisor & Cook', org: 'Adult & Teen Challenge' },
  { from: '2012', to: '2015', title: 'Supervisor · Manager on Duty', org: 'Johnny Rockets' },
];

/** Sorted newest first for display, with the supporting roles kept in order. */
export const timeline = [...roles].sort((a, b) => Number(b.from) - Number(a.from));

export const careerSummary = {
  years: '10+',
  headline: 'Hospitality and customer-facing retail',
};

/**
 * Résumé-only detail: the bullets, skills and summary that belong on a CV but
 * would be redundant on the site. Drives both /resume and the generated PDF.
 */
export const resume = {
  target: 'Customer onboarding · Implementation · Operations & training',
  summary:
    'Operations and training professional with 10+ years across hospitality and customer-facing retail. I get teams to standard — new-location openings, back-of-house management, front-line customer technology — and I design and test the documentation, workflows and internal tools that keep them there.',
  skills: [
    'Employee training and coaching',
    'New-location readiness and openings',
    'Customer communication',
    'Workflow troubleshooting',
    'SOPs, checklists and documentation',
    'Food cost, recipes and inventory',
    'AI-assisted workflow design',
    'Internal tools and prototyping',
  ],
  bullets: {
    "B\u2019s Bagels": [
      'Lead daily kitchen operations — prioritise production and resolve staffing, equipment, inventory and workflow problems during high-volume service.',
      'Train and coach employees on station procedures, preparation standards and safe work practices; assign tasks and follow up on execution.',
      'Built and am testing an internal operations portal for the shop: recipes, builds, prep, SOPs, cleaning, equipment and training, searchable from a phone.',
    ],
    "Cooper\u2019s Hawk Winery & Restaurants": [
      'Supported new restaurant openings by training unfamiliar teams on station setup, preparation, plating, and opening and closing procedures.',
      'Supervised kitchen departments and reinforced operating standards, helping teams get ready under time pressure.',
    ],
    'AT&T / Spring Mobile': [
      'Identified customer needs, demonstrated devices and services, and explained changing plans, promotions and product features in practical terms.',
      'Answered product and service questions and completed contracts, payments, orders and the related digital documentation.',
    ],
  } as Record<string, string[]>,
};

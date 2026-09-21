/** Homepage content that is really a list, kept out of the markup. */

/** Section 2 — the reality of tribal knowledge. */
export const problems: readonly { said: string; means: string }[] = [
  {
    said: 'Ask the chef.',
    means: 'The procedure exists, but only in one person’s head — and they are off on Tuesday.',
  },
  {
    said: 'Maria knows how to do it.',
    means: 'One employee holds knowledge the restaurant cannot operate without. That is a risk, not a compliment.',
  },
  {
    said: 'It should be in the binder.',
    means: 'There is a binder. It is three menus out of date, and nobody has opened it since the health inspection.',
  },
  {
    said: 'Just do it like last time.',
    means: 'The recipe changes with whoever is on the shift, and so does what the guest gets.',
  },
  {
    said: 'Didn’t someone show you that already?',
    means: 'Onboarding depends on who happens to be working that day and how busy they are.',
  },
  {
    said: 'Only Dave can fix the slicer.',
    means: 'Equipment knowledge is tied to a person. When they are off, the station goes down with them.',
  },
];

/** Section 4 — what MISE OPS organizes. */
export const organizes: readonly { name: string; note: string }[] = [
  { name: 'SOPs', note: 'The procedures that run the place, in the order they happen.' },
  { name: 'Recipes & builds', note: 'Real quantities, real yields, plated the same way every time.' },
  { name: 'Prep', note: 'Standards and pars, so prep matches what the week actually needs.' },
  { name: 'Opening & closing', note: 'Step by step, by station, with nothing assumed.' },
  { name: 'Cleaning', note: 'What, how, how often, and who signs it off.' },
  { name: 'Onboarding', note: 'A first shift that does not depend on who is working.' },
  { name: 'Training', note: 'Role by role, so progress is something you can see.' },
  { name: 'Checklists', note: 'Recurring, and actually completed on a phone.' },
  { name: 'Equipment', note: 'Setup, cleaning and break-down for each machine.' },
  { name: 'Troubleshooting', note: 'The three things that usually go wrong, and the fix.' },
  { name: 'Manager resources', note: 'The decisions and escalations a shift lead needs.' },
  { name: 'Food safety', note: 'Temps, holds, labels and logs, written to be followed.' },
  { name: 'Bilingual material', note: 'English and Spanish where your team needs both.' },
  { name: 'QR-linked resources', note: 'The answer posted at the station it belongs to.' },
];

/** Section 6 — put the answer where the work happens. */
export const stations: readonly { station: string; label: string; opens: readonly string[] }[] = [
  {
    station: 'Slicer',
    label: 'EQUIP · 04',
    opens: ['Setup', 'Cleaning & break-down', 'Troubleshooting'],
  },
  {
    station: 'Prep table',
    label: 'PREP · 01',
    opens: ['Recipes & builds', 'Prep standards', 'Today’s pars'],
  },
  {
    station: 'Manager station',
    label: 'MGMT · 00',
    opens: ['Opening', 'Closing', 'Manager resources'],
  },
  {
    station: 'Walk-in',
    label: 'COLD · 02',
    opens: ['Labeling & dating', 'Temp logs', 'Rotation standard'],
  },
];

/** Section 10 — who it is for. */
export const audience: readonly { when: string; because: string }[] = [
  {
    when: 'You’re opening a second location',
    because:
      'Everything that lives in one person’s head has to exist twice on day one. This is the moment undocumented knowledge stops being survivable.',
  },
  {
    when: 'You want to step away more',
    because:
      'A restaurant that cannot run a week without you is a job, not an asset. The system is what makes the difference.',
  },
  {
    when: 'You have a new GM',
    because:
      'They inherit the operation without inheriting ten years of context. Written procedures shorten that from months to weeks.',
  },
  {
    when: 'The team is growing',
    because:
      'What worked at twelve people breaks at thirty. Verbal training does not scale past the people who can hear you.',
  },
  {
    when: 'You keep retraining the same things',
    because:
      'If the same question comes back every week, the answer is not written down anywhere the team can reach it.',
  },
  {
    when: 'Shifts are inconsistent',
    because:
      'When the guest experience depends on who is working, the standard is not documented — it is being remembered, differently, by each person.',
  },
  {
    when: 'One employee holds critical knowledge',
    because:
      'It is not about trust. It is that the restaurant should not be one resignation away from losing how something is done.',
  },
];

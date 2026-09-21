/** What the two engagements include — shared by the homepage and their pages. */

export const sprintScope: readonly string[] = [
  'One location',
  'Owner and manager knowledge capture',
  'Priority SOPs, agreed with you up front',
  'Recurring checklists',
  'New-hire quick start',
  'Staff access on their own phones',
  'Bilingual content where your team needs it',
  'QR-linked resources at the stations',
  'Review and verification with your chef or GM',
  'Launch and handoff to your managers',
];

/**
 * Said plainly, because a scope that only lists inclusions is a scope that
 * ends in an argument.
 */
export const sprintExclusions: readonly string[] = [
  'Every procedure in the building. We agree a priority list; the long tail comes later or under Care.',
  'A second location. Each one is scoped and priced on its own.',
  'Menu development, recipe testing or costing. We document what you already do.',
  'New software licences, hardware or POS work.',
  'Ongoing changes after handoff — that is what Care is for.',
];

export const careScope: readonly string[] = [
  'Procedure updates as menus and equipment change',
  'New procedures added as the operation grows',
  'A scheduled review so the system does not drift',
  'Staff access and station labels kept current',
  'A named person to send changes to',
];

export const careExclusions: readonly string[] = [
  'Unlimited work. Care covers a defined amount of change each month.',
  'A full menu rewrite or a second location build — both are scoped separately.',
  'Being your on-call manager. Care maintains the system, it does not run the shift.',
];

/** What actually happens in a Sprint, in the order it happens. */
export const sprintStages: readonly { stage: string; yours: string; ours: string }[] = [
  {
    stage: 'Capture',
    ours: 'We shadow shifts, photograph stations, and collect every binder, sheet and thread that holds a procedure.',
    yours: 'Let us be in the way as little as possible. That is it.',
  },
  {
    stage: 'Build',
    ours: 'We turn all of it into structured procedures — recipes with real quantities, opening and closing in order, equipment with its failure modes.',
    yours: 'Nothing. This is the part you are paying to not do.',
  },
  {
    stage: 'Verify',
    ours: 'We bring you every procedure and the questions we could not answer ourselves.',
    yours: 'A focused review block with you and your chef or GM. This is the part only you can do.',
  },
  {
    stage: 'Launch',
    ours: 'Staff access goes live, QR labels go up at the stations, and we walk your managers through running it.',
    yours: 'Get your managers in a room with us once.',
  },
  {
    stage: 'Handoff',
    ours: 'You get the system and everything behind it. It is yours whether or not you continue with us.',
    yours: 'Decide whether you want Care.',
  },
];

/** The MISE Method. Five stages, each with what it actually involves. */
export interface MethodStage {
  key: string;
  name: string;
  summary: string;
  detail: string;
  /** What the restaurant is left holding at the end of the stage. */
  leaves: string;
}

export const method: readonly MethodStage[] = [
  {
    key: 'capture',
    name: 'Capture',
    summary: 'We come to you, during service and after it.',
    detail:
      'We shadow shifts, watch how the work is really done, photograph station setups, and collect what already exists — binders, recipe sheets, laminated cards, the text thread where half the decisions live.',
    leaves: 'A complete picture of how the restaurant runs today.',
  },
  {
    key: 'build',
    name: 'Build',
    summary: 'We turn all of it into procedures a new hire could follow.',
    detail:
      'Recipes with real quantities and yields. Opening and closing in the order they happen. Prep standards with pars. Cleaning by station. Equipment with the three things that usually go wrong and what to do about each.',
    leaves: 'A structured draft of the whole operation.',
  },
  {
    key: 'verify',
    name: 'Verify',
    summary: 'Nothing goes live on a guess.',
    detail:
      'You and your chef or GM review every procedure and approve the version that is correct. Where three people do a thing three ways, this is where you decide which one is the standard — often the most valuable hour of the whole engagement.',
    leaves: 'One approved version of every procedure.',
  },
  {
    key: 'launch',
    name: 'Launch',
    summary: 'The system goes where the work happens.',
    detail:
      'Staff get access on the phones already in their pockets. QR labels go up at the stations the procedures belong to. We walk your managers through running it, so it is theirs from day one rather than something that was done to them.',
    leaves: 'A team using it on shift.',
  },
  {
    key: 'maintain',
    name: 'Maintain',
    summary: 'Restaurants change. The system has to change with them.',
    detail:
      'Menus change, equipment gets replaced, people leave. MISE OPS Care keeps procedures matching the restaurant, so the system stays trusted instead of quietly becoming another binder nobody opens.',
    leaves: 'A system that is still true a year later.',
  },
] as const;

/** Homepage FAQ. Also feeds FAQPage structured data, so answers stay factual. */
export const faqs: readonly { q: string; a: string }[] = [
  {
    q: 'We already have SOPs. Is this still useful?',
    a: 'Usually, yes — but not always, and we will tell you if not. Most restaurants we meet have documents that are partly right, partly out of date, and not where anyone can reach them mid-shift. The work is then verification and access rather than writing from scratch, and the engagement is scoped smaller to match.',
  },
  {
    q: 'What if everything is currently in binders and text messages?',
    a: 'That is the normal starting point. Binders, recipe sheets, laminated cards, photos on a manager’s phone and a group chat are all source material. We collect them during Capture and treat them as drafts to verify, not as rubbish to throw out.',
  },
  {
    q: 'Do we need new software?',
    a: 'No new system for your team to learn. Staff open a link on the phone they already carry — no app to install, no account for a dishwasher to remember. If you already pay for a tool that does part of this, we would rather use it than sell you a second one.',
  },
  {
    q: 'Can you work with the tools we already use?',
    a: 'Where it makes sense, yes. If your recipes live somewhere that works, or your checklists already run in something your managers like, the goal is one place your team can find an answer — not replacing software that is doing its job.',
  },
  {
    q: 'Can procedures be bilingual?',
    a: 'Yes. Where your team needs English and Spanish, procedures are built in both, side by side, so nobody is working from the version they understand least. We scope which material genuinely needs it rather than translating everything by default.',
  },
  {
    q: 'How much work does this require from us?',
    a: 'The point is that most of it is ours. Expect shadowed shifts where we stay out of the way, and a focused review block with you and your chef or GM during Verify — that review is the part only you can do, because you are deciding which version of a procedure is the standard.',
  },
  {
    q: 'What happens after the initial build?',
    a: 'You own what we built, and it keeps working whether or not you continue with us. MISE OPS Care is there because restaurants change: menus, equipment and people all move, and a system that is not maintained becomes another binder nobody trusts.',
  },
  {
    q: 'Is this only for multi-location restaurants?',
    a: 'No. A single location with a growing team, a new GM, or an owner who wants a week off gets the same benefit. Multiple locations make the problem more expensive, not more real.',
  },
];

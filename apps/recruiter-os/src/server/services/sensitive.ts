/**
 * Sensitive-topic routing.
 *
 * This is a ROUTING AID, not a classifier and not an eligibility check. When
 * it fires, the product does exactly one thing: stop the automated
 * conversation, say something neutral, and make it a recruiter's job.
 *
 * It is deliberately generous about what counts as sensitive and deliberately
 * silent about what it found. It never answers the question, never estimates
 * eligibility, and never records a judgement about the person. Missing a case
 * is not a safety failure here, because an explicit human request ALWAYS
 * triggers handoff regardless of what this function thinks.
 */

export type SensitiveCategory = 'medical' | 'legal' | 'waiver' | 'financial' | 'other_sensitive';

const PATTERNS: Array<{ category: SensitiveCategory; pattern: RegExp }> = [
  {
    category: 'medical',
    pattern:
      /\b(asthma|adhd|adderall|medication|diagnos(is|ed)|surgery|injur(y|ies)|depress(ion|ed)|anxiety|therapy|therapist|disabilit|prescription|inhaler|seizure|diabet|autism|medical)\b/i,
  },
  {
    category: 'legal',
    pattern:
      /\b(arrest(ed)?|charge[sd]?|convict(ed|ion)|misdemean|felony|probation|court|expunge|dui|dwi|juvenile record|police report|warrant)\b/i,
  },
  { category: 'waiver', pattern: /\b(waiver|disqualif|dq'?d|moral waiver|medical waiver|eligib)\b/i },
  { category: 'financial', pattern: /\b(bankrupt|garnish|credit score|collections|debt)\b/i },
  {
    category: 'other_sensitive',
    pattern: /\b(immigration status|green card|visa status|deport|asylum|gender identity|religio)\b/i,
  },
];

const HUMAN_REQUEST =
  /\b(talk|speak|call)\s+(to|with)\s+(a\s+)?(real\s+)?(person|human|recruiter|someone)\b|\bhuman\b|\bstop the (bot|questions)\b|\bi(?:'| a)?m done (with )?(the )?questions\b|\bcan (someone|a person) call\b/i;

export function detectSensitive(text: string): { sensitive: boolean; category: SensitiveCategory | null } {
  for (const { category, pattern } of PATTERNS) {
    if (pattern.test(text)) return { sensitive: true, category };
  }
  return { sensitive: false, category: null };
}

export function detectHumanRequest(text: string): boolean {
  return HUMAN_REQUEST.test(text);
}

/**
 * The neutral thing we say. No reassurance about eligibility, no advice, no
 * hint about what was detected, and no promise about how quickly anyone will
 * call.
 */
export const NEUTRAL_HANDOFF_TEXT =
  'Thanks for telling us. That is something to go over with a recruiter rather than here, ' +
  'so I have stopped the questions and passed this to the recruiter for this area. ' +
  'They will pick it up from here. You do not need to add anything else right now.';

export const HUMAN_REQUEST_TEXT =
  'Understood — I have stopped the questions and passed this to a recruiter, who will follow up with you. ' +
  'Nothing else is needed from you right now.';

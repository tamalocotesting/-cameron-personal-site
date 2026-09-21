import 'server-only';
import type {
  AiBriefProvider,
  BriefContext,
  BriefPreparationOutcome,
  BriefResult,
  SourceReference,
} from './types';
import { truncate } from '@/lib/utils';

/**
 * Deterministic, rules-based brief preparation.
 *
 * This is the DEMO-mode provider, and it is genuinely useful rather than a
 * placeholder: it reads the stored intake answers, messages and call outcomes
 * and assembles the four questions a recruiter actually needs answered. It
 * cites the exact source it drew each line from, because it only ever quotes.
 *
 * It labels itself as rules-based demo preparation everywhere it appears, and
 * it makes no external network call of any kind.
 */

const INTENT_KEYS = ['interest_area', 'reason_for_interest', 'timeline', 'anything_else'];

/**
 * Question keys the clarification pass looks for. Matching is on the stable
 * KEY, not the wording, so rephrasing a question does not silently change what
 * the brief asks a recruiter to confirm.
 */
const WANTED_KEYS: Array<[string, string]> = [
  ['contact_preference', 'Confirm how and when they prefer to be contacted.'],
  ['availability', 'Confirm the days and times they can actually talk.'],
  ['timeline', 'Ask what timeframe they have in mind.'],
  ['education_status', 'Ask about current education status.'],
  ['asvab_status', 'Ask whether they have taken the ASVAB.'],
];

function firstSentence(text: string, max = 160): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const stop = cleaned.search(/[.!?](\s|$)/);
  const slice = stop > 20 ? cleaned.slice(0, stop + 1) : cleaned;
  return truncate(slice, max);
}

function refFor(source: BriefContext['sources'][number], excerptSource?: string): SourceReference | null {
  const base = (excerptSource ?? source.text).replace(/\s+/g, ' ').trim();
  // The contract requires an excerpt of at least three characters that is a
  // verbatim span of the stored text. A two-character answer like "No" cannot
  // satisfy that, so it is cited through its question label instead of being
  // forced into a malformed reference.
  if (base.length < 3) return null;
  return {
    kind: source.kind,
    id: source.id,
    revision: source.revision,
    excerpt: truncate(base, 200).replace(/…$/, ''),
  };
}

export class LocalRulesBriefProvider implements AiBriefProvider {
  readonly name = 'local-rules';
  readonly rulesBased = true;
  readonly promptVersion = 'local-rules/2026-09-01';
  readonly modelId = null;

  async prepare(context: BriefContext): Promise<BriefPreparationOutcome> {
    const started = Date.now();

    const intakeSources = context.sources.filter((s) => s.kind === 'INTAKE_ANSWER');
    const applicantMessages = context.sources.filter(
      (s) => s.kind === 'MESSAGE' && s.speaker === 'applicant',
    );
    const callSources = context.sources.filter((s) => s.kind === 'CALL_EVENT');

    // --- 1. What does this person want? -----------------------------------
    const intentSource =
      intakeSources.find((s) => s.fieldKey !== null && INTENT_KEYS.includes(s.fieldKey)) ??
      applicantMessages[0] ??
      intakeSources[0] ??
      callSources[0];

    const applicantIntent = intentSource
      ? `Stated interest: ${firstSentence(intentSource.text)}`
      : 'Not yet stated. The case has no applicant-supplied statement of interest.';

    // --- 2. What have they already told us? -------------------------------
    const facts: BriefResult['facts'] = [];
    // An intake answer IS something they told us, so all of them qualify. The
    // only thing filtered out is text too short to quote verifiably.
    for (const source of intakeSources) {
      if (!source.text.trim()) continue;
      const ref = refFor(source);
      if (!ref) continue;
      facts.push({
        text: `${source.label} — ${firstSentence(source.text, 180)}`,
        sources: [ref],
      });
      if (facts.length >= 8) break;
    }
    for (const source of applicantMessages.slice(-3)) {
      if (facts.length >= 10) break;
      const ref = refFor(source);
      if (!ref) continue;
      facts.push({
        text: `Said in conversation: ${firstSentence(source.text, 180)}`,
        sources: [ref],
      });
    }
    for (const source of callSources.slice(-2)) {
      if (facts.length >= 12) break;
      const ref = refFor(source);
      if (!ref) continue;
      facts.push({
        text: `Call record: ${firstSentence(source.text, 160)}`,
        sources: [ref],
      });
    }

    // --- 3. What needs clarification? -------------------------------------
    const answeredKeys = new Set(intakeSources.map((s) => s.fieldKey).filter((k): k is string => k !== null));
    const clarifications: string[] = [];
    for (const [key, ask] of WANTED_KEYS) {
      if (!answeredKeys.has(key)) clarifications.push(ask);
      if (clarifications.length >= 6) break;
    }
    if (!context.applicantDisplayName.trim()) clarifications.push('Confirm the applicant’s name.');
    if (!context.operational.channelPermissions.length) {
      clarifications.push('No contact permission is recorded yet — confirm it before messaging.');
    }

    const unknowns: string[] = [];
    if (!intakeSources.length) unknowns.push('No intake answers have been submitted for this case.');
    if (!applicantMessages.length) unknowns.push('The applicant has not sent a message yet.');
    if (!context.timezone) unknowns.push('Applicant timezone is unconfirmed.');

    // --- 4. What should the recruiter do next? ----------------------------
    const reviewReasons: string[] = [];
    for (const kind of context.operational.openReviewFlagKinds) {
      if (kind === 'HUMAN_REQUESTED') reviewReasons.push('The applicant asked to speak with a person.');
      else if (kind === 'SENSITIVE_QUESTION')
        reviewReasons.push('A question came up that automation must not answer. A recruiter has to handle it.');
      else if (kind === 'LINKING_REVIEW')
        reviewReasons.push('An inbound contact could belong to more than one case. Linking needs review.');
      else reviewReasons.push(`Open review flag: ${kind}.`);
    }

    const suggestedNextAction = context.operational.openReviewFlagKinds.includes('HUMAN_REQUESTED')
      ? 'Call the applicant — they asked to speak with a person. Use the recorded callback window.'
      : context.operational.openTaskTitles.length
        ? `Work the open commitment: ${context.operational.openTaskTitles[0]}.`
        : applicantMessages.length
          ? 'Reply to the applicant’s message and propose two concrete appointment times.'
          : 'Make first contact on the permitted channel and confirm a time to talk.';

    const result: BriefResult = {
      applicantIntent,
      facts,
      clarifications: clarifications.slice(0, 8),
      unknowns: unknowns.slice(0, 8),
      suggestedNextAction,
      messageDraft: null,
      reviewReasons: reviewReasons.slice(0, 6),
    };

    return {
      status: 'ok',
      result,
      providerName: this.name,
      modelId: null,
      promptVersion: this.promptVersion,
      durationMs: Date.now() - started,
    };
  }

  async checkHealth() {
    return {
      ok: true,
      detail: 'Rules-based demo preparation. Deterministic, local, no external request.',
    };
  }
}

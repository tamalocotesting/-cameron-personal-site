import { z } from 'zod';

/**
 * The brief contract.
 *
 * Source references are APPLICATION-DEFINED FIELDS inside our own JSON schema.
 * We deliberately do not depend on combining a provider's separate citation
 * feature with structured output: the reference must be a plain field we can
 * validate ourselves against our own database.
 *
 * Every factual statement must carry at least one reference, and every
 * reference must quote an excerpt that actually occurs in the stored source.
 * A brief that fails either check is rejected — never displayed as valid.
 */
export const sourceReferenceSchema = z.object({
  kind: z.enum(['MESSAGE', 'INTAKE_ANSWER', 'NOTE_REVISION', 'CALL_EVENT']),
  /** Must be an id that appeared in the context we supplied. */
  id: z.string().min(1),
  /** Revision number for versioned sources. */
  revision: z.number().int().positive().nullable().optional(),
  /** A verbatim span from that source. Verified server-side. */
  excerpt: z.string().min(3).max(400),
});

export const briefFactSchema = z.object({
  text: z.string().min(1).max(600),
  sources: z.array(sourceReferenceSchema).min(1).max(4),
});

export const briefResultSchema = z.object({
  /** What this person appears to want, in their own framing. */
  applicantIntent: z.string().min(1).max(600),
  /** Things they have already told us. Each needs a source. */
  facts: z.array(briefFactSchema).max(12),
  /** Open questions a recruiter should ask. No sources required. */
  clarifications: z.array(z.string().min(1).max(300)).max(8),
  /** Information we simply do not have. Stays visibly unknown. */
  unknowns: z.array(z.string().min(1).max(300)).max(8),
  /** A suggestion, labelled as such. Never an instruction. */
  suggestedNextAction: z.string().min(1).max(400),
  /** Optional draft. Requires recruiter approval before it can be sent. */
  messageDraft: z.string().max(900).nullable().optional(),
  /** Why a human needs to look. Workflow reasons only. */
  reviewReasons: z.array(z.string().min(1).max(300)).max(6),
});

export type BriefResult = z.infer<typeof briefResultSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

/** A single permitted source, as supplied to the provider. */
export type BriefContextSource = {
  kind: SourceReference['kind'];
  id: string;
  revision: number | null;
  /** Who said it, so the model does not attribute a recruiter line to the applicant. */
  speaker: 'applicant' | 'recruiter' | 'automation' | 'system';
  label: string;
  /**
   * The stable question key for an intake answer. Matching on this rather than
   * on the human-readable prompt is what keeps the rules adapter working when
   * an organization rewords a question.
   */
  fieldKey: string | null;
  occurredAt: string;
  text: string;
};

export type BriefContext = {
  organizationId: string;
  applicantId: string;
  applicantDisplayName: string;
  caseStatus: string;
  timezone: string;
  /** Only sources in approved data categories, never sensitive free text. */
  sources: BriefContextSource[];
  /** Operational facts that are ours, not the applicant's words. */
  operational: {
    ownerName: string | null;
    openTaskTitles: string[];
    nextDueAt: string | null;
    openReviewFlagKinds: string[];
    channelPermissions: string[];
  };
};

export type BriefPreparationOutcome =
  | { status: 'ok'; result: BriefResult; providerName: string; modelId: string | null; promptVersion: string; durationMs: number }
  | { status: 'unavailable'; providerName: string; reason: string }
  | { status: 'invalid'; providerName: string; reason: string };

export interface AiBriefProvider {
  readonly name: string;
  /** True when the brief is produced by deterministic local rules. */
  readonly rulesBased: boolean;
  readonly promptVersion: string;
  readonly modelId: string | null;
  prepare(context: BriefContext, signal?: AbortSignal): Promise<BriefPreparationOutcome>;
  checkHealth(): Promise<{ ok: boolean; detail: string }>;
}

import { z } from 'zod';

/**
 * Job catalogue.
 *
 * Payloads carry SCOPED IDENTIFIERS ONLY. No transcripts, no applicant free
 * text, no rendered message bodies: a queue row is not a place to keep a
 * conversation. The worker re-reads current state — consent, opt-out,
 * ownership, appointment state — when the job actually runs, because all of
 * those can change between enqueue and execution.
 */
export const JOB = {
  dispatchMessage: 'message.dispatch',
  reconcileMessage: 'message.reconcile',
  sendAcknowledgment: 'inquiry.acknowledge',
  prepareBrief: 'brief.prepare',
  appointmentReminder: 'appointment.reminder',
  scanOverdueTasks: 'tasks.scan-overdue',
  detectDuplicates: 'duplicates.detect',
  deliverHandoffWebhook: 'handoff.webhook',
  advanceSmsIntake: 'intake.sms-advance',
  retentionRun: 'retention.run',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export const jobPayloads = {
  [JOB.dispatchMessage]: z.object({
    organizationId: z.string(),
    messageId: z.string(),
  }),
  [JOB.reconcileMessage]: z.object({
    organizationId: z.string(),
    messageId: z.string(),
    attempt: z.number().int().min(1).default(1),
  }),
  [JOB.sendAcknowledgment]: z.object({
    organizationId: z.string(),
    applicantId: z.string(),
    inquiryEpisodeId: z.string(),
  }),
  [JOB.prepareBrief]: z.object({
    organizationId: z.string(),
    applicantId: z.string(),
    requestedByMemberId: z.string().nullable().default(null),
    reason: z.string().default('event'),
  }),
  [JOB.appointmentReminder]: z.object({
    organizationId: z.string(),
    appointmentId: z.string(),
    reminderId: z.string(),
  }),
  [JOB.scanOverdueTasks]: z.object({
    organizationId: z.string(),
  }),
  [JOB.detectDuplicates]: z.object({
    organizationId: z.string(),
    applicantId: z.string(),
  }),
  [JOB.deliverHandoffWebhook]: z.object({
    organizationId: z.string(),
    handoffExportId: z.string(),
  }),
  // Identifiers only. The reply's text stays in the message row; the worker
  // reads it under the policy layer when the job runs.
  [JOB.advanceSmsIntake]: z.object({
    organizationId: z.string(),
    sessionId: z.string(),
    messageId: z.string(),
  }),
  [JOB.retentionRun]: z.object({
    organizationId: z.string(),
    policyId: z.string(),
    runId: z.string(),
    mode: z.enum(['preview', 'execute']),
    requestedByMemberId: z.string(),
  }),
} as const;

export type JobPayload<K extends JobName> = z.infer<(typeof jobPayloads)[K]>;

/** Retry policy per job. Uncertain external side effects get ONE attempt. */
export const jobRetryPolicy: Record<JobName, { retryLimit: number; retryDelaySeconds: number }> = {
  // A dispatch that times out is reconciled, never blindly retried.
  [JOB.dispatchMessage]: { retryLimit: 0, retryDelaySeconds: 0 },
  [JOB.reconcileMessage]: { retryLimit: 4, retryDelaySeconds: 60 },
  [JOB.sendAcknowledgment]: { retryLimit: 2, retryDelaySeconds: 30 },
  [JOB.prepareBrief]: { retryLimit: 2, retryDelaySeconds: 20 },
  [JOB.appointmentReminder]: { retryLimit: 2, retryDelaySeconds: 60 },
  [JOB.scanOverdueTasks]: { retryLimit: 1, retryDelaySeconds: 120 },
  [JOB.detectDuplicates]: { retryLimit: 2, retryDelaySeconds: 30 },
  [JOB.deliverHandoffWebhook]: { retryLimit: 3, retryDelaySeconds: 90 },
  // Every step is idempotent on the inbound message id, so a retry re-sends
  // nothing: the message row already exists and is returned as-is.
  [JOB.advanceSmsIntake]: { retryLimit: 2, retryDelaySeconds: 20 },
  [JOB.retentionRun]: { retryLimit: 0, retryDelaySeconds: 0 },
};

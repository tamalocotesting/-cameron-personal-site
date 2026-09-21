import {
  AppointmentState,
  CaseStatus,
  MessageState,
  TaskStatus,
  DefinitionState,
  IntakeSessionStatus,
  HandoffState,
} from '@prisma/client';
import { ConflictError } from '@/server/authz/errors';

/**
 * Explicit transition tables.
 *
 * The enum keeps invalid values out of the column. These tables keep invalid
 * MOVES out of the workflow — which is the part that actually goes wrong when
 * two people (or a person and a provider callback) touch a row at once.
 */

type Transitions<T extends string> = Readonly<Record<T, readonly T[]>>;

export const caseTransitions: Transitions<CaseStatus> = {
  NEW_INQUIRY: ['INTAKE_IN_PROGRESS', 'READY_FOR_RECRUITER', 'CONTACT_ATTEMPTED', 'AWAITING_APPLICANT', 'CLOSED'],
  INTAKE_IN_PROGRESS: ['READY_FOR_RECRUITER', 'AWAITING_APPLICANT', 'CONTACT_ATTEMPTED', 'CLOSED'],
  READY_FOR_RECRUITER: ['CONTACT_ATTEMPTED', 'TWO_WAY_CONVERSATION', 'APPOINTMENT_SCHEDULED', 'AWAITING_APPLICANT', 'CLOSED'],
  CONTACT_ATTEMPTED: ['TWO_WAY_CONVERSATION', 'APPOINTMENT_SCHEDULED', 'AWAITING_APPLICANT', 'READY_FOR_RECRUITER', 'CLOSED'],
  TWO_WAY_CONVERSATION: ['APPOINTMENT_SCHEDULED', 'AWAITING_APPLICANT', 'CONTACT_ATTEMPTED', 'CLOSED'],
  APPOINTMENT_SCHEDULED: ['TWO_WAY_CONVERSATION', 'AWAITING_APPLICANT', 'CONTACT_ATTEMPTED', 'CLOSED'],
  AWAITING_APPLICANT: ['TWO_WAY_CONVERSATION', 'CONTACT_ATTEMPTED', 'APPOINTMENT_SCHEDULED', 'READY_FOR_RECRUITER', 'CLOSED'],
  // Reopening a closed case is allowed, and starts a NEW inquiry episode.
  CLOSED: ['READY_FOR_RECRUITER', 'TWO_WAY_CONVERSATION', 'CONTACT_ATTEMPTED'],
};

/**
 * Message transport. Note what is NOT here: PROVIDER_ACCEPTED does not lead
 * back to QUEUED, DELIVERED is terminal, and OUTCOME_UNKNOWN can only be left
 * by reconciliation — never by another send attempt.
 */
export const messageTransitions: Transitions<MessageState> = {
  RECEIVED: [],
  DRAFT: ['APPROVED', 'CANCELED'],
  APPROVED: ['DRAFT', 'SCHEDULED', 'QUEUED', 'CANCELED', 'BLOCKED'],
  SCHEDULED: ['QUEUED', 'CANCELED', 'BLOCKED'],
  QUEUED: ['SUBMITTING', 'CANCELED', 'BLOCKED'],
  SUBMITTING: ['PROVIDER_ACCEPTED', 'FAILED', 'OUTCOME_UNKNOWN', 'BLOCKED'],
  PROVIDER_ACCEPTED: ['SENT', 'DELIVERED', 'FAILED'],
  SENT: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
  CANCELED: [],
  BLOCKED: ['DRAFT'],
  OUTCOME_UNKNOWN: ['PROVIDER_ACCEPTED', 'SENT', 'DELIVERED', 'FAILED'],
};

/**
 * Rank used to resolve out-of-order provider callbacks. A late "sent" never
 * demotes a row that a newer "delivered" already moved forward.
 */
export const messageStateRank: Record<MessageState, number> = {
  DRAFT: 0,
  APPROVED: 1,
  SCHEDULED: 2,
  QUEUED: 3,
  SUBMITTING: 4,
  BLOCKED: 4,
  OUTCOME_UNKNOWN: 5,
  PROVIDER_ACCEPTED: 6,
  SENT: 7,
  DELIVERED: 9,
  FAILED: 8,
  CANCELED: 8,
  RECEIVED: 9,
};

export const taskTransitions: Transitions<TaskStatus> = {
  OPEN: ['SNOOZED', 'COMPLETED', 'CANCELED'],
  SNOOZED: ['OPEN', 'COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

export const appointmentTransitions: Transitions<AppointmentState> = {
  PROPOSED: ['SCHEDULED', 'CONFIRMED', 'CANCELED'],
  SCHEDULED: ['CONFIRMED', 'CANCELED', 'COMPLETED', 'NO_SHOW'],
  CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
  NO_SHOW: [],
};

/**
 * Question sets and templates.
 *
 * Publishing IS the approval: the action records who approved it and on what
 * basis, so DRAFT can go straight to PUBLISHED. PENDING_APPROVAL stays
 * available for an organization that wants a separate reviewer, and a
 * PUBLISHED version is never edited — it is retired and replaced.
 */
export const definitionTransitions: Transitions<DefinitionState> = {
  DRAFT: ['PENDING_APPROVAL', 'PUBLISHED', 'RETIRED'],
  PENDING_APPROVAL: ['DRAFT', 'PUBLISHED', 'RETIRED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: [],
};

export const intakeSessionTransitions: Transitions<IntakeSessionStatus> = {
  IN_PROGRESS: ['PAUSED', 'COMPLETED', 'HANDED_OFF', 'ABANDONED'],
  PAUSED: ['IN_PROGRESS', 'COMPLETED', 'HANDED_OFF', 'ABANDONED'],
  // A handed-off session can still be completed by a recruiter-led path.
  HANDED_OFF: ['COMPLETED', 'ABANDONED'],
  COMPLETED: [],
  ABANDONED: ['IN_PROGRESS'],
};

export const handoffTransitions: Transitions<HandoffState> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['EXPORTED', 'DRAFT'],
  EXPORTED: ['TRANSPORT_ACCEPTED', 'TRANSPORT_FAILED', 'EXTERNALLY_CONFIRMED'],
  TRANSPORT_ACCEPTED: ['EXTERNALLY_CONFIRMED', 'TRANSPORT_FAILED'],
  TRANSPORT_FAILED: ['EXPORTED'],
  EXTERNALLY_CONFIRMED: [],
};

export function canTransition<T extends string>(table: Transitions<T>, from: T, to: T): boolean {
  if (from === to) return true;
  return (table[from] ?? []).includes(to);
}

export function assertTransition<T extends string>(
  table: Transitions<T>,
  from: T,
  to: T,
  subject: string,
): void {
  if (!canTransition(table, from, to)) {
    throw new ConflictError(`${subject} cannot move from ${from} to ${to}.`);
  }
}

/** States in which a case still needs an accountable owner and a next step. */
export const ACTIVE_CASE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.NEW_INQUIRY,
  CaseStatus.INTAKE_IN_PROGRESS,
  CaseStatus.READY_FOR_RECRUITER,
  CaseStatus.CONTACT_ATTEMPTED,
  CaseStatus.TWO_WAY_CONVERSATION,
  CaseStatus.APPOINTMENT_SCHEDULED,
  CaseStatus.AWAITING_APPLICANT,
];

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [TaskStatus.OPEN, TaskStatus.SNOOZED];

export const PENDING_SEND_STATES: readonly MessageState[] = [
  MessageState.APPROVED,
  MessageState.SCHEDULED,
  MessageState.QUEUED,
];

export const ACTIVE_APPOINTMENT_STATES: readonly AppointmentState[] = [
  AppointmentState.PROPOSED,
  AppointmentState.SCHEDULED,
  AppointmentState.CONFIRMED,
];

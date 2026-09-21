import { describe, expect, it } from 'vitest';
import {
  appointmentTransitions,
  assertTransition,
  canTransition,
  caseTransitions,
  messageStateRank,
  messageTransitions,
} from '@/server/domain/state-machines';
import { classifyForwardedLeg } from '@/server/services/voice';
import { detectHumanRequest, detectSensitive } from '@/server/services/sensitive';
import { normalizeProviderStatus } from '@/server/services/messaging';

describe('message transport state machine', () => {
  it('refuses to move a delivered message anywhere else', () => {
    expect(canTransition(messageTransitions, 'DELIVERED', 'SENT')).toBe(false);
    expect(canTransition(messageTransitions, 'DELIVERED', 'FAILED')).toBe(false);
  });

  it('only lets an unknown outcome be resolved by reconciliation, never by another send', () => {
    expect(canTransition(messageTransitions, 'OUTCOME_UNKNOWN', 'DELIVERED')).toBe(true);
    expect(canTransition(messageTransitions, 'OUTCOME_UNKNOWN', 'QUEUED')).toBe(false);
    expect(canTransition(messageTransitions, 'OUTCOME_UNKNOWN', 'SUBMITTING')).toBe(false);
  });

  it('ranks delivery above acceptance so a late callback cannot demote it', () => {
    expect(messageStateRank.DELIVERED).toBeGreaterThan(messageStateRank.SENT);
    expect(messageStateRank.SENT).toBeGreaterThan(messageStateRank.PROVIDER_ACCEPTED);
  });

  it('throws with a readable message on an invalid move', () => {
    expect(() => assertTransition(messageTransitions, 'DELIVERED', 'QUEUED', 'Message')).toThrow(
      /cannot move from DELIVERED to QUEUED/,
    );
  });
});

describe('case and appointment state machines', () => {
  it('allows a closed case to be reopened', () => {
    expect(canTransition(caseTransitions, 'CLOSED', 'READY_FOR_RECRUITER')).toBe(true);
  });

  it('will not resurrect a completed appointment', () => {
    expect(canTransition(appointmentTransitions, 'COMPLETED', 'SCHEDULED')).toBe(false);
    expect(canTransition(appointmentTransitions, 'NO_SHOW', 'CONFIRMED')).toBe(false);
  });
});

describe('forwarded call leg classification', () => {
  it('does not treat a completed leg with no duration as a human answering', () => {
    expect(classifyForwardedLeg({ dialCallStatus: 'completed', dialCallDuration: 0 })).toEqual({
      outcome: 'FORWARD_UNANSWERED',
      humanConnected: false,
    });
  });

  it('treats a completed leg with real duration as a connected call', () => {
    expect(classifyForwardedLeg({ dialCallStatus: 'completed', dialCallDuration: 42 })).toEqual({
      outcome: 'CONNECTED',
      humanConnected: true,
    });
  });

  it('maps every unanswered outcome without claiming a connection', () => {
    for (const status of ['no-answer', 'busy', 'failed', 'canceled', 'weird-new-status', null]) {
      const result = classifyForwardedLeg({ dialCallStatus: status, dialCallDuration: null });
      expect(result.humanConnected).toBe(false);
    }
  });
});

describe('provider status normalisation', () => {
  it('keeps acceptance and delivery distinct', () => {
    expect(normalizeProviderStatus('queued')).toBe('PROVIDER_ACCEPTED');
    expect(normalizeProviderStatus('accepted')).toBe('PROVIDER_ACCEPTED');
    expect(normalizeProviderStatus('sent')).toBe('SENT');
    expect(normalizeProviderStatus('delivered')).toBe('DELIVERED');
    expect(normalizeProviderStatus('undelivered')).toBe('FAILED');
  });

  it('treats an unrecognised status as unknown rather than success', () => {
    expect(normalizeProviderStatus('something_new')).toBe('OUTCOME_UNKNOWN');
  });
});

describe('sensitive routing', () => {
  it('routes medical, legal and waiver topics without answering them', () => {
    expect(detectSensitive('I take a prescription for asthma').category).toBe('medical');
    expect(detectSensitive('I was arrested when I was 17').category).toBe('legal');
    expect(detectSensitive('do I need a waiver for that').category).toBe('waiver');
  });

  it('leaves ordinary answers alone', () => {
    expect(detectSensitive('I am interested in aviation and finish school in May').sensitive).toBe(false);
  });

  it('recognises an explicit request for a person', () => {
    for (const text of [
      'can I talk to a real person',
      'I want to speak with a recruiter',
      'please stop the questions',
      'can someone call me',
    ]) {
      expect(detectHumanRequest(text)).toBe(true);
    }
    expect(detectHumanRequest('I am free on Tuesday')).toBe(false);
  });
});

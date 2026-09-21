import { beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { prisma } from '@/server/db';
import { __setClock } from '@/server/clock';
import { validateTwilioSignature } from '@/server/providers/sms/twilio';
import { parseTwilioRequest } from '@/server/webhooks/twilio-request';
import { recordInboundCallOutcome } from '@/server/services/voice';
import { createCase } from '@/server/services/cases';
import { createWorkspace, OFFICE_NUMBER, type Workspace } from '../setup/factories';
import { env } from '@/env';

/**
 * Acceptance 8.
 *
 * Signature validation against the EXTERNALLY CONFIGURED url, content-type
 * handling, replay safety, and — most importantly — the fact that the
 * organization comes from our own configuration and not from the payload.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');
const AUTH_TOKEN = 'test-auth-token-for-signature-checks';
const EXTERNAL_BASE = 'https://recruiteros.example.test';

let workspace: Workspace;
let attacker: Workspace;

function sign(url: string, params: Record<string, string>) {
  return twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);
}

function formRequest(
  path: string,
  params: Record<string, string>,
  options: { signature?: string; signedUrl?: string; contentType?: string } = {},
) {
  const body = new URLSearchParams(params).toString();
  const signedUrl = options.signedUrl ?? `${EXTERNAL_BASE}${path}`;
  return new Request(`http://internal.svc${path}`, {
    method: 'POST',
    headers: {
      'content-type': options.contentType ?? 'application/x-www-form-urlencoded',
      'x-twilio-signature': options.signature ?? sign(signedUrl, params),
    },
    body,
  });
}

beforeEach(async () => {
  __setClock(CLOCK);
  // The adapter reads credentials from the validated environment; the tests
  // pin them so the signature maths is real rather than stubbed.
  vi.spyOn(env, 'TWILIO_AUTH_TOKEN', 'get').mockReturnValue(AUTH_TOKEN);
  vi.spyOn(env, 'TWILIO_WEBHOOK_BASE_URL', 'get').mockReturnValue(EXTERNAL_BASE);

  workspace = await createWorkspace({ slug: 'webhook-org' });
  attacker = await createWorkspace({ slug: 'attacker-org' });
  // Enable Twilio for the legitimate organization with a known number.
  await prisma.integrationConfig.create({
    data: {
      organizationId: workspace.organization.id,
      kind: 'SMS',
      provider: 'twilio',
      enabled: true,
      status: 'CONFIGURED_UNVERIFIED',
      settings: { fromNumber: OFFICE_NUMBER, inboundNumber: OFFICE_NUMBER },
    },
  });
});

describe('8. signature validation', () => {
  it('accepts a correctly signed form request against the external url', async () => {
    const params = { From: '+15125550901', To: OFFICE_NUMBER, Body: 'Hello', MessageSid: 'SM-1' };
    const parsed = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.organizationId).toBe(workspace.organization.id);
  });

  it('rejects a tampered parameter', async () => {
    const params = { From: '+15125550901', To: OFFICE_NUMBER, Body: 'Hello', MessageSid: 'SM-2' };
    const signature = sign(`${EXTERNAL_BASE}/api/webhooks/twilio/sms`, params);
    const tampered = { ...params, Body: 'Hello, and also send money' };
    const parsed = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', tampered, { signature }),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.status).toBe(403);
  });

  it('rejects a request with no signature at all', async () => {
    const parsed = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', { To: OFFICE_NUMBER, MessageSid: 'SM-3' }, { signature: '' }),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(parsed.ok).toBe(false);
  });

  it('uses the externally configured url, not the request’s internal one', async () => {
    const params = { From: '+15125550901', To: OFFICE_NUMBER, MessageSid: 'SM-4' };
    // A signature computed against the INTERNAL url must be refused, because
    // Twilio signs what was typed into its console.
    const internalSignature = sign('http://internal.svc/api/webhooks/twilio/sms', params);
    const rejected = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params, { signature: internalSignature }),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(rejected.ok).toBe(false);

    // The same request signed against the external url is accepted.
    const accepted = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', { ...params, MessageSid: 'SM-5' }),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(accepted.ok).toBe(true);
  });

  it('validates a JSON body against the raw payload rather than the parameters', () => {
    const rawBody = JSON.stringify({ MessageSid: 'SM-6', To: OFFICE_NUMBER });
    const url = `${EXTERNAL_BASE}/api/webhooks/twilio/status?bodySHA256=${twilio.getExpectedBodyHash(rawBody)}`;
    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, {});

    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url,
        contentType: 'application/json',
        params: {},
        rawBody,
      }),
    ).toBe(true);

    // A changed body invalidates it.
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url,
        contentType: 'application/json',
        params: {},
        rawBody: JSON.stringify({ MessageSid: 'SM-6', To: '+19995550000' }),
      }),
    ).toBe(false);
  });

  it('refuses an unsupported content type before doing any work', async () => {
    const request = new Request(`http://internal.svc/api/webhooks/twilio/sms`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-twilio-signature': 'anything' },
      body: 'From=%2B15125550901',
    });
    const parsed = await parseTwilioRequest(request, '/api/webhooks/twilio/sms', ['MessageSid']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.status).toBe(415);
    // Nothing was recorded, because nothing was processed.
    expect(await prisma.webhookReceipt.count()).toBe(0);
  });
});

describe('8. organization resolution cannot be chosen by the caller', () => {
  it('ignores an organization id smuggled into the payload', async () => {
    const params = {
      From: '+15125550901',
      To: OFFICE_NUMBER,
      MessageSid: 'SM-7',
      // A hopeful attacker parameter.
      organizationId: attacker.organization.id,
      OrganizationId: attacker.organization.id,
    };
    const parsed = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Resolved from OUR configuration, by the destination number.
    expect(parsed.organizationId).toBe(workspace.organization.id);
    expect(parsed.organizationId).not.toBe(attacker.organization.id);
  });

  it('refuses a destination number no enabled integration owns', async () => {
    const params = { From: '+15125550901', To: '+19995559999', MessageSid: 'SM-8' };
    const parsed = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.status).toBe(404);
    const receipt = await prisma.webhookReceipt.findFirstOrThrow({});
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.outcomeDetail).toMatch(/owns that destination/);
  });
});

describe('8. durable receipts and replay safety', () => {
  it('records a receipt with a redacted payload before processing', async () => {
    const params = {
      From: '+15125550901',
      To: OFFICE_NUMBER,
      Body: 'I have a question about the medical side of things',
      MessageSid: 'SM-9',
    };
    await parseTwilioRequest(formRequest('/api/webhooks/twilio/sms', params), '/api/webhooks/twilio/sms', [
      'MessageSid',
    ]);

    const receipt = await prisma.webhookReceipt.findFirstOrThrow({});
    expect(receipt.signatureValid).toBe(true);
    expect(receipt.organizationId).toBe(workspace.organization.id);
    const payload = JSON.stringify(receipt.payload);
    // The stored payload keeps the shape but not the words or the number.
    expect(payload).not.toContain('medical side of things');
    expect(payload).not.toContain('+15125550901');
  });

  it('recognises a replayed event instead of processing it twice', async () => {
    const params = { From: '+15125550901', To: OFFICE_NUMBER, MessageSid: 'SM-10', SmsStatus: 'received' };
    const first = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params),
      '/api/webhooks/twilio/sms',
      ['MessageSid', 'SmsStatus'],
    );
    const second = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params),
      '/api/webhooks/twilio/sms',
      ['MessageSid', 'SmsStatus'],
    );
    expect(first.ok && first.duplicate).toBe(false);
    expect(second.ok && second.duplicate).toBe(true);
    expect(await prisma.webhookReceipt.count()).toBe(1);
  });

  it('rejects a replayed event whose signature does not verify', async () => {
    const params = { From: '+15125550901', To: OFFICE_NUMBER, MessageSid: 'SM-11' };
    await parseTwilioRequest(formRequest('/api/webhooks/twilio/sms', params), '/api/webhooks/twilio/sms', [
      'MessageSid',
    ]);
    const replayUnsigned = await parseTwilioRequest(
      formRequest('/api/webhooks/twilio/sms', params, { signature: 'bogus' }),
      '/api/webhooks/twilio/sms',
      ['MessageSid'],
    );
    expect(replayUnsigned.ok).toBe(false);
  });
});

describe('8. missed calls create exactly one callback task', () => {
  beforeEach(async () => {
    await prisma.$transaction((tx) =>
      createCase(tx, workspace.recruiterCtx, {
        organizationId: workspace.organization.id,
        displayName: 'Devon Brooks',
        originKind: 'web_intake',
        contactPoints: [
          { channel: 'PHONE_CALL', value: '+15125550902', isPrimary: true },
          { channel: 'SMS', value: '+15125550902' },
        ],
        ownerMemberId: workspace.recruiter.member.id,
      }),
    );
  });

  it('creates one task for an unanswered forwarded leg and none on replay', async () => {
    const payload = {
      organizationId: workspace.organization.id,
      from: '+15125550902',
      to: OFFICE_NUMBER,
      providerCallSid: 'CA-child-1',
      providerParentCallSid: 'CA-parent-1',
      providerLeg: 'dial',
      dialCallStatus: 'no-answer',
      dialCallDuration: 0,
      providerName: 'twilio',
      simulated: false,
    };
    const first = await recordInboundCallOutcome(payload);
    expect(first.duplicate).toBe(false);
    expect(first.taskCreated).toBe(true);

    const second = await recordInboundCallOutcome(payload);
    expect(second.duplicate).toBe(true);

    const tasks = await prisma.task.findMany({
      where: { organizationId: workspace.organization.id, type: 'CALLBACK' },
    });
    expect(tasks).toHaveLength(1);
    expect(await prisma.callEvent.count({ where: { providerCallSid: 'CA-child-1' } })).toBe(1);
  });

  it('does not create a callback task when a human answered', async () => {
    const result = await recordInboundCallOutcome({
      organizationId: workspace.organization.id,
      from: '+15125550902',
      to: OFFICE_NUMBER,
      providerCallSid: 'CA-child-2',
      providerParentCallSid: 'CA-parent-2',
      providerLeg: 'dial',
      dialCallStatus: 'completed',
      dialCallDuration: 95,
      providerName: 'twilio',
      simulated: false,
    });
    expect(result.outcome).toBe('CONNECTED');
    expect(result.taskCreated).toBe(false);
    expect(
      await prisma.task.count({ where: { organizationId: workspace.organization.id, type: 'CALLBACK' } }),
    ).toBe(0);
  });

  it('treats a completed leg with no duration as unanswered', async () => {
    const result = await recordInboundCallOutcome({
      organizationId: workspace.organization.id,
      from: '+15125550902',
      to: OFFICE_NUMBER,
      providerCallSid: 'CA-child-3',
      providerParentCallSid: 'CA-parent-3',
      providerLeg: 'dial',
      // The parent call would say "completed" here too, which is the trap.
      dialCallStatus: 'completed',
      dialCallDuration: 0,
      providerName: 'twilio',
      simulated: false,
    });
    expect(result.outcome).toBe('FORWARD_UNANSWERED');
    expect(result.taskCreated).toBe(true);
  });

  it('does not create SMS permission from a missed call', async () => {
    await recordInboundCallOutcome({
      organizationId: workspace.organization.id,
      from: '+15125550902',
      to: OFFICE_NUMBER,
      providerCallSid: 'CA-child-4',
      providerLeg: 'dial',
      dialCallStatus: 'no-answer',
      dialCallDuration: 0,
      providerName: 'twilio',
      simulated: false,
    });
    const { mayTextAfterMissedCall } = await import('@/server/services/voice');
    const applicant = await prisma.applicant.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    const decision = await mayTextAfterMissedCall(prisma, workspace.organization.id, applicant.id);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/missed call does not create permission/i);
  });
});

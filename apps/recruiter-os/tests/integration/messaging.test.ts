import { beforeEach, describe, expect, it } from 'vitest';
import { ConsentPurpose, MessageState } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock } from '@/server/clock';
import {
  applyDeliveryEvent,
  approveDraft,
  cancelMessage,
  createDraft,
  dispatchMessage,
  editDraft,
  queueApprovedMessage,
  recordInboundSms,
  reconcileMessage,
  sendApprovedTemplate,
} from '@/server/services/messaging';
import { createCase } from '@/server/services/cases';
import { createWorkspace, grantConsent, OFFICE_NUMBER, type Workspace } from '../setup/factories';
import { BlockedError } from '@/server/authz/errors';
import { handlers } from '../../worker/handlers';

/**
 * Acceptance 6, 7 and parts of 9.
 *
 * Every send here goes through the real dispatch path and the real local
 * telecom simulator, so "queued" versus "accepted" versus "delivered" are the
 * states the product actually produces.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z'); // 10:00 CDT, inside contact hours

let workspace: Workspace;
let applicantId: string;

const PHONE = '+15125550501';

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
  const created = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: 'Tasha Alvarez',
      timezone: 'America/Chicago',
      originKind: 'web_intake',
      contactPoints: [
        { channel: 'PHONE_CALL', value: PHONE, isPrimary: true },
        { channel: 'SMS', value: PHONE },
      ],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  applicantId = created.applicant.id;
  await prisma.applicant.update({
    where: { id: applicantId },
    data: { timezoneConfirmed: true },
  });
  await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.RECRUITER_SMS, PHONE);
});

describe('6. drafting and scheduling are not sending', () => {
  it('keeps draft, approval and dispatch as separate states', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Hi Tasha, when is a good time to talk?',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    expect(draft.state).toBe(MessageState.DRAFT);
    expect(draft.providerMessageId).toBeNull();

    // A draft cannot be queued.
    await expect(
      queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id }),
    ).rejects.toThrow(/not been approved/);

    const approved = await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    expect(approved.state).toBe(MessageState.APPROVED);
    expect(approved.approvedBodyHash).not.toBeNull();
    // Approval alone is still not sending.
    expect(approved.providerMessageId).toBeNull();

    const queued = await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    expect(queued.state).toBe(MessageState.QUEUED);
    expect(queued.providerMessageId).toBeNull();

    // Only dispatch reaches the provider, and acceptance is not delivery.
    const result = await dispatchMessage(workspace.organization.id, draft.id);
    expect(result.state).toBe(MessageState.PROVIDER_ACCEPTED);
    const dispatched = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(dispatched.providerMessageId).toMatch(/^SIM/);
    expect(dispatched.state).not.toBe(MessageState.DELIVERED);
  });

  it('does not count a draft as human contact or complete anything', async () => {
    await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Draft only',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });

    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId } });
    expect(episode.firstHumanOutreachAt).toBeNull();
    expect(episode.firstTwoWayHumanAt).toBeNull();

    const openTasks = await prisma.task.count({
      where: { applicantId, status: { in: ['OPEN', 'SNOOZED'] } },
    });
    expect(openTasks).toBeGreaterThan(0);
  });

  it('marks first human outreach only once the provider accepts a recruiter message', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Hi Tasha, Austin here.',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    await dispatchMessage(workspace.organization.id, draft.id);

    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId } });
    expect(episode.firstHumanOutreachAt).not.toBeNull();
    // A reply is still needed before two-way HUMAN contact is claimed.
    expect(episode.firstTwoWayHumanAt).toBeNull();
  });
});

describe('5 (messaging half). editing an approved message invalidates the approval', () => {
  it('drops back to draft and refuses to dispatch on the old approval', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Original text',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: true,
      aiBriefId: null,
    });
    const approved = await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    const originalHash = approved.approvedBodyHash;

    const edited = await editDraft(workspace.recruiterCtx, { messageId: draft.id, body: 'Changed text' });
    expect(edited.state).toBe(MessageState.DRAFT);
    expect(edited.approvedBodyHash).toBeNull();
    expect(edited.approvedByMemberId).toBeNull();
    expect(originalHash).not.toBeNull();

    await expect(queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id })).rejects.toThrow(
      /not been approved/,
    );

    // And a tampered body with a stale hash is refused at dispatch too.
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    await prisma.message.update({ where: { id: draft.id }, data: { body: 'Smuggled text' } });
    const result = await dispatchMessage(workspace.organization.id, draft.id);
    expect(result.state).toBe(MessageState.BLOCKED);
  });
});

describe('7. opt-out, keyword handling and replay safety', () => {
  it('blocks and cancels pending sends when a STOP arrives first', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Following up',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, {
      messageId: draft.id,
      sendAt: new Date(CLOCK.getTime() + 3_600_000),
    });
    const scheduled = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(scheduled.state).toBe(MessageState.SCHEDULED);

    const inbound = await recordInboundSms({
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'STOP',
      providerMessageId: 'SIMIN-STOP-1',
      providerName: 'simulator',
      simulated: true,
    });
    expect(inbound.keyword).toBe('STOP');
    // The carrier answers the keyword itself; we must not double up.
    expect(inbound.providerAutoResponds).toBe(true);

    const afterStop = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(afterStop.state).toBe(MessageState.CANCELED);
    expect(afterStop.blockedReason).toMatch(/opted out/i);

    const job = await prisma.outboxRecord.findFirstOrThrow({ where: { idempotencyKey: `send:${draft.id}` } });
    expect(job.status).toBe('FAILED');

    // A recruiter cannot override the opt-out by pressing Send again.
    const second = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Trying again anyway',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: second.id });
    await expect(queueApprovedMessage(workspace.recruiterCtx, { messageId: second.id })).rejects.toThrow(
      BlockedError,
    );
  });

  it('suppresses a number across every case that holds it', async () => {
    const other = await prisma.$transaction((tx) =>
      createCase(tx, workspace.recruiterCtx, {
        organizationId: workspace.organization.id,
        displayName: 'Sibling On The Same Phone',
        originKind: 'web_intake',
        contactPoints: [{ channel: 'SMS', value: PHONE }],
        ownerMemberId: workspace.recruiter.member.id,
      }),
    );
    await grantConsent(workspace.organization.id, other.applicant.id, ConsentPurpose.RECRUITER_SMS, PHONE);

    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'stop',
      providerMessageId: 'SIMIN-STOP-2',
      providerName: 'simulator',
      simulated: true,
    });

    const suppressed = await prisma.channelPermission.findMany({
      where: { organizationId: workspace.organization.id, contactValue: PHONE, channel: 'SMS' },
    });
    expect(suppressed.length).toBeGreaterThanOrEqual(2);
    expect(suppressed.every((p) => p.suppressed)).toBe(true);
  });

  it('lifts suppression only on an explicit START', async () => {
    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'STOP',
      providerMessageId: 'SIMIN-STOP-3',
      providerName: 'simulator',
      simulated: true,
    });
    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'START',
      providerMessageId: 'SIMIN-START-1',
      providerName: 'simulator',
      simulated: true,
    });
    const permission = await prisma.channelPermission.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, contactValue: PHONE, purpose: 'RECRUITER_SMS' },
    });
    expect(permission.suppressed).toBe(false);
    expect(permission.granted).toBe(true);
  });

  it('ignores a replayed inbound message instead of duplicating it', async () => {
    const payload = {
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'Hi, is someone there?',
      providerMessageId: 'SIMIN-REPLAY-1',
      providerName: 'simulator',
      simulated: true,
    };
    const first = await recordInboundSms(payload);
    const second = await recordInboundSms(payload);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const messages = await prisma.message.findMany({
      where: { organizationId: workspace.organization.id, providerMessageId: 'SIMIN-REPLAY-1' },
    });
    expect(messages).toHaveLength(1);

    const replyTasks = await prisma.task.findMany({
      where: { applicantId, sourceRef: { startsWith: 'reply:' } },
    });
    expect(replyTasks).toHaveLength(1);
  });

  it('will not send at all when no permission was ever recorded', async () => {
    const noConsent = await prisma.$transaction((tx) =>
      createCase(tx, workspace.recruiterCtx, {
        organizationId: workspace.organization.id,
        displayName: 'Never Consented',
        originKind: 'web_intake',
        contactPoints: [{ channel: 'SMS', value: '+15125550599' }],
        ownerMemberId: workspace.recruiter.member.id,
      }),
    );
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId: noConsent.applicant.id,
      toValue: '+15125550599',
      body: 'Unsolicited',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await expect(queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id })).rejects.toThrow(
      /No recorded permission/,
    );
  });
});

describe('9 (messaging half). uncertain outcomes and out-of-order callbacks', () => {
  it('never re-sends after an ambiguous submission', async () => {
    const unknownNumber = '+15550000000'; // the simulator's timeout fixture
    const caseRow = await prisma.$transaction((tx) =>
      createCase(tx, workspace.recruiterCtx, {
        organizationId: workspace.organization.id,
        displayName: 'Timeout Fixture',
        timezone: 'America/Chicago',
        originKind: 'web_intake',
        contactPoints: [{ channel: 'SMS', value: unknownNumber }],
        ownerMemberId: workspace.recruiter.member.id,
      }),
    );
    await prisma.applicant.update({ where: { id: caseRow.applicant.id }, data: { timezoneConfirmed: true } });
    await grantConsent(workspace.organization.id, caseRow.applicant.id, ConsentPurpose.RECRUITER_SMS, unknownNumber);

    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId: caseRow.applicant.id,
      toValue: unknownNumber,
      body: 'Hello there',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });

    const result = await dispatchMessage(workspace.organization.id, draft.id);
    expect(result.state).toBe(MessageState.OUTCOME_UNKNOWN);

    const message = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(message.attemptCount).toBe(1);

    // A re-run of the dispatch job must not submit a second time.
    const replay = await dispatchMessage(workspace.organization.id, draft.id);
    expect(replay.state).toBe(MessageState.OUTCOME_UNKNOWN);
    const after = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(after.attemptCount).toBe(1);

    // It becomes reconciliation work with a review flag, not a retry.
    const flags = await prisma.reviewFlag.findMany({
      where: { applicantId: caseRow.applicant.id, kind: 'SEND_RECONCILIATION' },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.detail).toMatch(/do not resend/i);

    const jobs = await prisma.outboxRecord.findMany({
      where: { organizationId: workspace.organization.id, jobName: 'message.reconcile' },
    });
    expect(jobs).toHaveLength(1);
  });

  it('keeps history and current state correct when statuses arrive out of order', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Ordering test',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    await dispatchMessage(workspace.organization.id, draft.id);
    const dispatched = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    const providerMessageId = dispatched.providerMessageId!;

    const delivered = await applyDeliveryEvent({
      organizationId: workspace.organization.id,
      providerMessageId,
      providerStatus: 'delivered',
      occurredAt: new Date(CLOCK.getTime() + 20_000),
    });
    expect(delivered.state).toBe(MessageState.DELIVERED);

    // A late "sent" must not demote it.
    const late = await applyDeliveryEvent({
      organizationId: workspace.organization.id,
      providerMessageId,
      providerStatus: 'sent',
      occurredAt: new Date(CLOCK.getTime() + 5_000),
    });
    expect(late.applied).toBe(true);
    expect(late.state).toBe(MessageState.DELIVERED);

    const current = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(current.state).toBe(MessageState.DELIVERED);

    // But the history keeps both events.
    const events = await prisma.messageDeliveryEvent.findMany({ where: { messageId: draft.id } });
    expect(events.map((e) => e.providerStatus).sort()).toEqual(['delivered', 'sent']);

    // A replayed identical callback is ignored.
    const replay = await applyDeliveryEvent({
      organizationId: workspace.organization.id,
      providerMessageId,
      providerStatus: 'delivered',
      occurredAt: new Date(CLOCK.getTime() + 20_000),
    });
    expect(replay.applied).toBe(false);
    expect(await prisma.messageDeliveryEvent.count({ where: { messageId: draft.id } })).toBe(2);
  });

  it('reconciliation asks the provider and never sends again', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Reconcile me',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    await dispatchMessage(workspace.organization.id, draft.id);
    // Force the ambiguous state and let reconciliation resolve it.
    await prisma.message.update({
      where: { id: draft.id },
      data: { state: MessageState.OUTCOME_UNKNOWN },
    });

    const result = await reconcileMessage(workspace.organization.id, draft.id, 1);
    expect(result.resolved).toBe(true);
    const message = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(message.attemptCount).toBe(1);
    expect(message.state).not.toBe(MessageState.OUTCOME_UNKNOWN);
  });
});

describe('approved automation', () => {
  it('sends an allowlisted approved template, and refuses a paused case', async () => {
    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId } });
    await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.INTAKE_SMS, PHONE);

    const result = await handlers['inquiry.acknowledge']({
      organizationId: workspace.organization.id,
      applicantId,
      inquiryEpisodeId: episode.id,
    });
    expect(result.detail).toMatch(/Queued message/);

    // Pause the case: automation stops until a person has looked.
    await prisma.applicant.update({
      where: { id: applicantId },
      data: { automationPaused: true, automationPausedReason: 'The applicant asked for a person.' },
    });
    const blocked = await prisma.$transaction((tx) =>
      sendApprovedTemplate(tx, workspace.organization.id, {
        applicantId,
        templateKey: 'acknowledgment',
        purpose: ConsentPurpose.INTAKE_SMS,
        toValue: PHONE,
        values: {},
        idempotencyKey: `ack-second:${episode.id}`,
      }),
    );
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') expect(blocked.reason).toMatch(/paused/i);
  });

  it('refuses a template that is not on the automation allowlist', async () => {
    await prisma.messageTemplate.create({
      data: {
        organizationId: workspace.organization.id,
        key: 'not_allowlisted',
        kind: 'RECRUITER_MANUAL',
        channel: 'SMS',
        name: 'Recruiter only',
        automatable: true,
      },
    });
    const result = await prisma.$transaction((tx) =>
      sendApprovedTemplate(tx, workspace.organization.id, {
        applicantId,
        templateKey: 'not_allowlisted',
        purpose: ConsentPurpose.RECRUITER_SMS,
        toValue: PHONE,
        values: {},
        idempotencyKey: 'not-allowed-1',
      }),
    );
    expect(result.status).toBe('blocked');
  });

  it('is deduplicated by its business idempotency key', async () => {
    await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.INTAKE_SMS, PHONE);
    const key = 'ack:dedupe-test';
    const first = await prisma.$transaction((tx) =>
      sendApprovedTemplate(tx, workspace.organization.id, {
        applicantId,
        templateKey: 'acknowledgment',
        purpose: ConsentPurpose.INTAKE_SMS,
        toValue: PHONE,
        values: {},
        idempotencyKey: key,
      }),
    );
    const second = await prisma.$transaction((tx) =>
      sendApprovedTemplate(tx, workspace.organization.id, {
        applicantId,
        templateKey: 'acknowledgment',
        purpose: ConsentPurpose.INTAKE_SMS,
        toValue: PHONE,
        values: {},
        idempotencyKey: key,
      }),
    );
    expect(first).toEqual(second);
    expect(await prisma.message.count({ where: { idempotencyKey: key } })).toBe(1);
  });
});

describe('quiet hours', () => {
  it('refuses a recruiter send inside the recipient’s quiet hours', async () => {
    // 03:00 UTC is 22:00 in Chicago — inside the 21:00–08:00 window.
    __setClock(new Date('2026-06-16T03:00:00Z'));
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Late night',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await expect(queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id })).rejects.toThrow(
      /quiet hours/i,
    );
  });

  it('applies the conservative policy when the recipient timezone is unconfirmed', async () => {
    await prisma.applicant.update({
      where: { id: applicantId },
      data: { timezone: null, timezoneConfirmed: false },
    });
    __setClock(new Date('2026-06-16T03:00:00Z')); // 22:00 office time
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Unknown zone',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await expect(queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id })).rejects.toThrow(
      /not confirmed/i,
    );
  });
});

describe('cancellation', () => {
  it('cancels a queued message and its job', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Cancel me',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    await cancelMessage(workspace.recruiterCtx, { messageId: draft.id, reason: 'changed my mind' });

    const message = await prisma.message.findFirstOrThrow({ where: { id: draft.id } });
    expect(message.state).toBe(MessageState.CANCELED);
    const job = await prisma.outboxRecord.findFirstOrThrow({ where: { idempotencyKey: `send:${draft.id}` } });
    expect(job.status).toBe('FAILED');

    // A dispatch of a canceled message is a no-op.
    const result = await dispatchMessage(workspace.organization.id, draft.id);
    expect(result.state).toBe(MessageState.CANCELED);
  });
});

describe('two-way human contact', () => {
  it('does not count a reply to automation as human contact', async () => {
    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId } });
    await grantConsent(workspace.organization.id, applicantId, ConsentPurpose.INTAKE_SMS, PHONE);
    await handlers['inquiry.acknowledge']({
      organizationId: workspace.organization.id,
      applicantId,
      inquiryEpisodeId: episode.id,
    });

    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'ok thanks',
      providerMessageId: 'SIMIN-BOTREPLY-1',
      providerName: 'simulator',
      simulated: true,
    });

    const after = await prisma.inquiryEpisode.findFirstOrThrow({ where: { id: episode.id } });
    // A human had not reached out, so this is not two-way HUMAN contact.
    expect(after.firstTwoWayHumanAt).toBeNull();
  });

  it('counts a reply to a recruiter message', async () => {
    const draft = await createDraft(workspace.recruiterCtx, {
      applicantId,
      toValue: PHONE,
      body: 'Austin here — when suits you?',
      purpose: ConsentPurpose.RECRUITER_SMS,
      aiGenerated: false,
      aiBriefId: null,
    });
    await approveDraft(workspace.recruiterCtx, { messageId: draft.id });
    await queueApprovedMessage(workspace.recruiterCtx, { messageId: draft.id });
    await dispatchMessage(workspace.organization.id, draft.id);

    await recordInboundSms({
      organizationId: workspace.organization.id,
      from: PHONE,
      to: OFFICE_NUMBER,
      body: 'Tomorrow afternoon works',
      providerMessageId: 'SIMIN-HUMANREPLY-1',
      providerName: 'simulator',
      simulated: true,
    });

    const episode = await prisma.inquiryEpisode.findFirstOrThrow({ where: { applicantId } });
    expect(episode.firstTwoWayHumanAt).not.toBeNull();
  });
});

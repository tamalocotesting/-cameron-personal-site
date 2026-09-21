import { beforeEach, describe, expect, it } from 'vitest';
import { ConsentAction, ConsentPurpose, GrantType } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock } from '@/server/clock';
import { createCase, addNote } from '@/server/services/cases';
import { detectDuplicates, listDuplicateCandidates, markNotDuplicate, mergeCases } from '@/server/services/duplicates';
import { recordInboundSms } from '@/server/services/messaging';
import { loadCaseFile } from '@/server/services/case-view';
import { createWorkspace, grantConsent, grantPermission, OFFICE_NUMBER, staffContext, type Workspace } from '../setup/factories';

/**
 * Acceptance 13.
 *
 * Shared contact information must not leak or auto-merge anything, and an
 * authorized merge must preserve provenance and the strictest permissions.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');
const SHARED = '+15125551101';

let workspace: Workspace;
let first: string;
let second: string;

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();

  const a = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: 'Ethan Pratt',
      originKind: 'web_intake',
      contactPoints: [
        { channel: 'PHONE_CALL', value: SHARED, isPrimary: true },
        { channel: 'SMS', value: SHARED },
      ],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  first = a.applicant.id;

  const b = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: 'Nora Pratt',
      originKind: 'web_intake',
      contactPoints: [
        { channel: 'PHONE_CALL', value: SHARED },
        { channel: 'SMS', value: SHARED },
      ],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  second = b.applicant.id;
});

describe('13. a shared number is a signal, never an identity', () => {
  it('flags a candidate without merging anything or mixing the histories', async () => {
    await addNote(workspace.recruiterCtx, { applicantId: first, body: 'Ethan is the older brother.' });
    await detectDuplicates(workspace.organization.id, first);

    const candidates = await listDuplicateCandidates(workspace.organization.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.signal).toBe('shared_phone');
    expect(candidates[0]!.resolution).toBe('open');
    expect(candidates[0]!.signalDetail).toMatch(/not proof of identity/i);

    // Neither case absorbed the other.
    const both = await prisma.applicant.findMany({ where: { id: { in: [first, second] } } });
    expect(both.every((a) => a.mergedIntoApplicantId === null)).toBe(true);

    // And the note is visible on exactly one case.
    const firstFile = await loadCaseFile(workspace.recruiterCtx, first);
    const secondFile = await loadCaseFile(workspace.recruiterCtx, second);
    expect(firstFile.notes).toHaveLength(1);
    expect(secondFile.notes).toHaveLength(0);
  });

  it('refuses to attach an ambiguous inbound message to either case', async () => {
    const result = await recordInboundSms({
      organizationId: workspace.organization.id,
      from: SHARED,
      to: OFFICE_NUMBER,
      body: 'Hi, following up on my application',
      providerMessageId: 'SIMIN-AMBIG-1',
      providerName: 'simulator',
      simulated: true,
    });

    expect(result.applicantId).toBeNull();
    expect(result.detail).toMatch(/linking review/i);
    expect(await prisma.message.count({ where: { organizationId: workspace.organization.id, direction: 'INBOUND' } })).toBe(0);

    // Both candidate cases get a RESTRICTED linking review item.
    const flags = await prisma.reviewFlag.findMany({
      where: { organizationId: workspace.organization.id, kind: 'LINKING_REVIEW' },
    });
    expect(flags).toHaveLength(2);
    expect(flags.every((f) => f.restricted)).toBe(true);
    // The flag names the problem, not the content of the message.
    expect(flags[0]!.detail).not.toMatch(/following up on my application/);
  });

  it('records a similar-name candidate as its own weaker signal', async () => {
    const twin = await prisma.$transaction((tx) =>
      createCase(tx, workspace.recruiterCtx, {
        organizationId: workspace.organization.id,
        displayName: 'Ethan Pratt',
        originKind: 'web_intake',
        contactPoints: [{ channel: 'SMS', value: '+15125551199' }],
        ownerMemberId: workspace.recruiter.member.id,
      }),
    );
    await detectDuplicates(workspace.organization.id, twin.applicant.id);
    const candidates = await listDuplicateCandidates(workspace.organization.id, twin.applicant.id);
    expect(candidates.some((c) => c.signal === 'similar_name')).toBe(true);
    expect(candidates.find((c) => c.signal === 'similar_name')!.signalDetail).toMatch(/not proof of identity/i);
  });
});

describe('13. merging is explicit, authorized and preserves provenance', () => {
  it('refuses a merge without reassignment authority', async () => {
    await expect(
      mergeCases(workspace.recruiterCtx, {
        survivingApplicantId: first,
        mergedApplicantId: second,
        reason: 'I think they are the same.',
      }),
    ).rejects.toThrow(/reassignment authority/);
  });

  it('refuses a merge when either side is unreadable', async () => {
    await grantPermission(workspace.organization.id, workspace.manager.member.id, GrantType.REASSIGNMENT);
    const ctx = staffContext(workspace.manager.member, workspace.orgRef);
    // The manager can reassign but cannot read the content of these cases.
    await expect(
      mergeCases(ctx, {
        survivingApplicantId: first,
        mergedApplicantId: second,
        reason: 'Same person.',
      }),
    ).rejects.toThrow();
  });

  it('moves history across and keeps the merged case readable for provenance', async () => {
    await grantPermission(workspace.organization.id, workspace.recruiter.member.id, GrantType.REASSIGNMENT);
    const ctx = staffContext(workspace.recruiter.member, workspace.orgRef);

    await addNote(workspace.recruiterCtx, { applicantId: second, body: 'Spoke to Nora on Tuesday.' });
    const noteBefore = await prisma.note.findFirstOrThrow({ where: { applicantId: second } });

    await mergeCases(ctx, {
      survivingApplicantId: first,
      mergedApplicantId: second,
      reason: 'Confirmed on the phone that these are the same person.',
    });

    const survivor = await prisma.applicant.findFirstOrThrow({ where: { id: first } });
    const merged = await prisma.applicant.findFirstOrThrow({ where: { id: second } });

    expect(merged.mergedIntoApplicantId).toBe(first);
    expect(merged.closureReason).toBe('MERGED_DUPLICATE');
    expect(merged.closureNote).toMatch(/Confirmed on the phone/);
    expect(survivor.mergedIntoApplicantId).toBeNull();

    // The note moved, keeping its identity and its author.
    const noteAfter = await prisma.note.findFirstOrThrow({ where: { id: noteBefore.id } });
    expect(noteAfter.applicantId).toBe(first);
    expect(noteAfter.authorMemberId).toBe(noteBefore.authorMemberId);

    // The merge itself is in the security audit trail.
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, action: 'case.merged' },
    });
    expect(audit.category).toBe('SECURITY');
    expect(JSON.stringify(audit.metadata)).toContain('mergedReference');

    // And a review item asks a person to confirm what was agreed.
    const flags = await prisma.reviewFlag.findMany({
      where: { applicantId: first, kind: 'MERGE_PERMISSION_REVIEW' },
    });
    expect(flags).toHaveLength(1);
  });

  it('keeps the most restrictive contact permission after a merge', async () => {
    await grantPermission(workspace.organization.id, workspace.recruiter.member.id, GrantType.REASSIGNMENT);
    const ctx = staffContext(workspace.recruiter.member, workspace.orgRef);

    // One case agreed to texts; the other opted out on the same number.
    await grantConsent(workspace.organization.id, first, ConsentPurpose.RECRUITER_SMS, SHARED);
    await grantConsent(
      workspace.organization.id,
      second,
      ConsentPurpose.RECRUITER_SMS,
      SHARED,
      ConsentAction.SUPPRESSED,
    );

    await mergeCases(ctx, {
      survivingApplicantId: first,
      mergedApplicantId: second,
      reason: 'Same person.',
    });

    const permission = await prisma.channelPermission.findFirstOrThrow({
      where: {
        organizationId: workspace.organization.id,
        applicantId: first,
        purpose: ConsentPurpose.RECRUITER_SMS,
        contactValue: SHARED,
      },
    });
    // The suppression wins until somebody reviews it.
    expect(permission.suppressed).toBe(true);
    expect(permission.granted).toBe(false);
  });

  it('does not reset the inquiry clocks of either case', async () => {
    await grantPermission(workspace.organization.id, workspace.recruiter.member.id, GrantType.REASSIGNMENT);
    const ctx = staffContext(workspace.recruiter.member, workspace.orgRef);

    const before = await prisma.inquiryEpisode.findMany({
      where: { organizationId: workspace.organization.id },
      orderBy: { openedAt: 'asc' },
      select: { id: true, applicantId: true, openedAt: true },
    });

    await mergeCases(ctx, {
      survivingApplicantId: first,
      mergedApplicantId: second,
      reason: 'Same person.',
    });

    const after = await prisma.inquiryEpisode.findMany({
      orderBy: { openedAt: 'asc' },
      select: { id: true, applicantId: true, openedAt: true },
    });
    // The episodes keep their own case and their own opening time.
    expect(after.map((e) => e.openedAt.toISOString())).toEqual(before.map((e) => e.openedAt.toISOString()));
    expect(after.map((e) => e.applicantId).sort()).toEqual(before.map((e) => e.applicantId).sort());
  });

  it('refuses to merge a case into itself or to merge twice', async () => {
    await grantPermission(workspace.organization.id, workspace.recruiter.member.id, GrantType.REASSIGNMENT);
    const ctx = staffContext(workspace.recruiter.member, workspace.orgRef);

    await expect(
      mergeCases(ctx, { survivingApplicantId: first, mergedApplicantId: first, reason: 'Nonsense.' }),
    ).rejects.toThrow(/two different cases/i);

    await mergeCases(ctx, { survivingApplicantId: first, mergedApplicantId: second, reason: 'Same person.' });
    await expect(
      mergeCases(ctx, { survivingApplicantId: first, mergedApplicantId: second, reason: 'Again.' }),
    ).rejects.toThrow(/already been merged/i);
  });
});

describe('13. dismissing a candidate', () => {
  it('records the decision and clears the review work', async () => {
    await detectDuplicates(workspace.organization.id, first);
    const candidate = (await listDuplicateCandidates(workspace.organization.id))[0]!;

    await markNotDuplicate(workspace.recruiterCtx, {
      candidateId: candidate.id,
      reason: 'Siblings sharing a family phone; confirmed with both.',
    });

    const updated = await prisma.duplicateCandidate.findFirstOrThrow({ where: { id: candidate.id } });
    expect(updated.resolution).toBe('not_duplicate');
    expect(updated.resolvedByMemberId).toBe(workspace.recruiter.member.id);

    const openFlags = await prisma.reviewFlag.count({
      where: {
        organizationId: workspace.organization.id,
        kind: 'DUPLICATE_SUSPECTED',
        status: 'OPEN',
      },
    });
    expect(openFlags).toBe(0);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: workspace.organization.id, action: 'duplicate.dismissed' },
    });
    expect(audit.category).toBe('SECURITY');
  });
});

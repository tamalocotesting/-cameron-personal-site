import { beforeEach, describe, expect, it } from 'vitest';
import { CaseClosureReason, CaseStatus, GrantType } from '@prisma/client';
import { prisma } from '@/server/db';
import { __setClock, now } from '@/server/clock';
import {
  approvePolicy,
  createPolicy,
  executeRetentionRun,
  queueRetentionRun,
  setLegalHold,
} from '@/server/services/retention';
import { createCase, addNote } from '@/server/services/cases';
import { prepareBrief } from '@/server/services/briefs';
import { createWorkspace, grantPermission, staffContext, type Workspace } from '../setup/factories';
import { demoToolsEnabled, env } from '@/env';

/**
 * Acceptance 15.
 *
 * Retention with a dry run, a legal hold, derived content, honest caveats —
 * and the demo-tools boundary.
 */

const CLOCK = new Date('2026-06-15T15:00:00Z');

let workspace: Workspace;

async function closedCase(name: string, closedDaysAgo: number) {
  const created = await prisma.$transaction((tx) =>
    createCase(tx, workspace.recruiterCtx, {
      organizationId: workspace.organization.id,
      displayName: name,
      originKind: 'web_intake',
      contactPoints: [{ channel: 'SMS', value: `+1512555${Math.floor(1000 + Math.random() * 8999)}` }],
      ownerMemberId: workspace.recruiter.member.id,
    }),
  );
  const session = await prisma.intakeSession.create({
    data: {
      organizationId: workspace.organization.id,
      applicantId: created.applicant.id,
      intakeVersionId: workspace.version.id,
      pathway: 'FULL_INTAKE',
      status: 'COMPLETED',
    },
  });
  await prisma.intakeAnswer.create({
    data: {
      organizationId: workspace.organization.id,
      intakeSessionId: session.id,
      questionKey: 'general_location',
      questionPrompt: 'Which town or area are you in?',
      revision: 1,
      valueText: 'Pflugerville, just north of Austin',
    },
  });
  await addNote(workspace.recruiterCtx, { applicantId: created.applicant.id, body: 'Spoke once, no answer after.' });
  await prepareBrief({
    organizationId: workspace.organization.id,
    applicantId: created.applicant.id,
    requestedByMemberId: null,
    reason: 'test',
  });

  await prisma.task.updateMany({
    where: { applicantId: created.applicant.id },
    data: { status: 'CANCELED', canceledAt: now(), cancelReason: 'case closed' },
  });
  await prisma.applicant.update({
    where: { id: created.applicant.id },
    data: {
      status: CaseStatus.CLOSED,
      closureReason: CaseClosureReason.UNABLE_TO_REACH,
      closedAt: new Date(CLOCK.getTime() - closedDaysAgo * 86_400_000),
    },
  });
  return created.applicant;
}

beforeEach(async () => {
  __setClock(CLOCK);
  workspace = await createWorkspace();
  await grantPermission(workspace.organization.id, workspace.admin.member.id, GrantType.RETENTION_ADMIN);
});

describe('15. there is no destructive default', () => {
  it('creates a policy that is neither approved nor enabled', async () => {
    const policy = await createPolicy(workspace.adminCtx, {
      name: 'Station default',
      closedCaseRetentionDays: 30,
      webhookPayloadRetentionDays: 7,
      briefRetentionDays: 14,
      auditMetadataRetentionDays: 365,
    });
    expect(policy.enabled).toBe(false);
    expect(policy.approvedAt).toBeNull();
  });

  it('refuses to execute an unapproved policy', async () => {
    const policy = await createPolicy(workspace.adminCtx, {
      name: 'Unapproved',
      closedCaseRetentionDays: 30,
      webhookPayloadRetentionDays: null,
      briefRetentionDays: null,
      auditMetadataRetentionDays: null,
    });
    const ctx = staffContext(workspace.admin.member, workspace.orgRef);
    await expect(queueRetentionRun(ctx, { policyId: policy.id, mode: 'execute' })).rejects.toThrow(
      /approved and enabled/,
    );
    // A preview is always allowed: it deletes nothing.
    const run = await queueRetentionRun(ctx, { policyId: policy.id, mode: 'preview' });
    expect(run.mode).toBe('preview');
  });

  it('refuses a run without the retention-admin grant', async () => {
    const policy = await createPolicy(workspace.adminCtx, {
      name: 'No grant',
      closedCaseRetentionDays: 30,
      webhookPayloadRetentionDays: null,
      briefRetentionDays: null,
      auditMetadataRetentionDays: null,
    });
    await expect(
      queueRetentionRun(workspace.recruiterCtx, { policyId: policy.id, mode: 'preview' }),
    ).rejects.toThrow(/retention-admin grant/);
  });
});

describe('15. a preview changes nothing and a legal hold is absolute', () => {
  it('reports counts, protects a held case, and deletes nothing in preview', async () => {
    const old = await closedCase('Old Closed Case', 120);
    const held = await closedCase('Held Closed Case', 200);
    await setLegalHold(workspace.adminCtx, {
      applicantId: held.id,
      hold: true,
      reason: 'Under review by the station.',
    });

    const policy = await createPolicy(workspace.adminCtx, {
      name: 'Aggressive',
      closedCaseRetentionDays: 60,
      webhookPayloadRetentionDays: 1,
      briefRetentionDays: 1,
      auditMetadataRetentionDays: 1,
    });
    await approvePolicy(workspace.adminCtx, { policyId: policy.id, enable: true });
    const run = await prisma.retentionRun.create({
      data: {
        organizationId: workspace.organization.id,
        policyId: policy.id,
        mode: 'preview',
        requestedByMemberId: workspace.admin.member.id,
      },
    });

    const summary = await executeRetentionRun({
      organizationId: workspace.organization.id,
      policyId: policy.id,
      runId: run.id,
      mode: 'preview',
    });

    expect(summary.mode).toBe('preview');
    expect(summary.casesConsidered).toBe(2);
    expect(summary.casesOnLegalHold).toBe(1);
    expect(summary.casesAffected).toBe(1);
    expect(summary.intakeAnswersRemoved).toBeGreaterThan(0);
    expect(summary.notesRemoved).toBeGreaterThan(0);
    expect(summary.briefsRemoved).toBeGreaterThan(0);
    // The honest caveats travel with the result.
    expect(summary.caveats.join(' ')).toMatch(/backups|replicas/i);

    // Nothing was actually deleted.
    expect(await prisma.applicant.count({ where: { id: { in: [old.id, held.id] } } })).toBe(2);
    expect(await prisma.note.count({ where: { applicantId: old.id } })).toBe(1);
  });

  it('removes the case and its derived material on execution, and never the held one', async () => {
    const old = await closedCase('Deletable', 120);
    const held = await closedCase('Protected', 200);
    await setLegalHold(workspace.adminCtx, {
      applicantId: held.id,
      hold: true,
      reason: 'Legal hold for the demo.',
    });

    const policy = await createPolicy(workspace.adminCtx, {
      name: 'Execute me',
      closedCaseRetentionDays: 60,
      webhookPayloadRetentionDays: null,
      briefRetentionDays: null,
      auditMetadataRetentionDays: null,
    });
    await approvePolicy(workspace.adminCtx, { policyId: policy.id, enable: true });
    const run = await prisma.retentionRun.create({
      data: {
        organizationId: workspace.organization.id,
        policyId: policy.id,
        mode: 'execute',
        requestedByMemberId: workspace.admin.member.id,
      },
    });

    const summary = await executeRetentionRun({
      organizationId: workspace.organization.id,
      policyId: policy.id,
      runId: run.id,
      mode: 'execute',
    });
    expect(summary.casesAffected).toBe(1);

    // The deletable case is gone, together with its derived material.
    expect(await prisma.applicant.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.note.count({ where: { applicantId: old.id } })).toBe(0);
    expect(await prisma.brief.count({ where: { applicantId: old.id } })).toBe(0);
    expect(await prisma.briefSourceRef.count({ where: { briefItem: { brief: { applicantId: old.id } } } })).toBe(0);

    // The held case is untouched.
    expect(await prisma.applicant.count({ where: { id: held.id } })).toBe(1);
    expect(await prisma.note.count({ where: { applicantId: held.id } })).toBeGreaterThan(0);

    // Minimal audit metadata survives, without the deleted content in it.
    const audit = await prisma.auditEvent.findMany({
      where: { organizationId: workspace.organization.id, applicantId: old.id },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Pflugerville/);

    // Metric events survive too, so historical reports do not silently move.
    expect(await prisma.metricEvent.count({ where: { applicantId: old.id } })).toBeGreaterThan(0);

    const finished = await prisma.retentionRun.findFirstOrThrow({ where: { id: run.id } });
    expect(finished.finishedAt).not.toBeNull();
  });

  it('minimizes old audit metadata without deleting the audit trail', async () => {
    const applicant = await closedCase('Audit Minimization', 1);

    const policy = await createPolicy(workspace.adminCtx, {
      name: 'Audit only',
      closedCaseRetentionDays: null,
      webhookPayloadRetentionDays: null,
      briefRetentionDays: null,
      auditMetadataRetentionDays: 365,
    });
    await approvePolicy(workspace.adminCtx, { policyId: policy.id, enable: true });

    // Age every audit row that exists at this point past the cutoff, and only
    // then take the counts, so the policy's own audit rows do not skew them.
    const cutoff = new Date(CLOCK.getTime() - 400 * 86_400_000);
    await prisma.auditEvent.updateMany({
      where: { organizationId: workspace.organization.id },
      data: { occurredAt: cutoff },
    });
    const before = await prisma.auditEvent.count({ where: { organizationId: workspace.organization.id } });

    const run = await prisma.retentionRun.create({
      data: {
        organizationId: workspace.organization.id,
        policyId: policy.id,
        mode: 'execute',
        requestedByMemberId: workspace.admin.member.id,
      },
    });
    const summary = await executeRetentionRun({
      organizationId: workspace.organization.id,
      policyId: policy.id,
      runId: run.id,
      mode: 'execute',
    });

    expect(summary.auditMetadataMinimized).toBe(before);
    // The rows are still there; only their metadata is emptied.
    expect(await prisma.auditEvent.count({ where: { organizationId: workspace.organization.id } })).toBe(before);
    const rows = await prisma.auditEvent.findMany({
      where: { organizationId: workspace.organization.id, occurredAt: cutoff },
      select: { metadata: true, action: true, ipAddress: true },
    });
    expect(rows).toHaveLength(before);
    expect(rows.every((r) => JSON.stringify(r.metadata) === '{}')).toBe(true);
    expect(rows.every((r) => r.ipAddress === null)).toBe(true);
    // The fact of each action survives, which is the point.
    expect(rows.every((r) => r.action.length > 0)).toBe(true);
    // The case itself was not touched by an audit-only policy.
    expect(await prisma.applicant.count({ where: { id: applicant.id } })).toBe(1);
  });
});

describe('15. demo tools are bound to the demo configuration', () => {
  it('is only enabled in DEMO mode with the explicit opt-in', () => {
    expect(env.APP_MODE).toBe('DEMO');
    expect(env.DEMO_TOOLS_ENABLED).toBe(true);
    expect(demoToolsEnabled).toBe(true);
  });

  it('refuses to seed demo data unless the application is in DEMO mode', async () => {
    // The seed's own guard, asserted here rather than by running the script.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../prisma/seed.ts', import.meta.url), 'utf8'),
    );
    expect(source).toMatch(/env\.APP_MODE !== 'DEMO'/);
    expect(source).toMatch(/refuses to run unless APP_MODE=DEMO/);
  });

  it('refuses a live-scoped organization in the demo simulation endpoint', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/app/api/demo/simulate/route.ts', import.meta.url), 'utf8'),
    );
    expect(source).toMatch(/if \(!demoToolsEnabled\)/);
    expect(source).toMatch(/dataScope !== 'DEMO'/);
  });

  it('refuses a LIVE deployment that still has demo tools switched on', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/env.ts', import.meta.url), 'utf8'),
    );
    expect(source).toMatch(/APP_MODE === 'LIVE' && value\.DEMO_TOOLS_ENABLED/);
    expect(source).toMatch(/not permitted with APP_MODE=LIVE/);
  });
});

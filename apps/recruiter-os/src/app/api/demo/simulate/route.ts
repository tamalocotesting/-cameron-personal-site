import { NextResponse } from 'next/server';
import { z } from 'zod';
import { demoToolsEnabled } from '@/env';
import { requireStaffContext } from '@/server/context';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { recordInboundSms, applyDeliveryEvent, normalizeProviderStatus } from '@/server/services/messaging';
import { recordInboundCallOutcome } from '@/server/services/voice';
import { redact, redactError } from '@/lib/redact';
import { isAppError } from '@/server/authz/errors';

export const dynamic = 'force-dynamic';

/**
 * The demo event console's endpoint.
 *
 * It exists ONLY when APP_MODE=DEMO and DEMO_TOOLS_ENABLED=true, it requires a
 * signed-in staff member, and it refuses to touch a live-scoped organization.
 *
 * Crucially it drives the REAL domain handlers — the same functions the Twilio
 * routes call — so the state machine, the deduplication, the out-of-order
 * resolution and the consent checks are genuinely exercised. Nothing here
 * fakes UI state.
 */
const payloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inbound_sms'), from: z.string().min(3), body: z.string().min(1).max(600) }),
  z.object({ kind: z.literal('missed_call'), from: z.string().min(3), dialCallStatus: z.enum(['no-answer', 'busy', 'failed', 'completed']) }),
  z.object({ kind: z.literal('delivery_status'), messageId: z.string().min(1), status: z.string().min(1), errorCode: z.string().optional() }),
  z.object({ kind: z.literal('opt_out'), from: z.string().min(3) }),
  z.object({ kind: z.literal('opt_in'), from: z.string().min(3) }),
]);

export async function POST(request: Request) {
  if (!demoToolsEnabled) {
    return NextResponse.json(
      { error: 'The demo event console is not available in this deployment.' },
      { status: 404 },
    );
  }

  let ctx;
  try {
    ctx = await requireStaffContext();
  } catch {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  if (ctx.organization.dataScope !== 'DEMO') {
    return NextResponse.json(
      { error: 'This organization holds live-scoped data. Simulated events are refused.' },
      { status: 409 },
    );
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unrecognised simulation request.' }, { status: 400 });
  }
  const event = parsed.data;
  const organizationId = ctx.member.organizationId;

  const config = await prisma.integrationConfig.findFirst({
    where: { organizationId, kind: 'SMS', provider: 'simulator' },
  });
  const settings = (config?.settings ?? {}) as { fromNumber?: string; inboundNumber?: string };
  const officeNumber = settings.inboundNumber ?? settings.fromNumber ?? '+15555550100';

  // A durable receipt, exactly as a real provider callback would produce.
  const receipt = await prisma.webhookReceipt.create({
    data: {
      organizationId,
      provider: 'simulator',
      endpoint: `/api/demo/simulate#${event.kind}`,
      providerEventKey: `sim|${event.kind}|${JSON.stringify(event)}|${now().toISOString()}`,
      signatureValid: true,
      payload: (redact(event) ?? {}) as object,
      outcome: 'received',
    },
    select: { id: true },
  });

  try {
    let detail = '';
    switch (event.kind) {
      case 'inbound_sms':
      case 'opt_out':
      case 'opt_in': {
        const body = event.kind === 'opt_out' ? 'STOP' : event.kind === 'opt_in' ? 'START' : event.body;
        const result = await recordInboundSms({
          organizationId,
          from: event.from,
          to: officeNumber,
          body,
          providerMessageId: `SIMIN${Date.now()}${Math.floor(Math.random() * 1000)}`,
          providerName: 'simulator',
          simulated: true,
        });
        detail = result.detail;
        break;
      }
      case 'missed_call': {
        const sid = `SIMCA${Date.now()}`;
        const result = await recordInboundCallOutcome({
          organizationId,
          from: event.from,
          to: officeNumber,
          providerCallSid: sid,
          providerParentCallSid: `${sid}P`,
          providerLeg: 'dial',
          dialCallStatus: event.dialCallStatus,
          // A "completed" forwarded leg with zero duration still means nobody
          // spoke — that is the case this simulator makes easy to demonstrate.
          dialCallDuration: event.dialCallStatus === 'completed' ? 42 : 0,
          providerName: 'simulator',
          simulated: true,
        });
        detail = `outcome=${result.outcome} taskCreated=${result.taskCreated}`;
        break;
      }
      case 'delivery_status': {
        const message = await prisma.message.findFirst({
          where: { id: event.messageId, organizationId },
          select: { providerMessageId: true },
        });
        if (!message?.providerMessageId) {
          detail = 'That message has no provider id yet, so there is nothing to report on.';
          break;
        }
        const result = await applyDeliveryEvent({
          organizationId,
          providerMessageId: message.providerMessageId,
          providerStatus: event.status,
          errorCode: event.errorCode ?? null,
          providerEventId: `sim-${event.status}-${Date.now()}`,
          occurredAt: now(),
        });
        detail = `${result.detail} (normalized ${normalizeProviderStatus(event.status)})`;
        break;
      }
    }

    await prisma.webhookReceipt.update({
      where: { id: receipt.id },
      data: { outcome: 'processed', outcomeDetail: detail, processedAt: now() },
    });
    return NextResponse.json({ ok: true, detail });
  } catch (error) {
    const info = redactError(error);
    await prisma.webhookReceipt.update({
      where: { id: receipt.id },
      data: { outcome: 'rejected', outcomeDetail: `${info.name}: ${info.message}`, processedAt: now() },
    });
    return NextResponse.json(
      { error: isAppError(error) ? error.message : 'The simulated event could not be processed.' },
      { status: 400 },
    );
  }
}

import { NextResponse } from 'next/server';
import { parseTwilioRequest, settleReceipt } from '@/server/webhooks/twilio-request';
import { resolveVoiceProvider } from '@/server/providers/registry';
import { forwardTargetFor, resolveCallerCase } from '@/server/services/voice';
import { prisma } from '@/server/db';
import { env } from '@/env';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * Inbound voice.
 *
 * Returns instructions to forward the call to a recruiter, with an `action`
 * URL so the FORWARDED LEG reports its own outcome. That leg is the only thing
 * that says whether a human actually answered.
 *
 * No recording, no transcription, no voice agent.
 */
export async function POST(request: Request) {
  const parsed = await parseTwilioRequest(request, '/api/webhooks/twilio/voice', ['CallSid']);
  if (!parsed.ok) return new NextResponse(parsed.reason, { status: parsed.status });

  const provider = await resolveVoiceProvider(parsed.organizationId);
  if (!provider.available) {
    await settleReceipt(parsed.receiptId, 'rejected', provider.reason);
    // No pretending: if voice is not configured, say so and hang up.
    return new NextResponse(
      '<Response><Say>This office cannot take calls on this number right now.</Say><Hangup/></Response>',
      { status: 200, headers: { 'content-type': 'text/xml' } },
    );
  }

  try {
    const from = parsed.params.From ?? '';
    const resolved = await prisma.$transaction((tx) => resolveCallerCase(tx, parsed.organizationId, from));
    const target = await forwardTargetFor(parsed.organizationId, resolved.applicantId);

    if (!target.number) {
      await settleReceipt(parsed.receiptId, 'processed', target.reason);
      const instruction = provider.provider.buildUnavailableInstruction({
        message: 'Thanks for calling. A recruiter will follow up with you.',
      });
      return new NextResponse(instruction.body, {
        status: 200,
        headers: { 'content-type': instruction.contentType },
      });
    }

    const base = env.TWILIO_WEBHOOK_BASE_URL || env.PUBLIC_APP_URL;
    const instruction = provider.provider.buildForwardInstruction({
      forwardTo: target.number,
      callerId: parsed.params.To ?? '',
      actionUrl: `${base.replace(/\/$/, '')}/api/webhooks/twilio/voice-status`,
      timeoutSeconds: 20,
    });

    await settleReceipt(parsed.receiptId, 'processed', `Forwarding via ${target.reason}.`);
    return new NextResponse(instruction.body, {
      status: 200,
      headers: { 'content-type': instruction.contentType },
    });
  } catch (error) {
    const info = redactError(error);
    await settleReceipt(parsed.receiptId, 'rejected', `${info.name}: ${info.message}`);
    return new NextResponse('processing failed', { status: 500 });
  }
}

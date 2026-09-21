import { NextResponse } from 'next/server';
import { parseTwilioRequest, settleReceipt } from '@/server/webhooks/twilio-request';
import { recordInboundCallOutcome } from '@/server/services/voice';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * The forwarded leg's outcome.
 *
 * `DialCallStatus` is the field that matters. The PARENT call reports
 * `completed` whether or not anyone answered, so deciding "missed call" from
 * the parent status would create callback tasks for answered calls and none
 * for missed ones.
 */
export async function POST(request: Request) {
  const parsed = await parseTwilioRequest(request, '/api/webhooks/twilio/voice-status', [
    'CallSid',
    'DialCallSid',
    'DialCallStatus',
  ]);
  if (!parsed.ok) return new NextResponse(parsed.reason, { status: parsed.status });
  if (parsed.duplicate) {
    await settleReceipt(parsed.receiptId, 'duplicate', 'Replayed call status; ignored.');
    return new NextResponse('<Response/>', { status: 200, headers: { 'content-type': 'text/xml' } });
  }

  try {
    const duration = parsed.params.DialCallDuration ? Number(parsed.params.DialCallDuration) : null;
    const result = await recordInboundCallOutcome({
      organizationId: parsed.organizationId,
      from: parsed.params.From ?? '',
      to: parsed.params.To ?? '',
      providerCallSid: parsed.params.DialCallSid || parsed.params.CallSid || '',
      providerParentCallSid: parsed.params.CallSid ?? null,
      providerLeg: 'dial',
      dialCallStatus: parsed.params.DialCallStatus ?? null,
      dialCallDuration: Number.isFinite(duration) ? duration : null,
      providerName: 'twilio',
      simulated: false,
    });
    await settleReceipt(
      parsed.receiptId,
      result.duplicate ? 'duplicate' : 'processed',
      `outcome=${result.outcome} taskCreated=${result.taskCreated}`,
    );
  } catch (error) {
    const info = redactError(error);
    await settleReceipt(parsed.receiptId, 'rejected', `${info.name}: ${info.message}`);
    return new NextResponse('processing failed', { status: 500 });
  }

  return new NextResponse('<Response/>', { status: 200, headers: { 'content-type': 'text/xml' } });
}

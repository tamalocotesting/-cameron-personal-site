import { NextResponse } from 'next/server';
import { parseTwilioRequest, settleReceipt } from '@/server/webhooks/twilio-request';
import { recordInboundSms } from '@/server/services/messaging';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * Inbound SMS.
 *
 * Twilio answers STOP/HELP with its own message, so we deliberately return an
 * EMPTY TwiML response: adding our own confirmation would send the person two.
 */
export async function POST(request: Request) {
  const parsed = await parseTwilioRequest(request, '/api/webhooks/twilio/sms', ['MessageSid', 'SmsStatus']);
  if (!parsed.ok) {
    return new NextResponse(parsed.reason, { status: parsed.status });
  }
  if (parsed.duplicate) {
    await settleReceipt(parsed.receiptId, 'duplicate', 'Replayed delivery; ignored.');
    return new NextResponse('<Response/>', { status: 200, headers: { 'content-type': 'text/xml' } });
  }

  try {
    const result = await recordInboundSms({
      organizationId: parsed.organizationId,
      from: parsed.params.From ?? '',
      to: parsed.params.To ?? '',
      body: parsed.params.Body ?? '',
      providerMessageId: parsed.params.MessageSid ?? '',
      providerName: 'twilio',
      simulated: false,
    });
    await settleReceipt(parsed.receiptId, result.duplicate ? 'duplicate' : 'processed', result.detail);
  } catch (error) {
    const info = redactError(error);
    await settleReceipt(parsed.receiptId, 'rejected', `${info.name}: ${info.message}`);
    // Twilio retries on 5xx; the receipt makes the replay a no-op.
    return new NextResponse('processing failed', { status: 500 });
  }

  return new NextResponse('<Response/>', { status: 200, headers: { 'content-type': 'text/xml' } });
}

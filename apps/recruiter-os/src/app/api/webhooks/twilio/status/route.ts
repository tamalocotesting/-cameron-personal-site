import { NextResponse } from 'next/server';
import { parseTwilioRequest, settleReceipt } from '@/server/webhooks/twilio-request';
import { applyDeliveryEvent } from '@/server/services/messaging';
import { now } from '@/server/clock';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * Delivery status callbacks. These arrive out of order in the real world, so
 * every event is appended to history and only a HIGHER-ranked state moves the
 * message forward.
 */
export async function POST(request: Request) {
  const parsed = await parseTwilioRequest(request, '/api/webhooks/twilio/status', [
    'MessageSid',
    'MessageStatus',
  ]);
  if (!parsed.ok) return new NextResponse(parsed.reason, { status: parsed.status });
  if (parsed.duplicate) {
    await settleReceipt(parsed.receiptId, 'duplicate', 'Replayed status callback; ignored.');
    return new NextResponse(null, { status: 204 });
  }

  try {
    const result = await applyDeliveryEvent({
      organizationId: parsed.organizationId,
      providerMessageId: parsed.params.MessageSid ?? '',
      providerStatus: parsed.params.MessageStatus ?? parsed.params.SmsStatus ?? '',
      errorCode: parsed.params.ErrorCode ?? null,
      errorMessage: parsed.params.ErrorMessage ?? null,
      providerEventId: parsed.params.MessageSid ?? null,
      occurredAt: now(),
    });
    await settleReceipt(parsed.receiptId, result.applied ? 'processed' : 'duplicate', result.detail);
  } catch (error) {
    const info = redactError(error);
    await settleReceipt(parsed.receiptId, 'rejected', `${info.name}: ${info.message}`);
    return new NextResponse('processing failed', { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

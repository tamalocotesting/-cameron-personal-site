import 'server-only';
import { IntegrationKind } from '@prisma/client';
import { prisma } from '@/server/db';
import { env } from '@/env';
import { validateTwilioSignature } from '@/server/providers/sms/twilio';
import { redact } from '@/lib/redact';
import { now } from '@/server/clock';

/**
 * Inbound Twilio request handling, shared by all four callback routes.
 *
 * The three things that go wrong in real deployments, handled explicitly:
 *
 *  1. THE URL. Twilio signs the URL that was configured in its console. Behind
 *     a proxy the request's own URL is often the internal one, so when
 *     TWILIO_WEBHOOK_BASE_URL is set we reconstruct from it and ignore
 *     whatever the request claims. Query strings are preserved because they
 *     are part of the signed value.
 *  2. THE BODY. For form-encoded requests the signature covers the POST
 *     PARAMETERS; for JSON it covers the raw body. Both are supported.
 *  3. ORGANIZATION OWNERSHIP. The organization is resolved from OUR OWN
 *     integration configuration by matching the destination number. It is
 *     never taken from the request payload, so a caller cannot route data into
 *     an organization of their choosing.
 *
 * Validation happens before any processing, and a durable receipt is written
 * before slow work so the acknowledgment can return immediately.
 */

export type ParsedTwilioRequest =
  | {
      ok: true;
      params: Record<string, string>;
      rawBody: string;
      organizationId: string;
      receiptId: string;
      duplicate: boolean;
      signedUrl: string;
    }
  | { ok: false; status: number; reason: string; receiptId: string | null };

function reconstructUrl(request: Request, endpointPath: string): string {
  const requestUrl = new URL(request.url);
  if (env.TWILIO_WEBHOOK_BASE_URL) {
    const base = env.TWILIO_WEBHOOK_BASE_URL.replace(/\/$/, '');
    return `${base}${endpointPath}${requestUrl.search}`;
  }
  return requestUrl.toString();
}

/** The destination number tells us which organization this belongs to. */
async function resolveOrganizationByNumber(to: string): Promise<string | null> {
  if (!to) return null;
  const configs = await prisma.integrationConfig.findMany({
    where: { kind: { in: [IntegrationKind.SMS, IntegrationKind.VOICE] }, enabled: true },
    select: { organizationId: true, settings: true },
  });
  for (const config of configs) {
    const settings = (config.settings ?? {}) as { fromNumber?: string; inboundNumber?: string };
    if (settings.fromNumber === to || settings.inboundNumber === to) return config.organizationId;
  }
  return null;
}

export async function parseTwilioRequest(
  request: Request,
  endpointPath: string,
  eventKeyFields: string[],
): Promise<ParsedTwilioRequest> {
  const contentType = request.headers.get('content-type');
  const signature = request.headers.get('x-twilio-signature');
  const rawBody = await request.text();

  const params: Record<string, string> = {};
  if ((contentType ?? '').includes('application/x-www-form-urlencoded')) {
    for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value;
  } else if ((contentType ?? '').includes('application/json')) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) params[key] = String(value);
    } catch {
      return { ok: false, status: 400, reason: 'Malformed JSON body.', receiptId: null };
    }
  } else {
    return { ok: false, status: 415, reason: 'Unsupported content type.', receiptId: null };
  }

  const signedUrl = reconstructUrl(request, endpointPath);

  // Reject before processing. No credentials configured means no trust.
  const valid =
    Boolean(env.TWILIO_AUTH_TOKEN) &&
    validateTwilioSignature({
      authToken: env.TWILIO_AUTH_TOKEN,
      signature,
      url: signedUrl,
      contentType,
      params,
      rawBody,
    });

  const providerEventKey = [endpointPath, ...eventKeyFields.map((field) => params[field] ?? '')].join('|');

  const organizationId = valid
    ? await resolveOrganizationByNumber(params.To ?? params.Called ?? '')
    : null;

  // Durable receipt first, so a replay is recognised and slow work can move
  // to a job without losing the event.
  let receiptId: string;
  let duplicate = false;
  try {
    const receipt = await prisma.webhookReceipt.create({
      data: {
        organizationId,
        provider: 'twilio',
        endpoint: endpointPath,
        providerEventKey,
        signatureValid: valid,
        payload: (redact(params) ?? {}) as object,
        outcome: valid ? 'received' : 'rejected',
        outcomeDetail: valid ? null : 'Signature validation failed.',
        receivedAt: now(),
      },
      select: { id: true },
    });
    receiptId = receipt.id;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      const existing = await prisma.webhookReceipt.findUnique({
        where: { provider_providerEventKey: { provider: 'twilio', providerEventKey } },
        select: { id: true, organizationId: true },
      });
      receiptId = existing?.id ?? 'unknown';
      duplicate = true;
      if (!valid) return { ok: false, status: 403, reason: 'Signature validation failed.', receiptId };
      return {
        ok: true,
        params,
        rawBody,
        organizationId: existing?.organizationId ?? organizationId ?? '',
        receiptId,
        duplicate: true,
        signedUrl,
      };
    }
    throw error;
  }

  if (!valid) {
    return { ok: false, status: 403, reason: 'Signature validation failed.', receiptId };
  }
  if (!organizationId) {
    await prisma.webhookReceipt.update({
      where: { id: receiptId },
      data: { outcome: 'rejected', outcomeDetail: 'No enabled integration owns that destination number.' },
    });
    return {
      ok: false,
      status: 404,
      reason: 'No enabled integration owns that destination number.',
      receiptId,
    };
  }

  return { ok: true, params, rawBody, organizationId, receiptId, duplicate, signedUrl };
}

export async function settleReceipt(receiptId: string | null, outcome: string, detail?: string) {
  if (!receiptId || receiptId === 'unknown') return;
  await prisma.webhookReceipt.update({
    where: { id: receiptId },
    data: { outcome, outcomeDetail: detail ?? null, processedAt: now() },
  });
}

import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '@/env';
import { redactError } from '@/lib/redact';

/**
 * Signed outbound webhook for handoff delivery.
 *
 * Disabled unless OUTBOUND_WEBHOOK_ALLOWED_ORIGINS lists the destination. The
 * SSRF protections are the point of this file: a destination that resolves to
 * a private, loopback, link-local or metadata address is refused BEFORE the
 * request is made, and redirects are not followed.
 *
 * A 2xx means the transport accepted the bytes. It does NOT mean a business
 * system imported the case. Those are two different states in the model.
 */

const BLOCKED_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./,
  /^2(2[4-9]|3\d|4\d|5[0-5])\./,
];

function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('::ffff:')
    );
  }
  return BLOCKED_V4.some((pattern) => pattern.test(address));
}

export type WebhookDeliveryResult =
  | { outcome: 'accepted'; status: number; requestId: string }
  | { outcome: 'failed'; status: number | null; detail: string; requestId: string }
  | { outcome: 'unknown'; detail: string; requestId: string };

export function outboundWebhookEnabled(): boolean {
  return env.outboundWebhookAllowedOrigins.length > 0 && Boolean(env.OUTBOUND_WEBHOOK_SIGNING_SECRET);
}

export async function assertDestinationAllowed(rawUrl: string): Promise<URL> {
  if (!outboundWebhookEnabled()) {
    throw new Error(
      'The outbound webhook adapter is disabled. Set OUTBOUND_WEBHOOK_ALLOWED_ORIGINS and OUTBOUND_WEBHOOK_SIGNING_SECRET to enable it.',
    );
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Webhook destinations must use https.');
  if (!env.outboundWebhookAllowedOrigins.includes(url.origin)) {
    throw new Error(`${url.origin} is not in OUTBOUND_WEBHOOK_ALLOWED_ORIGINS.`);
  }

  // Resolve and check every address the hostname maps to, so a DNS answer
  // pointing inside the network is refused rather than requested.
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error(`${url.hostname} does not resolve.`);
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new Error(`${url.hostname} resolves to a private or reserved address (${record.address}).`);
    }
  }
  return url;
}

export function signPayload(body: string, timestamp: string, idempotencyKey: string): string {
  const secret = env.OUTBOUND_WEBHOOK_SIGNING_SECRET;
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.${idempotencyKey}.${body}`);
  return `v1=${mac.digest('hex')}`;
}

export async function deliverWebhook(input: {
  url: string;
  payload: unknown;
  idempotencyKey: string;
  timeoutMs?: number;
}): Promise<WebhookDeliveryResult> {
  const requestId = randomUUID();
  let destination: URL;
  try {
    destination = await assertDestinationAllowed(input.url);
  } catch (error) {
    return { outcome: 'failed', status: null, detail: redactError(error).message, requestId };
  }

  const body = JSON.stringify(input.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);

  try {
    const response = await fetch(destination, {
      method: 'POST',
      // Never follow a redirect: it could point anywhere.
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-recruiteros-timestamp': timestamp,
        'x-recruiteros-idempotency-key': input.idempotencyKey,
        'x-recruiteros-signature': signPayload(body, timestamp, input.idempotencyKey),
        'x-recruiteros-request-id': requestId,
      },
      body,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        outcome: 'failed',
        status: response.status,
        detail: 'The destination returned a redirect, which is not followed.',
        requestId,
      };
    }
    if (response.ok) {
      // Transport accepted. Business acceptance is a separate, later state.
      return { outcome: 'accepted', status: response.status, requestId };
    }
    if (response.status >= 500) {
      return {
        outcome: 'unknown',
        detail: `Destination returned ${response.status}; it may or may not have processed the payload.`,
        requestId,
      };
    }
    return {
      outcome: 'failed',
      status: response.status,
      detail: `Destination returned ${response.status}.`,
      requestId,
    };
  } catch (error) {
    const info = redactError(error);
    return { outcome: 'unknown', detail: `${info.name}: ${info.message}`, requestId };
  } finally {
    clearTimeout(timeout);
  }
}

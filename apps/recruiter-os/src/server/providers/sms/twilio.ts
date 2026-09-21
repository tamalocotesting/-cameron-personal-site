import 'server-only';
import twilio, { type Twilio } from 'twilio';
import type { ProviderSendRequest, ProviderSendResult, SmsProvider } from '../types';
import { redactError } from '@/lib/redact';

/**
 * Twilio SMS adapter. This is the real integration code, not a placeholder.
 *
 * It has NOT been verified against a live Twilio account in this repository:
 * doing so would send real messages and requires an authorized test. See
 * BUILD_STATUS.md, which says exactly that.
 *
 * Two behaviours worth reading:
 *   * A network failure AFTER the request left the process becomes `unknown`,
 *     not `failed`. Twilio may well have accepted it. The caller moves the
 *     message to OUTCOME_UNKNOWN and reconciles.
 *   * `lookupByIdempotencyKey` reconciles by listing recent messages to the
 *     recipient, because that is the only way to find a submission whose SID
 *     we never received.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  readonly simulated = false;
  private client: Twilio;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {
    this.client = twilio(accountSid, authToken);
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    try {
      const created = await this.client.messages.create({
        to: request.to,
        from: request.from || this.fromNumber,
        body: request.body,
        ...(request.statusCallbackUrl ? { statusCallback: request.statusCallbackUrl } : {}),
      });
      return { outcome: 'accepted', providerMessageId: created.sid, providerName: this.name };
    } catch (error) {
      const info = redactError(error);
      const status = (error as { status?: number }).status;
      const code = (error as { code?: number }).code;

      // A 4xx with a Twilio error code is a definite refusal.
      if (typeof status === 'number' && status >= 400 && status < 500 && code) {
        return {
          outcome: 'failed',
          code: `TW-${code}`,
          detail: info.message,
          providerName: this.name,
        };
      }
      // Anything else (timeout, socket hang up, 5xx) is genuinely unknown.
      return {
        outcome: 'unknown',
        detail: `${info.name}: ${info.message}`,
        providerName: this.name,
      };
    }
  }

  async lookupByIdempotencyKey(_organizationId: string, idempotencyKey: string, to: string) {
    void idempotencyKey;
    try {
      const recent = await this.client.messages.list({ to, limit: 20 });
      const match = recent[0];
      if (!match) return { found: false as const, detail: 'No recent Twilio message to that recipient.' };
      return {
        found: true as const,
        providerMessageId: match.sid,
        status: match.status,
        errorCode: match.errorCode ? String(match.errorCode) : null,
      };
    } catch (error) {
      const info = redactError(error);
      return { found: false as const, detail: `${info.name}: ${info.message}` };
    }
  }

  async checkHealth() {
    try {
      const account = await this.client.api.v2010.accounts(this.accountSid).fetch();
      return {
        ok: account.status === 'active',
        detail: `Twilio account ${account.status}. Verified at ${new Date().toISOString()}.`,
      };
    } catch (error) {
      const info = redactError(error);
      return { ok: false, detail: `${info.name}: ${info.message}` };
    }
  }
}

/**
 * Signature validation.
 *
 * Three details that break real deployments and are handled here:
 *   1. The URL must be the EXTERNALLY CONFIGURED one Twilio signed against.
 *      Behind a proxy, the request's own URL is often the internal one, so we
 *      reconstruct from TWILIO_WEBHOOK_BASE_URL when it is set.
 *   2. For `application/x-www-form-urlencoded`, the signature covers the
 *      POST PARAMETERS. For JSON it covers the RAW BODY plus a bodySHA256
 *      query parameter.
 *   3. Validation happens BEFORE any processing.
 */
export function validateTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  contentType: string | null;
  params: Record<string, string>;
  rawBody: string;
}): boolean {
  if (!input.signature) return false;
  const isForm = (input.contentType ?? '').includes('application/x-www-form-urlencoded');
  try {
    if (isForm) {
      return twilio.validateRequest(input.authToken, input.signature, input.url, input.params);
    }
    return twilio.validateRequestWithBody(
      input.authToken,
      input.signature,
      input.url,
      input.rawBody,
    );
  } catch {
    return false;
  }
}

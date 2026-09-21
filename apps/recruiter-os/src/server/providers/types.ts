/**
 * Provider-neutral interfaces.
 *
 * The domain never imports a vendor SDK. It asks the registry for an SMS or
 * voice provider and gets either a working adapter or an explicit
 * unavailable state — never a stub that pretends to have sent something.
 */

export type ProviderSendRequest = {
  organizationId: string;
  /** Business idempotency key, passed to the provider where supported. */
  idempotencyKey: string;
  from: string;
  to: string;
  body: string;
  /** Absolute URL the provider should POST delivery updates to. */
  statusCallbackUrl?: string;
};

export type ProviderSendResult =
  /** The provider took responsibility for the message. NOT delivery. */
  | { outcome: 'accepted'; providerMessageId: string; providerName: string }
  /** The provider refused it. Terminal. */
  | { outcome: 'failed'; code: string; detail: string; providerName: string }
  /**
   * We submitted and never learned what happened — a timeout or a dropped
   * connection after the request went out. This is NOT a retry signal: a
   * blind retry here is how people get two copies of the same text.
   */
  | { outcome: 'unknown'; detail: string; providerName: string };

export type ProviderLookupResult =
  | { found: true; providerMessageId: string; status: string; errorCode?: string | null }
  | { found: false; detail: string };

export interface SmsProvider {
  readonly name: string;
  readonly simulated: boolean;
  send(request: ProviderSendRequest): Promise<ProviderSendResult>;
  /**
   * Reconciliation: ask the provider what happened to a submission whose
   * outcome we never learned. Adapters that cannot answer say so.
   */
  lookupByIdempotencyKey?(
    organizationId: string,
    idempotencyKey: string,
    to: string,
  ): Promise<ProviderLookupResult>;
  /** Health check. Only a real check may produce a HEALTHY label. */
  checkHealth(organizationId: string): Promise<{ ok: boolean; detail: string }>;
}

export type VoiceForwardInstruction = {
  /** Provider-specific markup (TwiML for Twilio, JSON for the simulator). */
  contentType: string;
  body: string;
};

export interface VoiceProvider {
  readonly name: string;
  readonly simulated: boolean;
  /**
   * Instruction returned to the provider for an inbound call: forward to the
   * recruiter, and tell us the outcome of the FORWARDED LEG, which is the only
   * thing that says whether a human actually picked up.
   */
  buildForwardInstruction(input: {
    forwardTo: string;
    callerId: string;
    actionUrl: string;
    timeoutSeconds: number;
  }): VoiceForwardInstruction;
  buildUnavailableInstruction(input: { message: string }): VoiceForwardInstruction;
  checkHealth(organizationId: string): Promise<{ ok: boolean; detail: string }>;
}

export type ProviderResolution<T> =
  | { available: true; provider: T; simulated: boolean }
  | {
      available: false;
      /** Maps 1:1 onto the integration status shown in Settings. */
      status: 'DISABLED' | 'DEMO' | 'CONFIGURED_UNVERIFIED' | 'ERROR';
      reason: string;
    };

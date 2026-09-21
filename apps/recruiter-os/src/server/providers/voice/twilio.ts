import 'server-only';
import twilio from 'twilio';
import type { VoiceForwardInstruction, VoiceProvider } from '../types';
import { redactError } from '@/lib/redact';

/**
 * Twilio Voice adapter.
 *
 * The important part is the `<Dial>` element's `action` URL plus
 * `DialCallStatus`: the PARENT call reports `completed` even when nobody
 * answered, so deciding "missed call" from the parent status is wrong. We read
 * the forwarded leg's outcome instead (see the voice-status route).
 *
 * `record` is never enabled. There is no transcription and no voice agent.
 */
export class TwilioVoiceProvider implements VoiceProvider {
  readonly name = 'twilio';
  readonly simulated = false;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
  ) {}

  buildForwardInstruction(input: {
    forwardTo: string;
    callerId: string;
    actionUrl: string;
    timeoutSeconds: number;
  }): VoiceForwardInstruction {
    const response = new twilio.twiml.VoiceResponse();
    const dial = response.dial({
      action: input.actionUrl,
      method: 'POST',
      timeout: input.timeoutSeconds,
      callerId: input.callerId,
      record: 'do-not-record',
      answerOnBridge: true,
    });
    dial.number(input.forwardTo);
    return { contentType: 'text/xml', body: response.toString() };
  }

  buildUnavailableInstruction(input: { message: string }): VoiceForwardInstruction {
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'Polly.Joanna' }, input.message);
    response.hangup();
    return { contentType: 'text/xml', body: response.toString() };
  }

  async checkHealth() {
    try {
      const client = twilio(this.accountSid, this.authToken);
      const account = await client.api.v2010.accounts(this.accountSid).fetch();
      return { ok: account.status === 'active', detail: `Twilio account ${account.status}.` };
    } catch (error) {
      const info = redactError(error);
      return { ok: false, detail: `${info.name}: ${info.message}` };
    }
  }
}

import 'server-only';
import type { VoiceForwardInstruction, VoiceProvider } from '../types';

/**
 * Local voice simulator. Returns a JSON description of what a real provider
 * would have been told to do, so the demo console can drive the same
 * call-status handler the real provider drives.
 *
 * No recording, no transcription, no autonomous voice agent — in this or the
 * Twilio adapter.
 */
export class SimulatorVoiceProvider implements VoiceProvider {
  readonly name = 'simulator';
  readonly simulated = true;

  buildForwardInstruction(input: {
    forwardTo: string;
    callerId: string;
    actionUrl: string;
    timeoutSeconds: number;
  }): VoiceForwardInstruction {
    return {
      contentType: 'application/json',
      body: JSON.stringify({ action: 'forward', ...input, recording: false }, null, 2),
    };
  }

  buildUnavailableInstruction(input: { message: string }): VoiceForwardInstruction {
    return {
      contentType: 'application/json',
      body: JSON.stringify({ action: 'announce', message: input.message, recording: false }, null, 2),
    };
  }

  async checkHealth() {
    return { ok: true, detail: 'Voice simulator responding. No real calls are placed.' };
  }
}

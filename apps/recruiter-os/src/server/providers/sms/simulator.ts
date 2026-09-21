import 'server-only';
import type { ProviderSendRequest, ProviderSendResult, SmsProvider } from '../types';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';

/**
 * Local telecommunications simulator.
 *
 * It behaves like a provider: it accepts a submission and returns an
 * identifier, and it does NOT claim delivery. Delivery, replies, failures and
 * opt-outs are produced by the demo event console, which posts to the SAME
 * webhook handlers the real provider would — so the state machine, the
 * deduplication and the out-of-order handling are exercised for real.
 *
 * Every message it accepts is stored with `simulated = true` and is labelled
 * wherever it is displayed.
 */
export class SimulatorSmsProvider implements SmsProvider {
  readonly name = 'simulator';
  readonly simulated = true;

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    // Fixture numbers that deliberately fail, so the failure path is
    // demonstrable without waiting for a real carrier error.
    if (/^\+1555000(19|29)\d\d$/.test(request.to)) {
      return {
        outcome: 'failed',
        code: 'SIM-30006',
        detail: 'Simulated landline / unreachable carrier.',
        providerName: this.name,
      };
    }
    if (/^\+15550000000$/.test(request.to)) {
      return {
        outcome: 'unknown',
        detail: 'Simulated timeout after submission. Outcome unknown; reconciliation required.',
        providerName: this.name,
      };
    }

    const providerMessageId = `SIM${request.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24).padStart(24, '0')}`;
    return { outcome: 'accepted', providerMessageId, providerName: this.name };
  }

  /**
   * Reconciliation.
   *
   * The simulator's "record" of a submission is the provider identifier it
   * handed back. If one exists it accepted the message and reports `sent`; if
   * not — which is what the timeout fixture produces — it honestly reports
   * having no record, and a human decides.
   */
  async lookupByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    const message = await prisma.message.findFirst({
      where: { organizationId, idempotencyKey },
      select: { providerMessageId: true },
    });
    if (!message?.providerMessageId) {
      return { found: false as const, detail: 'Simulator has no record of that submission.' };
    }
    return { found: true as const, providerMessageId: message.providerMessageId, status: 'sent' };
  }

  async checkHealth() {
    return { ok: true, detail: `Simulator responding (${now().toISOString()}). No real messages are sent.` };
  }
}

import 'server-only';
import { env } from '@/env';

/**
 * A single source of "now" for the whole server.
 *
 * Nothing in the domain calls `new Date()` directly. That gives us three
 * things: seeded demo data whose "Today" is always useful, deterministic
 * tests, and one place to look when a due-time calculation disagrees with a
 * human.
 *
 * DEMO_CLOCK accepts:
 *   ""                      real clock
 *   "2026-03-08T07:30:00Z"  frozen instant
 *   "+3d" / "-2h" / "+90m"  offset from the real clock
 */

type ClockState = { frozenAt: Date | null; offsetMs: number };

function parseClock(spec: string): ClockState {
  const trimmed = spec.trim();
  if (!trimmed) return { frozenAt: null, offsetMs: 0 };

  const offset = /^([+-])(\d+)([smhd])$/.exec(trimmed);
  if (offset) {
    const [, sign, amountRaw, unit] = offset;
    const amount = Number(amountRaw);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
    return { frozenAt: null, offsetMs: (sign === '-' ? -1 : 1) * amount * unitMs };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`DEMO_CLOCK is not a valid instant or offset: ${spec}`);
  }
  return { frozenAt: parsed, offsetMs: 0 };
}

const globalForClock = globalThis as unknown as { __recruiterOsClock?: ClockState };

function state(): ClockState {
  if (!globalForClock.__recruiterOsClock) {
    globalForClock.__recruiterOsClock = parseClock(env.DEMO_CLOCK);
  }
  return globalForClock.__recruiterOsClock;
}

export function now(): Date {
  const s = state();
  if (s.frozenAt) return new Date(s.frozenAt.getTime());
  return new Date(Date.now() + s.offsetMs);
}

export function clockDescription(): string {
  const s = state();
  if (s.frozenAt) return `frozen at ${s.frozenAt.toISOString()}`;
  if (s.offsetMs !== 0) return `offset ${s.offsetMs > 0 ? '+' : ''}${Math.round(s.offsetMs / 60000)}m`;
  return 'system clock';
}

export function isClockOverridden(): boolean {
  const s = state();
  return s.frozenAt !== null || s.offsetMs !== 0;
}

/** Test-only helpers. Production code never calls these. */
export function __setClock(instant: Date | null, offsetMs = 0) {
  globalForClock.__recruiterOsClock = { frozenAt: instant, offsetMs };
}

export function __resetClock() {
  globalForClock.__recruiterOsClock = parseClock(env.DEMO_CLOCK);
}

import 'server-only';
import { now } from '@/server/clock';

/**
 * Fixed-window rate limiter.
 *
 * IN-PROCESS ONLY. With more than one application instance each instance keeps
 * its own counters, so the effective limit is (limit × instances). That is
 * acceptable for the abuse this guards (token guessing, verification
 * brute-force, intake spam) but it is NOT a distributed limiter, and
 * SECURITY.md says so rather than implying otherwise. Durable per-target
 * counters that must survive a restart live in the database — see
 * `IntakeSession.resumeVerificationAttempts`.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const nowMs = now().getTime();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Occasional sweep so the map cannot grow without bound. */
export function sweepRateLimits() {
  const nowMs = now().getTime();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= nowMs) buckets.delete(key);
}

export function __resetRateLimits() {
  buckets.clear();
}

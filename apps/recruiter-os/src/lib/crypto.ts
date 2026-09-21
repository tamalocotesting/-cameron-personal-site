import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Resume links, appointment confirmation links and similar applicant-facing
 * credentials are high-entropy secrets that we store only as a hash.
 * Comparison is constant-time.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Stable content hash used for message-approval and brief-input snapshots. */
export function contentHash(...parts: Array<string | number | null | undefined>): string {
  return sha256(parts.map((p) => (p === null || p === undefined ? '\u0000' : String(p))).join('\u001f'));
}

/** A short, non-guessable verification code for resume-on-a-new-device. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  let value = 0;
  do {
    value = randomBytes(4).readUInt32BE(0) % max;
  } while (String(value).length < digits && value === 0);
  return String(value).padStart(digits, '0');
}

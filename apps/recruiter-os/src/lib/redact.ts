/**
 * Redaction used for logs, audit metadata and job telemetry.
 *
 * The rule this enforces: operational records describe WHICH fields were
 * touched, never WHAT the applicant said. Anything that looks like a secret,
 * phone number, email address or free text body is replaced.
 */
const SECRET_KEY_PATTERN =
  /(secret|token|password|authorization|auth_token|api[-_]?key|signature|cookie)/i;
const CONTENT_KEY_PATTERN = /(body|transcript|message|answer|note|excerpt|detail_text|free_text)/i;
const CONTACT_KEY_PATTERN = /(phone|email|contactvalue|from|to|address)/i;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D+/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  return `${local.slice(0, 1)}***@${value.slice(at + 1)}`;
}

export function maskContact(value: string): string {
  return value.includes('@') ? maskEmail(value) : maskPhone(value);
}

export type Redacted = Record<string, unknown>;

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof input !== 'object') return input;

  const out: Redacted = {};
  for (const [key, value] of Object.entries(input as Redacted)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      if (CONTACT_KEY_PATTERN.test(key)) {
        out[key] = maskContact(value);
        continue;
      }
      if (CONTENT_KEY_PATTERN.test(key)) {
        out[key] = `[${value.length} chars omitted]`;
        continue;
      }
      out[key] = value.length > 512 ? `${value.slice(0, 512)}…` : value;
      continue;
    }
    out[key] = redact(value, depth + 1);
  }
  return out;
}

export function redactError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      // Provider errors sometimes echo the request body. Keep only the first
      // line and cap it.
      message: error.message.split('\n')[0]!.slice(0, 300),
    };
  }
  return { name: 'UnknownError', message: String(error).slice(0, 300) };
}

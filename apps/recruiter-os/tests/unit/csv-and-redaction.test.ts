import { describe, expect, it } from 'vitest';
import { escapeCell, toCsv } from '@/lib/csv';
import { maskContact, redact, redactError } from '@/lib/redact';

describe('CSV export safety', () => {
  it('neutralises cells a spreadsheet would execute', () => {
    for (const dangerous of ['=SUM(A1:A9)', '+1+1', '-1+1', '@SUM(1)', '\tcmd', '\rcmd']) {
      expect(escapeCell(dangerous)).toBe(`"'${dangerous.replace(/"/g, '""')}"`);
    }
  });

  it('quotes every field and escapes embedded quotes and delimiters', () => {
    const csv = toCsv(['a', 'b'], [['plain', 'has,comma "and" quotes']]);
    expect(csv).toBe('"a","b"\r\n"plain","has,comma ""and"" quotes"\r\n');
  });

  it('leaves ordinary values alone', () => {
    expect(escapeCell('Austin Reyes')).toBe('"Austin Reyes"');
    expect(escapeCell(42)).toBe('"42"');
  });
});

describe('redaction', () => {
  it('masks contact values rather than logging them', () => {
    expect(maskContact('+15125550301')).toBe('***0301');
    expect(maskContact('tasha.alvarez@example.invalid')).toBe('t***@example.invalid');
  });

  it('removes secrets and message content from metadata', () => {
    const output = redact({
      authToken: 'super-secret',
      body: 'I have a question about my medical history',
      phone: '+15125550301',
      fields: ['displayName', 'timezone'],
      count: 3,
    }) as Record<string, unknown>;

    expect(output.authToken).toBe('[redacted]');
    expect(String(output.body)).toMatch(/chars omitted/);
    expect(output.phone).toBe('***0301');
    expect(output.fields).toEqual(['displayName', 'timezone']);
    expect(output.count).toBe(3);
  });

  it('keeps only the first line of an error message', () => {
    const error = new Error('provider refused\nrequest body: {"to":"+15125550301"}');
    expect(redactError(error).message).toBe('provider refused');
  });
});

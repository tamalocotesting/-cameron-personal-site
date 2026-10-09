import { describe, expect, it } from 'vitest';
import { computeProgress, runState, submissionOutcome } from '@/lib/progress';
import { completionRate, rateChange } from '@/lib/metrics';
import { csvCell, toCsv } from '@/lib/csv';
import { addDays, formatCsvDateTime, localDate } from '@/lib/time';

describe('checklist progress', () => {
  const items = [
    { required: true, status: 'done' as const },
    { required: true, status: 'blocked' as const },
    { required: true, status: 'pending' as const },
    { required: false, status: 'pending' as const },
  ];

  it('counts only required tasks toward the percentage', () => {
    const p = computeProgress(items);
    expect(p).toMatchObject({ requiredTotal: 3, requiredDone: 1, requiredBlocked: 1, requiredOpen: 1, percent: 33, allRequiredDone: false });
  });

  it('never reports complete while a required task is blocked or pending', () => {
    expect(submissionOutcome(items)).toBe('exceptions');
    expect(submissionOutcome([{ required: true, status: 'blocked' }])).toBe('exceptions');
    expect(submissionOutcome([{ required: true, status: 'done' }, { required: false, status: 'pending' }])).toBe('complete');
  });

  it('maps run rows to display states', () => {
    expect(runState(null)).toBe('not_started');
    expect(runState({ status: 'in_progress', outcome: null })).toBe('in_progress');
    expect(runState({ status: 'submitted', outcome: 'complete' })).toBe('complete');
    expect(runState({ status: 'submitted', outcome: 'exceptions' })).toBe('exceptions');
  });
});

describe('completion rate', () => {
  it('computes completed ÷ expected × 100', () => {
    expect(completionRate(3, 7)).toMatchObject({ ok: true, rate: 42.9 });
  });
  it('refuses to compute without an expected count, never treating missing data as success', () => {
    expect(completionRate(5, null).ok).toBe(false);
    expect(completionRate(5, 0).ok).toBe(false);
    expect(completionRate(null, 10).ok).toBe(false);
  });
  it('warns when completions exceed the expected count', () => {
    const r = completionRate(9, 7);
    expect(r.ok && r.warning).toBeTruthy();
  });
  it('compares in percentage points only when both sides exist', () => {
    expect(rateChange(completionRate(7, 14), completionRate(3, 7))).toBe(-7.1);
    expect(rateChange(completionRate(7, null), completionRate(3, 7))).toBeNull();
  });
});

describe('csv', () => {
  it('quotes and escapes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['x'], [[1]])).toBe('x\r\n1\r\n');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe("'-5");
  });
});

describe('time zones', () => {
  // 2026-10-09 02:30 UTC is still Oct 8 in Indianapolis (UTC-4) but Oct 9 in London.
  const instant = new Date('2026-10-09T02:30:00Z');
  it('derives the shift date from the restaurant zone, not the server zone', () => {
    expect(localDate('America/Indiana/Indianapolis', instant)).toBe('2026-10-08');
    expect(localDate('Europe/London', instant)).toBe('2026-10-09');
  });
  it('formats CSV times in local time', () => {
    expect(formatCsvDateTime(instant, 'America/Indiana/Indianapolis')).toBe('2026-10-08 22:30');
  });
  it('adds calendar days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

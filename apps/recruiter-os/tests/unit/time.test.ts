import { describe, expect, it } from 'vitest';
import {
  isWithinQuietHours,
  localDateKey,
  localMinuteOfDay,
  offsetMinutes,
  resolveZonedTime,
  zoneAbbreviation,
} from '@/lib/time';

describe('timezone resolution', () => {
  it('resolves an ordinary wall-clock time to a single instant', () => {
    const result = resolveZonedTime(
      { year: 2026, month: 6, day: 15, hour: 10, minute: 30 },
      'America/Chicago',
    );
    expect(result.kind).toBe('exact');
    if (result.kind !== 'exact') return;
    // 10:30 CDT is 15:30 UTC.
    expect(result.instant.toISOString()).toBe('2026-06-15T15:30:00.000Z');
  });

  it('reports the spring-forward gap instead of guessing', () => {
    // 2:30am on 8 March 2026 does not exist in America/Chicago.
    const result = resolveZonedTime(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      'America/Chicago',
    );
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.suggestion.getTime()).toBeGreaterThan(result.gapStart.getTime());
  });

  it('reports the fall-back overlap with both occurrences', () => {
    // 1:30am on 1 November 2026 happens twice in America/Chicago.
    const result = resolveZonedTime(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      'America/Chicago',
    );
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    const [first, second] = result.alternatives;
    expect(second.getTime() - first.getTime()).toBe(3_600_000);
    expect(zoneAbbreviation(first, 'America/Chicago')).toBe('CDT');
    expect(zoneAbbreviation(second, 'America/Chicago')).toBe('CST');
  });

  it('tracks the offset across a daylight-saving boundary', () => {
    expect(offsetMinutes(new Date('2026-01-15T18:00:00Z'), 'America/Chicago')).toBe(-360);
    expect(offsetMinutes(new Date('2026-07-15T18:00:00Z'), 'America/Chicago')).toBe(-300);
  });

  it('handles a zone with no daylight saving', () => {
    expect(offsetMinutes(new Date('2026-01-15T18:00:00Z'), 'America/Phoenix')).toBe(-420);
    expect(offsetMinutes(new Date('2026-07-15T18:00:00Z'), 'America/Phoenix')).toBe(-420);
  });
});

describe('quiet hours', () => {
  it('treats a window that wraps midnight correctly', () => {
    const start = 21 * 60;
    const end = 8 * 60;
    // 22:00 local is inside 21:00–08:00.
    expect(isWithinQuietHours(new Date('2026-06-16T03:00:00Z'), 'America/Chicago', start, end)).toBe(true);
    // 14:00 local is outside.
    expect(isWithinQuietHours(new Date('2026-06-15T19:00:00Z'), 'America/Chicago', start, end)).toBe(false);
    // 07:00 local is still inside.
    expect(isWithinQuietHours(new Date('2026-06-15T12:00:00Z'), 'America/Chicago', start, end)).toBe(true);
  });

  it('evaluates the window in the recipient zone, not the server zone', () => {
    const instant = new Date('2026-06-16T03:30:00Z');
    // 22:30 in Chicago, 20:30 in Los Angeles: quiet in one, not the other.
    expect(isWithinQuietHours(instant, 'America/Chicago', 21 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietHours(instant, 'America/Los_Angeles', 21 * 60, 8 * 60)).toBe(false);
  });
});

describe('local day helpers', () => {
  it('buckets an instant into the right local day', () => {
    // 01:30 UTC is still the previous day in Chicago.
    expect(localDateKey(new Date('2026-06-16T01:30:00Z'), 'America/Chicago')).toBe('2026-06-15');
    expect(localMinuteOfDay(new Date('2026-06-16T01:30:00Z'), 'America/Chicago')).toBe(20 * 60 + 30);
  });
});

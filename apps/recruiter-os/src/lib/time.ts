/**
 * Timezone handling.
 *
 * Appointments are stored as a UTC instant plus the IANA zone they were agreed
 * in. Converting a wall-clock time in a zone to an instant is not a pure
 * addition: twice a year the mapping is either missing an hour (spring
 * forward) or has two answers (fall back). This module returns that fact
 * explicitly instead of quietly picking one, so scheduling can refuse or ask.
 *
 * No external date library: Node's ICU data is authoritative and always
 * present, and this keeps the dependency surface small.
 */

export type LocalDateTime = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
};

export type ZonedResolution =
  | { kind: 'exact'; instant: Date }
  /** The wall-clock time does not exist in that zone (DST gap). */
  | { kind: 'invalid'; gapStart: Date; suggestion: Date }
  /** The wall-clock time happens twice (DST overlap). */
  | { kind: 'ambiguous'; instant: Date; alternatives: [Date, Date] };

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields for an instant, as seen in `timeZone`. */
export function toLocalParts(instant: Date, timeZone: string): LocalDateTime & { second: number } {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Intl can render midnight as "24" in some locales/zones.
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset in minutes to ADD to UTC to get local time in `timeZone`. */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = toLocalParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

function sameLocal(instant: Date, timeZone: string, local: LocalDateTime): boolean {
  const p = toLocalParts(instant, timeZone);
  return (
    p.year === local.year &&
    p.month === local.month &&
    p.day === local.day &&
    p.hour === local.hour &&
    p.minute === local.minute
  );
}

/**
 * Resolve a wall-clock time in a zone to a UTC instant, reporting DST gaps and
 * overlaps rather than guessing.
 */
export function resolveZonedTime(local: LocalDateTime, timeZone: string): ZonedResolution {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);

  const candidates = new Set<number>();
  // Probe the offsets in force shortly before and after the naive instant:
  // those are the only two that can apply.
  for (const probe of [naive - 26 * 3600_000, naive, naive + 26 * 3600_000]) {
    const off = offsetMinutes(new Date(probe), timeZone);
    candidates.add(naive - off * 60000);
  }

  const valid = [...candidates]
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms))
    .filter((d) => sameLocal(d, timeZone, local));

  if (valid.length === 1) return { kind: 'exact', instant: valid[0]! };
  if (valid.length >= 2) {
    return {
      kind: 'ambiguous',
      instant: valid[0]!,
      alternatives: [valid[0]!, valid[valid.length - 1]!],
    };
  }

  // No instant maps to this wall-clock time: it fell in a spring-forward gap.
  // Suggest the same instant shifted forward past the gap.
  const before = new Date(naive - 3600_000);
  const offBefore = offsetMinutes(before, timeZone);
  const offAfter = offsetMinutes(new Date(naive + 3600_000), timeZone);
  const shift = (offAfter - offBefore) * 60000;
  const gapStart = new Date(naive - offBefore * 60000);
  return {
    kind: 'invalid',
    gapStart,
    suggestion: new Date(gapStart.getTime() + Math.max(shift, 3600_000)),
  };
}

/** Minutes since local midnight for an instant in a zone. */
export function localMinuteOfDay(instant: Date, timeZone: string): number {
  const p = toLocalParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

export function localWeekday(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** YYYY-MM-DD as seen in a zone. Used for day bucketing in reports. */
export function localDateKey(instant: Date, timeZone: string): string {
  const p = toLocalParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const p = toLocalParts(instant, timeZone);
  const r = resolveZonedTime({ ...p, hour: 0, minute: 0 }, timeZone);
  if (r.kind === 'invalid') return r.suggestion;
  return r.kind === 'exact' ? r.instant : r.instant;
}

export function endOfLocalDay(instant: Date, timeZone: string): Date {
  return new Date(startOfLocalDay(instant, timeZone).getTime() + 24 * 3600_000);
}

/**
 * `YYYY-MM-DDTHH:mm` as seen in `timeZone`, for a <input type="datetime-local">
 * default. The value a recruiter sees has to be the wall clock of the zone the
 * appointment will be agreed in — not the server's zone, and not UTC.
 */
export function localInputValue(instant: Date, timeZone: string): string {
  const p = toLocalParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatInZone(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(instant);
}

/** e.g. "CDT" — shown next to every timestamp so a time is never ambiguous. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(
    instant,
  );
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

/**
 * Quiet-hours window test. Handles a window that wraps midnight.
 * `startMinute` is when quiet hours BEGIN, `endMinute` when they END.
 */
export function isWithinQuietHours(
  instant: Date,
  timeZone: string,
  startMinute: number,
  endMinute: number,
): boolean {
  const m = localMinuteOfDay(instant, timeZone);
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return m >= startMinute && m < endMinute;
  return m >= startMinute || m < endMinute;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60000);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86400_000);
}

export function relativeLabel(target: Date, now: Date): string {
  const deltaMs = target.getTime() - now.getTime();
  const abs = Math.abs(deltaMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600_000);
  const days = Math.round(abs / 86400_000);
  const unit = minutes < 60 ? `${minutes}m` : hours < 36 ? `${hours}h` : `${days}d`;
  if (minutes < 1) return 'now';
  return deltaMs < 0 ? `${unit} ago` : `in ${unit}`;
}

export function durationMinutes(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 60000);
}

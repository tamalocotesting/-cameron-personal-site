/** Date helpers (ISO date strings, UTC arithmetic — business dates have no time component). */
export const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 0 = Monday … 6 = Sunday */
export const dow = (iso: string): number => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
export const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DOW_NAMES_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const isWeekend = (iso: string) => dow(iso) >= 5;
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

function nthWeekday(y: number, m: number, wd: number, n: number): string {
  // wd: 0=Mon
  let d = iso(y, m, 1);
  let c = 0;
  while (true) {
    if (dow(d) === wd && ++c === n) return d;
    d = addDays(d, 1);
  }
}
function lastWeekday(y: number, m: number, wd: number): string {
  let d = addDays(iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
  while (dow(d) !== wd) d = addDays(d, -1);
  return d;
}
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

export interface Holiday { key: string; name: string; name_es: string }
const NAMES: Record<string, [string, string]> = {
  new_years_day: ["New Year's Day", 'Año Nuevo'], mlk_day: ['MLK Day', 'Día de MLK'], presidents_day: ["Presidents' Day", 'Día de los Presidentes'],
  valentines: ["Valentine's Day", 'San Valentín'], st_patricks: ["St. Patrick's Day", 'San Patricio'], good_friday: ['Good Friday', 'Viernes Santo'],
  easter_sat: ['Easter Saturday', 'Sábado de Gloria'], easter: ['Easter Sunday', 'Domingo de Pascua'], mothers_day: ["Mother's Day", 'Día de las Madres'],
  memorial_day: ['Memorial Day', 'Día de los Caídos'], fathers_day: ["Father's Day", 'Día del Padre'], july_4: ['Independence Day', 'Día de la Independencia'],
  labor_day: ['Labor Day', 'Día del Trabajo'], halloween: ['Halloween', 'Halloween'], thanksgiving_eve: ['Thanksgiving Eve', 'Víspera de Acción de Gracias'],
  thanksgiving: ['Thanksgiving Day', 'Día de Acción de Gracias'], black_friday: ['Black Friday', 'Viernes Negro'],
  thanksgiving_sat: ['Thanksgiving Saturday', 'Sábado de Acción de Gracias'], thanksgiving_sun: ['Thanksgiving Sunday', 'Domingo de Acción de Gracias'],
  christmas_eve: ['Christmas Eve', 'Nochebuena'], christmas: ['Christmas Day', 'Navidad'], nye: ["New Year's Eve", 'Fin de Año'],
};

export function holidaysForYear(y: number): Record<string, string> {
  const tg = nthWeekday(y, 11, 3, 4);
  const e = easter(y);
  return {
    new_years_day: iso(y, 1, 1), mlk_day: nthWeekday(y, 1, 0, 3), presidents_day: nthWeekday(y, 2, 0, 3),
    valentines: iso(y, 2, 14), st_patricks: iso(y, 3, 17), good_friday: addDays(e, -2), easter_sat: addDays(e, -1), easter: e,
    mothers_day: nthWeekday(y, 5, 6, 2), memorial_day: lastWeekday(y, 5, 0), fathers_day: nthWeekday(y, 6, 6, 3), july_4: iso(y, 7, 4),
    labor_day: nthWeekday(y, 9, 0, 1), halloween: iso(y, 10, 31), thanksgiving_eve: addDays(tg, -1), thanksgiving: tg,
    black_friday: addDays(tg, 1), thanksgiving_sat: addDays(tg, 2), thanksgiving_sun: addDays(tg, 3),
    christmas_eve: iso(y, 12, 24), christmas: iso(y, 12, 25), nye: iso(y, 12, 31),
  };
}

const cache = new Map<number, Map<string, string>>();
/** date → holiday key */
function yearMap(y: number): Map<string, string> {
  let m = cache.get(y);
  if (!m) {
    m = new Map(Object.entries(holidaysForYear(y)).map(([k, d]) => [d, k]));
    cache.set(y, m);
  }
  return m;
}
export function holidayOn(date: string): Holiday | null {
  const key = yearMap(+date.slice(0, 4)).get(date);
  if (!key) return null;
  return { key, name: NAMES[key][0], name_es: NAMES[key][1] };
}
export const isHoliday = (date: string) => holidayOn(date) !== null;
/** Prior dates (before `before`) on which the same holiday fell, newest first. */
export function priorOccurrences(key: string, before: string, years = 4): string[] {
  const y = +before.slice(0, 4);
  const out: string[] = [];
  for (let k = 0; k <= years; k++) {
    const d = holidaysForYear(y - k)[key];
    if (d && d < before) out.push(d);
  }
  return out;
}

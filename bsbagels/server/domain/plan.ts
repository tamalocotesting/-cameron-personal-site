/**
 * The daily plan: everything a crew member needs for one business date, as provenance-tagged figures
 * and time-ordered prep tickets. Pure aside from reading the DB.
 */
import type { DB } from '../db.ts';
import { all, one } from '../db.ts';
import { addDays, dow, holidayOn, isWeekend, DOW_NAMES, DOW_NAMES_ES, daysBetween, priorOccurrences } from './calendar.ts';
import { forecastTotal, flavorShares, allocate, errorBands, DEFAULT_PARAMS, MODEL_ID, type Series, type ModelParams } from './forecast.ts';
import { loadSeries } from './history.ts';
import { buildProfile, type Profile } from './profile.ts';
import { loadAssumptions } from './assumptions.ts';
import { FLAVOR_META } from './units.ts';

export type Kind = 'verified' | 'forecast' | 'assumption' | 'missing' | 'known';
export interface Figure { value: number | null; kind: Kind; lo?: number; hi?: number; unit?: string; basis: string; assumptions?: string[] }
export interface Ticket {
  key: string; station: 'oven' | 'prep' | 'eggs' | 'line' | 'close' | 'lead';
  due: string; title: string; title_es: string; qty: number | null; unit: string; unit_es: string;
  detail: string; detail_es: string; figure: Figure; status?: string | null; adjusted?: { qty: number; reason: string; by: string } | null;
}
export interface Alert { level: 'info' | 'watch' | 'act'; title: string; title_es: string; body: string; body_es: string }

const r0 = (x: number) => Math.round(x);
const ceil = Math.ceil;

interface Ctx { db: DB; s: Series; prof: Profile; A: ReturnType<typeof loadAssumptions>; p: ModelParams; histEnd: string }

function ctx(db: DB): Ctx {
  const A = loadAssumptions(db);
  const s = loadSeries(db);
  const p: ModelParams = { ...DEFAULT_PARAMS, weeks: A.model_weeks.value, holidayShrink: A.model_holiday_shrink.value, seasonWeight: A.model_season_weight.value };
  return { db, s, prof: buildProfile(db), A, p, histEnd: s.last };
}

/** Bagel forecast for one date with flavor split and range. */
export function bagelForecast(c: Ctx, date: string) {
  const origin = addDays(c.histEnd, 1) < date ? addDays(c.histEnd, 1) : date;
  const h = holidayOn(date);
  // Closed-day detection: holiday whose prior occurrences all had no named-bagel records.
  if (h) {
    const prior = priorOccurrences(h.key, date).filter((d) => d >= c.s.first);
    const statuses = prior.map((d) => one<{ status: string }>(c.db, 'SELECT status FROM bagel_day WHERE date=?', d)?.status);
    if (prior.length && statuses.every((s) => s === 'no_records')) {
      return { date, closedLikely: true, holiday: h, origin, horizon: daysBetween(c.histEnd, date), total: { value: null, kind: 'missing', basis: `No bagel sales were recorded on ${h.name} last year (${prior.join(', ')}). Shop likely closed — confirm.` } as Figure, flavors: {} as Record<string, Figure>, raw: null };
    }
  }
  const f = forecastTotal(c.s, date, origin, c.p);
  const bands = errorBands(c.s, origin, 91, c.p);
  const b = isWeekend(date) ? bands.weekend : bands.weekday;
  const lo = Number.isFinite(b.lo) ? f.point * b.lo : f.point * 0.8;
  const hi = Number.isFinite(b.hi) ? f.point * b.hi : f.point * 1.2;
  const shares = flavorShares(c.s, f.baseDays);
  const pt = allocate(f.point, shares), los = allocate(lo, shares), his = allocate(hi, shares);
  const flavors: Record<string, Figure> = {};
  for (const k of Object.keys(pt).sort((a, z) => (FLAVOR_META[a]?.sort ?? 99) - (FLAVOR_META[z]?.sort ?? 99))) {
    flavors[k] = { value: pt[k], lo: los[k], hi: his[k], kind: 'forecast', unit: 'bagels', basis: `${(shares[k] * 100).toFixed(1)}% of the day’s ${Math.round(f.point)} bagels (this flavor’s share of the ${DOW_NAMES[dow(date)]} mix over the same baseline days).` };
  }
  const parts = [`${r0(f.base)} = trimmed mean of the last ${f.baseDays.length} ${DOW_NAMES[dow(date)]}s (${f.baseDays.at(-1)} → ${f.baseDays[0]}, high & low dropped)`];
  if (f.holiday.holiday) parts.push(f.holiday.observations.length
    ? `× ${f.holiday.value.toFixed(2)} ${h?.name} lift (past: ${f.holiday.observations.map((o) => `${o.date} ×${o.ratio.toFixed(2)}`).join(', ')}; 80% applied)`
    : `${h?.name}: no prior occurrence in history, no lift applied`);
  if (f.season.ratio !== null) parts.push(`× ${f.season.value.toFixed(3)} seasonal drift (last year this time vs. baseline weeks: ×${f.season.ratio.toFixed(3)}, half-weighted)`);
  return {
    date, closedLikely: false, holiday: h, origin, horizon: daysBetween(c.histEnd, date),
    total: { value: r0(f.point), lo: r0(lo), hi: r0(hi), kind: 'forecast', unit: 'bagels', basis: parts.join(' ') + `. Range = P20–P80 of walk-forward errors on ${isWeekend(date) ? 'weekends' : 'weekdays'} (n=${b.n}).` } as Figure,
    flavors: Object.fromEntries(Object.entries(flavors).map(([k, v]) => [k, { ...v, basis: v.basis + ' Day total: ' + parts.join(' ') }])), raw: f,
  };
}

function cateringFor(db: DB, date: string) {
  const rows = all<{ id: number; label: string; ready_by: string | null; bagels_json: string; sandwiches_json: string; spreads_json: string; status: string }>(db,
    `SELECT * FROM catering_orders WHERE date=? AND status IN ('confirmed','tentative')`, date);
  const bagels: Record<string, number> = {}, sandwiches: Record<string, number> = {}, spreads: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(JSON.parse(r.bagels_json) as Record<string, number>)) bagels[k] = (bagels[k] ?? 0) + v;
    for (const [k, v] of Object.entries(JSON.parse(r.sandwiches_json) as Record<string, number>)) sandwiches[k] = (sandwiches[k] ?? 0) + v;
    for (const [k, v] of Object.entries(JSON.parse(r.spreads_json) as Record<string, number>)) spreads[k] = (spreads[k] ?? 0) + v;
  }
  return { orders: rows, bagels, sandwiches, spreads };
}

/** Latest inventory count per (item,state) on or before date. */
function inventory(db: DB, date: string) {
  const rows = all<{ item: string; state: string; qty: number; unit: string; counted_at: string; business_date: string }>(db,
    `SELECT i.* FROM inventory_counts i JOIN (SELECT item,state,max(counted_at) m FROM inventory_counts WHERE business_date<=? GROUP BY item,state) x
       ON x.item=i.item AND x.state=i.state AND x.m=i.counted_at`, date);
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) map.set(`${r.item}|${r.state}`, r);
  return map;
}

function recipeComponents(db: DB) {
  const rows = all<{ recipe_id: string; component: string; qty: number | null; assumption_key: string | null }>(db, 'SELECT * FROM recipe_components');
  const out: Record<string, Record<string, { qty: number | null; key: string | null }>> = {};
  for (const r of rows) (out[r.recipe_id] ??= {})[r.component] = { qty: r.qty, key: r.assumption_key };
  return out;
}

export function buildPlan(db: DB, date: string) {
  const c = ctx(db);
  const A = c.A;
  const used = new Set<string>();
  const av = (k: string) => { if (A[k].status !== 'confirmed') used.add(k); return A[k].value; };

  const today = bagelForecast(c, date);
  const next = [1, 2, 3].map((k) => bagelForecast(c, addDays(date, k)));
  const cat = cateringFor(db, date);
  
  const inv = inventory(db, date);
  const comps = recipeComponents(db);
  const weekdayIdx = c.prof.weekdayIndex[dow(date)];
  const tickets: Ticket[] = [];
  const alerts: Alert[] = [];
  const point = today.total.value ?? 0;
  const lo = today.total.lo ?? point, hi = today.total.hi ?? point;
  const scale = (x: number) => ({ p: x * point, lo: x * lo, hi: x * hi });

  // ── Bagels: bake by flavor ──────────────────────────────────────────────
  const perTray = av('bagels_per_tray');
  const assorted = cat.bagels['Assorted'] ?? 0;
  const shareOf = (k: string) => (point ? (today.flavors[k]?.value ?? 0) / point : 0);
  const bake: Record<string, Figure & { catering: number; trays: number }> = {};
  for (const [k, f] of Object.entries(today.flavors)) {
    const catQ = (cat.bagels[k] ?? 0) + Math.round(assorted * shareOf(k));
    const q = (f.value ?? 0) + catQ;
    bake[k] = { ...f, value: q, lo: (f.lo ?? 0) + catQ, hi: (f.hi ?? 0) + catQ, catering: catQ, trays: q / perTray, basis: f.basis + (catQ ? ` + ${catQ} for booked catering` : '') };
  }
  for (const [k, q] of Object.entries(cat.bagels)) if (k !== 'Assorted' && !bake[k]) bake[k] = { value: q, kind: 'known', unit: 'bagels', basis: 'Booked catering only', catering: q, trays: q / perTray };
  const bakeTotal = Object.values(bake).reduce((a, f) => a + (f.value ?? 0), 0);
  const catBagels = Object.values(bake).reduce((a, f) => a + f.catering, 0);
  if (!today.closedLikely) {
    for (const [k, f] of Object.entries(bake)) {
      if (!f.value) continue;
      tickets.push({ key: `bake:${k}`, station: 'oven', due: '05:00', title: `Bake ${k}`, title_es: `Hornea ${FLAVOR_META[k]?.es ?? k}`,
        qty: f.value, unit: 'bagels', unit_es: 'bagels', detail: `≈ ${(f.value / perTray).toFixed(1)} trays of ${perTray}. Range ${f.lo}–${f.hi}.${f.catering ? ` Includes ${f.catering} catering.` : ''}`,
        detail_es: `≈ ${(f.value / perTray).toFixed(1)} charolas de ${perTray}. Rango ${f.lo}–${f.hi}.${f.catering ? ` Incluye ${f.catering} de catering.` : ''}`, figure: f });
    }
    const extra = hi - point;
    tickets.push({ key: 'bake:second', station: 'oven', due: `${String(av('second_bake_hour')).padStart(2, '0')}:00`, title: 'Check the case — second bake', title_es: 'Revisa la vitrina — segunda horneada',
      qty: r0(extra), unit: 'bagels max', unit_es: 'bagels máx.', detail: `If flavors are running low, bake up to ${r0(extra)} more from thawed stock (the gap between expected ${point} and a busy day ${hi}).`,
      detail_es: `Si se acaban sabores, hornea hasta ${r0(extra)} más de lo descongelado (diferencia entre lo esperado ${point} y un día fuerte ${hi}).`,
      figure: { value: r0(extra), kind: 'forecast', basis: 'Upper range minus expected', unit: 'bagels' } });
  }

  // ── Freezer pull for the next likely-open day (skips e.g. Thanksgiving) ─
  const tmr = next.find((n) => !n.closedLikely) ?? next[0];
  const skipped = next.slice(0, next.indexOf(tmr)).map((n) => `${DOW_NAMES[dow(n.date)]} (${n.holiday?.name ?? 'closed'})`);
  const pull: Record<string, Figure & { boxes: number; carry: number | null; carryKind: Kind }> = {};
  const perBox = av('bagels_per_box');
  const thawUpper = av('thaw_to_upper') >= 1;
  const catNext = cateringFor(db, tmr.date);
  if (!tmr.closedLikely) {
    const assortedN = catNext.bagels['Assorted'] ?? 0;
    const tPoint = tmr.total.value ?? 0;
    for (const [k, f] of Object.entries(tmr.flavors)) {
      const need = (thawUpper ? f.hi ?? f.value ?? 0 : f.value ?? 0) + (catNext.bagels[k] ?? 0) + Math.round(assortedN * ((f.value ?? 0) / (tPoint || 1)));
      const counted = inv.get(`${k}|thawed`);
      let carry: number, carryKind: Kind;
      if (counted && counted.business_date === date) { carry = Math.max(0, counted.qty - (bake[k]?.value ?? 0)); carryKind = 'verified'; }
      else { carry = Math.max(0, (today.flavors[k]?.hi ?? 0) - (today.flavors[k]?.value ?? 0)); carryKind = 'assumption'; }
      const q = Math.max(0, need - carry);
      pull[k] = { value: q, kind: 'forecast', unit: 'bagels', boxes: q / perBox, carry, carryKind,
        basis: `Tomorrow ${thawUpper ? 'upper range' : 'expected'} ${need} − ${carry} thawed left over (${carryKind === 'verified' ? 'from today’s count' : 'estimated: assumes today’s pull followed the plan — enter a thawed count to net it exactly'})` };
      if (q > 0) tickets.push({ key: `pull:${k}`, station: 'close', due: '13:00', title: `Pull ${k} → thaw side`, title_es: `Saca ${FLAVOR_META[k]?.es ?? k} → lado de descongelar`,
        qty: q, unit: 'bagels', unit_es: 'bagels', detail: `For ${DOW_NAMES[dow(tmr.date)]}${skipped.length ? ` (skipping ${skipped.join(', ')})` : ''}. ≈ ${(q / perBox).toFixed(2)} box. Freezer → RIGHT side of walk-in.`,
        detail_es: `Para el ${DOW_NAMES_ES[dow(tmr.date)]}. ≈ ${(q / perBox).toFixed(2)} caja. Congelador → lado DERECHO del cuarto frío.`, figure: pull[k] });
    }
  }

  // ── Sandwiches by item ──────────────────────────────────────────────────
  const sandShare = c.prof.sandwichShare * weekdayIdx;
  const sTot = scale(sandShare);
  const sandwiches = c.prof.sandwichMix.map((m) => {
    const known = cat.sandwiches[m.item] ?? 0;
    return { item: m.item, recipe_id: m.recipe_id, figure: { value: r0(sTot.p * m.share) + known, lo: r0(sTot.lo * m.share) + known, hi: r0(sTot.hi * m.share) + known, kind: 'forecast' as Kind, unit: 'sandwiches',
      basis: `${(m.share * 100).toFixed(1)}% of sandwiches (${c.prof.months.join(', ')} item totals) × ${r0(sTot.p)} sandwiches (bagels × ${(c.prof.sandwichShare * 100).toFixed(1)}% × ${DOW_NAMES[dow(date)]} index ${weekdayIdx.toFixed(2)})${known ? ` + ${known} catering` : ''}` } };
  }).filter((x) => (x.figure.hi ?? 0) > 0);
  for (const [k, v] of Object.entries(cat.sandwiches)) if (!sandwiches.find((s) => s.item === k)) sandwiches.push({ item: k, recipe_id: null, figure: { value: v, lo: v, hi: v, kind: 'known', unit: 'sandwiches', basis: 'Booked catering' } });
  const sandUnits = (pick: 'value' | 'lo' | 'hi') => sandwiches.reduce((a, s) => a + ((s.figure[pick] as number) ?? 0), 0);

  // ── Proteins & eggs (from build cards × sandwiches + add-ons) ───────────
  const comp = (item: string, recipe: string | null, key: string) => {
    if (!recipe) return 0; const cc = comps[recipe]?.[key]; if (!cc) return 0;
    if (cc.qty === null && cc.key) return av(cc.key);
    return cc.qty ?? 0;
  };
  const sumComp = (key: string, pick: 'value' | 'lo' | 'hi') => sandwiches.reduce((a, s) => a + ((s.figure[pick] as number) ?? 0) * comp(s.item, s.recipe_id, key), 0);
  const buf = 1 + av('protein_buffer_pct') / 100;
  const sandP = sandUnits('value');
  const proteinFig = (key: string, addonRate: number, addonUnit: number, unit: string, label: string): Figure => {
    const base = sumComp(key, 'value') + sandP * addonRate * addonUnit;
    const l = sumComp(key, 'lo') + sandUnits('lo') * addonRate * addonUnit, h = sumComp(key, 'hi') + sandUnits('hi') * addonRate * addonUnit;
    return { value: ceil(base * buf), lo: ceil(l), hi: ceil(h * buf), kind: 'forecast', unit,
      basis: `${r0(sumComp(key, 'value'))} ${label} from build cards × sandwich forecast + ${r0(sandP * addonRate * addonUnit)} from add-ons (${(addonRate * 100).toFixed(1)}% of sandwiches) + ${av('protein_buffer_pct')}% buffer` };
  };
  const bacon = proteinFig('bacon_strip', c.prof.addons.bacon, av('bacon_per_addon'), 'strips', 'strips');
  const sausage = proteinFig('sausage_patty', c.prof.addons.sausage, av('sausage_per_addon'), 'patties', 'patties');
  const eggOz = proteinFig('egg_oz', c.prof.addons.eggs, av('egg_oz_per_addon'), 'oz', 'oz');
  const shellEggs: Figure = { value: ceil((eggOz.value ?? 0) / av('egg_oz_per_shell_egg')), kind: 'forecast', unit: 'eggs', basis: `${eggOz.value} oz ÷ ${av('egg_oz_per_shell_egg')} oz per X-Large egg (assumption)` };
  const invCooked = (item: string) => inv.get(`${item}|cooked`);
  const net = (fig: Figure, item: string) => {
    const cnt = invCooked(item);
    return cnt && cnt.business_date === date ? { ...fig, value: Math.max(0, (fig.value ?? 0) - cnt.qty), basis: fig.basis + ` − ${cnt.qty} cooked on hand (counted)` } : fig;
  };
  const baconCook = net(bacon, 'bacon'), sausageCook = net(sausage, 'sausage');
  if (!today.closedLikely) {
    tickets.push({ key: 'prep:bacon', station: 'prep', due: '05:15', title: 'Cook bacon', title_es: 'Cocina tocino', qty: baconCook.value, unit: 'strips', unit_es: 'tiras',
      detail: `Pick Me Up 2 · BLT 4 · add-ons. Range ${bacon.lo}–${bacon.hi}.`, detail_es: `Pick Me Up 2 · BLT 4 · extras. Rango ${bacon.lo}–${bacon.hi}.`, figure: baconCook });
    tickets.push({ key: 'prep:sausage', station: 'prep', due: '05:15', title: 'Cook sausage patties', title_es: 'Cocina medallones de salchicha', qty: sausageCook.value, unit: 'patties (4 oz)', unit_es: 'medallones (4 oz)',
      detail: `Rise & Grind 1 · add-ons. Range ${sausage.lo}–${sausage.hi}.`, detail_es: `Rise & Grind 1 · extras. Rango ${sausage.lo}–${sausage.hi}.`, figure: sausageCook });
    tickets.push({ key: 'eggs:crack', station: 'eggs', due: '05:30', title: 'Crack eggs', title_es: 'Rompe huevos', qty: shellEggs.value, unit: 'eggs', unit_es: 'huevos',
      detail: `${eggOz.value} oz prepared egg (Pick Me Up & Rise & Grind 4 oz · Basic B, B Healthy, Heavenly Hash 2 oz).`, detail_es: `${eggOz.value} oz de huevo (Pick Me Up y Rise & Grind 4 oz · Basic B, B Healthy, Heavenly Hash 2 oz).`, figure: shellEggs });
  }

  // ── Other ingredient prep ────────────────────────────────────────────────
  const other: { key: string; label: string; label_es: string; figure: Figure }[] = [];
  const otherComp = (key: string, label: string, label_es: string, unit: string, extra = 0, extraBasis = '') => {
    const v = sumComp(key, 'value') + extra;
    if (v > 0) other.push({ key, label, label_es, figure: { value: Math.ceil(v), lo: Math.ceil(sumComp(key, 'lo')), hi: Math.ceil(sumComp(key, 'hi') + extra), kind: 'forecast', unit, basis: `Build-card portions × sandwich forecast${extraBasis}` } });
  };
  otherComp('potato_pancake', 'Potato pancakes', 'Tortitas de papa', 'each', point * c.prof.potatoPancakeSidePerBagel * 2, ' + "Potato Pancakes (2)" side orders × 2');
  otherComp('avocado_half', 'Avocado halves', 'Mitades de aguacate', 'halves');
  otherComp('tomato_slice', 'Tomato slices', 'Rebanadas de tomate', 'slices');
  otherComp('lox_oz', 'Lox', 'Salmón', 'oz');
  otherComp('turkey_oz', 'Turkey', 'Pavo', 'oz');
  otherComp('pastrami_oz', 'Pastrami', 'Pastrami', 'oz');
  const saladOz = sumComp('salad_oz', 'value');
  for (const [k, sh] of Object.entries(c.prof.saladSplit)) if (saladOz > 0) other.push({ key: `salad:${k}`, label: `${k} salad (sandwiches)`, label_es: `Ensalada de ${k === 'Tuna' ? 'atún' : k === 'Chicken' ? 'pollo' : 'huevo'} (sándwiches)`,
    figure: { value: Math.ceil(saladOz * sh), kind: c.prof.saladSplitKnown ? 'forecast' : 'assumption', unit: 'oz', basis: `4 oz × salad sandwiches × ${(sh * 100).toFixed(0)}% ${k} (${c.prof.saladSplitKnown ? 'Toast choice modifiers' : 'even split — no modifier data'}). Salad tubs sold by the pound are not included.` } });
  if (!today.closedLikely && other.length) tickets.push({ key: 'prep:other', station: 'prep', due: '06:00', title: 'Line prep', title_es: 'Preparación de línea', qty: null, unit: '', unit_es: '',
    detail: other.map((o) => `${o.label} ${o.figure.value} ${o.figure.unit}`).join(' · '), detail_es: other.map((o) => `${o.label_es} ${o.figure.value} ${o.figure.unit}`).join(' · '),
    figure: { value: null, kind: 'forecast', basis: 'See ingredient table' } });

  // ── Cream cheese ────────────────────────────────────────────────────────
  const spreadOz = av('cc_spread_oz'), addonOz = av('cc_addon_oz'), tubOz = av('cc_tub_oz'), sideOz = av('cc_side_oz');
  const parDays = av('cc_tub_par_days'), safety = 1 + av('cc_safety_pct') / 100, batch = av('cc_batch_lb');
  const glUnits = sandwiches.find((s) => s.recipe_id === 'goldie_lox')?.figure.value ?? 0;
  const flavorsCC = new Set([...Object.keys(c.prof.spreadPerBagel), ...Object.keys(c.prof.retailPerBagel), ...Object.keys(c.prof.addonCcPerSandwich), ...Object.keys(cat.spreads)]);
  const nextPoints = next.map((n) => n.total.value ?? 0);
  // Plain base is made Mon & Fri: cover through the day before the next base day.
  const daysToNextBase = (() => { for (let k = 1; k <= 7; k++) if ([0, 4].includes(dow(addDays(date, k)))) return k; return 3; })();
  const cream = [...flavorsCC].map((f) => {
    const sp = (c.prof.spreadPerBagel[f] ?? 0) * point;
    const ad = (c.prof.addonCcPerSandwich[f] ?? 0) * sandP;
    const rt = c.prof.retailPerBagel[f];
    const tubsDay = rt ? rt.per * rt.share8 * point : 0;
    const sidesDay = rt ? rt.per * (1 - rt.share8) * point : 0;
    const gl = f === 'Plain' ? glUnits * av('cc_goldie_lox_oz') : 0;
    const catOz = cat.spreads[f] ?? 0;
    const ozToday = sp * spreadOz + ad * addonOz + sidesDay * sideOz + gl + catOz; // loose stock used today (tubs counted separately)
    const tubsOnHand = inv.get(`cream_cheese:${f}|tub_8oz`);
    const tubsNeed = ceil(tubsDay * parDays);
    const tubsToPack = Math.max(0, tubsNeed - (tubsOnHand && tubsOnHand.business_date === date ? tubsOnHand.qty : 0));
    const coverDays = f === 'Plain' ? daysToNextBase : 2;
    const futureOz = nextPoints.slice(0, coverDays - 1).reduce((a, p) => a + ((c.prof.spreadPerBagel[f] ?? 0) * p * spreadOz + (rt ? rt.per * (1 - rt.share8) * p * sideOz : 0)), 0);
    const bulkNeedLb = ((ozToday + futureOz + tubsToPack * tubOz) * safety) / 16;
    const bulkOnHand = inv.get(`cream_cheese:${f}|bulk_lb`);
    const haveLb = bulkOnHand && bulkOnHand.business_date === date ? bulkOnHand.qty : null;
    const toMakeLb = haveLb === null ? bulkNeedLb : Math.max(0, bulkNeedLb - haveLb);
    return {
      flavor: f, spreadServings: r0(sp), addOns: r0(ad), goldieLoxOz: r0(gl), cateringOz: catOz,
      ozToday: { value: r0(ozToday), kind: 'forecast' as Kind, unit: 'oz', basis: `${r0(sp)} spreads × ${spreadOz} oz (confirmed) + ${r0(ad)} add-ons × ${addonOz} oz + ${r0(sidesDay)} 4 oz sides${gl ? ` + Goldie Lox ${r0(gl)} oz (assumption)` : ''}${catOz ? ` + ${catOz} oz catering` : ''}` },
      tubsPerDay: tubsDay, tubsToPack: { value: tubsToPack, kind: 'forecast' as Kind, unit: '8 oz tubs', basis: `${tubsDay.toFixed(1)} tubs/day × ${parDays} day par (assumption)${tubsOnHand && tubsOnHand.business_date === date ? ` − ${tubsOnHand.qty} in case (counted)` : ' — no tub count today, assumes case is empty'}` },
      bulkNeedLb: { value: Math.round(bulkNeedLb * 10) / 10, kind: 'forecast' as Kind, unit: 'lb', basis: `Covers ${coverDays} day(s)${f === 'Plain' ? ' (until next Mon/Fri base day)' : ''} incl. packing, +${av('cc_safety_pct')}%` },
      onHandLb: haveLb === null ? { value: null, kind: 'missing' as Kind, unit: 'lb', basis: 'No count entered today — not assumed to be zero; plan shows the full need' } : { value: haveLb, kind: 'verified' as Kind, unit: 'lb', basis: `Counted ${bulkOnHand!.counted_at}` },
      toMakeLb: { value: Math.round(toMakeLb * 10) / 10, kind: haveLb === null ? 'assumption' as Kind : 'forecast' as Kind, unit: 'lb', basis: haveLb === null ? 'Full need — enter on-hand to net it' : 'Need − on hand' },
      batches: f === 'Plain' ? null : ceil(toMakeLb / batch),
      share8Known: rt?.share8Known ?? true,
    };
  }).filter((x) => x.ozToday.value! > 0 || x.tubsToPack.value! > 0).sort((a, b) => (b.ozToday.value ?? 0) - (a.ozToday.value ?? 0));
  if (!today.closedLikely) {
    tickets.push({ key: 'prep:cc', station: 'prep', due: '06:00', title: 'Cream cheese: check & mix', title_es: 'Queso crema: revisa y mezcla', qty: null, unit: '', unit_es: '',
      detail: cream.filter((x) => (x.toMakeLb.value ?? 0) >= 0.5).map((x) => `${x.flavor} ${x.toMakeLb.value} lb${x.batches ? ` (${x.batches}×${batch} lb)` : ''}`).join(' · ') || 'Nothing to mix',
      detail_es: cream.filter((x) => (x.toMakeLb.value ?? 0) >= 0.5).map((x) => `${x.flavor} ${x.toMakeLb.value} lb${x.batches ? ` (${x.batches}×${batch} lb)` : ''}`).join(' · ') || 'Nada que mezclar',
      figure: { value: null, kind: 'forecast', basis: 'See cream cheese table' } });
    const pack = cream.filter((x) => (x.tubsToPack.value ?? 0) > 0);
    if (pack.length) tickets.push({ key: 'prep:tubs', station: 'prep', due: '11:00', title: 'Pack 8 oz tubs', title_es: 'Empaca envases de 8 oz', qty: pack.reduce((a, x) => a + (x.tubsToPack.value ?? 0), 0), unit: 'tubs', unit_es: 'envases',
      detail: pack.map((x) => `${x.flavor} ${x.tubsToPack.value}`).join(' · ') + '. Label: name, packed-on, use-by.', detail_es: pack.map((x) => `${x.flavor} ${x.tubsToPack.value}`).join(' · ') + '. Etiqueta: nombre, fecha de empaque, fecha límite.',
      figure: { value: null, kind: 'forecast', basis: 'See cream cheese table' } });
    tickets.push({ key: 'close:waste', station: 'close', due: '14:00', title: 'Log waste & count thawed bagels', title_es: 'Registra merma y cuenta bagels descongelados', qty: null, unit: '', unit_es: '',
      detail: 'Counts make tomorrow’s pull exact.', detail_es: 'El conteo hace exacto el retiro de mañana.', figure: { value: null, kind: 'known', basis: '' } });
  }

  // ── Alerts ──────────────────────────────────────────────────────────────
  const horizon = daysBetween(c.histEnd, date);
  if (horizon > 3) alerts.push({ level: 'watch', title: `Forecast is ${horizon} days past the latest Toast data`, title_es: `El pronóstico está ${horizon} días después de los últimos datos de Toast`,
    body: `Latest imported bagel history: ${c.histEnd}. Import a new Item Selection Details export to sharpen these numbers.`, body_es: `Último historial importado: ${c.histEnd}. Importa un nuevo reporte de Toast para afinar estos números.` });
  if (today.closedLikely) alerts.push({ level: 'act', title: `${today.holiday?.name}: likely closed`, title_es: `${today.holiday?.name_es}: probablemente cerrado`, body: today.total.basis, body_es: 'El año pasado no hubo ventas de bagels este día. Confirma si abrimos.' });
  else if (today.holiday && today.raw && today.raw.holiday.value !== 1) alerts.push({ level: 'act', title: `${today.holiday.name} — ×${today.raw.holiday.value.toFixed(2)} vs a normal ${DOW_NAMES[dow(date)]}`, title_es: `${today.holiday.name_es} — ×${today.raw.holiday.value.toFixed(2)} vs un ${DOW_NAMES_ES[dow(date)]} normal`, body: today.total.basis, body_es: 'Basado en el mismo día festivo del año pasado.' });
  for (const n of next) if (n.holiday) alerts.push({ level: n.closedLikely ? 'act' : 'watch', title: `${DOW_NAMES[dow(n.date)]} ${n.date.slice(5)}: ${n.holiday.name}${n.closedLikely ? ' (likely closed)' : n.raw ? ` ×${n.raw.holiday.value.toFixed(2)}` : ''}`, title_es: `${DOW_NAMES_ES[dow(n.date)]} ${n.date.slice(5)}: ${n.holiday.name_es}`,
    body: n.closedLikely ? n.total.basis : `Expected ${n.total.value} bagels (range ${n.total.lo}–${n.total.hi}). Plan the freezer pull accordingly.`, body_es: n.closedLikely ? 'Confirma si abrimos.' : `Se esperan ${n.total.value} bagels (rango ${n.total.lo}–${n.total.hi}).` });
  if (!today.closedLikely && hi / Math.max(1, lo) > 1.6) alerts.push({ level: 'info', title: 'Wide range today', title_es: 'Rango amplio hoy', body: `${lo}–${hi} bagels. Bulk orders swing this weekday; keep thawed stock ready for a second bake.`, body_es: `${lo}–${hi} bagels. Los pedidos grandes varían este día; ten bagels descongelados para una segunda horneada.` });
  if (cat.orders.length) alerts.push({ level: 'act', title: `${cat.orders.length} catering order(s) today — ${catBagels} bagels included`, title_es: `${cat.orders.length} pedido(s) de catering hoy — ${catBagels} bagels incluidos`, body: cat.orders.map((o) => `${o.label}${o.ready_by ? ' by ' + o.ready_by : ''}`).join(' · '), body_es: cat.orders.map((o) => `${o.label}${o.ready_by ? ' para ' + o.ready_by : ''}`).join(' · ') });
  if (catNext.orders.length) alerts.push({ level: 'watch', title: `${catNext.orders.length} catering order(s) tomorrow — included in the pull`, title_es: `${catNext.orders.length} pedido(s) de catering mañana — incluidos en el retiro`, body: catNext.orders.map((o) => o.label).join(' · '), body_es: catNext.orders.map((o) => o.label).join(' · ') });
  const hasThawCount = [...inv.values()].some((r) => r.state === 'thawed' && r.business_date === date);
  if (!hasThawCount && !today.closedLikely) alerts.push({ level: 'info', title: 'No thawed-bagel count today', title_es: 'Sin conteo de bagels descongelados hoy', body: 'Tomorrow’s pull assumes today’s thawed stock matches the plan. A 2-minute count makes it exact.', body_es: 'El retiro de mañana supone que lo descongelado coincide con el plan. Un conteo de 2 minutos lo hace exacto.' });
  if (used.size) alerts.push({ level: 'info', title: `${used.size} unconfirmed assumptions shape today's numbers`, title_es: `${used.size} supuestos sin confirmar afectan los números de hoy`, body: [...used].map((k) => A[k].label).join(' · '), body_es: 'Un gerente puede confirmarlos en Ledger › Supuestos.' });

  // ── Status overlays: adjustments, done state ────────────────────────────
  const adj = new Map(all<{ ticket_key: string; qty: number; reason: string; username: string }>(db, `SELECT a.ticket_key,a.qty,a.reason,u.username FROM plan_adjustments a LEFT JOIN users u ON u.id=a.user_id WHERE a.date=?`, date).map((r) => [r.ticket_key, r]));
  const st = new Map(all<{ ticket_key: string; status: string }>(db, 'SELECT ticket_key,status FROM ticket_status WHERE date=?', date).map((r) => [r.ticket_key, r.status]));
  for (const t of tickets) {
    const a = adj.get(t.key);
    if (a) t.adjusted = { qty: a.qty, reason: a.reason, by: a.username };
    t.status = st.get(t.key) ?? null;
  }
  tickets.sort((a, b) => a.due.localeCompare(b.due));

  // previous shift: tickets + handoffs from yesterday and today
  const prev = addDays(date, -1);
  const prevDone = all<{ ticket_key: string; status: string; at: string; username: string }>(db, `SELECT t.ticket_key,t.status,t.at,u.display_name username FROM ticket_status t LEFT JOIN users u ON u.id=t.user_id WHERE t.date=? ORDER BY t.at`, prev);
  const handoffs = all(db, `SELECT h.id,h.date,h.shift,h.note,h.flags_json,h.at,u.display_name author FROM handoffs h LEFT JOIN users u ON u.id=h.user_id WHERE h.date IN (?,?) ORDER BY h.at DESC LIMIT 10`, prev, date);

  return {
    date, weekday: DOW_NAMES[dow(date)], weekday_es: DOW_NAMES_ES[dow(date)], holiday: today.holiday, closedLikely: today.closedLikely,
    model: MODEL_ID, historyEnd: c.histEnd, horizonDays: horizon, profileMonths: c.prof.months,
    bagels: { total: today.total, walkInFlavors: today.flavors, bake, bakeTotal, cateringBagels: catBagels, trays: bakeTotal / perTray },
    pull: { forDate: tmr.date, skipped, closedLikely: tmr.closedLikely, total: Object.values(pull).reduce((a, f) => a + (f.value ?? 0), 0), flavors: pull },
    outlook: next.map((n) => ({ date: n.date, weekday: DOW_NAMES[dow(n.date)], holiday: n.holiday?.name ?? null, closedLikely: n.closedLikely, total: n.total })),
    sandwiches: { total: { value: r0(sandP), lo: r0(sandUnits('lo')), hi: r0(sandUnits('hi')), kind: 'forecast' as Kind, basis: c.prof.weekdayIndexBasis }, items: sandwiches },
    proteins: { bacon, sausage, eggOz, shellEggs, baconCook, sausageCook },
    other, cream, catering: cat.orders, alerts, tickets,
    previous: { date: prev, tickets: prevDone, handoffs },
    assumptionsUsed: [...used].map((k) => ({ key: k, ...A[k] })),
  };
}

export type Plan = ReturnType<typeof buildPlan>;
export { ctx as planContext };

import type { DB } from '../db.ts';
import { all } from '../db.ts';

export interface AssumptionDef {
  key: string; value: number; unit: string; label: string; label_es: string; category: string;
  status: 'assumption' | 'confirmed'; basis: string;
}

/**
 * Default register. "confirmed" means a source in the kit or management states it; everything else is an
 * editable assumption shown with the amber mark wherever it influences a number.
 */
export const DEFAULT_ASSUMPTIONS: AssumptionDef[] = [
  // Cream cheese
  { key: 'cc_spread_oz', value: 2, unit: 'oz', label: 'Cream cheese per bagel served with cream cheese', label_es: 'Queso crema por bagel con queso crema', category: 'cream_cheese', status: 'confirmed', basis: 'Confirmed by management; also manual FOH standard (two 1 oz scoops).' },
  { key: 'cc_addon_oz', value: 2, unit: 'oz', label: 'Cream cheese per sandwich add-on', label_es: 'Queso crema por extra en sándwich', category: 'cream_cheese', status: 'confirmed', basis: 'Toast modifier names read "Cream Cheese- … 2oz."' },
  { key: 'cc_goldie_lox_oz', value: 2, unit: 'oz', label: 'Cream cheese on a Goldie Lox', label_es: 'Queso crema en un Goldie Lox', category: 'cream_cheese', status: 'assumption', basis: 'Card says "both halves" with no amount; uses the 2 oz spread standard until confirmed.' },
  { key: 'cc_tub_oz', value: 8, unit: 'oz', label: 'Retail grab-and-go tub', label_es: 'Envase para venta', category: 'cream_cheese', status: 'confirmed', basis: 'Kit planning rules: retail tubs are 8 oz.' },
  { key: 'cc_side_oz', value: 4, unit: 'oz', label: 'Small retail / side size', label_es: 'Tamaño chico', category: 'cream_cheese', status: 'confirmed', basis: 'Toast Size modifier "4 oz".' },
  { key: 'cc_tub_par_days', value: 2, unit: 'days', label: 'Days of 8 oz tubs to keep packed in the case', label_es: 'Días de envases de 8 oz listos', category: 'cream_cheese', status: 'assumption', basis: 'No par list in the kit. Short to respect date-marking; manager to set.' },
  { key: 'cc_batch_lb', value: 3, unit: 'lb', label: 'Flavored cream cheese batch size', label_es: 'Tamaño de tanda de queso crema con sabor', category: 'cream_cheese', status: 'assumption', basis: 'Historical manual: small 3 lb batches. Current yields not supplied.' },
  { key: 'cc_safety_pct', value: 10, unit: '%', label: 'Cream cheese safety margin', label_es: 'Margen de seguridad de queso crema', category: 'cream_cheese', status: 'assumption', basis: 'Planning margin; not from data.' },
  // Proteins & eggs
  { key: 'bacon_per_addon', value: 2, unit: 'strips', label: 'Bacon strips per "Add bacon"', label_es: 'Tiras de tocino por extra de tocino', category: 'protein', status: 'assumption', basis: 'Not stated anywhere; matches Pick Me Up portion.' },
  { key: 'sausage_per_addon', value: 1, unit: 'patty', label: 'Sausage patties per "Add sausage"', label_es: 'Medallones por extra de salchicha', category: 'protein', status: 'assumption', basis: 'Not stated; one patty assumed.' },
  { key: 'egg_oz_per_addon', value: 2, unit: 'oz', label: 'Egg per "Add eggs"', label_es: 'Huevo por extra de huevo', category: 'protein', status: 'assumption', basis: 'Not stated; uses the 2 oz single-egg sandwich portion.' },
  { key: 'egg_oz_per_shell_egg', value: 2, unit: 'oz', label: 'Liquid egg per X-Large shell egg', label_es: 'Huevo líquido por huevo extra grande', category: 'protein', status: 'assumption', basis: 'Purchases are X-Large eggs; ~2 oz each is the USDA minimum-weight approximation. Weigh to confirm.' },
  { key: 'protein_buffer_pct', value: 10, unit: '%', label: 'Bacon / sausage / egg buffer', label_es: 'Margen de proteína y huevo', category: 'protein', status: 'assumption', basis: 'Planning margin; not from data.' },
  // Bagels
  { key: 'bagels_per_box', value: 72, unit: 'bagels', label: 'Regular bagels per box', label_es: 'Bagels por caja', category: 'bagels', status: 'confirmed', basis: 'Kit: 72 per box, 40 boxes per pallet.' },
  { key: 'boxes_per_pallet', value: 40, unit: 'boxes', label: 'Boxes per pallet', label_es: 'Cajas por tarima', category: 'bagels', status: 'confirmed', basis: 'Kit inventory facts.' },
  { key: 'bagels_per_tray', value: 16, unit: 'bagels', label: 'Bagels per oven tray', label_es: 'Bagels por charola', category: 'bagels', status: 'assumption', basis: 'Manual says 15–18 per tray; 16 used.' },
  { key: 'thawed_life_days', value: 7, unit: 'days', label: 'Thawed shelf life', label_es: 'Vida después de descongelar', category: 'bagels', status: 'confirmed', basis: 'Historical manual: thawed must be used within 7 days. Verify current policy.' },
  { key: 'thaw_to_upper', value: 1, unit: 'flag', label: 'Thaw to the upper end of the forecast range (1 = yes)', label_es: 'Descongelar al rango alto (1 = sí)', category: 'bagels', status: 'assumption', basis: 'Buffer policy: bake to the expected number, keep the rest thawed for a second bake.' },
  { key: 'second_bake_hour', value: 9, unit: 'hour', label: 'Check-and-rebake time', label_es: 'Hora de revisar y volver a hornear', category: 'bagels', status: 'assumption', basis: 'Peak is 07:00–10:00 (Channels & Hours). Manager to set.' },
  // Model
  { key: 'model_weeks', value: 8, unit: 'weeks', label: 'Same-weekday history used', label_es: 'Semanas de historial', category: 'model', status: 'assumption', basis: 'Chosen by walk-forward backtest.' },
  { key: 'model_holiday_shrink', value: 0.8, unit: '×', label: 'Share of past holiday lift applied', label_es: 'Proporción del efecto festivo', category: 'model', status: 'assumption', basis: 'Chosen by walk-forward backtest; 1.0 = repeat last year exactly.' },
  { key: 'model_season_weight', value: 0.5, unit: '×', label: 'Weight on last-year seasonal drift', label_es: 'Peso de la estacionalidad', category: 'model', status: 'assumption', basis: 'Chosen by walk-forward backtest.' },
];

export function loadAssumptions(db: DB): Record<string, { value: number; status: string; label: string; unit: string }> {
  const rows = all<{ key: string; value: number; status: string; label: string; unit: string }>(db, 'SELECT key,value,status,label,unit FROM assumptions');
  const out: Record<string, { value: number; status: string; label: string; unit: string }> = {};
  for (const d of DEFAULT_ASSUMPTIONS) out[d.key] = { value: d.value, status: d.status, label: d.label, unit: d.unit };
  for (const r of rows) out[r.key] = r;
  return out;
}

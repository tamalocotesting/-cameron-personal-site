import { openDb } from '../../server/db.ts';
import { loadSeries } from '../../server/domain/history.ts';
import { dateRange } from '../../server/domain/calendar.ts';
const s = loadSeries(openDb());
const FL = ['Plain','Everything','GF Plain','GF Everything','Whole Wheat','Whole Wheat Everything','Sesame','Cinnamon Raisin','Poppy','Rainbow','Onion','Pumpernickel','Blueberry'];
// Poisson floor: E|X-λ| ≈ sqrt(2λ/π) for a perfectly known daily mean λ (use actual as λ proxy). Even a perfect forecaster of the mean can't beat this.
let floorF = 0, floorT = 0, act = 0; const byF: Record<string, [number, number]> = {};
for (const d of dateRange('2026-09-06', '2026-10-31')) { const a = s.flavors.get(d); if (!a) continue; let tot = 0;
  for (const f of FL) { const l = a[f] ?? 0; floorF += Math.sqrt(2 * l / Math.PI); tot += l; byF[f] ??= [0, 0]; byF[f][0] += Math.sqrt(2 * l / Math.PI); byF[f][1] += l; }
  floorT += Math.sqrt(2 * tot / Math.PI); act += tot; }
console.log('Poisson noise floor (perfect mean forecast): flavor WAPE', (floorF / act * 100).toFixed(1) + '%', ' daily-total WAPE', (floorT / act * 100).toFixed(1) + '%');
for (const [f, [e, a]] of Object.entries(byF).sort((x, y) => y[1][1] - x[1][1])) console.log('  ', f.padEnd(24), 'avg/day', (a / 56).toFixed(1).padStart(6), ' floor', (e / a * 100).toFixed(0) + '%');

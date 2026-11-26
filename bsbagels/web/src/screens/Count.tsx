import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppCtx } from '../App';
import { Bi, useLang } from '../i18n';
import { FlavorChip, Loading, useToast, fmt } from '../components/ui';
import { usePlan } from './Rail';

const CC = ['Plain', 'Knock Out', 'Cinnamon Sugar', 'Jalapeño Cheddar', 'Strawberry', 'Veggie', 'Blueberry', 'Lox'];

function Stepper({ value, onChange, step = 1, label }: { value: number | ''; onChange: (v: number | '') => void; step?: number; label: string }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="btn sm" aria-label={`Less ${label}`} onClick={() => onChange(Math.max(0, (+value || 0) - step))}>−</button>
      <input className="input num" style={{ width: 76, textAlign: 'center', minHeight: 40, padding: 6 }} inputMode="decimal" value={value} aria-label={label}
        onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); onChange(v === '' ? '' : +v); }} />
      <button className="btn sm" aria-label={`More ${label}`} onClick={() => onChange((+value || 0) + step)}>+</button>
    </div>
  );
}

export function Count({ ctx }: { ctx: AppCtx }) {
  const lang = useLang();
  const date = ctx.meta.today;
  const { plan } = usePlan(date);
  const [latest, setLatest] = useState<any[] | null>(null);
  const [vals, setVals] = useState<Record<string, number | ''>>({});
  const [toast, say] = useToast();
  const [waste, setWaste] = useState({ item: 'Plain', qty: '' as number | '', unit: 'bagels', reason: 'end_of_day' });
  const load = () => api('/api/inventory').then(setLatest);
  useEffect(() => { load(); }, []);
  if (!latest || !plan) return <Loading />;
  const last = (item: string, state: string) => latest.find((r) => r.item === item && r.state === state);
  const flavors = ctx.meta.flavors.filter((f) => f.active).map((f) => f.name);
  const set = (k: string, v: number | '') => setVals({ ...vals, [k]: v });
  const save = async () => {
    const counts = Object.entries(vals).filter(([, v]) => v !== '').map(([k, v]) => { const [item, state, unit] = k.split('|'); return { item, state, unit, qty: v }; });
    if (!counts.length) return say('Nothing entered');
    try { await api('/api/inventory', { body: { date, counts } }); setVals({}); load(); say(lang === 'es' ? `✓ ${counts.length} conteos guardados` : `✓ Saved ${counts.length} counts`); } catch (e) { say((e as Error).message); }
  };
  const logWaste = async () => {
    if (!waste.qty) return;
    try { await api('/api/waste', { body: { date, ...waste } }); setWaste({ ...waste, qty: '' }); say(lang === 'es' ? '✓ Merma registrada' : '✓ Waste logged'); } catch (e) { say((e as Error).message); }
  };
  const need = (f: string) => plan.bagels.bake[f]?.value ?? 0;
  return (
    <div className="stack">
      <h1 style={{ fontSize: 28 }}><Bi en="Count & waste" es="Conteo y merma" /></h1>
      <p className="small muted"><Bi en="Counts replace estimates in today’s plan. Leave blank if you didn’t count — blank stays unknown, never zero." es="Los conteos reemplazan los estimados. Deja en blanco lo que no contaste: en blanco es desconocido, no cero." /></p>

      <div className="card stack">
        <h2><Bi en="Thawed bagels (left side + right side)" es="Bagels descongelados (lado izquierdo + derecho)" /></h2>
        {flavors.map((f) => { const l = last(f, 'thawed'); return (
          <div key={f} className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row grow" style={{ gap: 10 }}><FlavorChip name={f} size={30} /><div><b>{f}</b><div className="xs faint">{l ? `Last: ${fmt(l.qty)} · ${l.business_date}` : 'Never counted'} · bake today {fmt(need(f))}</div></div></div>
            <Stepper value={vals[`${f}|thawed|bagels`] ?? ''} onChange={(v) => set(`${f}|thawed|bagels`, v)} label={`${f} thawed`} />
          </div>); })}
      </div>

      <div className="card stack">
        <h2><Bi en="Cream cheese" es="Queso crema" /></h2>
        <div className="row xs faint" style={{ justifyContent: 'flex-end', gap: 70, paddingRight: 30 }}><span>bulk lb</span><span>8 oz tubs</span></div>
        {CC.map((f) => { const need = plan.cream.find((c: any) => c.flavor === f); return (
          <div key={f} className="row wrap" style={{ justifyContent: 'space-between' }}>
            <div className="grow"><b>{f}</b><div className="xs faint">need {fmt(need?.bulkNeedLb.value, 1)} lb · pack {fmt(need?.tubsToPack.value)}</div></div>
            <Stepper value={vals[`cream_cheese:${f}|bulk_lb|lb`] ?? ''} step={0.5} onChange={(v) => set(`cream_cheese:${f}|bulk_lb|lb`, v)} label={`${f} bulk pounds`} />
            <Stepper value={vals[`cream_cheese:${f}|tub_8oz|tubs`] ?? ''} onChange={(v) => set(`cream_cheese:${f}|tub_8oz|tubs`, v)} label={`${f} tubs`} />
          </div>); })}
      </div>

      <div className="card stack">
        <h2><Bi en="Cooked proteins on hand" es="Proteína cocida disponible" /></h2>
        {[['bacon', 'Bacon strips', 'Tiras de tocino', 'strips'], ['sausage', 'Sausage patties', 'Medallones', 'patties']].map(([k, en, es, unit]) => (
          <div key={k} className="row" style={{ justifyContent: 'space-between' }}><b className="grow"><Bi en={en} es={es} inline /></b><Stepper value={vals[`${k}|cooked|${unit}`] ?? ''} onChange={(v) => set(`${k}|cooked|${unit}`, v)} label={en} /></div>))}
      </div>
      <button className="btn primary" onClick={save} style={{ width: '100%' }}><Bi en="Save counts" es="Guardar conteos" inline /></button>

      <div className="card stack">
        <h2><Bi en="Log waste" es="Registrar merma" /></h2>
        <div className="row wrap">
          <select className="input" style={{ flex: '1 1 160px' }} value={waste.item} onChange={(e) => setWaste({ ...waste, item: e.target.value, unit: flavors.includes(e.target.value) ? 'bagels' : e.target.value.startsWith('CC') ? 'oz' : 'each' })} aria-label="Item">
            <optgroup label="Bagels">{flavors.map((f) => <option key={f}>{f}</option>)}</optgroup>
            <optgroup label="Cream cheese">{CC.map((f) => <option key={f} value={`CC ${f}`}>CC {f}</option>)}</optgroup>
            <optgroup label="Other"><option>Bacon strips</option><option>Sausage patties</option><option>Eggs</option><option>Sandwich</option></optgroup>
          </select>
          <Stepper value={waste.qty} onChange={(v) => setWaste({ ...waste, qty: v })} label="Waste quantity" />
        </div>
        <div className="seg" style={{ flexWrap: 'wrap' }}>{[['end_of_day', 'End of day', 'Fin del día'], ['burnt', 'Burnt', 'Quemado'], ['dropped', 'Dropped', 'Se cayó'], ['expired', 'Expired', 'Caducado'], ['quality', 'Quality', 'Calidad']].map(([k, en, es]) =>
          <button key={k} aria-pressed={waste.reason === k} onClick={() => setWaste({ ...waste, reason: k })}><Bi en={en} es={es} inline /></button>)}</div>
        <button className="btn ink" onClick={logWaste} disabled={!waste.qty}><Bi en="Log waste" es="Registrar" inline /></button>
      </div>
      {toast}
    </div>
  );
}

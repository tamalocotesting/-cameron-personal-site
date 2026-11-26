import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppCtx } from '../App';
import { Bi, useLang } from '../i18n';
import { Loading, useToast, Icon } from '../components/ui';

export function Shift({ ctx }: { ctx: AppCtx }) {
  const lang = useLang();
  const date = ctx.meta.today;
  const [handoffs, setHandoffs] = useState<any[] | null>(null);
  const [lists, setLists] = useState<any[] | null>(null);
  const [note, setNote] = useState('');
  const [shift, setShift] = useState<'open' | 'mid' | 'close'>('close');
  const [toast, say] = useToast();
  const load = () => { api(`/api/handoffs?date=${date}`).then(setHandoffs); api(`/api/checklists?date=${date}`).then(setLists); };
  useEffect(load, [date]);
  if (ctx.route === 'shift/account') return <Account ctx={ctx} />;
  if (!handoffs || !lists) return <Loading />;
  const post = async () => {
    try { await api('/api/handoffs', { body: { date, shift, note } }); setNote(''); load(); say(lang === 'es' ? '✓ Nota guardada' : '✓ Handoff saved'); } catch (e) { say((e as Error).message); }
  };
  const tick = async (cl: string, item: string, done: boolean) => { await api('/api/checklists/tick', { body: { date, checklist_id: cl, item_id: item, done } }); load(); };
  return (
    <div className="stack">
      <h1 style={{ fontSize: 28 }}><Bi en="Shift handoff" es="Entrega de turno" /></h1>
      <div className="card stack">
        <div className="seg">{(['open', 'mid', 'close'] as const).map((s) => <button key={s} aria-pressed={shift === s} onClick={() => setShift(s)}>{{ open: lang === 'es' ? 'Apertura' : 'Opening', mid: lang === 'es' ? 'Medio' : 'Mid', close: lang === 'es' ? 'Cierre' : 'Closing' }[s]}</button>)}</div>
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Handoff note"
          placeholder={lang === 'es' ? 'Qué quedó pendiente, qué se acabó, qué debe saber el siguiente turno…' : 'What’s left, what ran out, what the next shift needs to know…'} />
        <div className="row wrap">{(lang === 'es' ? ['Se acabó un sabor', 'Pedido grande', 'Equipo falla', 'Faltan insumos'] : ['Ran out of a flavor', 'Big order coming', 'Equipment issue', 'Supplies low']).map((q) =>
          <button key={q} className="btn sm" onClick={() => setNote((n) => (n ? n + ' ' : '') + q + ': ')}>+ {q}</button>)}</div>
        <button className="btn primary" onClick={post} disabled={!note.trim()}><Bi en="Save handoff" es="Guardar nota" inline /></button>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}><Bi en="Last 7 days" es="Últimos 7 días" /></h2>
        {handoffs.length === 0 ? <p className="muted small">No notes yet.</p> : handoffs.map((h) => <div key={h.id} style={{ padding: '10px 0', borderBottom: '1px dashed var(--line)' }}>
          <div className="xs faint"><b>{h.author}</b> · {h.date} · {h.shift}</div><div>{h.note}</div></div>)}
      </div>
      {lists.map((l) => {
        const done = new Set(l.ticks.map((t: any) => t.item_id));
        return (
          <div key={l.id} className="card stack">
            <div className="row"><h2 className="grow"><Bi en={`${l.name} checklist`} es={`Lista de ${l.name_es?.toLowerCase()}`} /></h2>{l.status === 'draft' ? <span className="pill warn">Draft — needs manager approval</span> : <span className="pill ok">Approved</span>}<span className="pill">{done.size}/{l.items.length}</span></div>
            {l.items.map((it: any) => (
              <label key={it.id} className="row" style={{ alignItems: 'flex-start', cursor: 'pointer', padding: '6px 0' }}>
                <button className="check" style={{ width: 36, height: 36, borderRadius: 10, border: '2.5px solid var(--line)', background: done.has(it.id) ? 'var(--dill)' : 'var(--paper)', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }} aria-pressed={done.has(it.id)} onClick={() => tick(l.id, it.id, !done.has(it.id))}>{done.has(it.id) && <span style={{ width: 20, height: 20 }}>{Icon.check}</span>}</button>
                <span><Bi en={it.text} es={it.text_es} /><span className="xs faint"> · {it.station}</span></span>
              </label>))}
          </div>
        );
      })}
      {toast}
    </div>
  );
}

export function Account({ ctx }: { ctx: AppCtx }) {
  const [cur, setCur] = useState(''); const [nx, setNx] = useState(''); const [msg, setMsg] = useState('');
  const pin = ctx.user.role === 'crew' || ctx.user.role === 'lead';
  const save = async () => { try { await api('/api/me', { method: 'PUT', body: { current: cur, next: nx } }); setMsg('Saved. Other sessions were signed out.'); setCur(''); setNx(''); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div className="card stack" style={{ maxWidth: 480 }}>
      <h2>Change {pin ? 'PIN' : 'password'}</h2>
      <div className="field"><label>Current</label><input className="input" type="password" inputMode={pin ? 'numeric' : undefined} value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <div className="field"><label>New {pin ? '(4–8 digits)' : '(10+ characters)'}</label><input className="input" type="password" inputMode={pin ? 'numeric' : undefined} value={nx} onChange={(e) => setNx(e.target.value)} /></div>
      <button className="btn primary" onClick={save} disabled={!cur || !nx}>Save</button>
      {msg && <div className="alert info">{msg}</div>}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, can, cachePlan, cachedPlan, type Figure } from '../api';
import type { AppCtx } from '../App';
import { Bi, BiKey, useLang, useT } from '../i18n';
import { Fig, FlavorChip, Prov, Sheet, Icon, Loading, ErrorBox, fmt, useToast } from '../components/ui';

export type Plan = any;
const STATION: Record<string, [string, string]> = { oven: ['Oven', 'Horno'], prep: ['Prep', 'Preparación'], eggs: ['Eggs', 'Huevos'], line: ['Line', 'Línea'], close: ['Close-out', 'Cierre'], lead: ['Lead', 'Encargado'] };
export const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nice = (d: string, lang: string) => { const x = new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); return x.charAt(0).toUpperCase() + x.slice(1); };

export function usePlan(date: string) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState<number | null>(null);
  const reload = useCallback(async () => {
    try { const p = await api(`/api/plan?date=${date}`); setPlan(p); setStale(null); setError(null); cachePlan(date, p); }
    catch (e) { const c = cachedPlan(date); if (c) { setPlan(c.plan); setStale(c.at); } else setError(e); }
  }, [date]);
  useEffect(() => { setPlan(null); reload(); }, [reload]);
  return { plan, error, reload, stale };
}

export function Rail({ ctx }: { ctx: AppCtx }) {
  const lang = useLang();
  const t = useT();
  const [date, setDate] = useState(ctx.meta.today);
  const { plan, error, reload, stale } = usePlan(date);
  const [open, setOpen] = useState<any>(null);
  const [toast, say] = useToast();
  const [section, setSection] = useState<string | null>(null);

  const toggle = async (tk: any) => {
    const next = tk.status === 'done' ? null : 'done';
    tk.status = next; // optimistic
    try { await api('/api/tickets/status', { body: { date, key: tk.key, status: next } }); say(next ? (lang === 'es' ? '✓ Hecho · Done' : '✓ Done') : (lang === 'es' ? 'Reabierto · Reopened' : 'Reopened')); reload(); }
    catch (e) { say((e as Error).message); reload(); }
  };

  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn sm ghost" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">{Icon.chevL}</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800 }}>{nice(date, lang)}</div>{lang === 'es' && <div className="xs faint">{nice(date, 'en')}</div>}
          {date !== ctx.meta.today && <button className="btn sm ghost" style={{ minHeight: 28 }} onClick={() => setDate(ctx.meta.today)}><BiKey k="today" /></button>}
        </div>
        <button className="btn sm ghost" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">{Icon.chevR}</button>
      </div>
      {stale && <div className="alert watch"><b>Offline — showing the plan saved {new Date(stale).toLocaleTimeString()}</b>Ticks will not save until the connection is back.</div>}
      {!plan ? <Loading /> : <>
        <DayHeader plan={plan} />
        <Alerts plan={plan} />
        <PreviousShift plan={plan} />
        {plan.tickets.length === 0 ? <div className="card empty">{t('noTickets')}</div> : <RailGroups plan={plan} onToggle={toggle} onOpen={setOpen} />}
        <div className="card">
          <div className="kicker" style={{ marginBottom: 8 }}><Bi en="The numbers behind the rail" es="Los números detrás del rail" inline /></div>
          <div className="row wrap">
            {[['bagels', 'Bagels by flavor', 'Bagels por sabor'], ['pull', 'Freezer pull', 'Retiro del congelador'], ['sandwiches', 'Sandwiches', 'Sándwiches'], ['proteins', 'Proteins & prep', 'Proteínas y prep'], ['cream', 'Cream cheese', 'Queso crema'], ['outlook', 'Next days', 'Próximos días']].map(([k, en, es]) =>
              <button key={k} className="btn sm" onClick={() => setSection(k)}><Bi en={en} es={es} inline /></button>)}
          </div>
        </div>
        <Sheet open={!!section} onClose={() => setSection(null)}>{section && <PlanSection plan={plan} which={section} />}</Sheet>
        <TicketSheet ctx={ctx} date={date} ticket={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />
      </>}
      {toast}
    </div>
  );
}

export function DayHeader({ plan }: { plan: Plan }) {
  const t = useT();
  const lang = useLang();
  const tot: Figure = plan.bagels.total;
  return (
    <section className="dayhead" aria-label="Today at a glance">
      <div className="row wrap" style={{ position: 'relative', zIndex: 1 }}>
        <span className="when">{lang === 'es' ? plan.weekday_es.toUpperCase() : plan.weekday.toUpperCase()} · {plan.date}</span>
        {plan.holiday && <span className="holiday-badge">★ {lang === 'es' ? plan.holiday.name_es : plan.holiday.name}</span>}
      </div>
      <div style={{ position: 'relative', zIndex: 1, marginTop: 10 }}>
        <div className="kicker" style={{ color: 'rgba(244,237,225,.65)' }}><Bi en="Bagels to bake" es="Bagels para hornear" inline /></div>
        {plan.closedLikely ? <div className="num big" style={{ fontSize: 40 }}>—<span style={{ fontSize: 18, marginLeft: 10, fontWeight: 600 }}><Bi en="likely closed · confirm" es="probablemente cerrado · confirma" inline /></span></div> : <>
          <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
            <span className="num big">{fmt(plan.bagels.bakeTotal)}</span>
            <span className="range" style={{ paddingBottom: 8 }}>{t('range')} {fmt(tot.lo)}–{fmt(tot.hi)}<br />≈ {plan.bagels.trays.toFixed(0)} trays{plan.bagels.cateringBagels ? ` · ${plan.bagels.cateringBagels} catering` : ''}</span>
          </div>
        </>}
        <div style={{ marginTop: 6 }}><Prov kind={plan.closedLikely ? 'missing' : 'forecast'} title={tot.basis} /></div>
      </div>
      <div className="stats">
        <div className="stat"><span className="num">{fmt(plan.sandwiches.total.value)}</span><span>{t('sandwiches')}</span></div>
        <div className="stat"><span className="num">{fmt(plan.proteins.baconCook.value)}</span><span>{t('bacon')}</span></div>
        <div className="stat"><span className="num">{fmt(plan.proteins.sausageCook.value)}</span><span>{t('sausage')}</span></div>
        <div className="stat"><span className="num">{fmt(plan.proteins.shellEggs.value)}</span><span>{t('eggs')}</span></div>
      </div>
    </section>
  );
}

export function Alerts({ plan, all }: { plan: Plan; all?: boolean }) {
  const lang = useLang();
  const [showInfo, setShowInfo] = useState(!!all);
  const main = plan.alerts.filter((a: any) => a.level !== 'info');
  const info = plan.alerts.filter((a: any) => a.level === 'info');
  if (!plan.alerts.length) return null;
  return (
    <div className="stack" aria-label="Alerts">
      {main.map((a: any, i: number) => <div key={i} className={`alert ${a.level}`}><b><Bi en={a.title} es={a.title_es} inline /></b><span className="small muted">{lang === 'es' && a.body_es ? <>{a.body_es}<br /><span className="faint">{a.body}</span></> : a.body}</span></div>)}
      {info.length > 0 && (showInfo
        ? info.map((a: any, i: number) => <div key={i} className="alert info"><b><Bi en={a.title} es={a.title_es} inline /></b><span className="small muted">{lang === 'es' && a.body_es ? a.body_es : a.body}</span></div>)
        : <button className="btn sm ghost" onClick={() => setShowInfo(true)}>+ {info.length} <Bi en="more notes" es="notas más" inline /></button>)}
    </div>
  );
}

function PreviousShift({ plan }: { plan: Plan }) {
  const t = useT();
  const { tickets, handoffs } = plan.previous;
  if (!tickets.length && !handoffs.length) return <div className="card small muted"><b>{t('previous')}</b> · <Bi en="No ticks or handoff notes recorded yesterday." es="No hay tickets ni notas de ayer." inline /></div>;
  const done = tickets.filter((x: any) => x.status === 'done').length;
  return (
    <div className="card">
      <div className="row"><b className="grow">{t('previous')} · {plan.previous.date}</b><span className="pill ok">{done} ✓</span>{tickets.length - done > 0 && <span className="pill warn">{tickets.length - done} skipped</span>}</div>
      {handoffs.slice(0, 2).map((h: any) => <p key={h.id} className="small" style={{ margin: '8px 0 0' }}><b>{h.author}</b> <span className="faint">({h.shift})</span>: {h.note}</p>)}
    </div>
  );
}

function RailGroups({ plan, onToggle, onOpen }: { plan: Plan; onToggle: (t: any) => void; onOpen: (t: any) => void }) {
  const lang = useLang();
  const groups: [string, any[]][] = [];
  for (const tk of plan.tickets) {
    const k = `${tk.due}|${tk.station}`;
    const g = groups.find(([gk]) => gk === k);
    if (g) g[1].push(tk); else groups.push([k, [tk]]);
  }
  return <>{groups.map(([k, list]) => {
    const [due, station] = k.split('|');
    const done = list.filter((x) => x.status === 'done').length;
    return (
      <section key={k} className="railgroup" aria-label={`${due} ${station}`}>
        <div className="railhead"><span className="time">{due}</span><span className="station">{lang === 'es' ? `${STATION[station][1]} · ${STATION[station][0]}` : STATION[station][0]}</span><span className="prog">{done}/{list.length}</span></div>
        <div className="railbar" />
        <div className="tickets">{list.map((tk, i) => <TicketView key={tk.key} tk={tk} first={i === 0} onToggle={onToggle} onOpen={onOpen} />)}</div>
      </section>
    );
  })}</>;
}

function TicketView({ tk, first, onToggle, onOpen }: { tk: any; first: boolean; onToggle: (t: any) => void; onOpen: (t: any) => void }) {
  const lang = useLang();
  const flavor = tk.key.startsWith('bake:') || tk.key.startsWith('pull:') ? tk.key.split(':')[1] : null;
  const qty = tk.adjusted ? tk.adjusted.qty : tk.qty;
  return (
    <article className={`ticket ${first ? 'first' : ''} ${tk.status === 'done' ? 'done' : ''}`}>
      <button className="check" aria-pressed={tk.status === 'done'} aria-label={`${tk.status === 'done' ? 'Undo' : 'Mark done'}: ${tk.title}`} onClick={() => onToggle(tk)}>{Icon.check}</button>
      <div style={{ minWidth: 0 }} onClick={() => onOpen(tk)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(tk)}>
        <div className="row" style={{ gap: 8 }}>{flavor && flavor !== 'second' && <FlavorChip name={flavor} size={26} />}<div className="t-title">{lang === 'es' ? tk.title_es : tk.title}</div></div>
        {lang === 'es' && <div className="t-es" style={{ fontStyle: 'normal' }}>{tk.title}</div>}
        <div className="t-detail">{lang === 'es' ? tk.detail_es : tk.detail}</div>
        {lang === 'es' && <div className="t-detail faint xs">{tk.detail}</div>}
        {tk.adjusted && <div className="adj">✎ {tk.adjusted.by}: {tk.adjusted.reason} (plan {fmt(tk.qty)})</div>}
      </div>
      <div className="qty" onClick={() => onOpen(tk)}>
        {qty !== null && <><span className="num">{fmt(qty)}</span><span className="unit">{lang === 'es' ? tk.unit_es : tk.unit}</span></>}
        <button className="more" aria-label="Details">{Icon.dots}</button>
      </div>
    </article>
  );
}

function TicketSheet({ ctx, date, ticket, onClose, onChanged }: { ctx: AppCtx; date: string; ticket: any; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const lang = useLang();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setQty(ticket?.adjusted?.qty?.toString() ?? ticket?.qty?.toString() ?? ''); setReason(ticket?.adjusted?.reason ?? ''); setErr(''); }, [ticket]);
  if (!ticket) return null;
  const f: Figure = ticket.figure;
  const save = async (clear = false) => {
    try { await api('/api/tickets/adjust', { body: { date, key: ticket.key, qty: clear ? null : Number(qty), reason } }); onChanged(); }
    catch (e) { setErr((e as Error).message); }
  };
  const setStatus = async (status: string | null) => { await api('/api/tickets/status', { body: { date, key: ticket.key, status } }); onChanged(); };
  return (
    <Sheet open onClose={onClose} title={<Bi en={ticket.title} es={ticket.title_es} />}>
      <div className="stack">
        <div className="card">
          <div className="kicker">{t('why')}</div>
          {f.value !== null ? <div style={{ margin: '6px 0' }}><Fig f={f} big /></div> : <div style={{ margin: '6px 0' }}><Prov kind={f.kind} /></div>}
          <p className="small" style={{ margin: 0 }}>{f.basis || (lang === 'es' ? ticket.detail_es : ticket.detail)}</p>
          {ticket.detail && f.basis && <p className="small muted" style={{ margin: '8px 0 0' }}>{lang === 'es' ? ticket.detail_es : ticket.detail}</p>}
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => setStatus(ticket.status === 'done' ? null : 'done')}>{ticket.status === 'done' ? t('undo') : t('markDone')}</button>
          <button className="btn" onClick={() => setStatus('skipped')}>{t('skip')}</button>
        </div>
        {can(ctx.user, 'lead') && ticket.qty !== null && <div className="card stack">
          <div className="kicker">{t('adjust')} · <Bi en="lead and above, recorded in the audit log" es="encargado o más, queda registrado" inline /></div>
          <div className="row"><input className="input" style={{ maxWidth: 140 }} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} aria-label="New quantity" /><span className="muted">{ticket.unit}</span></div>
          <input className="input" placeholder={lang === 'es' ? 'Motivo (p. ej. pedido grande confirmado)' : 'Reason (e.g. confirmed large order)'} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('reason')} />
          <div className="row"><button className="btn ink" onClick={() => save()} disabled={!qty || reason.trim().length < 3}>{t('save')}</button>{ticket.adjusted && <button className="btn" onClick={() => save(true)}>Revert to plan</button>}</div>
          {err && <div className="alert act">{err}</div>}
        </div>}
      </div>
    </Sheet>
  );
}

/** Detailed plan tables — shared by the crew sheet and the Ledger. */
export function PlanSection({ plan, which }: { plan: Plan; which: string }) {
  const lang = useLang();
  if (which === 'bagels') return <div className="stack">
    <h2><Bi en="Bake by flavor" es="Hornear por sabor" /></h2>
    <p className="small muted">{plan.bagels.total.basis}</p>
    <div className="scroll-x"><table className="table"><thead><tr><th>Flavor</th><th className="r">Bake</th><th className="r">Range</th><th className="r">Catering</th><th className="r">Trays</th></tr></thead><tbody>
      {Object.entries(plan.bagels.bake).filter(([, f]: any) => f.value > 0 || f.hi > 0).map(([k, f]: any) => <tr key={k}><td><span className="row" style={{ gap: 8 }}><FlavorChip name={k} size={24} />{k}</span></td><td className="r num">{fmt(f.value)}</td><td className="r faint">{fmt(f.lo)}–{fmt(f.hi)}</td><td className="r">{f.catering || ''}</td><td className="r">{f.trays.toFixed(1)}</td></tr>)}
      <tr><td><b>Total</b></td><td className="r num">{fmt(plan.bagels.bakeTotal)}</td><td className="r faint">{fmt(plan.bagels.total.lo)}–{fmt(plan.bagels.total.hi)}</td><td className="r">{plan.bagels.cateringBagels || ''}</td><td className="r">{plan.bagels.trays.toFixed(1)}</td></tr>
    </tbody></table></div>
    <p className="xs faint">Physical bagels already include sandwich bagels, dozens and half-dozens — sandwiches are never added on top. <Prov kind="forecast" /> walk-in & online · <Prov kind="known" /> booked catering.</p>
  </div>;
  if (which === 'pull') return <div className="stack">
    <h2><Bi en={`Freezer pull for ${plan.pull.forDate}`} es={`Sacar del congelador para ${plan.pull.forDate}`} /></h2>
    {plan.pull.skipped?.length > 0 && <div className="alert watch">Skipping {plan.pull.skipped.join(', ')}.</div>}
    <div className="scroll-x"><table className="table"><thead><tr><th>Flavor</th><th className="r">Pull</th><th className="r">≈ boxes</th><th className="r">Thawed left</th></tr></thead><tbody>
      {Object.entries(plan.pull.flavors).map(([k, f]: any) => <tr key={k}><td><span className="row" style={{ gap: 8 }}><FlavorChip name={k} size={24} />{k}</span></td><td className="r num">{fmt(f.value)}</td><td className="r">{f.boxes.toFixed(2)}</td><td className="r">{fmt(f.carry)} <Prov kind={f.carryKind} /></td></tr>)}
    </tbody></table></div>
    <p className="xs faint">Pull = next open day’s upper range + booked catering − thawed stock left over. Enter a thawed count on the Count tab to replace the estimate.</p>
  </div>;
  if (which === 'sandwiches') return <div className="stack">
    <h2><Bi en="Expected sandwiches" es="Sándwiches esperados" /></h2>
    <p className="small muted"><Fig f={plan.sandwiches.total} /> · {plan.sandwiches.total.basis}</p>
    <table className="table"><thead><tr><th>Sandwich</th><th className="r">Expected</th><th className="r">Range</th></tr></thead><tbody>
      {plan.sandwiches.items.map((s: any) => <tr key={s.item} title={s.figure.basis}><td>{s.item}{!s.recipe_id && <span className="faint xs"> · no card</span>}</td><td className="r num">{fmt(s.figure.value)}</td><td className="r faint">{fmt(s.figure.lo)}–{fmt(s.figure.hi)}</td></tr>)}
    </tbody></table>
  </div>;
  if (which === 'proteins') return <div className="stack">
    <h2><Bi en="Proteins, eggs & line prep" es="Proteínas, huevo y preparación" /></h2>
    <table className="table"><tbody>
      {[['Bacon strips', 'Tiras de tocino', plan.proteins.baconCook], ['Sausage patties', 'Medallones', plan.proteins.sausageCook], ['Prepared egg (oz)', 'Huevo preparado (oz)', plan.proteins.eggOz], ['Shell eggs', 'Huevos enteros', plan.proteins.shellEggs]].map(([en, es, f]: any) =>
        <tr key={en}><td><Bi en={en} es={es} /></td><td className="r"><Fig f={f} /></td></tr>)}
      {plan.other.map((o: any) => <tr key={o.key} title={o.figure.basis}><td><Bi en={o.label} es={o.label_es} /></td><td className="r"><Fig f={o.figure} /></td></tr>)}
    </tbody></table>
    <p className="xs faint">{plan.proteins.bacon.basis}</p>
  </div>;
  if (which === 'cream') return <div className="stack">
    <h2><Bi en="Cream cheese: make, mix & pack" es="Queso crema: preparar, mezclar y empacar" /></h2>
    <div className="only-narrow" style={{ display: 'grid', gap: 8 }}>{plan.cream.map((c: any) => <div key={c.flavor} className="card" style={{ padding: 12 }}>
      <div className="row"><b className="grow">{c.flavor}</b>{c.onHandLb.value === null ? <Prov kind="missing" title={c.onHandLb.basis} /> : <span className="small">on hand {fmt(c.onHandLb.value, 1)} lb</span>}</div>
      <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <div><div className="xs faint"><Bi en="Make" es="Preparar" inline /></div><span className="num" style={{ fontSize: 26 }}>{fmt(c.toMakeLb.value, 1)}</span> <span className="xs faint">lb{c.batches ? ` · ${c.batches}×` : ''}</span></div>
        <div><div className="xs faint"><Bi en="Pack 8 oz" es="Empacar 8 oz" inline /></div><span className="num" style={{ fontSize: 26 }}>{fmt(c.tubsToPack.value)}</span></div>
        <div><div className="xs faint"><Bi en="Use today" es="Uso hoy" inline /></div><span className="num" style={{ fontSize: 20 }}>{fmt(c.ozToday.value)}</span> <span className="xs faint">oz</span></div>
      </div></div>)}</div>
    <div className="scroll-x only-wide"><table className="table"><thead><tr><th>Flavor</th><th className="r">Use today</th><th className="r">8 oz tubs to pack</th><th className="r">Need (lb)</th><th className="r">On hand</th><th className="r">Make</th></tr></thead><tbody>
      {plan.cream.map((c: any) => <tr key={c.flavor}><td>{c.flavor}{!c.share8Known && <span title="8 oz vs 4 oz split unknown for this flavor — uses the overall split"> <Prov kind="assumption" /></span>}</td>
        <td className="r" title={c.ozToday.basis}>{fmt(c.ozToday.value)} oz</td><td className="r num" title={c.tubsToPack.basis}>{fmt(c.tubsToPack.value)}</td><td className="r">{fmt(c.bulkNeedLb.value, 1)}</td>
        <td className="r">{c.onHandLb.value === null ? <Prov kind="missing" title={c.onHandLb.basis} /> : fmt(c.onHandLb.value, 1)}</td><td className="r num">{fmt(c.toMakeLb.value, 1)}{c.batches ? <span className="faint xs"> · {c.batches} batch</span> : ''}</td></tr>)}
    </tbody></table></div>
    <p className="xs faint">2 oz per bagel served with cream cheese <Prov kind="verified" title="Confirmed by management" />. Plain base is made Monday & Friday, so Plain covers until the next base day. Retail tubs and loose stock are the same product in two states — packed tubs are not counted again as loose stock. {lang === 'es' ? 'Nunca extiendas la fecha límite de una etiqueta.' : 'Never extend a labelled use-by date.'}</p>
  </div>;
  if (which === 'outlook') return <div className="stack">
    <h2><Bi en="Next days" es="Próximos días" /></h2>
    <table className="table"><tbody>{plan.outlook.map((o: any) => <tr key={o.date}><td><b>{o.weekday}</b> <span className="faint">{o.date}</span>{o.holiday && <span className="pill warn" style={{ marginLeft: 6 }}>{o.holiday}</span>}</td><td className="r"><Fig f={o.total} /></td></tr>)}</tbody></table>
  </div>;
  return null;
}

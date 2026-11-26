import { useEffect, useMemo, useState } from 'react';
import { api, can } from '../api';
import type { AppCtx } from '../App';
import { UserMenu } from '../App';
import { Logo, Loading, Fig, Prov, fmt, FlavorChip } from '../components/ui';
import { SeriesChart, Bars, type Pt } from '../components/charts';
import { DayHeader, Alerts, PlanSection, usePlan, addDays } from '../screens/Rail';
import { Ask } from '../screens/Ask';
import { Account } from '../screens/Shift';
import { Catering, Inventory, Assumptions, Imports, Recipes, Training, People, Audit, Backups } from './Admin';

const NAV: [string, string, string, 'manager' | 'owner'][] = [
  ['Plan', 'today', 'Today', 'manager'], ['Plan', 'forecast', 'Forecast & accuracy', 'manager'], ['Plan', 'catering', 'Catering', 'manager'],
  ['Kitchen', 'inventory', 'Inventory & waste', 'manager'], ['Kitchen', 'recipes', 'Recipes & checklists', 'manager'], ['Kitchen', 'training', 'Training', 'manager'],
  ['Data', 'history', 'History', 'manager'], ['Data', 'assumptions', 'Assumptions', 'manager'], ['Data', 'imports', 'Toast imports', 'manager'],
  ['Admin', 'people', 'People & roles', 'owner'], ['Admin', 'audit', 'Audit log', 'owner'], ['Admin', 'backups', 'Backups & export', 'manager'],
  ['', 'ask', 'Ask B’s', 'manager'],
];

export function Ledger({ ctx }: { ctx: AppCtx }) {
  const page = ctx.route.split('/')[1] || 'today';
  let lastGroup = '';
  return (
    <div className="ledger">
      <aside className="side">
        <div className="row"><Logo size={36} light /><div><div className="brand-word">The Ledger</div><div className="brand-sub">B’s Bagels · planning</div></div></div>
        <nav aria-label="Ledger">
          {NAV.filter(([, , , r]) => can(ctx.user, r)).map(([g, id, label]) => {
            const head = g && g !== lastGroup ? <div className="navgroup" key={'g' + g}>{g}</div> : null; lastGroup = g;
            return [head, <a key={id} href={`#ledger/${id}`} aria-current={page === id ? 'page' : undefined}>{label}</a>];
          })}
          <div className="navgroup">Kitchen view</div>
          <a href="#rail">Open the crew Rail →</a>
        </nav>
      </aside>
      <main className="main">
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
          <span className="small faint grow">Toast bagel history through <b>{ctx.meta.historyEnd}</b>{ctx.meta.salesEnd && <> · sales through <b>{ctx.meta.salesEnd}</b></>} · model {ctx.meta.model}</span>
          <UserMenu ctx={ctx} />
        </div>
        {page === 'today' && <Today ctx={ctx} />}
        {page === 'forecast' && <Forecast ctx={ctx} />}
        {page === 'history' && <History ctx={ctx} />}
        {page === 'catering' && <Catering ctx={ctx} />}
        {page === 'inventory' && <Inventory ctx={ctx} />}
        {page === 'recipes' && <Recipes ctx={ctx} />}
        {page === 'training' && <Training ctx={ctx} />}
        {page === 'assumptions' && <Assumptions ctx={ctx} />}
        {page === 'imports' && <Imports ctx={ctx} />}
        {page === 'people' && <People ctx={ctx} />}
        {page === 'audit' && <Audit ctx={ctx} />}
        {page === 'backups' && <Backups ctx={ctx} />}
        {page === 'ask' && <div style={{ maxWidth: 820 }}><Ask ctx={ctx} /></div>}
        {page === 'account' && <Account ctx={ctx} />}
      </main>
    </div>
  );
}

function Today({ ctx }: { ctx: AppCtx }) {
  const [date, setDate] = useState(ctx.meta.today);
  const { plan } = usePlan(date);
  return (
    <div className="stack">
      <div className="row wrap">
        <h1 className="grow">Production plan</h1>
        <button className="btn sm" onClick={() => setDate(addDays(date, -1))}>←</button>
        <input type="date" className="input" style={{ width: 180 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Plan date" />
        <button className="btn sm" onClick={() => setDate(addDays(date, 1))}>→</button>
        {date !== ctx.meta.today && <button className="btn sm" onClick={() => setDate(ctx.meta.today)}>Today</button>}
      </div>
      {!plan ? <Loading /> : <>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <DayHeader plan={plan} />
            <div className="card"><PlanSection plan={plan} which="bagels" /></div>
            <div className="card"><PlanSection plan={plan} which="sandwiches" /></div>
          </div>
          <div className="stack">
            <Alerts plan={plan} />
            <div className="card"><PlanSection plan={plan} which="pull" /></div>
            <div className="card"><PlanSection plan={plan} which="proteins" /></div>
            <div className="card"><PlanSection plan={plan} which="outlook" /></div>
          </div>
        </div>
        <div className="card"><PlanSection plan={plan} which="cream" /></div>
        <div className="card">
          <h2>Assumptions shaping this plan</h2>
          <table className="table"><tbody>{plan.assumptionsUsed.map((a: any) => <tr key={a.key}><td>{a.label}</td><td className="r num">{a.value} {a.unit}</td><td className="r"><Prov kind="assumption" /></td></tr>)}</tbody></table>
          <a href="#ledger/assumptions" className="small">Review & confirm →</a>
        </div>
      </>}
    </div>
  );
}

function Forecast({ ctx }: { ctx: AppCtx }) {
  const [acc, setAcc] = useState<any>(null);
  const [from, setFrom] = useState(addDays(ctx.meta.historyEnd, -91));
  const [to, setTo] = useState(ctx.meta.historyEnd);
  const [future, setFuture] = useState<any[] | null>(null);
  useEffect(() => { setAcc(null); api(`/api/accuracy?from=${from}&to=${to}`).then(setAcc); }, [from, to]);
  useEffect(() => {
    api(`/api/outlook?from=${ctx.meta.today}&days=14`).then(setFuture);
  }, [ctx.meta.today]);
  const pts: Pt[] = useMemo(() => acc ? acc.rows.map((r: any) => ({ date: r.date, actual: r.actual, forecast: r.model })) : [], [acc]);
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  return (
    <div className="stack">
      <h1>Forecast & accuracy</h1>
      <div className="card">
        <div className="row wrap" style={{ marginBottom: 10 }}><h2 className="grow">Next 14 days</h2><span className="small faint">Forecasts extrapolate from Toast data through {ctx.meta.historyEnd}</span></div>
        {!future ? <Loading label="Forecasting…" /> : <div className="scroll-x"><table className="table"><thead><tr><th>Date</th><th className="r">Bagels</th><th className="r">Range</th><th className="r">Sandwiches</th><th className="r">Bacon</th><th className="r">Sausage</th><th className="r">Eggs</th></tr></thead><tbody>
          {future.map((f) => <tr key={f.date}><td><b>{f.weekday.slice(0, 3)}</b> {f.date}{f.holiday && <span className={`pill ${f.closed ? 'bad' : 'warn'}`} style={{ marginLeft: 6 }}>{f.holiday}{f.closed ? ' · likely closed' : ''}</span>}</td>
            <td className="r num">{fmt(f.total.value)}</td><td className="r faint">{f.total.lo != null ? `${fmt(f.total.lo)}–${fmt(f.total.hi)}` : '—'}</td><td className="r">{fmt(f.sandwiches)}</td><td className="r">{fmt(f.bacon)}</td><td className="r">{fmt(f.sausage)}</td><td className="r">{fmt(f.eggs)}</td></tr>)}
        </tbody></table></div>}
      </div>
      <div className="card stack">
        <div className="row wrap"><h2 className="grow">Walk-forward backtest</h2>
          <input type="date" className="input" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" className="input" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div>
        <p className="small muted">Each day is forecast using only data from before it. Error = weighted absolute percentage error (WAPE): Σ|actual − forecast| ÷ Σ actual. Days with no Toast record are skipped, not scored as zero.</p>
        {!acc ? <Loading label="Running backtest…" /> : <>
          <div className="grid3">
            {acc.scores.map((s: any) => <div key={s.segment} className="card kpi"><div className="kicker">{s.segment} · {s.model.n} days</div><span className="num">{pct(s.model.wape)}</span>
              <div className="small muted">avg-of-8 {pct(s.avg8.wape)} · last week {pct(s.lastWeek.wape)}</div></div>)}
          </div>
          <SeriesChart data={pts} labelForecast="Model forecast (made the day before)" />
          <div className="grid2">
            <div><h3 style={{ margin: '6px 0 10px' }}>Error by weekday (model)</h3><Bars rows={acc.byWeekday.map((w: any) => ({ label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][w.dow], value: +(w.model.wape * 100).toFixed(1), sub: `avg8 ${(w.avg8.wape * 100).toFixed(1)}%` }))} unit="%" /></div>
            <div><h3 style={{ margin: '6px 0 10px' }}>Bias</h3><p className="num" style={{ fontSize: 30, margin: 0 }}>{acc.bias > 0 ? '+' : ''}{pct(acc.bias)}</p><p className="small muted">Positive = the model over-forecast on balance. Weekday misses are mostly unannounced bulk orders — enter known large orders as catering so they become known demand.</p></div>
          </div>
          {acc.snapshots.length > 0 && <><h3>Saved forecasts vs what happened</h3><table className="table"><thead><tr><th>Date</th><th className="r">Forecast</th><th className="r">Range</th><th className="r">Actual</th></tr></thead><tbody>
            {acc.snapshots.map((s: any) => <tr key={s.target_date + s.made_on}><td>{s.target_date} <span className="faint xs">made with data to {s.made_on}</span></td><td className="r">{fmt(s.total_point)}</td><td className="r faint">{fmt(s.total_lo)}–{fmt(s.total_hi)}</td><td className="r">{s.actual == null ? <Prov kind="missing" title="Import Toast data for this date to score it" /> : fmt(s.actual)}</td></tr>)}</tbody></table></>}
        </>}
      </div>
    </div>
  );
}

function History({ ctx }: { ctx: AppCtx }) {
  const [to, setTo] = useState(ctx.meta.historyEnd);
  const [from, setFrom] = useState(addDays(ctx.meta.historyEnd, -83));
  const [flavor, setFlavor] = useState('');
  const [data, setData] = useState<any>(null);
  const [sales, setSales] = useState<any[] | null>(null);
  const [cmp, setCmp] = useState<any>(null);
  useEffect(() => { setData(null); api(`/api/history/bagels?from=${from}&to=${to}`).then(setData); if (can(ctx.user, 'manager')) api(`/api/history/sales?from=${from}&to=${to}`).then(setSales); }, [from, to]);
  const pts: Pt[] = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, number>();
    if (flavor) for (const f of data.flavors) if (f.flavor === flavor) byDate.set(f.date, f.units);
    return data.days.map((d: any) => ({ date: d.date, actual: d.status !== 'recorded' ? null : flavor ? (byDate.get(d.date) ?? 0) : d.total, note: d.note ?? undefined }));
  }, [data, flavor]);
  const mix = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, number>(); let tot = 0;
    for (const f of data.flavors) { m.set(f.flavor, (m.get(f.flavor) ?? 0) + f.units); tot += f.units; }
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: +(v / tot * 100).toFixed(1), sub: `(${fmt(v)})` }));
  }, [data]);
  const rec = data ? data.days.filter((d: any) => d.status === 'recorded') : [];
  const lastYear = () => { setCmp(null); const a = { from, to }, b = { from: addDays(from, -364), to: addDays(to, -364) };
    Promise.all([api(`/api/history/bagels?from=${a.from}&to=${a.to}`), api(`/api/history/bagels?from=${b.from}&to=${b.to}`)]).then(([x, y]) => {
      const s = (d: any) => { const r = d.days.filter((z: any) => z.status === 'recorded'); const sum = flavor ? d.flavors.filter((f: any) => f.flavor === flavor).reduce((q: number, f: any) => q + f.units, 0) : r.reduce((q: number, z: any) => q + z.total, 0); return { sum, n: r.length, avg: r.length ? sum / r.length : null, missing: d.days.length - r.length }; };
      setCmp({ a: { ...a, ...s(x) }, b: { ...b, ...s(y) } }); }); };
  return (
    <div className="stack">
      <h1>History explorer</h1>
      <div className="card row wrap">
        <div className="field"><label>From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><label>Flavor</label><select className="input" value={flavor} onChange={(e) => setFlavor(e.target.value)}><option value="">All flavors</option>{ctx.meta.flavors.map((f) => <option key={f.name}>{f.name}</option>)}</select></div>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={lastYear}>Compare with same days last year</button>
      </div>
      {!data ? <Loading /> : <>
        <div className="grid4">
          <div className="card kpi"><div className="kicker">Bagels {flavor && `· ${flavor}`}</div><span className="num">{fmt(pts.reduce((a, p) => a + (p.actual ?? 0), 0))}</span><Prov kind="verified" /></div>
          <div className="card kpi"><div className="kicker">Recorded days</div><span className="num">{rec.length}</span><span className="small muted">of {data.days.length} in range</span></div>
          <div className="card kpi"><div className="kicker">Avg per recorded day</div><span className="num">{fmt(pts.reduce((a, p) => a + (p.actual ?? 0), 0) / Math.max(1, rec.length))}</span></div>
          <div className="card kpi"><div className="kicker">Days without records</div><span className="num">{data.days.length - rec.length}</span><span className="small muted">unknown, not zero</span></div>
        </div>
        {cmp && <div className="card"><h2>This range vs last year</h2><table className="table"><thead><tr><th>Range</th><th className="r">Bagels</th><th className="r">Recorded days</th><th className="r">Avg / day</th></tr></thead><tbody>
          {[cmp.a, cmp.b].map((r: any) => <tr key={r.from}><td>{r.from} → {r.to}</td><td className="r num">{fmt(r.sum)}</td><td className="r">{r.n}{r.missing ? <span className="faint xs"> ({r.missing} missing)</span> : ''}</td><td className="r">{fmt(r.avg)}</td></tr>)}
          <tr><td><b>Change in daily average</b></td><td /><td /><td className="r num">{cmp.a.avg && cmp.b.avg ? `${((cmp.a.avg / cmp.b.avg - 1) * 100).toFixed(1)}%` : '—'}</td></tr></tbody></table>
          <p className="xs faint">Compares 364 days earlier so weekdays line up. Averages use recorded days only.</p></div>}
        <div className="card"><h2 style={{ marginBottom: 8 }}>Daily physical bagels {flavor && `· ${flavor}`}</h2><SeriesChart data={pts} /></div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="card"><h2 style={{ marginBottom: 10 }}>Flavor mix in range</h2><Bars rows={mix} unit="%" /></div>
          {sales && <div className="card"><h2 style={{ marginBottom: 8 }}>Net sales <Prov kind="verified" /></h2>
            <SeriesChart data={sales.map((s) => ({ date: s.date, actual: s.status === 'actual' ? Math.round(s.net_sales) : null }))} labelActual="Net sales $ (Toast)" height={200} />
            <p className="xs faint">Manager-only. Daily sales exports currently end {ctx.meta.salesEnd}.</p></div>}
        </div>
        <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 800 }}>Table view</summary>
          <div className="scroll-x" style={{ maxHeight: 420, overflowY: 'auto' }}><table className="table"><thead><tr><th>Date</th><th>Status</th><th className="r">Bagels</th></tr></thead><tbody>{data.days.map((d: any) => <tr key={d.date}><td>{d.date}</td><td>{d.status === 'recorded' ? <Prov kind="verified" /> : <Prov kind="missing" title={d.note} />}</td><td className="r">{d.total ?? '—'}</td></tr>)}</tbody></table></div>
        </details>
      </>}
    </div>
  );
}

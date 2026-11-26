import { useEffect, useState } from 'react';
import { api, can } from '../api';
import type { AppCtx } from '../App';
import { Loading, Prov, fmt, useToast, Sheet } from '../components/ui';
import { BuildCard } from '../screens/Cards';
import { addDays } from '../screens/Rail';

const FLAVORS = ['Plain', 'Everything', 'Sesame', 'Cinnamon Raisin', 'Blueberry', 'Onion', 'Rainbow', 'Pumpernickel', 'Poppy', 'Whole Wheat', 'Whole Wheat Everything', 'GF Plain', 'GF Everything', 'Assorted'];

// ── Catering ───────────────────────────────────────────────────────────────
export function Catering({ ctx }: { ctx: AppCtx }) {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [toast, say] = useToast();
  const load = () => api(`/api/catering?from=${addDays(ctx.meta.today, -14)}`).then(setOrders);
  useEffect(() => { load(); }, []);
  const blank = { date: ctx.meta.today, ready_by: '07:30', label: '', bagels: {}, sandwiches: {}, spreads: {}, notes: '', status: 'confirmed' };
  const save = async () => {
    try {
      if (edit.id) await api(`/api/catering/${edit.id}`, { method: 'PUT', body: edit }); else await api('/api/catering', { body: edit });
      setEdit(null); load(); say('Saved — included in that day’s bake and pull');
    } catch (e) { say((e as Error).message); }
  };
  const parse = (o: any) => ({ ...o, bagels: JSON.parse(o.bagels_json), sandwiches: JSON.parse(o.sandwiches_json), spreads: JSON.parse(o.spreads_json) });
  if (!orders) return <Loading />;
  return (
    <div className="stack">
      <div className="row"><h1 className="grow">Catering & large orders</h1><button className="btn primary" onClick={() => setEdit(blank)}>+ New order</button></div>
      <p className="small muted">Toast history excludes catering bundles, so booked orders are added on top of the forecast — never double counted. Record any large pre-order here and it becomes known demand on the rail.</p>
      <div className="card"><table className="table"><thead><tr><th>Date</th><th>Ready</th><th>Order</th><th className="r">Bagels</th><th>Status</th><th /></tr></thead><tbody>
        {orders.length === 0 && <tr><td colSpan={6} className="empty">No upcoming orders.</td></tr>}
        {orders.map((o) => { const p = parse(o); return <tr key={o.id}><td>{o.date}</td><td>{o.ready_by}</td><td><b>{o.label}</b><div className="xs faint">{Object.entries(p.bagels).map(([k, v]) => `${v} ${k}`).join(' · ')}</div></td><td className="r num">{fmt(Object.values(p.bagels as Record<string, number>).reduce((a, b) => a + b, 0))}</td>
          <td><span className={`pill ${o.status === 'confirmed' ? 'ok' : o.status === 'cancelled' ? 'bad' : 'warn'}`}>{o.status}</span></td><td><button className="btn sm" onClick={() => setEdit(p)}>Edit</button></td></tr>; })}
      </tbody></table></div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit order' : 'New catering order'}>
        {edit && <div className="stack">
          <div className="row wrap">
            <div className="field grow"><label>Date</label><input type="date" className="input" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></div>
            <div className="field"><label>Ready by</label><input type="time" className="input" value={edit.ready_by ?? ''} onChange={(e) => setEdit({ ...edit, ready_by: e.target.value })} /></div>
            <div className="field"><label>Status</label><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{['tentative', 'confirmed', 'done', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select></div>
          </div>
          <div className="field"><label>Reference (no personal details needed)</label><input className="input" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="e.g. Office breakfast #2231" /></div>
          <div className="field"><label>Bagels by flavor (Assorted is split by the day’s mix)</label>
            <div className="grid2">{FLAVORS.map((f) => <div key={f} className="row"><span className="grow small">{f}</span><input className="input" style={{ width: 90, minHeight: 40 }} inputMode="numeric" value={edit.bagels[f] ?? ''} onChange={(e) => setEdit({ ...edit, bagels: { ...edit.bagels, [f]: +e.target.value || 0 } })} aria-label={`${f} bagels`} /></div>)}</div></div>
          <div className="field"><label>Cream cheese (oz by flavor)</label><div className="grid2">{['Plain', 'Knock Out', 'Cinnamon Sugar', 'Jalapeño Cheddar', 'Strawberry', 'Veggie'].map((f) => <div key={f} className="row"><span className="grow small">{f}</span><input className="input" style={{ width: 90, minHeight: 40 }} inputMode="numeric" value={edit.spreads[f] ?? ''} onChange={(e) => setEdit({ ...edit, spreads: { ...edit.spreads, [f]: +e.target.value || 0 } })} /></div>)}</div></div>
          <div className="field"><label>Notes</label><textarea className="input" value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
          <button className="btn primary" onClick={save} disabled={!edit.label}>Save order</button>
        </div>}
      </Sheet>
      {toast}
    </div>
  );
}

// ── Inventory & waste ──────────────────────────────────────────────────────
export function Inventory({ ctx }: { ctx: AppCtx }) {
  const [inv, setInv] = useState<any[] | null>(null);
  const [waste, setWaste] = useState<any[] | null>(null);
  const [frozen, setFrozen] = useState<Record<string, string>>({});
  const [toast, say] = useToast();
  const load = () => { api('/api/inventory').then(setInv); api(`/api/waste?date=${ctx.meta.today}`).then(setWaste); };
  useEffect(load, []);
  const saveFrozen = async () => {
    const counts = Object.entries(frozen).filter(([, v]) => v !== '').map(([item, v]) => ({ item, state: 'frozen', qty: +v, unit: 'bagels' }));
    if (!counts.length) return;
    await api('/api/inventory', { body: { date: ctx.meta.today, counts } }); setFrozen({}); load(); say('Freezer counts saved');
  };
  if (!inv || !waste) return <Loading />;
  const frozenRows = inv.filter((r) => r.state === 'frozen');
  const frozenTotal = frozenRows.reduce((a, r) => a + r.qty, 0);
  return (
    <div className="stack">
      <h1>Inventory & waste</h1>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <h2>Freezer count (bagels)</h2>
          <p className="small muted">Regular pallet = 40 boxes × 72 = 2,880 bagels. Gluten-free stock is counted separately. Without a count, freezer coverage stays <Prov kind="missing" />.</p>
          <div className="grid2">{FLAVORS.filter((f) => f !== 'Assorted').map((f) => <div key={f} className="row"><span className="grow small">{f}<br /><span className="xs faint">{(() => { const r = frozenRows.find((x) => x.item === f); return r ? `${fmt(r.qty)} on ${r.business_date}` : 'not counted'; })()}</span></span><input className="input" style={{ width: 90, minHeight: 40 }} inputMode="numeric" value={frozen[f] ?? ''} onChange={(e) => setFrozen({ ...frozen, [f]: e.target.value.replace(/\D/g, '') })} aria-label={`${f} frozen`} /></div>)}</div>
          <button className="btn ink" onClick={saveFrozen}>Save freezer count</button>
          {frozenRows.length > 0 && <p className="small"><b>{fmt(frozenTotal)}</b> frozen bagels counted ≈ {(frozenTotal / 72).toFixed(1)} boxes.</p>}
        </div>
        <div className="card"><h2>Latest counts</h2><div className="scroll-x" style={{ maxHeight: 460, overflowY: 'auto' }}><table className="table"><thead><tr><th>Item</th><th>State</th><th className="r">Qty</th><th>When</th></tr></thead><tbody>
          {inv.length === 0 && <tr><td colSpan={4} className="empty">Nothing counted yet.</td></tr>}
          {inv.map((r) => <tr key={r.id}><td>{r.item}</td><td>{r.state}</td><td className="r num">{fmt(r.qty, 1)} <span className="xs faint">{r.unit}</span></td><td className="xs faint">{r.business_date} · {r.who}</td></tr>)}</tbody></table></div></div>
      </div>
      <div className="card"><h2>Waste — last 14 days</h2><table className="table"><thead><tr><th>Date</th><th>Item</th><th className="r">Qty</th><th>Reason</th><th>By</th>{can(ctx.user, 'lead') && <th />}</tr></thead><tbody>
        {waste.length === 0 && <tr><td colSpan={6} className="empty">No waste logged.</td></tr>}
        {waste.map((w) => <tr key={w.id}><td>{w.date}</td><td>{w.item}</td><td className="r">{fmt(w.qty)} {w.unit}</td><td>{w.reason.replace(/_/g, ' ')}</td><td className="xs faint">{w.who}</td><td><button className="btn sm ghost" onClick={async () => { const reason = prompt('Reason for removing this entry?'); if (reason) { await api(`/api/waste/${w.id}`, { method: 'DELETE', body: { reason } }); load(); } }}>Remove</button></td></tr>)}
      </tbody></table><p className="xs faint">Toast-logged waste is part of the imported history; this log captures what Toast doesn’t (end-of-day, burnt, expired).</p></div>
      {toast}
    </div>
  );
}

// ── Assumptions ────────────────────────────────────────────────────────────
export function Assumptions({ ctx: _ctx }: { ctx: AppCtx }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [toast, say] = useToast();
  const load = () => api('/api/assumptions').then(setRows);
  useEffect(() => { load(); }, []);
  if (!rows) return <Loading />;
  const save = async () => { try { await api(`/api/assumptions/${edit.key}`, { method: 'PUT', body: { value: +edit.value, status: edit.status, basis: edit.basis, reason: edit.reason } }); setEdit(null); load(); say('Saved — plans update immediately; change is in the audit log'); } catch (e) { say((e as Error).message); } };
  const cats = [...new Set(rows.map((r) => r.category))];
  return (
    <div className="stack">
      <h1>Assumptions register</h1>
      <p className="small muted">Every planning input that isn’t in the data lives here with an owner and a reason. <Prov kind="verified" /> confirmed facts · <Prov kind="assumption" /> working assumptions shown wherever they shape a number.</p>
      {cats.map((c) => <div key={c} className="card"><h2 style={{ textTransform: 'capitalize', marginBottom: 6 }}>{c.replace(/_/g, ' ')}</h2><table className="table"><tbody>
        {rows.filter((r) => r.category === c).map((r) => <tr key={r.key}><td style={{ width: '42%' }}><b>{r.label}</b><div className="xs faint">{r.label_es}</div></td><td className="r num" style={{ whiteSpace: 'nowrap' }}>{r.value} {r.unit}</td><td><Prov kind={r.status === 'confirmed' ? 'verified' : 'assumption'} /></td><td className="small muted">{r.basis}<div className="xs faint">{r.updated_by} · {r.updated_at?.slice(0, 10)}</div></td><td><button className="btn sm" onClick={() => setEdit({ ...r, reason: '' })}>Edit</button></td></tr>)}
      </tbody></table></div>)}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.label}>
        {edit && <div className="stack">
          <div className="row"><input className="input" style={{ width: 140 }} inputMode="decimal" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} aria-label="Value" /><span>{edit.unit}</span></div>
          <div className="seg"><button aria-pressed={edit.status === 'assumption'} onClick={() => setEdit({ ...edit, status: 'assumption' })}>Assumption</button><button aria-pressed={edit.status === 'confirmed'} onClick={() => setEdit({ ...edit, status: 'confirmed' })}>Confirmed by management</button></div>
          <div className="field"><label>Basis / source</label><textarea className="input" value={edit.basis ?? ''} onChange={(e) => setEdit({ ...edit, basis: e.target.value })} /></div>
          <div className="field"><label>Reason for change (audit log)</label><input className="input" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></div>
          <button className="btn primary" onClick={save} disabled={edit.reason.trim().length < 3}>Save</button>
        </div>}
      </Sheet>
      {toast}
    </div>
  );
}

// ── Imports ────────────────────────────────────────────────────────────────
export function Imports({ ctx: _ctx }: { ctx: AppCtx }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pv, setPv] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sources, setSources] = useState<any[] | null>(null);
  const [result, setResult] = useState<any>(null);
  const load = () => api('/api/sources').then(setSources);
  useEffect(() => { load(); }, []);
  const pick = async (f: File) => {
    setPv(null); setErr(''); setResult(null);
    const text = await f.text(); setFile({ name: f.name, text });
    try { setPv(await api('/api/imports/preview', { body: { filename: f.name, content: text } })); } catch (e) { setErr((e as Error).message); }
  };
  const apply = async (replace: boolean) => { try { const r = await api('/api/imports/apply', { body: { filename: file!.name, content: file!.text, replace } }); setResult(r); load(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="stack">
      <h1>Toast imports</h1>
      <div className="card stack">
        <p className="small">Upload a Toast export as CSV: <b>Item Selection Details</b> (daily items), <b>Modifier Selection Details</b> (daily bagel flavors, spreads, add-ons — the feed that drives forecasts), or <b>Sales by day</b> (net sales & orders). Files are hashed: the same file never imports twice, and dates that already have data are replaced only after you confirm.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} aria-label="Choose a Toast CSV export" />
        {err && <div className="alert act">{err}</div>}
        {pv && <div className="card">
          <h3>{pv.filename} — {pv.kind.replace(/_/g, ' ')}</h3>
          <p className="small">{pv.rows} rows ({pv.voidRows} voided, excluded) · dates {pv.dates[0]} → {pv.dates.at(-1)} ({pv.dates.length} days){pv.summary.bagelUnits !== undefined && <> · <b>{fmt(pv.summary.bagelUnits)}</b> physical bagels</>}{pv.summary.itemUnits !== undefined && <> · {fmt(pv.summary.itemUnits)} item units</>}</p>
          {pv.warnings.map((w: string) => <div key={w} className="alert watch">{w}</div>)}
          {pv.duplicateFile ? <div className="alert info">This exact file was already imported.</div> : <div className="row wrap">
            {pv.overlap.length > 0 ? <><div className="alert watch grow">{pv.overlap.length} of these dates already have data ({pv.overlap.slice(0, 4).join(', ')}{pv.overlap.length > 4 ? '…' : ''}). Replacing is logged and reversible from a backup.</div><button className="btn primary" onClick={() => apply(true)}>Replace & import</button></>
              : <button className="btn primary" onClick={() => apply(false)}>Import</button>}
          </div>}
        </div>}
        {result && <div className={`alert ${result.applied ? 'info' : 'watch'}`}><b>{result.applied ? 'Imported' : 'Not imported'}</b>{result.reason ?? `Source ${result.sourceId}. Forecasts now use the new history.`}</div>}
      </div>
      <div className="card"><h2>Source register</h2><div className="scroll-x"><table className="table"><thead><tr><th>Source</th><th>Kind</th><th>Period</th><th className="r">Rows</th><th>Imported</th></tr></thead><tbody>
        {(sources ?? []).map((s) => <tr key={s.id}><td><b>{s.label}</b><div className="xs faint">{s.filename} · sha256 {s.sha256?.slice(0, 12)}…</div></td><td className="small">{s.kind}</td><td className="small">{s.period_start ?? '—'} → {s.period_end ?? '—'}</td><td className="r">{fmt(s.row_count)}</td><td className="xs faint">{s.imported_at?.slice(0, 16)} · {s.imported_by}</td></tr>)}
      </tbody></table></div></div>
    </div>
  );
}

// ── Recipes & checklists ───────────────────────────────────────────────────
export function Recipes({ ctx }: { ctx: AppCtx }) {
  const [recipes, setRecipes] = useState<any[] | null>(null);
  const [lists, setLists] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [toast, say] = useToast();
  const load = () => { api('/api/recipes').then(setRecipes); api(`/api/checklists?date=${ctx.meta.today}`).then(setLists); };
  useEffect(load, []);
  if (!recipes || !lists) return <Loading />;
  const setStatus = async (r: any, status: string) => { const note = status === 'approved' ? 'Approved by manager' : r.status_note; await api(`/api/recipes/${r.id}`, { method: 'PUT', body: { status, status_note: note } }); load(); say('Recipe status updated'); };
  const approve = async (l: any) => { await api(`/api/checklists/${l.id}`, { method: 'PUT', body: { status: l.status === 'approved' ? 'draft' : 'approved' } }); load(); };
  return (
    <div className="stack">
      <h1>Recipes & checklists</h1>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card"><h2 style={{ marginBottom: 8 }}>Build-card library</h2><table className="table"><tbody>
          {recipes.map((r) => <tr key={r.id}><td><button className="btn ghost sm" onClick={() => setSel(r)} style={{ padding: 0 }}><b>{r.name}</b></button><div className="xs faint">{r.toast_items ?? (r.kind === 'method' ? 'method' : 'no Toast item linked')}</div></td>
            <td>{r.status === 'approved' ? <span className="pill ok">approved</span> : r.status === 'needs_confirmation' ? <span className="pill warn" title={r.status_note}>confirm</span> : <span className="pill">from PDF</span>}</td>
            <td>{r.status !== 'approved' && <button className="btn sm" onClick={() => setStatus(r, 'approved')}>Approve</button>}</td></tr>)}
        </tbody></table></div>
        <div className="stack">{lists.map((l) => <div key={l.id} className="card stack">
          <div className="row"><h2 className="grow">{l.name} checklist</h2><button className="btn sm" onClick={() => approve(l)}>{l.status === 'approved' ? 'Return to draft' : 'Approve'}</button></div>
          {l.status === 'draft' && <div className="alert watch small">Draft built from manual excerpts only — review every line before approving.</div>}
          <ol style={{ margin: 0, paddingLeft: 20 }}>{l.items.map((it: any) => <li key={it.id} className="small" style={{ marginBottom: 6 }}>{it.text}<div className="xs faint">{it.text_es}</div></li>)}</ol>
        </div>)}</div>
      </div>
      <Sheet open={!!sel} onClose={() => setSel(null)}>{sel && <BuildCard r={sel} />}</Sheet>
      {toast}
    </div>
  );
}

// ── Training ───────────────────────────────────────────────────────────────
export function Training({ ctx: _ctx }: { ctx: AppCtx }) {
  const [d, setD] = useState<any>(null);
  const load = () => api('/api/training').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;
  const has = (u: number, r: string) => d.signoffs.find((s: any) => s.user_id === u && s.recipe_id === r);
  const toggle = async (u: number, r: string) => { await api('/api/training/signoff', { body: { user_id: u, recipe_id: r, signed: !has(u, r) } }); load(); };
  return (
    <div className="stack">
      <h1>Training sign-off</h1>
      <p className="small muted">A lead signs off when a crew member builds the item to card standard. Click a cell to sign or un-sign; every change is audited.</p>
      <div className="card scroll-x"><table className="table"><thead><tr><th>Card</th>{d.users.map((u: any) => <th key={u.id} className="r">{u.display_name}</th>)}</tr></thead><tbody>
        {d.recipes.map((r: any) => <tr key={r.id}><td>{r.name}</td>{d.users.map((u: any) => { const s = has(u.id, r.id); return <td key={u.id} className="r"><button className="btn sm" style={{ minWidth: 44, background: s ? 'var(--dill)' : undefined, color: s ? '#fff' : undefined }} onClick={() => toggle(u.id, r.id)} title={s ? `Signed by ${s.signer} ${s.at.slice(0, 10)}` : 'Not signed'} aria-label={`${r.name} for ${u.display_name}`}>{s ? '✓' : '·'}</button></td>; })}</tr>)}
      </tbody></table></div>
    </div>
  );
}

// ── People (owner) ─────────────────────────────────────────────────────────
export function People({ ctx: _ctx }: { ctx: AppCtx }) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [nu, setNu] = useState({ username: '', display_name: '', role: 'crew', secret: '', lang: 'en', station: '' });
  const [msg, say] = useToast();
  const load = () => api('/api/users').then(setUsers);
  useEffect(() => { load(); }, []);
  if (!users) return <Loading />;
  const create = async () => { try { await api('/api/users', { body: nu }); setNu({ ...nu, username: '', display_name: '', secret: '' }); load(); say('User created'); } catch (e) { say((e as Error).message); } };
  const upd = async (id: number, body: any) => { try { await api(`/api/users/${id}`, { method: 'PUT', body }); load(); say('Updated — their sessions were signed out'); } catch (e) { say((e as Error).message); } };
  return (
    <div className="stack">
      <h1>People & roles</h1>
      <div className="card"><table className="table"><thead><tr><th>Name</th><th>Role</th><th>Lang</th><th>Status</th><th /></tr></thead><tbody>
        {users.map((u) => <tr key={u.id} style={{ opacity: u.active ? 1 : .5 }}><td><b>{u.display_name}</b><div className="xs faint">{u.username}{u.station ? ` · ${u.station}` : ''}</div></td>
          <td><select className="input" style={{ minHeight: 38, width: 130 }} value={u.role} onChange={(e) => upd(u.id, { role: e.target.value })}>{['crew', 'lead', 'manager', 'owner'].map((r) => <option key={r}>{r}</option>)}</select></td>
          <td>{u.lang}</td><td>{u.active ? <span className="pill ok">active</span> : <span className="pill">inactive</span>}</td>
          <td className="row"><button className="btn sm" onClick={() => { const s = prompt(u.role === 'crew' || u.role === 'lead' ? 'New PIN (4–8 digits)' : 'New password (10+ chars)'); if (s) upd(u.id, { secret: s }); }}>Reset</button><button className="btn sm" onClick={() => upd(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>)}
      </tbody></table></div>
      <div className="card stack" style={{ maxWidth: 640 }}>
        <h2>Add a person</h2>
        <div className="grid2">
          <div className="field"><label>Username</label><input className="input" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /></div>
          <div className="field"><label>Display name</label><input className="input" value={nu.display_name} onChange={(e) => setNu({ ...nu, display_name: e.target.value })} /></div>
          <div className="field"><label>Role</label><select className="input" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>{['crew', 'lead', 'manager', 'owner'].map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="field"><label>{nu.role === 'crew' || nu.role === 'lead' ? 'PIN (4–8 digits)' : 'Password (10+ chars)'}</label><input className="input" type="password" value={nu.secret} onChange={(e) => setNu({ ...nu, secret: e.target.value })} /></div>
          <div className="field"><label>Language</label><select className="input" value={nu.lang} onChange={(e) => setNu({ ...nu, lang: e.target.value })}><option value="en">English</option><option value="es">Español</option></select></div>
          <div className="field"><label>Station</label><select className="input" value={nu.station} onChange={(e) => setNu({ ...nu, station: e.target.value })}><option value="">—</option>{['oven', 'prep', 'eggs', 'line'].map((s) => <option key={s}>{s}</option>)}</select></div>
        </div>
        <button className="btn primary" onClick={create} disabled={!nu.username || !nu.secret}>Create</button>
      </div>
      {msg}
    </div>
  );
}

// ── Audit (owner) ──────────────────────────────────────────────────────────
export function Audit({ ctx: _ctx }: { ctx: AppCtx }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api(`/api/audit?limit=300${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setRows); }, [q]);
  return (
    <div className="stack">
      <div className="row"><h1 className="grow">Audit log</h1><input className="input" style={{ width: 260 }} placeholder="Filter by action (e.g. assumption)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!rows ? <Loading /> : <div className="card scroll-x"><table className="table"><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Entity</th><th>Change</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td className="xs">{r.at.slice(0, 19).replace('T', ' ')}</td><td>{r.username}</td><td><code className="xs">{r.action}</code></td><td className="xs">{r.entity} {r.entity_id}</td>
          <td className="xs" style={{ maxWidth: 420, wordBreak: 'break-word' }}>{r.before_json && <div className="faint">before: {r.before_json.slice(0, 200)}</div>}{r.after_json && <div>after: {r.after_json.slice(0, 200)}</div>}{r.reason && <div><b>reason:</b> {r.reason}</div>}</td></tr>)}
      </tbody></table></div>}
    </div>
  );
}

// ── Backups & export ───────────────────────────────────────────────────────
export function Backups({ ctx }: { ctx: AppCtx }) {
  const owner = can(ctx.user, 'owner');
  const [list, setList] = useState<any[] | null>(null);
  const [toast, say] = useToast();
  const load = () => owner ? api('/api/backups').then(setList) : setList([]);
  useEffect(() => { load(); }, []);
  const make = async () => { const r = await api('/api/backups', { body: { label: 'manual' } }); say(`Backup ${r.name} created`); load(); };
  const restore = async (n: string) => { const c = prompt(`Restoring replaces ALL current data with ${n}.\nA safety backup is taken first.\nType the backup name to confirm:`); if (c !== n) return; const r = await api(`/api/backups/${n}/restore`, { body: { confirm: c } }); alert(`Restored. Safety backup: ${r.safetyBackup}. Reloading.`); location.reload(); };
  const tables = ['bagel_day', 'bagel_daily', 'daily_sales', 'item_monthly', 'item_daily', 'assumptions', 'inventory_counts', 'catering_orders', 'waste_log', 'handoffs', 'ticket_status', 'plan_adjustments', 'forecast_snapshots', 'recipes', 'sources'];
  return (
    <div className="stack">
      <h1>Backups & export</h1>
      {owner && <div className="card stack">
        <div className="row"><h2 className="grow">Database backups</h2><button className="btn primary" onClick={make}>Back up now</button></div>
        <p className="small muted">An automatic snapshot is taken daily. Restoring takes a safety snapshot first, so a restore can itself be undone. Store downloaded backups somewhere private — they contain confidential sales and recipe data.</p>
        {!list ? <Loading /> : <table className="table"><tbody>{list.map((b) => <tr key={b.name}><td><code className="xs">{b.name}</code></td><td className="r small">{(b.bytes / 1e6).toFixed(1)} MB</td><td className="row"><a className="btn sm" href={`/api/backups/${b.name}`}>Download</a><button className="btn sm" onClick={() => restore(b.name)}>Restore…</button></td></tr>)}</tbody></table>}
      </div>}
      <div className="card stack">
        <h2>Export data (CSV)</h2>
        <p className="small muted">Exports are recorded in the audit log.</p>
        <div className="row wrap">{tables.map((t) => <a key={t} className="btn sm" href={`/api/export/${t}.csv`}>{t}</a>)}</div>
      </div>
      {toast}
    </div>
  );
}

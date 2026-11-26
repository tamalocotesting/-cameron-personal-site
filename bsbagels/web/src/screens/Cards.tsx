import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AppCtx } from '../App';
import { Bi, useLang } from '../i18n';
import { Loading, Prov } from '../components/ui';

export function Cards({ ctx: _ctx }: { ctx: AppCtx }) {
  const lang = useLang();
  const [recipes, setRecipes] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { api('/api/recipes').then(setRecipes); }, []);
  const list = useMemo(() => (recipes ?? []).filter((r) => !q || `${r.name} ${r.name_es} ${r.toast_items ?? ''}`.toLowerCase().includes(q.toLowerCase())), [recipes, q]);
  if (!recipes) return <Loading />;
  const r = recipes.find((x) => x.id === sel);
  if (r) return <BuildCard r={r} onBack={() => setSel(null)} />;
  return (
    <div className="stack">
      <h1 style={{ fontSize: 28 }}><Bi en="Build cards" es="Guías de preparación" /></h1>
      <input className="input" placeholder={lang === 'es' ? 'Buscar · Search' : 'Search sandwiches & methods'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <div style={{ display: 'grid', gap: 10 }}>
        {list.map((x) => (
          <button key={x.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 4 }} onClick={() => setSel(x.id)}>
            <div className="row"><b className="grow" style={{ fontSize: 19, fontFamily: 'var(--font-display)' }}>{x.name}</b>{x.kind === 'method' && <span className="pill">Method</span>}{x.status === 'needs_confirmation' && <span className="pill warn">Confirm</span>}{x.signoff && <span className="pill ok">✓ trained</span>}</div>
            <span className="small muted" style={{ fontStyle: 'italic' }}>{x.name_es}</span>
            <span className="xs faint">{x.headline}</span>
          </button>
        ))}
      </div>
      <p className="xs faint">Transcribed from B’s build-card PDFs. Spanish on the cards is B’s own wording. Portions marked “Confirm” differ between sources — follow the current approved card.</p>
    </div>
  );
}

function Photo({ id, name }: { id: string; name: string }) {
  const [ext, setExt] = useState(0);
  const exts = ['jpg', 'png', 'webp'];
  return <div className="photo-slot">{ext < exts.length
    ? <img src={`/photos/${id}.${exts[ext]}`} alt={`${name} — B’s photo`} onError={() => setExt(ext + 1)} />
    : <span>B’s photo goes here<br /><span className="xs">Save it as assets/photos/{id}.jpg on the server (photos were not included in the data kit).</span></span>}</div>;
}

export function BuildCard({ r, onBack }: { r: any; onBack?: () => void }) {
  const lang = useLang();
  const es = lang === 'es';
  return (
    <div className="stack">
      {onBack && <button className="btn sm ghost" onClick={onBack} style={{ alignSelf: 'flex-start' }}>← <Bi en="All cards" es="Todas las guías" inline /></button>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '18px 18px 14px' }}>
          <div className="kicker" style={{ color: '#E7A867' }}>{r.kind === 'method' ? 'Method card · Guía de procedimiento' : 'Build card · Guía de preparación'}</div>
          <h1 style={{ fontSize: 32, marginTop: 6 }}>{r.name}</h1>
          <div style={{ fontStyle: 'italic', opacity: .8 }}>{r.name_es}</div>
          <div className="small" style={{ marginTop: 10, fontWeight: 700 }}>{r.headline}</div>
          {r.headline_es && <div className="small" style={{ opacity: .75 }}>{r.headline_es}</div>}
        </div>
        <div style={{ padding: 16 }}>
          <Photo id={r.id} name={r.name} />
          {r.status === 'needs_confirmation' && <div className="alert watch" style={{ marginTop: 12 }}><b>Needs confirmation · Por confirmar</b><span className="small">{r.status_note}</span></div>}
          <div style={{ marginTop: 8 }}>
            {r.steps.map((s: any) => (
              <div key={s.n} className="bc-step">
                <div className="bc-n">{s.n}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{es ? s.title_es : s.title}{' '}{s.amount && <span className="bc-amt">{es ? s.amount_es : s.amount}</span>}</div>
                  <div className="small faint" style={{ fontWeight: 700 }}>{es ? s.title : s.title_es}{s.amount && ` · ${es ? s.amount : s.amount_es}`}</div>
                  <div style={{ marginTop: 4 }}>{es ? s.body_es : s.body}</div>
                  <div className="small muted" style={{ fontStyle: 'italic' }}>{es ? s.body : s.body_es}</div>
                </div>
              </div>
            ))}
          </div>
          {r.components.length > 0 && <>
            <hr className="soft" />
            <div className="kicker"><Bi en="Portions used for planning" es="Porciones para planear" inline /></div>
            <div className="row wrap" style={{ marginTop: 8 }}>{r.components.map((c: any) => <span key={c.component} className="pill">{c.component.replace(/_/g, ' ')}: {c.qty ?? '?'} {c.qty === null && <Prov kind="assumption" title={`Uses assumption ${c.assumption_key}`} />}</span>)}</div>
          </>}
        </div>
      </div>
    </div>
  );
}

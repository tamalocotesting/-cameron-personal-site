import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AppCtx } from '../App';
import { Bi, useLang } from '../i18n';

interface Turn { role: 'user' | 'assistant'; content: string; sources?: any[]; stop?: string }

const SUGGEST: Record<string, [string, string][]> = {
  crew: [['How many Everything do I bake today?', '¿Cuántos Everything horneo hoy?'], ['What goes on a Rise & Grind?', '¿Qué lleva un Rise & Grind?'], ['How much bacon should I cook?', '¿Cuánto tocino cocino?']],
  manager: [['Compare Saturday bagels in October 2026 vs October 2025', ''], ['What did we sell over Thanksgiving week last year?', ''], ['How accurate was the forecast in September?', ''], ['Which assumptions are still unconfirmed?', '']],
};

export function Ask({ ctx, compact }: { ctx: AppCtx; compact?: boolean }) {
  const lang = useLang();
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem('ask') ?? '[]'); } catch { return []; } });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem('ask', JSON.stringify(turns.slice(-30))); } catch { /* ignore */ } end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns]);
  const send = async (text = q) => {
    if (!text.trim() || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text.trim() }];
    setTurns(next); setQ(''); setBusy(true);
    try {
      const r = await api('/api/ask', { body: { history: next.map(({ role, content }) => ({ role, content })) } });
      setTurns([...next, { role: 'assistant', content: r.answer, sources: r.sources, stop: r.stop }]);
    } catch (e) { setTurns([...next, { role: 'assistant', content: `Error: ${(e as Error).message}` }]); }
    finally { setBusy(false); }
  };
  const sugg = SUGGEST[ctx.user.role === 'manager' || ctx.user.role === 'owner' ? 'manager' : 'crew'];
  return (
    <div className="stack">
      {!compact && <h1 style={{ fontSize: 28 }}><Bi en="Ask B’s" es="Pregúntale a B’s" /></h1>}
      {!ctx.meta.assistantConfigured && <div className="alert watch"><b>Assistant not configured</b><span className="small">An owner needs to set ANTHROPIC_API_KEY on the server (see docs/AI_ASSISTANT.md).</span></div>}
      <p className="small muted"><Bi en="Answers come from your shop’s records and calculations — with sources. If the data isn’t there, it says so." es="Las respuestas salen de los registros de la tienda, con fuentes. Si no hay datos, lo dice." /></p>
      {turns.length === 0 && <div className="row wrap">{sugg.map(([en, es]) => <button key={en} className="btn sm" onClick={() => send(lang === 'es' && es ? es : en)}>{lang === 'es' && es ? es : en}</button>)}</div>}
      <div className="stack">
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role === 'user' ? 'user' : 'bot'}`}>
            {t.content}
            {t.sources && t.sources.length > 0 && <details className="srcs"><summary className="xs faint" style={{ cursor: 'pointer' }}>Sources & steps ({t.sources.length})</summary>
              {t.sources.map((s, j) => <div key={j}><code>{s.tool}({JSON.stringify(s.input)})</code>{s.error ? <span className="xs" style={{ color: 'var(--tomato)' }}> {s.error}</span> : <span className="xs faint"> → {s.sources.join('; ')}</span>}</div>)}
            </details>}
          </div>))}
        {busy && <div className="bubble bot faint">Looking it up…</div>}
        <div ref={end} />
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(); }} style={{ position: compact ? 'static' : 'sticky', bottom: compact ? undefined : 96 }}>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'es' ? 'Escribe tu pregunta…' : 'Ask about today, history, recipes…'} aria-label="Question" />
        <button className="btn primary" disabled={busy || !q.trim()}>Ask</button>
        {turns.length > 0 && <button type="button" className="btn ghost" onClick={() => setTurns([])}>Clear</button>}
      </form>
    </div>
  );
}

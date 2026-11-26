import { useCallback, useEffect, useState } from 'react';
import { api, setCsrf, can, type User } from './api';
import { LangCtx, type Lang, enOf, esOf } from './i18n';
import { Icon, Logo, Loading } from './components/ui';
import { Login } from './screens/Login';
import { Rail } from './screens/Rail';
import { Cards } from './screens/Cards';
import { Count } from './screens/Count';
import { Shift } from './screens/Shift';
import { Ask } from './screens/Ask';
import { Ledger } from './ledger/Ledger';

export interface Meta { today: string; historyEnd: string; salesEnd?: string; model: string; assistantConfigured: boolean; assistantModel: string; flavors: { name: string; name_es: string; short: string; gluten_free: number; active: number }[] }
export interface AppCtx { user: User; meta: Meta; lang: Lang; setLang: (l: Lang) => void; logout: () => void; go: (r: string) => void; route: string }

function useHashRoute(): [string, (r: string) => void] {
  const [r, setR] = useState(() => location.hash.slice(1) || '');
  useEffect(() => { const f = () => setR(location.hash.slice(1)); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return [r, (n: string) => { location.hash = n; }];
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [lang, setLangState] = useState<Lang>('en');
  const [route, go] = useHashRoute();

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: User; csrf: string }>('/api/me');
      setCsrf(me.csrf); setUser(me.user); setLangState(me.user.lang);
      setMeta(await api<Meta>('/api/meta'));
    } catch { setUser(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = (l: Lang) => { setLangState(l); api('/api/me', { method: 'PUT', body: { lang: l } }).catch(() => {}); };
  const logout = async () => { await api('/api/logout', { method: 'POST', body: {} }).catch(() => {}); setCsrf(''); setUser(null); go(''); };

  if (user === undefined) return <Loading />;
  if (!user) return <LangCtx.Provider value={lang}><Login onDone={load} lang={lang} setLang={setLangState} /></LangCtx.Provider>;
  if (!meta) return <Loading />;
  const ctx: AppCtx = { user, meta, lang, setLang, logout, go, route };
  const wantsLedger = route.startsWith('ledger') || (route === '' && can(user, 'manager') && window.innerWidth >= 900);
  return (
    <LangCtx.Provider value={lang}>
      {wantsLedger && can(user, 'manager') ? <Ledger ctx={ctx} /> : <CrewShell ctx={ctx} />}
    </LangCtx.Provider>
  );
}

function CrewShell({ ctx }: { ctx: AppCtx }) {
  const tab = ctx.route.split('/')[0] || 'rail';
  const tabs: [string, keyof typeof Icon, Parameters<typeof enOf>[0]][] = [['rail', 'rail', 'rail'], ['cards', 'cards', 'cards'], ['count', 'count', 'count'], ['shift', 'shift', 'shift'], ['ask', 'ask', 'ask']];
  return (
    <>
      <header className="top">
        <div className="row">
          <div className="brand grow"><Logo size={32} /><div><div className="brand-word">The Rail</div><div className="brand-sub hide-narrow">B’s Bagels · Westfield</div></div></div>
          <div className="seg" role="group" aria-label="Language">
            <button aria-pressed={ctx.lang === 'en'} onClick={() => ctx.setLang('en')}>EN</button>
            <button aria-pressed={ctx.lang === 'es'} onClick={() => ctx.setLang('es')}>ES</button>
          </div>
          <UserMenu ctx={ctx} />
        </div>
      </header>
      <main className="page">
        {tab === 'rail' && <Rail ctx={ctx} />}
        {tab === 'cards' && <Cards ctx={ctx} />}
        {tab === 'count' && <Count ctx={ctx} />}
        {tab === 'shift' && <Shift ctx={ctx} />}
        {tab === 'ask' && <Ask ctx={ctx} />}
      </main>
      <nav className="tabs" aria-label="Sections">
        {tabs.map(([id, ic, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => ctx.go(id)}>{Icon[ic]}<span>{ctx.lang === 'es' ? esOf(label) : enOf(label)}</span>{ctx.lang === 'es' && <span style={{ fontSize: 10, opacity: .7, marginTop: -3 }}>{enOf(label)}</span>}</button>)}
      </nav>
    </>
  );
}

export function UserMenu({ ctx }: { ctx: AppCtx }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account menu">{ctx.user.display_name.split(' ')[0]}</button>
      {open && <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 220, zIndex: 40, padding: 8 }} onMouseLeave={() => setOpen(false)}>
        <div className="small faint" style={{ padding: '6px 8px' }}>{ctx.user.display_name} · {ctx.user.role}</div>
        {can(ctx.user, 'manager') && <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => ctx.go(ctx.route.startsWith('ledger') ? 'rail' : 'ledger/today')}>{ctx.route.startsWith('ledger') ? 'Open crew Rail' : 'Open Ledger'}</button>}
        <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setOpen(false); ctx.go(ctx.route.startsWith('ledger') ? 'ledger/account' : 'shift/account'); }}>Change PIN / password</button>
        <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={ctx.logout}>Sign out</button>
      </div>}
    </div>
  );
}

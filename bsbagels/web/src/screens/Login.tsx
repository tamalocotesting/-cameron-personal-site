import { useEffect, useState } from 'react';
import { api } from '../api';
import { Logo } from '../components/ui';
import { Bi, type Lang } from '../i18n';

export function Login({ onDone, lang, setLang }: { onDone: () => void; lang: Lang; setLang: (l: Lang) => void }) {
  const [roster, setRoster] = useState<{ username: string; display_name: string }[] | null>(null);
  const [mode, setMode] = useState<'crew' | 'manager'>('crew');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/roster').then(setRoster).catch(() => setRoster([])); }, []);
  useEffect(() => { if (roster && !roster.length) setMode('manager'); }, [roster]);
  if (!roster) return <div className="login" />;

  const submit = async (s = secret) => {
    setBusy(true); setErr('');
    try { await api('/api/login', { body: { username, secret: s } }); onDone(); }
    catch (e) { setErr((e as Error).message); setSecret(''); }
    finally { setBusy(false); }
  };
  const press = (k: string) => {
    if (k === '⌫') return setSecret(secret.slice(0, -1));
    const s = (secret + k).slice(0, 8);
    setSecret(s);
  };

  return (
    <div className="login">
      <div className="login-card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><Logo size={48} /><div><div className="brand-word" style={{ fontSize: 26 }}>The Rail</div><div className="brand-sub">B’s Bagels · Westfield</div></div></div>
          <div className="seg"><button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button><button aria-pressed={lang === 'es'} onClick={() => setLang('es')}>ES</button></div>
        </div>
        <div className="card stack">
          {roster.length > 0 && <div className="seg" style={{ width: '100%' }}>
            <button style={{ flex: 1 }} aria-pressed={mode === 'crew'} onClick={() => { setMode('crew'); setSecret(''); setErr(''); }}><Bi en="Kitchen" es="Cocina" inline /></button>
            <button style={{ flex: 1 }} aria-pressed={mode === 'manager'} onClick={() => { setMode('manager'); setSecret(''); setErr(''); setUsername(''); }}><Bi en="Manager" es="Gerente" inline /></button>
          </div>}
          {mode === 'crew' ? <>
            <h2><Bi en="Who's on?" es="¿Quién eres?" /></h2>
            <div className="roster">{roster.map((r) => <button key={r.username} aria-pressed={username === r.username} onClick={() => { setUsername(r.username); setSecret(''); setErr(''); }}>{r.display_name}</button>)}</div>
            {username && <>
              <div className="pin-dots" aria-label={`${secret.length} digits entered`}>{Array.from({ length: Math.max(4, secret.length) }).map((_, i) => <i key={i} className={i < secret.length ? 'on' : ''} />)}</div>
              <div className="pin">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '→'].map((k) => (
                <button key={k} disabled={busy} aria-label={k === '⌫' ? 'Delete' : k === '→' ? 'Sign in' : k} onClick={() => (k === '→' ? submit() : press(k))} style={k === '→' ? { background: 'var(--crust)', color: 'var(--crust-ink)', borderColor: 'var(--crust)' } : undefined}>{k}</button>))}</div>
            </>}
          </> : <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <h2><Bi en="Sign in" es="Iniciar sesión" /></h2>
            <div className="field"><label htmlFor="u">Username</label><input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="field"><label htmlFor="p"><Bi en="Password or PIN" es="Contraseña o PIN" inline /></label><input id="p" type="password" className="input" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
            <button className="btn primary" disabled={busy || !username || !secret}>Sign in</button>
          </form>}
          {err && <div className="alert act" role="alert">{err}</div>}
        </div>
        <p className="xs faint" style={{ textAlign: 'center' }}>Confidential business data. Use your own sign-in. Every change is recorded.</p>
      </div>
    </div>
  );
}

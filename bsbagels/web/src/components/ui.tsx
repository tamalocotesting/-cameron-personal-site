import { useEffect, useState, type ReactNode } from 'react';
import type { Figure, Kind } from '../api';
import { useLang } from '../i18n';

const PROV: Record<Kind, [string, string]> = {
  verified: ['Verified', 'Verificado'], forecast: ['Forecast', 'Pronóstico'], assumption: ['Assumption', 'Supuesto'], missing: ['Missing', 'Sin dato'], known: ['Booked', 'Reservado'],
};
export function Prov({ kind, title }: { kind: Kind; title?: string }) {
  const lang = useLang();
  return <span className={`prov ${kind}`} title={title}><i aria-hidden />{lang === 'es' ? `${PROV[kind][1]} · ${PROV[kind][0]}` : PROV[kind][0]}</span>;
}

export const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));

/** A number that always carries its provenance. Missing renders as a dash, never 0. */
export function Fig({ f, big, unit, showRange = true, d = 0 }: { f?: Figure | null; big?: boolean; unit?: string; showRange?: boolean; d?: number }) {
  if (!f) return <span className="missing-val">—</span>;
  return (
    <span className="row" style={{ gap: 8, display: 'inline-flex', alignItems: 'baseline', flexWrap: 'wrap' }}>
      {f.value === null ? <span className="missing-val">—</span> : <span className="num" style={{ fontSize: big ? 30 : undefined }}>{fmt(f.value, d)}</span>}
      {(unit ?? f.unit) && f.value !== null && <span className="faint xs">{unit ?? f.unit}</span>}
      {showRange && f.lo !== undefined && f.hi !== undefined && f.value !== null && <span className="faint xs">{fmt(f.lo)}–{fmt(f.hi)}</span>}
      <Prov kind={f.kind} title={f.basis} />
    </span>
  );
}

const FLAVOR_STYLE: Record<string, string> = {
  Plain: '#E3C084', Everything: 'radial-gradient(circle at 30% 30%, #2b2420 1.2px, transparent 1.6px) 0 0/6px 6px, radial-gradient(circle at 70% 60%, #f3ead9 1.2px, transparent 1.6px) 0 0/7px 7px, #C99A5B',
  Sesame: 'radial-gradient(ellipse at 50% 50%, #FFF4DC 1.3px, transparent 1.8px) 0 0/6px 5px, #D8AE6C', 'Cinnamon Raisin': 'radial-gradient(circle, #4A2A1C 1.6px, transparent 2px) 0 0/8px 8px, #9B6440',
  Blueberry: 'radial-gradient(circle, #2E3A6B 1.8px, transparent 2.2px) 0 0/9px 9px, #B98C67', Onion: 'radial-gradient(circle, #6E4B22 1.2px, transparent 1.6px) 0 0/7px 7px, #D3AE72',
  Rainbow: 'conic-gradient(#E46A5B, #F0B647, #8CC269, #5AA6D8, #9C7BD1, #E46A5B)', Pumpernickel: '#4A3328', Poppy: 'radial-gradient(circle, #1F1B17 1px, transparent 1.4px) 0 0/5px 5px, #D9B57D',
  'Whole Wheat': '#A97848', 'Whole Wheat Everything': 'radial-gradient(circle, #2b2420 1.2px, transparent 1.6px) 0 0/6px 6px, #A97848',
  'GF Plain': '#EBD3A4', 'GF Everything': 'radial-gradient(circle, #2b2420 1.2px, transparent 1.6px) 0 0/6px 6px, #E1C38E',
};
const SHORT: Record<string, string> = { Plain: 'PL', Everything: 'EV', Sesame: 'SE', 'Cinnamon Raisin': 'CR', Blueberry: 'BB', Onion: 'ON', Rainbow: 'RB', Pumpernickel: 'PU', Poppy: 'PO', 'Whole Wheat': 'WW', 'Whole Wheat Everything': 'WE', 'GF Plain': 'GP', 'GF Everything': 'GE' };
export function FlavorChip({ name, size = 34 }: { name: string; size?: number }) {
  return <span className={`fchip ${name.startsWith('GF') ? 'gf' : ''}`} style={{ background: FLAVOR_STYLE[name] ?? '#D9C3A0', width: size, height: size }} title={name} aria-label={name}>
    <b className="sr">{SHORT[name] ?? name.slice(0, 2)}</b></span>;
}

export function Logo({ size = 34, light }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="15" fill={light ? '#F4EDE1' : '#1F1B17'} />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#D9A35B" strokeWidth="11" />
      <g fill={light ? '#1F1B17' : '#F4EDE1'}>{[[21, 22], [30, 15.5], [40, 18], [46, 27], [17, 33], [44, 39], [24, 45], [35, 48]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.6" />)}</g>
    </svg>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {title && <h2 style={{ fontSize: 22, marginBottom: 10 }}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}

export function Loading({ label = 'Loading…' }: { label?: string }) { return <div className="empty">{label}</div>; }
export function ErrorBox({ error }: { error: unknown }) { return <div className="alert act"><b>Something went wrong</b>{String((error as Error)?.message ?? error)}</div>; }

export const Icon = {
  rail: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h18" /><rect x="5" y="8" width="5" height="11" rx="1" /><rect x="14" y="8" width="5" height="8" rx="1" /></svg>,
  cards: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="3" width="13" height="17" rx="2" /><path d="M8 8h5M8 12h5M8 16h3" /><path d="M20 7v12a2 2 0 0 1-2 2H9" /></svg>,
  count: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>,
  shift: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h11l-3-3M20 17H9l3 3" /></svg>,
  ask: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 5h16v11H9l-5 4z" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4" /><circle cx="12" cy="14.6" r=".4" fill="currentColor" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  dots: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  chevL: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>,
  chevR: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>,
};

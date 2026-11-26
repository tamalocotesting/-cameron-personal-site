import { useMemo, useRef, useState } from 'react';

export interface Pt { date: string; actual?: number | null; forecast?: number | null; lo?: number | null; hi?: number | null; note?: string }

const W = 720, H = 240, M = { l: 44, r: 16, t: 14, b: 28 };

/** Daily series: verified actuals (solid, blueberry) vs forecast (dashed, crust) with P20–P80 band.
 *  Missing actuals break the line and show as a hollow tick on the baseline — never plotted as zero. */
export function SeriesChart({ data, height = H, labelActual = 'Verified (Toast)', labelForecast = 'Forecast' }: { data: Pt[]; height?: number; labelActual?: string; labelForecast?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const hasF = data.some((d) => d.forecast != null), hasBand = data.some((d) => d.lo != null);
  const { x, y, ticks, max } = useMemo(() => {
    const vals = data.flatMap((d) => [d.actual, d.forecast, d.hi]).filter((v): v is number => v != null);
    const max = Math.max(10, ...vals) * 1.08;
    const x = (i: number) => M.l + (i / Math.max(1, data.length - 1)) * (W - M.l - M.r);
    const y = (v: number) => height - M.b - (v / max) * (height - M.t - M.b);
    const step = Math.pow(10, Math.floor(Math.log10(max))) / (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 1 : 2);
    const ticks: number[] = []; for (let v = 0; v <= max; v += step) ticks.push(v);
    return { x, y, ticks, max };
  }, [data, height]);
  const path = (key: 'actual' | 'forecast') => {
    let d = '', pen = false;
    data.forEach((p, i) => { const v = p[key]; if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const band = hasBand ? (() => {
    const pts = data.map((p, i) => [i, p] as const).filter(([, p]) => p.lo != null && p.hi != null);
    if (!pts.length) return '';
    return 'M' + pts.map(([i, p]) => `${x(i)},${y(p.hi!)}`).join('L') + 'L' + [...pts].reverse().map(([i, p]) => `${x(i)},${y(p.lo!)}`).join('L') + 'Z';
  })() : '';
  const labelEvery = Math.ceil(data.length / 8);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - M.l) / (W - M.l - M.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const last = (key: 'actual' | 'forecast') => { for (let i = data.length - 1; i >= 0; i--) if (data[i][key] != null) return i; return -1; };
  const la = last('actual'), lf = last('forecast');
  const h = hover != null ? data[hover] : null;
  return (
    <div>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i className="sw" style={{ borderColor: 'var(--c-actual)' }} />{labelActual}</span>
        {hasF && <span><i className="sw dash" style={{ borderColor: 'var(--c-forecast)' }} />{labelForecast}</span>}
        {hasBand && <span><i className="sw band" />Likely range (P20–P80)</span>}
        <span className="faint">○ on baseline = no record (not zero)</span>
      </div>
      <div ref={ref} style={{ position: 'relative' }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg className="chart" viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Daily bagels chart">
          {ticks.map((t) => <g key={t}><line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--c-grid)" strokeWidth={1} /><text x={M.l - 6} y={y(t) + 4} textAnchor="end">{t}</text></g>)}
          {data.map((p, i) => i % labelEvery === 0 && <text key={p.date} x={x(i)} y={height - 8} textAnchor="middle">{p.date.slice(5)}</text>)}
          {band && <path d={band} fill="var(--c-forecast)" opacity={0.16} />}
          <path d={path('forecast')} fill="none" stroke="var(--c-forecast)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
          <path d={path('actual')} fill="none" stroke="var(--c-actual)" strokeWidth={2} strokeLinejoin="round" />
          {data.map((p, i) => p.actual === null && <circle key={'m' + i} cx={x(i)} cy={height - M.b} r={4} fill="var(--card)" stroke="var(--ink-3)" strokeWidth={1.5} />)}
          {la >= 0 && <><circle cx={x(la)} cy={y(data[la].actual!)} r={4.5} fill="var(--c-actual)" stroke="var(--card)" strokeWidth={2} /><text x={x(la) - 6} y={y(data[la].actual!) - 9} textAnchor="end" style={{ fill: 'var(--ink-2)', fontWeight: 700 }}>{data[la].actual}</text></>}
          {lf >= 0 && lf !== la && <><circle cx={x(lf)} cy={y(data[lf].forecast!)} r={4.5} fill="var(--c-forecast)" stroke="var(--card)" strokeWidth={2} /><text x={x(lf) - 6} y={y(data[lf].forecast!) - 9} textAnchor="end" style={{ fill: 'var(--ink-2)', fontWeight: 700 }}>{Math.round(data[lf].forecast!)}</text></>}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={height - M.b} stroke="var(--ink-3)" strokeWidth={1} />}
        </svg>
        {h && <div className="tip" style={{ left: `min(calc(${(x(hover!) / W) * 100}% + 12px), calc(100% - 190px))`, top: 8 }}>
          <b>{h.date}</b><br />
          Verified: {h.actual == null ? (h.actual === null ? 'no record' : '—') : h.actual}<br />
          {h.forecast != null && <>Forecast: {Math.round(h.forecast)}{h.lo != null ? ` (${Math.round(h.lo)}–${Math.round(h.hi!)})` : ''}<br /></>}
          {h.note && <span style={{ opacity: .8 }}>{h.note}</span>}
        </div>}
      </div>
      <span className="sr">Max {Math.round(max)}</span>
    </div>
  );
}

/** Horizontal bars, one hue (magnitude). Values labelled at the bar end. */
export function Bars({ rows, unit = '', max }: { rows: { label: string; value: number; sub?: string }[]; unit?: string; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 34%) 1fr', gap: 10, alignItems: 'center' }} title={`${r.label}: ${r.value}${unit}`}>
          <span className="small" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ height: 14, width: `${(r.value / m) * 100}%`, minWidth: 2, background: 'var(--c-actual)', borderRadius: '0 4px 4px 0' }} />
            <span className="small num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}{unit}{r.sub ? <span className="faint xs"> {r.sub}</span> : null}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

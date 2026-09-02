import React, { useState } from 'react';
import { formatMoney } from '../../engine';

/**
 * Small SVG chart set. Follows the dataviz method: single axis, thin marks,
 * recessive grid, fixed categorical order, hover layer with tooltip, legend
 * for >= 2 series, text in text tokens.
 */
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

export interface Series { name: string; values: number[]; color?: string }

function niceTicks(min: number, max: number, n = 4): number[] {
  if (max === min) { max = min + 1; }
  const span = max - min;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

export const LineChart: React.FC<{ labels: string[]; series: Series[]; height?: number; currency?: string; zeroLine?: boolean }> = ({ labels, series, height = 220, currency = 'USD', zeroLine = true }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 62, padR = 12, padT = 12, padB = 26;
  const all = series.flatMap((s) => s.values);
  if (all.length === 0) return <div className="muted small">No data yet.</div>;
  let min = Math.min(...all), max = Math.max(...all);
  if (zeroLine) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const ticks = niceTicks(min, max);
  min = Math.min(min, ticks[0]); max = Math.max(max, ticks[ticks.length - 1]);
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); }}>
        {ticks.map((t) => (<g key={t}><line className="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={t === 0 ? { stroke: 'var(--line-2)' } : undefined} /><text x={padL - 6} y={y(t) + 4} textAnchor="end">{formatMoney(t, currency, true)}</text></g>))}
        {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && <text key={i} x={x(i)} y={H - 8} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{l}</text>)}
        {series.map((s, si) => <path key={s.name} d={path(s.values)} fill="none" stroke={s.color ?? SERIES[si]} strokeWidth={2} strokeLinejoin="round" />)}
        {hover != null && (<g>
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--ink-3)" strokeDasharray="3 3" />
          {series.map((s, si) => <circle key={si} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color ?? SERIES[si]} stroke="var(--bg-2)" strokeWidth={2} />)}
        </g>)}
      </svg>
      {hover != null && (<div className="small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}><span className="muted mono">{labels[hover]}</span>{series.map((s, si) => <span key={si}><span className="sw" style={{ background: s.color ?? SERIES[si], display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 5 }} />{s.name}: <span className="mono">{formatMoney(s.values[hover], currency, true)}</span></span>)}</div>)}
      {series.length >= 2 && <div className="legend">{series.map((s, si) => <span key={si}><span className="sw" style={{ background: s.color ?? SERIES[si] }} />{s.name}</span>)}</div>}
    </div>
  );
};

export const BarChart: React.FC<{ labels: string[]; series: Series[]; height?: number; currency?: string }> = ({ labels, series, height = 200, currency = 'USD' }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 62, padR = 12, padT = 12, padB = 26;
  const all = series.flatMap((s) => s.values);
  if (all.length === 0) return <div className="muted small">No data yet.</div>;
  const min = Math.min(0, ...all), max = Math.max(0, ...all);
  const ticks = niceTicks(min, max);
  const lo = Math.min(min, ticks[0]), hi = Math.max(max, ticks[ticks.length - 1]);
  const n = labels.length;
  const groupW = (W - padL - padR) / n;
  const barW = Math.max(2, (groupW * 0.7) / series.length);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const labelEvery = Math.max(1, Math.ceil(n / 10));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (<g key={t}><line className="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={t === 0 ? { stroke: 'var(--line-2)' } : undefined} /><text x={padL - 6} y={y(t) + 4} textAnchor="end">{formatMoney(t, currency, true)}</text></g>))}
        {labels.map((l, i) => (<g key={i} onMouseEnter={() => setHover(i)}>
          <rect x={padL + i * groupW} y={padT} width={groupW} height={H - padT - padB} fill="transparent" />
          {series.map((s, si) => { const v = s.values[i]; const top = Math.min(y(v), y(0)); const h = Math.abs(y(v) - y(0)); return <rect key={si} x={padL + i * groupW + groupW * 0.15 + si * barW} y={top} width={barW - 2} height={Math.max(0, h)} rx={2} fill={s.color ?? SERIES[si]} opacity={hover == null || hover === i ? 1 : 0.55} />; })}
          {(i % labelEvery === 0) && <text x={padL + i * groupW + groupW / 2} y={H - 8} textAnchor="middle">{l}</text>}
        </g>))}
      </svg>
      {hover != null && <div className="small" style={{ marginTop: 4 }}><span className="muted mono">{labels[hover]}</span> {series.map((s, si) => <span key={si} style={{ marginLeft: 12 }}>{s.name}: <span className="mono">{formatMoney(s.values[hover], currency, true)}</span></span>)}</div>}
      {series.length >= 2 && <div className="legend">{series.map((s, si) => <span key={si}><span className="sw" style={{ background: s.color ?? SERIES[si] }} />{s.name}</span>)}</div>}
    </div>
  );
};

export const Donut: React.FC<{ items: { name: string; value: number }[]; currency?: string }> = ({ items, currency = 'USD' }) => {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1;
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 7);
  const other = sorted.slice(7).reduce((s, i) => s + i.value, 0);
  if (other > 0) top.push({ name: 'Other', value: other });
  const R = 54, r = 36, C = 64;
  let acc = 0;
  const arcs = top.map((it, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += it.value; const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
    return <path key={i} d={`M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z`} fill={SERIES[i]} stroke="var(--bg-2)" strokeWidth={2} />;
  });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr', gap: 16, alignItems: 'center' }}>
      <svg viewBox="0 0 128 128" width={128} height={128}>{arcs}</svg>
      <div className="donut-legend">{top.map((it, i) => (<React.Fragment key={i}><span className="sw" style={{ background: SERIES[i], width: 10, height: 10, borderRadius: 2, display: 'inline-block' }} /><span>{it.name}</span><span className="mono muted">{formatMoney(it.value, currency, true)} · {((it.value / total) * 100).toFixed(0)}%</span></React.Fragment>))}</div>
    </div>
  );
};

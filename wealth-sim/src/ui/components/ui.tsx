import React from 'react';
import { formatMoney, formatDate, type SourceInfo } from '../../engine';

export const Money: React.FC<{ v: number; c?: string; compact?: boolean; signed?: boolean; className?: string }> = ({ v, c = 'USD', compact = true, signed, className }) => {
  const cls = signed ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : '';
  return <span className={`mono ${cls} ${className ?? ''}`}>{signed && v > 0 ? '+' : ''}{formatMoney(v, c, compact)}</span>;
};

export const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; small?: boolean }> = ({ label, value, sub, small }) => (
  <div className="stat"><span className="label">{label}</span><span className={`value ${small ? 'small' : ''}`}>{value}</span>{sub && <span className="delta">{sub}</span>}</div>
);

export const Card: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({ title, right, children, style, className }) => (
  <div className={`card ${className ?? ''}`} style={style}>{title && <h3>{title}{right && <span className="right">{right}</span>}</h3>}{children}</div>
);

export const SourceTag: React.FC<{ s: SourceInfo | undefined }> = ({ s }) => {
  if (!s) return null;
  const label = { user_entered: 'User', user_override: 'Override', builtin_reference: 'Reference', retrieved_real_world: 'Real-world', calculated_estimate: 'Estimate', market_estimate: 'Market est.', simulation_generated: 'Simulated' }[s.type];
  return <span className={`tag src-${s.type}`} title={[s.label, s.reference, s.retrievedOn ? `retrieved ${s.retrievedOn}` : '', s.notes].filter(Boolean).join(' · ')}>{label}</span>;
};

export const Modal: React.FC<{ title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, sub, onClose, children, footer }) => (
  <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {sub && <div className="sub">{sub}</div>}
      {children}
      {footer && <div className="btn-row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>{footer}</div>}
    </div>
  </div>
);

export const KV: React.FC<{ rows: [string, React.ReactNode, boolean?][] }> = ({ rows }) => (
  <div className="kv">{rows.map(([k, v, total], i) => (<React.Fragment key={i}><span className={`k ${total ? 'total' : ''}`}>{k}</span><span className={`v ${total ? 'total' : ''}`}>{v}</span></React.Fragment>))}</div>
);

export const Change: React.FC<{ from: number; to: number; c?: string }> = ({ from, to, c }) => (
  <span><Money v={from} c={c} /><span className="arrow">→</span><Money v={to} c={c} className={to < from ? 'neg' : to > from ? 'pos' : ''} /></span>
);

export const Date_: React.FC<{ d: string }> = ({ d }) => <span className="mono small">{formatDate(d)}</span>;

export const Empty: React.FC<{ text: string }> = ({ text }) => <div className="muted" style={{ padding: 20, textAlign: 'center' }}>{text}</div>;

export { label } from '../../engine';

import React from 'react';
import type { Store } from '../store';
import { formatDate } from '../../engine';
import { Card, Money, Empty } from '../components/ui';

export const Timeline: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const items = [...s.timeline].reverse();
  const years = new Map<number, typeof items>();
  for (const it of items) { const y = +it.date.slice(0, 4); (years.get(y) ?? years.set(y, []).get(y)!).push(it); }
  return (
    <div>
      <h1 className="page-title">Timeline</h1>
      <p className="page-sub">How your simulated financial life evolved.</p>
      {items.length === 0 ? <Card><Empty text="Nothing yet." /></Card> : Array.from(years.entries()).map(([y, its]) => (<Card key={y} title={String(y)} style={{ marginBottom: 14 }}>
        <div className="timeline">{its.map((it) => <div className="item" key={it.id}><div className="d">{formatDate(it.date)} · {it.kind}</div><div><b>{it.title}</b>{it.amount != null && <span className="mono muted"> · <Money v={it.amount} c={c} /></span>}</div>{it.detail && <div className="small muted">{it.detail}</div>}</div>)}</div>
      </Card>))}
    </div>
  );
};

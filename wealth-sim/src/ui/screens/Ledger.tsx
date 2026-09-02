import React, { useState } from 'react';
import type { Store } from '../store';
import { reverseTransaction, label as lbl } from '../../engine';
import { Card, Money, Date_ } from '../components/ui';

export const Ledger: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [hideMarket, setHideMarket] = useState(true);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const types = Array.from(new Set(s.ledger.map((t) => t.type)));
  const rows = [...s.ledger].reverse().filter((t) => (type === 'all' || t.type === type) && (!hideMarket || (t.type !== 'investment_return' && t.type !== 'valuation') || type !== 'all') && (!q || t.description.toLowerCase().includes(q.toLowerCase()) || t.category.includes(q.toLowerCase())));
  const per = 60;
  const view = rows.slice(page * per, page * per + per);
  return (
    <div>
      <h1 className="page-title">Transaction ledger</h1>
      <p className="page-sub">{s.ledger.length.toLocaleString()} entries. Every balance in the app is derived from these postings.</p>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <input placeholder="Search description…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ width: 260 }} />
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}><option value="all">All types</option>{types.map((t) => <option key={t} value={t}>{lbl(t)}</option>)}</select>
        <label className="small muted"><input type="checkbox" checked={hideMarket} onChange={(e) => setHideMarket(e.target.checked)} /> hide monthly market moves</label>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="small muted">{rows.length} shown</span>
        <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button><button className="btn small" disabled={(page + 1) * per >= rows.length} onClick={() => setPage(page + 1)}>›</button>
      </div>
      <Card>
        <div className="scroll-x"><table className="data"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th className="num">Cash</th><th>Tax</th><th></th></tr></thead>
          <tbody>{view.map((t) => (<React.Fragment key={t.id}>
            <tr className="clickable" onClick={() => setOpen(open === t.id ? null : t.id)} style={t.reversedBy ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}><td><Date_ d={t.date} /></td><td className="muted small">{lbl(t.type)}{t.recurring && ' ↻'}</td><td>{t.description}</td><td className="muted small">{lbl(t.category)}</td><td className="num"><Money v={t.cashEffect} c={c} signed compact={false} /></td><td className="small muted">{t.tax ? Object.entries(t.tax).filter(([, v]) => typeof v === 'number' && v !== 0).map(([k, v]) => `${lbl(k)} ${(v as number).toLocaleString()}`).join(', ') : ''}</td><td>{!t.reversedBy && t.type !== 'reversal' && t.type !== 'opening_balance' && t.createdBy !== 'engine' && <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); if (confirm('Reverse this transaction? Balances are restored; both entries stay in the ledger.')) store.mutate((d) => { reverseTransaction(d, t.id, 'User reversal'); }, 'Reversed'); }}>undo</button>}</td></tr>
            {open === t.id && <tr><td colSpan={7} style={{ background: 'var(--bg-3)' }}><div className="small mono">{t.id} · seq {t.seq}{t.idempotencyKey ? ` · key ${t.idempotencyKey}` : ''}{t.assetId ? ` · asset ${s.assets[t.assetId]?.name}` : ''}{t.reverses ? ` · reverses ${t.reverses}` : ''}</div><table className="data" style={{ marginTop: 6 }}><tbody>{t.postings.map((p, i) => <tr key={i}><td className="small">{p.kind}</td><td className="small muted">{'accountId' in p ? s.accounts[p.accountId]?.name : 'assetId' in p ? s.assets[p.assetId]?.name : 'liabilityId' in p ? s.liabilities[p.liabilityId]?.name : 'category' in p ? lbl(p.category) : 'reason' in p ? p.reason : ''}</td><td className="num"><Money v={p.amount} c={c} signed compact={false} /></td></tr>)}</tbody></table>{t.notes && <div className="small muted" style={{ marginTop: 4 }}>{t.notes}</div>}</td></tr>}
          </React.Fragment>))}</tbody></table></div>
      </Card>
    </div>
  );
};

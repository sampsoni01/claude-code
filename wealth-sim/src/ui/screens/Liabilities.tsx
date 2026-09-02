import React, { useState } from 'react';
import type { Store } from '../store';
import { amortizationSchedule, payOffLoan, computeMetrics, label as lbl, formatDate } from '../../engine';
import { Card, Money, Empty, Stat } from '../components/ui';

export const Liabilities: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const m = computeMetrics(s);
  const [sel, setSel] = useState<string | null>(null);
  const active = Object.values(s.liabilities).filter((l) => l.status === 'active').sort((a, b) => b.balance - a.balance);
  const past = Object.values(s.liabilities).filter((l) => l.status !== 'active');
  const l = sel ? s.liabilities[sel] : null;
  return (
    <div>
      <h1 className="page-title">Liabilities</h1>
      <p className="page-sub">Interest is an expense; principal repayment moves cash to debt reduction and never counts as spending.</p>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Card><Stat label="Total debt" value={<Money v={m.totalLiabilities} c={c} />} /></Card>
        <Card><Stat label="Monthly debt service" value={<Money v={m.monthlyDebtService} c={c} />} /></Card>
        <Card><Stat label="Monthly interest" value={<Money v={m.monthlyInterest} c={c} />} /></Card>
        <Card><Stat label="Debt / total assets" value={`${((m.totalLiabilities / Math.max(1, m.totalAssets)) * 100).toFixed(1)}%`} /></Card>
      </div>
      <Card>
        {active.length === 0 ? <Empty text="No active debt." /> : <table className="data"><thead><tr><th>Loan</th><th>Kind</th><th>Secured by</th><th className="num">Balance</th><th className="num">Rate</th><th className="num">Payment</th><th className="num">Months left</th><th>Next</th><th></th></tr></thead>
          <tbody>{active.map((x) => <tr key={x.id} className="clickable" onClick={() => setSel(x.id)}><td>{x.name}</td><td className="muted">{lbl(x.kind)}</td><td className="small muted">{x.securedByAssetId ? s.assets[x.securedByAssetId]?.name : '—'}</td><td className="num"><Money v={x.balance} c={c} /></td><td className="num">{(x.annualRate * 100).toFixed(2)}%</td><td className="num"><Money v={x.monthlyPayment} c={c} compact={false} />{x.interestOnly && <span className="small muted"> (IO)</span>}</td><td className="num">{x.termMonths ? x.monthsRemaining : '∞'}</td><td className="small mono">{x.nextPaymentDate}</td><td><button className="btn small" onClick={(e) => { e.stopPropagation(); if (confirm(`Pay off ${x.name} (${x.balance.toLocaleString()}) from cash?`)) store.mutate((d) => payOffLoan(d, x.id), 'Loan paid off'); }}>pay off</button></td></tr>)}</tbody></table>}
      </Card>
      {l && (<Card title={`${l.name} — amortization`} style={{ marginTop: 14 }} right={<button className="btn small ghost" onClick={() => setSel(null)}>close</button>}>
        <div className="small muted" style={{ marginBottom: 8 }}>Originated {formatDate(l.originatedOn)} · original {l.originalPrincipal.toLocaleString()} · interest paid to date <Money v={l.totalInterestPaid} c={c} /> · principal paid <Money v={l.totalPrincipalPaid} c={c} />{l.balloonPayment > 0 && !l.interestOnly ? ` · balloon ${l.balloonPayment.toLocaleString()}` : ''}</div>
        <div className="scroll-x" style={{ maxHeight: 300, overflowY: 'auto' }}><table className="data"><thead><tr><th>#</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Balance</th></tr></thead><tbody>{amortizationSchedule(l).slice(0, 120).map((r) => <tr key={r.month}><td>{r.month}</td><td className="num"><Money v={r.interest} c={c} compact={false} /></td><td className="num"><Money v={r.principal} c={c} compact={false} /></td><td className="num"><Money v={r.balance} c={c} compact={false} /></td></tr>)}</tbody></table></div>
      </Card>)}
      {past.length > 0 && <Card title="Paid off / settled" style={{ marginTop: 14 }}><table className="data"><tbody>{past.map((x) => <tr key={x.id}><td>{x.name}</td><td className="muted">{x.status}</td><td className="num">interest paid <Money v={x.totalInterestPaid} c={c} /></td></tr>)}</tbody></table></Card>}
    </div>
  );
};

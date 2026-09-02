import React, { useState } from 'react';
import type { Store } from '../store';
import { businessProfit, updateBusiness, distributeRetainedEarnings, commitSale, formatMoney } from '../../engine';
import { Card, Money, Empty, KV, Stat } from '../components/ui';
import { SaleReview } from '../components/reviews';

export const Businesses: React.FC<{ store: Store; go: (s: string) => void }> = ({ store, go }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [sell, setSell] = useState<string | null>(null);
  const [dist, setDist] = useState<Record<string, number>>({});
  const biz = Object.values(s.assets).filter((a) => a.status === 'owned' && a.details.kind === 'business');
  const totalValue = biz.reduce((x, a) => x + a.currentValue, 0);
  const totalDist = biz.reduce((x, a) => a.details.kind === 'business' ? x + Math.max(0, businessProfit(a.details.business)) * a.details.business.ownershipPct * a.details.business.distributionRate : x, 0);
  return (
    <div>
      <h1 className="page-title">Businesses</h1>
      <p className="page-sub">Businesses run their own P&L. Profit accrues inside the business; only distributions reach your cash. Value is revalued yearly on profit × multiple.</p>
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <Card><Stat label="Business equity value" value={<Money v={totalValue} c={c} />} /></Card>
        <Card><Stat label="Expected distributions /yr" value={<Money v={totalDist} c={c} />} /></Card>
        <Card><Stat label="Holdings" value={biz.length} sub={<button className="btn small ghost" onClick={() => go('purchase')}>acquire a business →</button>} /></Card>
      </div>
      {biz.length === 0 ? <Card><Empty text="No business holdings. Acquire one from the Purchase screen or ask the Business Advisor." /></Card> : biz.map((a) => { if (a.details.kind !== 'business') return null; const b = a.details.business; const profit = businessProfit(b); const up = (patch: any) => store.mutate((d) => updateBusiness(d, a.id, patch), 'Business updated'); return (
        <Card key={a.id} title={a.name} right={<span className="mono"><Money v={a.currentValue} c={c} /></span>} style={{ marginBottom: 14 }}>
          <div className="grid cols-2">
            <KV rows={[['Industry', b.industry], ['Ownership', `${(b.ownershipPct * 100).toFixed(0)}%`], ['Annual revenue', <Money v={b.annualRevenue} c={c} compact={false} />], ['Operating expenses', <Money v={-b.annualOperatingExpenses} c={c} compact={false} />], ['Payroll', <Money v={-b.annualPayroll} c={c} compact={false} />], ['Profit', <Money v={profit} c={c} compact={false} signed />, true], ['Your share of profit', <Money v={profit * b.ownershipPct} c={c} compact={false} />], ['Distributed to you /yr', <Money v={Math.max(0, profit) * b.ownershipPct * b.distributionRate} c={c} compact={false} />], ['Retained earnings (your share)', <Money v={b.retainedEarnings} c={c} compact={false} />], ['Employees', b.employees], ['Purchase price', <Money v={a.purchasePrice} c={c} compact={false} />]]} />
            <div>
              <div className="row"><label className="field">Growth %/yr<input type="number" step="0.5" value={+(b.annualGrowthRate * 100).toFixed(1)} onChange={(e) => up({ annualGrowthRate: +e.target.value / 100 })} /></label><label className="field">Distribution rate %<input type="number" value={+(b.distributionRate * 100).toFixed(0)} onChange={(e) => up({ distributionRate: +e.target.value / 100 })} /></label><label className="field">Valuation multiple<input type="number" step="0.5" value={b.valuationMultiple} onChange={(e) => up({ valuationMultiple: +e.target.value })} /></label></div>
              <div className="row" style={{ marginTop: 8 }}><label className="field">Revenue<input type="number" value={b.annualRevenue} onChange={(e) => up({ annualRevenue: +e.target.value })} /></label><label className="field">Op. expenses<input type="number" value={b.annualOperatingExpenses} onChange={(e) => up({ annualOperatingExpenses: +e.target.value })} /></label><label className="field">Payroll<input type="number" value={b.annualPayroll} onChange={(e) => up({ annualPayroll: +e.target.value })} /></label></div>
              <div className="row" style={{ marginTop: 12 }}><label className="field">Special distribution (from retained {formatMoney(b.retainedEarnings, c, true)})<input type="number" value={dist[a.id] ?? 0} onChange={(e) => setDist({ ...dist, [a.id]: +e.target.value })} /></label><button className="btn" style={{ flex: 0 }} disabled={!dist[a.id] || b.retainedEarnings <= 0} onClick={() => store.mutate((d) => distributeRetainedEarnings(d, a.id, dist[a.id]), 'Distribution paid')}>Distribute</button><button className="btn danger" style={{ flex: 0 }} onClick={() => setSell(a.id)}>Sell stake</button></div>
              <div className="small muted" style={{ marginTop: 8 }}>Edits are recorded as user overrides. Implied value: profit × multiple × ownership + 50% of retained earnings, applied at each year-end.</div>
            </div>
          </div>
        </Card>); })}
      {sell && <SaleReview state={s} assetId={sell} onClose={() => setSell(null)} onConfirm={(price) => { if (store.apply((st) => commitSale(st, sell, { value: price, source: { type: 'user_entered' } }).state, 'Business sold')) setSell(null); }} />}
    </div>
  );
};

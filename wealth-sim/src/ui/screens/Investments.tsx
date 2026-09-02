import React, { useState } from 'react';
import type { Store } from '../store';
import { commitPurchase, sellSecurityPortion, updateSecurityAssumptions, securityDefaults, securityValueRuleFor, SCENARIOS, computeMetrics, label as lbl, type PurchaseSpec, type MarketScenarioId } from '../../engine';
import { Card, Money, Stat, Empty, SourceTag } from '../components/ui';
import { LineChart } from '../components/charts';
import { PurchaseReview } from '../components/reviews';

export const Investments: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const m = computeMetrics(s);
  const holdings = Object.values(s.assets).filter((a) => a.status === 'owned' && a.details.kind === 'security').sort((a, b) => b.currentValue - a.currentValue);
  const total = holdings.reduce((x, a) => x + a.currentValue, 0);
  const basis = holdings.reduce((x, a) => x + a.costBasis, 0);
  const [buy, setBuy] = useState<PurchaseSpec | null>(null);
  const [form, setForm] = useState({ name: 'S&P 500 index fund', cls: 'etf' as any, amount: 1_000_000 });
  const [sellAmt, setSellAmt] = useState<Record<string, number>>({});
  const hist = s.history.slice(-36);
  const openBuy = () => {
    const d = securityDefaults(form.cls);
    const sec = { assetClass: form.cls, expectedAnnualReturn: d.ret, annualVolatility: d.vol, dividendYield: d.div };
    setBuy({ name: form.name, category: form.cls === 'private_equity' || form.cls === 'venture' ? 'private_investment' : 'public_security', details: { kind: 'security', security: sec }, price: { value: form.amount, source: { type: 'user_entered' } }, valueRule: securityValueRuleFor(sec), createdBy: 'user' });
  };
  return (
    <div>
      <h1 className="page-title">Investments</h1>
      <p className="page-sub">Performance varies month to month around each holding's expected return and volatility, shaped by the market scenario.</p>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Card><Stat label="Portfolio value" value={<Money v={total} c={c} />} sub={<>liquid <Money v={m.liquidAssets - m.cash} c={c} /></>} /></Card>
        <Card><Stat label="Gain vs basis" value={<Money v={total - basis} c={c} signed />} sub={basis > 0 ? `${(((total - basis) / basis) * 100).toFixed(1)}%` : '—'} /></Card>
        <Card><Stat label="Est. annual dividends" value={<Money v={holdings.reduce((x, a) => x + a.currentValue * (a.details.kind === 'security' ? a.details.security.dividendYield : 0), 0)} c={c} />} /></Card>
        <Card><Stat label="Market scenario" value={<select value={s.settings.scenario.id} onChange={(e) => store.mutate((d) => { d.settings.scenario = { ...SCENARIOS[e.target.value as MarketScenarioId] }; }, 'Scenario changed')} style={{ fontSize: 13 }}>{Object.values(SCENARIOS).map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</select>} sub={`equity drift ${(s.settings.scenario.equityDrift * 100).toFixed(0)}% · vol ×${s.settings.scenario.volatilityMultiplier}`} /></Card>
      </div>
      <Card title="Liquid assets vs net worth" style={{ marginBottom: 14 }}><LineChart labels={hist.map((h) => h.date.slice(0, 7))} currency={c} series={[{ name: 'Net worth', values: hist.map((h) => h.netWorth) }, { name: 'Liquid assets', values: hist.map((h) => h.liquidAssets) }]} /></Card>
      <Card title="Buy a holding" style={{ marginBottom: 14 }}>
        <div className="row">
          <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">Asset class<select value={form.cls} onChange={(e) => setForm({ ...form, cls: e.target.value })}>{['stock', 'etf', 'bond', 'private_equity', 'venture', 'real_estate_fund', 'alternative', 'cash_equivalent'].map((k) => <option key={k} value={k}>{lbl(k)}</option>)}</select></label>
          <label className="field">Amount<input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} /></label>
          <button className="btn primary" style={{ flex: 0 }} onClick={openBuy}>Review purchase</button>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Default expectations by class: {(['etf', 'stock', 'bond', 'private_equity', 'venture'] as const).map((k) => `${lbl(k)} ${(securityDefaults(k).ret * 100).toFixed(1)}%/${(securityDefaults(k).vol * 100).toFixed(0)}%`).join(' · ')} (return/vol, simulation assumptions).</div>
      </Card>
      <Card title="Holdings">
        {holdings.length === 0 ? <Empty text="No investment holdings." /> : <div className="scroll-x"><table className="data"><thead><tr><th>Holding</th><th>Class</th><th className="num">Value</th><th className="num">Basis</th><th className="num">Gain</th><th className="num">Exp. return</th><th className="num">Vol</th><th className="num">Yield</th><th>Sell</th></tr></thead>
          <tbody>{holdings.map((a) => { if (a.details.kind !== 'security') return null; const sec = a.details.security; return (<tr key={a.id}>
            <td>{a.name} <SourceTag s={a.valueRule.source} /></td><td className="muted">{lbl(sec.assetClass)}</td><td className="num"><Money v={a.currentValue} c={c} /></td><td className="num"><Money v={a.costBasis} c={c} /></td><td className="num"><Money v={a.currentValue - a.costBasis} c={c} signed /></td>
            <td className="num"><input type="number" step="0.5" style={{ width: 64 }} value={+(sec.expectedAnnualReturn * 100).toFixed(1)} onChange={(e) => store.mutate((d) => updateSecurityAssumptions(d, a.id, { expectedAnnualReturn: +e.target.value / 100 }))} />%</td>
            <td className="num"><input type="number" step="1" style={{ width: 56 }} value={+(sec.annualVolatility * 100).toFixed(0)} onChange={(e) => store.mutate((d) => updateSecurityAssumptions(d, a.id, { annualVolatility: +e.target.value / 100 }))} />%</td>
            <td className="num"><input type="number" step="0.1" style={{ width: 56 }} value={+(sec.dividendYield * 100).toFixed(1)} onChange={(e) => store.mutate((d) => updateSecurityAssumptions(d, a.id, { dividendYield: +e.target.value / 100 }))} />%</td>
            <td>{a.liquidity === 'liquid' ? <span className="btn-row"><input type="number" style={{ width: 120 }} placeholder="amount" value={sellAmt[a.id] ?? ''} onChange={(e) => setSellAmt({ ...sellAmt, [a.id]: +e.target.value })} /><button className="btn small" disabled={!sellAmt[a.id]} onClick={() => store.mutate((d) => sellSecurityPortion(d, a.id, sellAmt[a.id]), 'Sold holding portion')}>sell</button></span> : <span className="small muted">illiquid</span>}</td>
          </tr>); })}</tbody></table></div>}
      </Card>
      {buy && <PurchaseReview state={s} spec={buy} onClose={() => setBuy(null)} onConfirm={(spec) => { if (store.apply((st) => commitPurchase(st, spec).state, `Bought ${spec.name}`)) setBuy(null); }} />}
    </div>
  );
};

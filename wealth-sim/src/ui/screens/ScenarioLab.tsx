import React, { useState } from 'react';
import type { Store } from '../store';
import { runScenario, applyScenarioActions, SCENARIOS, JURISDICTIONS, label as lbl, type ScenarioAction, type ScenarioResult, type MarketScenarioId } from '../../engine';
import { Card, Money, Change } from '../components/ui';
import { LineChart } from '../components/charts';

export const ScenarioLab: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [actions, setActions] = useState<ScenarioAction[]>([]);
  const [years, setYears] = useState(10);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [buy, setBuy] = useState({ name: 'House', category: 'real_estate', price: 45_000_000, financed: false, down: 40 });
  const [spend, setSpend] = useState(5_000_000);
  const [shock, setShock] = useState({ cat: 'public_security', pct: 30 });
  const [market, setMarket] = useState<MarketScenarioId>('recession');
  const [expense, setExpense] = useState({ name: 'Extra spending', monthly: 100_000 });
  const owned = Object.values(s.assets).filter((a) => a.status === 'owned' && a.resaleAllowed);
  const [sellId, setSellId] = useState(owned[0]?.id ?? '');
  const add = (a: ScenarioAction) => setActions([...actions, a]);
  const run = () => { setBusy(true); setTimeout(() => { try { setResult(runScenario(s, actions.map(describe).join(' + ') || 'Baseline', actions, years)); } catch (e: any) { store.toast(e.message, 'err'); } setBusy(false); }, 10); };
  const j = JURISDICTIONS[s.profile.taxJurisdiction];
  const describe = (a: ScenarioAction): string => a.kind === 'purchase' ? `Buy ${a.spec.name} (${a.spec.price.value.toLocaleString()}${a.spec.financing ? ', financed' : ''})` : a.kind === 'sell' ? `Sell ${s.assets[a.assetId]?.name}` : a.kind === 'quit_job' ? 'Quit job' : a.kind === 'set_annual_spend' ? `Spend ${a.annual.toLocaleString()}/yr` : a.kind === 'market' ? `Market: ${SCENARIOS[a.scenario].name}` : a.kind === 'add_expense' ? `+${a.name} ${a.monthly.toLocaleString()}/mo` : a.kind === 'add_income' ? `+income ${a.monthly.toLocaleString()}/mo` : `${lbl(a.assetCategory)} ${a.pct * 100}%`;
  return (
    <div>
      <h1 className="page-title">Scenario Lab</h1>
      <p className="page-sub">Test decisions on a copy of your simulation. Nothing here touches the live books until you press Apply.</p>
      <div className="grid cols-3">
        <Card title="Purchase"><div className="row"><label className="field">Name<input value={buy.name} onChange={(e) => setBuy({ ...buy, name: e.target.value })} /></label><label className="field">Category<select value={buy.category} onChange={(e) => setBuy({ ...buy, category: e.target.value })}>{['real_estate', 'vehicle', 'aircraft', 'yacht', 'art', 'business', 'public_security', 'custom_physical'].map((k) => <option key={k} value={k}>{lbl(k)}</option>)}</select></label></div><div className="row" style={{ marginTop: 6 }}><label className="field">Price<input type="number" value={buy.price} onChange={(e) => setBuy({ ...buy, price: +e.target.value })} /></label><label className="field"><span><input type="checkbox" checked={buy.financed} onChange={(e) => setBuy({ ...buy, financed: e.target.checked })} /> finance</span></label>{buy.financed && <label className="field">Down %<input type="number" value={buy.down} onChange={(e) => setBuy({ ...buy, down: +e.target.value })} /></label>}<button className="btn small" style={{ flex: 0 }} onClick={() => add({ kind: 'purchase', spec: { name: buy.name, category: buy.category as any, details: buy.category === 'real_estate' ? { kind: 'property', property: { address: 'Scenario', propertyType: 'house', use: 'primary_residence', garageCapacity: 3, parkingSpaces: 3, storageCapacity: 20, annualPropertyTaxRate: j.defaultPropertyTaxRate } } : buy.category === 'business' ? { kind: 'business', business: { industry: 'Scenario', annualRevenue: buy.price * 1.2, annualOperatingExpenses: buy.price * 0.6, annualPayroll: buy.price * 0.4, employees: 50, ownershipPct: 1, annualGrowthRate: 0.05, distributionRate: 0.6, valuationMultiple: 5, retainedEarnings: 0 } } : { kind: 'generic', fields: {} }, price: { value: buy.price, source: { type: 'user_entered' } }, financing: buy.financed ? { kind: buy.category === 'real_estate' ? 'mortgage' : buy.category === 'vehicle' ? 'auto_loan' : buy.category === 'business' ? 'business_loan' : 'personal_loan', downPaymentPct: buy.down / 100, annualRate: undefined as any, termMonths: undefined as any } : undefined } })}>Add</button></div></Card>
        <Card title="Income & spending"><div className="row"><button className="btn small" onClick={() => add({ kind: 'quit_job' })}>Quit job</button><label className="field">Annual spend<input type="number" value={spend} onChange={(e) => setSpend(+e.target.value)} /></label><button className="btn small" style={{ flex: 0 }} onClick={() => add({ kind: 'set_annual_spend', annual: spend })}>Set</button></div><div className="row" style={{ marginTop: 6 }}><label className="field">Extra monthly expense<input type="number" value={expense.monthly} onChange={(e) => setExpense({ ...expense, monthly: +e.target.value })} /></label><button className="btn small" style={{ flex: 0 }} onClick={() => add({ kind: 'add_expense', name: expense.name, monthly: expense.monthly })}>Add</button></div><div className="row" style={{ marginTop: 6 }}><label className="field">Sell<select value={sellId} onChange={(e) => setSellId(e.target.value)}>{owned.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button className="btn small" style={{ flex: 0 }} disabled={!sellId} onClick={() => add({ kind: 'sell', assetId: sellId, price: { value: s.assets[sellId].currentValue, source: { type: 'market_estimate', label: 'carrying value' } } })}>Add</button></div></Card>
        <Card title="Markets"><div className="row"><label className="field">Shock<select value={shock.cat} onChange={(e) => setShock({ ...shock, cat: e.target.value })}><option value="public_security">Stock market</option><option value="real_estate">Real estate</option><option value="all">Everything</option></select></label><label className="field">Falls by %<input type="number" value={shock.pct} onChange={(e) => setShock({ ...shock, pct: +e.target.value })} /></label><button className="btn small" style={{ flex: 0 }} onClick={() => add({ kind: 'shock', assetCategory: shock.cat as any, pct: -shock.pct / 100 })}>Add</button></div><div className="row" style={{ marginTop: 6 }}><label className="field">Market regime<select value={market} onChange={(e) => setMarket(e.target.value as MarketScenarioId)}>{Object.values(SCENARIOS).map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</select></label><button className="btn small" style={{ flex: 0 }} onClick={() => add({ kind: 'market', scenario: market })}>Add</button></div></Card>
      </div>
      <Card style={{ marginTop: 14 }}>
        <div className="btn-row">
          <b>Scenario:</b>{actions.length === 0 ? <span className="muted">no actions (baseline only)</span> : actions.map((a, i) => <span key={i} className="chip" onClick={() => setActions(actions.filter((_, k) => k !== i))} title="remove">{describe(a)} ✕</span>)}
          <span style={{ flex: 1 }} />
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Years <input type="number" style={{ width: 60 }} value={years} min={1} max={30} onChange={(e) => setYears(+e.target.value)} /></label>
          <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Running…' : 'Run projection'}</button>
          <button className="btn danger" disabled={actions.length === 0} onClick={() => { if (confirm('Apply these actions to the live simulation?')) { if (store.apply((st) => applyScenarioActions(st, actions), 'Scenario applied')) { setActions([]); setResult(null); } } }}>Apply to live simulation</button>
        </div>
      </Card>
      {result && (<>
        {result.warnings.map((w) => <div className="warning" key={w}>{w}</div>)}
        <div className="grid cols-4" style={{ marginTop: 14 }}>
          <Card><div className="small muted">Cash now</div><Change from={result.immediate.before.cash} to={result.immediate.after.cash} c={c} /></Card>
          <Card><div className="small muted">Net worth now</div><Change from={result.immediate.before.netWorth} to={result.immediate.after.netWorth} c={c} /></Card>
          <Card><div className="small muted">Debt</div><Change from={result.immediate.before.totalLiabilities} to={result.immediate.after.totalLiabilities} c={c} /></Card>
          <Card><div className="small muted">Monthly cash flow</div><Change from={result.immediate.before.monthlyCashFlow} to={result.immediate.after.monthlyCashFlow} c={c} /></Card>
        </div>
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <Card title="Net worth projection"><LineChart labels={result.scenario.map((p) => `Y${p.years}`)} currency={c} series={[{ name: 'Baseline', values: result.baseline.map((p) => p.metrics.netWorth) }, { name: 'Scenario', values: result.scenario.map((p) => p.metrics.netWorth) }]} /></Card>
          <Card title="Cash projection"><LineChart labels={result.scenario.map((p) => `Y${p.years}`)} currency={c} series={[{ name: 'Baseline', values: result.baseline.map((p) => p.metrics.cash) }, { name: 'Scenario', values: result.scenario.map((p) => p.metrics.cash) }]} /></Card>
        </div>
        <Card title="Projection table" style={{ marginTop: 14 }}>
          <div className="scroll-x"><table className="data"><thead><tr><th>Year</th><th className="num">Net worth</th><th className="num">vs baseline</th><th className="num">Cash</th><th className="num">Liquid</th><th className="num">Debt</th><th className="num">Investments</th><th className="num">Annual expenses</th></tr></thead>
            <tbody>{result.scenario.filter((p) => [0, 1, 2, 3, 5, 10, 15, 20, 25, 30].includes(p.years) || p.years === years).map((p, i) => { const b = result.baseline.find((x) => x.years === p.years)!; void i; return <tr key={p.years}><td>Y{p.years} <span className="small muted">{p.date.slice(0, 4)}</span></td><td className="num"><Money v={p.metrics.netWorth} c={c} /></td><td className="num"><Money v={p.metrics.netWorth - b.metrics.netWorth} c={c} signed /></td><td className="num"><Money v={p.metrics.cash} c={c} /></td><td className="num"><Money v={p.metrics.liquidAssets} c={c} /></td><td className="num"><Money v={p.metrics.totalLiabilities} c={c} /></td><td className="num"><Money v={(p.metrics.allocation.public_security ?? 0) + (p.metrics.allocation.private_investment ?? 0)} c={c} /></td><td className="num"><Money v={p.metrics.monthlyExpenses * 12} c={c} /></td></tr>; })}</tbody></table></div>
          <div className="disclaimer">Projections use the same engine as time advancement with realism events disabled and the current market seed. They are illustrative, not predictions.</div>
        </Card>
      </>)}
    </div>
  );
};

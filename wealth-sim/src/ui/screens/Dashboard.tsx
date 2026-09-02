import React from 'react';
import type { Store } from '../store';
import { computeMetrics, upcomingPayments, formatDate, label as lbl } from '../../engine';
import { Card, Stat, Money, Date_ } from '../components/ui';
import { LineChart, BarChart, Donut } from '../components/charts';

export const Dashboard: React.FC<{ store: Store; go: (s: string) => void }> = ({ store, go }) => {
  const s = store.state!;
  const m = computeMetrics(s);
  const c = s.profile.currency;
  const hist = s.history.slice(-36);
  const labels = hist.map((h) => h.date.slice(0, 7));
  const first = s.history[0];
  const recent = [...s.ledger].reverse().filter((t) => t.type !== 'valuation' && t.type !== 'investment_return').slice(0, 9);
  const upcoming = upcomingPayments(s, 30).slice(0, 8);
  const invest = Object.values(s.assets).filter((a) => a.status === 'owned' && a.details.kind === 'security');
  const investGain = invest.reduce((sum, a) => sum + a.currentValue - a.costBasis, 0);
  const investBasis = invest.reduce((sum, a) => sum + a.costBasis, 0);
  const runway = m.monthlyCashFlow < 0 ? m.cash / -m.monthlyCashFlow : Infinity;
  return (
    <div>
      <h1 className="page-title">{s.profile.name}</h1>
      <p className="page-sub">{s.profile.location} · {formatDate(s.currentDate)} · all figures simulated</p>
      <div className="grid cols-6">
        <Card><Stat label="Net worth" value={<Money v={m.netWorth} c={c} />} sub={first ? <>since start <Money v={m.netWorth - first.netWorth} c={c} signed /></> : undefined} /></Card>
        <Card><Stat label="Cash" value={<Money v={m.cash} c={c} />} sub={<span className={runway < 12 ? 'warn' : ''}>{runway === Infinity ? 'cash flow positive' : `${runway.toFixed(0)} months runway at current burn`}</span>} /></Card>
        <Card><Stat label="Liquid assets" value={<Money v={m.liquidAssets} c={c} />} sub={<>liquid net worth <Money v={m.liquidNetWorth} c={c} /></>} /></Card>
        <Card><Stat label="Total assets" value={<Money v={m.totalAssets} c={c} />} sub={<>liabilities <Money v={m.totalLiabilities} c={c} /></>} /></Card>
        <Card><Stat label="Monthly cash flow" value={<Money v={m.monthlyCashFlow} c={c} signed />} sub={<>income <Money v={m.monthlyIncome} c={c} /> · outflow <Money v={m.monthlyExpenses} c={c} /></>} /></Card>
        <Card><Stat label="Annual lifestyle burn" value={<Money v={m.annualLifestyleBurn} c={c} />} sub={<>passive income <Money v={m.passiveMonthlyIncome * 12} c={c} />/yr</>} /></Card>
      </div>
      {m.cash < 0 && <div className="warning" style={{ marginTop: 14 }}>Your operating account is overdrawn by <Money v={-m.cash} c={c} />. The simulation keeps running, but you should sell assets, borrow, or cut spending. Net worth (<Money v={m.netWorth} c={c} />) doesn't pay bills.</div>}
      {m.cash >= 0 && runway < 12 && <div className="warning" style={{ marginTop: 14 }}>Liquidity warning: at the current burn your cash lasts about {runway.toFixed(0)} months. Net worth is <Money v={m.netWorth} c={c} /> but only <Money v={m.liquidAssets} c={c} /> is liquid.</div>}
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Net worth & liquidity history" right={<span className="small muted">monthly</span>}>
          <LineChart labels={labels} currency={c} series={[{ name: 'Net worth', values: hist.map((h) => h.netWorth) }, { name: 'Liquid assets', values: hist.map((h) => h.liquidAssets) }, { name: 'Cash', values: hist.map((h) => h.cash) }]} />
        </Card>
        <Card title="Monthly income vs expenses">
          <BarChart labels={labels.slice(-18)} currency={c} series={[{ name: 'Income', values: hist.slice(-18).map((h) => h.monthIncome) }, { name: 'Expenses', values: hist.slice(-18).map((h) => h.monthExpenses) }]} />
        </Card>
      </div>
      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <Card title="Asset allocation"><Donut currency={c} items={Object.entries(m.allocation).map(([k, v]) => ({ name: lbl(k), value: v }))} /></Card>
        <Card title="Debt & investments">
          <div className="grid cols-2">
            <Stat small label="Debt service /mo" value={<Money v={m.monthlyDebtService} c={c} />} sub={<>interest <Money v={m.monthlyInterest} c={c} />/mo</>} />
            <Stat small label="Total debt" value={<Money v={m.totalLiabilities} c={c} />} sub={`${Object.values(s.liabilities).filter((l) => l.status === 'active').length} active loans`} />
            <Stat small label="Investments" value={<Money v={invest.reduce((x, a) => x + a.currentValue, 0)} c={c} />} sub={investBasis > 0 ? <span className={investGain >= 0 ? 'pos' : 'neg'}>{investGain >= 0 ? '+' : ''}{((investGain / investBasis) * 100).toFixed(1)}% vs basis</span> : '—'} />
            <Stat small label="Market scenario" value={<span style={{ fontFamily: 'var(--font)', fontSize: 15 }}>{s.settings.scenario.name}</span>} sub={<button className="btn small ghost" onClick={() => go('settings')}>change</button>} />
          </div>
        </Card>
        <Card title="Upcoming payments (30 days)">
          {upcoming.length === 0 ? <div className="muted small">Nothing scheduled.</div> : <table className="data"><tbody>{upcoming.map((u, i) => <tr key={i}><td><Date_ d={u.date} /></td><td>{u.label}</td><td className="num"><Money v={u.amount} c={c} /></td></tr>)}</tbody></table>}
        </Card>
      </div>
      <Card title="Recent transactions" right={<button className="btn small ghost" onClick={() => go('ledger')}>full ledger →</button>} style={{ marginTop: 14 }}>
        <table className="data"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Cash effect</th></tr></thead>
          <tbody>{recent.map((t) => <tr key={t.id}><td><Date_ d={t.date} /></td><td>{t.description}</td><td className="muted">{lbl(t.category)}</td><td className="num"><Money v={t.cashEffect} c={c} signed compact={false} /></td></tr>)}</tbody></table>
      </Card>
    </div>
  );
};

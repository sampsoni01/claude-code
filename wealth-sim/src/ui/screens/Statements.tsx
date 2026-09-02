import React, { useState } from 'react';
import type { Store } from '../store';
import { balanceSheet, incomeStatement, cashFlowStatement, reconcile, periodBounds, computeAnnualSettlement, JURISDICTIONS, label as lbl } from '../../engine';
import { Card, Money, KV } from '../components/ui';

export const Statements: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'all'>('year');
  const { from, to } = periodBounds(s, period);
  const bs = balanceSheet(s);
  const is = incomeStatement(s, from, to);
  const cf = cashFlowStatement(s, from, to);
  const rec = reconcile(s);
  const j = JURISDICTIONS[s.profile.taxJurisdiction];
  const tax = computeAnnualSettlement(s.taxYear, j);
  const M = (v: number) => <Money v={v} c={c} compact={false} />;
  return (
    <div>
      <h1 className="page-title">Financial statements</h1>
      <p className="page-sub">All three statements are derived from the same ledger. <span className={rec.ok ? 'pos' : 'neg'}>{rec.ok ? '✓ Ledger reconciles with all balances.' : `✗ Reconciliation issues: ${rec.issues.join('; ')}`}</span></p>
      <div className="btn-row" style={{ marginBottom: 12 }}>{(['month', 'quarter', 'year', 'all'] as const).map((p) => <button key={p} className={`btn small ${period === p ? 'primary' : ''}`} onClick={() => setPeriod(p)}>{p === 'all' ? 'Since start' : `Trailing ${p}`}</button>)}<span className="small muted">{from} → {to}</span></div>
      <div className="grid cols-3">
        <Card title={`Balance sheet · ${bs.asOf}`}>
          <KV rows={[...bs.cash.map((a) => [a.name, M(a.balance)] as [string, React.ReactNode]), ...bs.assets.map((g) => [`${lbl(g.category)} (${g.items.length})`, M(g.total)] as [string, React.ReactNode]), ['Total assets', M(bs.totalAssets), true], ...bs.liabilities.map((l) => [l.name, M(-l.balance)] as [string, React.ReactNode]), ['Total liabilities', M(-bs.totalLiabilities), true], ['Net worth', M(bs.netWorth), true]]} />
        </Card>
        <Card title="Income statement">
          <KV rows={[...is.income.map((i) => [lbl(i.category), M(i.amount)] as [string, React.ReactNode]), ['Total income', M(is.totalIncome), true], ...is.expenses.map((e) => [lbl(e.category), M(-e.amount)] as [string, React.ReactNode]), ['Total expenses', M(-is.totalExpenses), true], ['Net income', M(is.netIncome), true], ['Realized gains/losses vs carrying value', M(is.realizedGains)], ['Unrealized valuation changes (not income)', M(is.unrealizedGains)], ['Change in net worth', M(is.comprehensiveChange), true]]} />
        </Card>
        <Card title="Cash flow statement">
          <KV rows={[['Opening cash', M(cf.openingCash)], ...cf.operating.map((r) => [r.label, M(r.amount)] as [string, React.ReactNode]), ['Net operating', M(cf.netOperating), true], ...cf.investing.map((r) => [r.label, M(r.amount)] as [string, React.ReactNode]), ['Net investing', M(cf.netInvesting), true], ...cf.financing.map((r) => [r.label, M(r.amount)] as [string, React.ReactNode]), ['Net financing', M(cf.netFinancing), true], ['Net change in cash', M(cf.netChange), true], ['Closing cash', M(cf.closingCash), true]]} />
        </Card>
      </div>
      <Card title={`Tax year ${s.taxYear.year} — running estimate (${j.name})`} style={{ marginTop: 14 }}>
        <div className="grid cols-2">
          <KV rows={[['Ordinary income to date', M(s.taxYear.ordinaryIncome)], ['Withheld to date', M(s.taxYear.withheld)], ['Long-term capital gains', M(s.taxYear.capitalGainsLong)], ['Short-term capital gains', M(s.taxYear.capitalGainsShort)], ['Dividends', M(s.taxYear.dividends)], ['Interest', M(s.taxYear.interestIncome)], ['Business distributions', M(s.taxYear.businessIncome)], ['Deductions (mortgage interest, property tax)', M(s.taxYear.deductions)], ['Property tax paid', M(s.taxYear.propertyTaxPaid)], ['Sales tax paid', M(s.taxYear.salesTaxPaid)]]} />
          <KV rows={[...tax.breakdown.map((b) => [b.label, M(b.tax)] as [string, React.ReactNode]), ['Estimated total liability', M(tax.totalLiability), true], ['Less withheld', M(-tax.withheld)], [`Estimated ${tax.balanceDue >= 0 ? 'payment due' : 'refund'} (settles month ${s.settings.taxSettlementMonth})`, M(Math.abs(tax.balanceDue)), true]]} />
        </div>
        <div className="disclaimer">Simulated, simplified tax estimates. {j.notes} Not tax advice.</div>
      </Card>
    </div>
  );
};

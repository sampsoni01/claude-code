import React, { useMemo, useState } from 'react';
import type { SimulationState, PurchasePlan, PurchaseSpec, SalePlan, Proposal } from '../../engine';
import { planPurchase, previewProposal, planSale, formatMoney, label as lbl } from '../../engine';
import { Modal, KV, Money, Change, SourceTag } from './ui';

/** Purchase review: every figure computed from the live state via planPurchase. */
export const PurchaseReview: React.FC<{ state: SimulationState; spec: PurchaseSpec; onConfirm: (spec: PurchaseSpec) => void; onClose: () => void }> = ({ state, spec: initial, onConfirm, onClose }) => {
  const [spec, setSpec] = useState(initial);
  const c = state.profile.currency;
  let plan: PurchasePlan | null = null; let err: string | null = null;
  try { plan = planPurchase(state, spec); } catch (e: any) { err = e.message; }
  const financing = spec.financing;
  return (
    <Modal title="Purchase summary" sub={`${spec.name} · ${lbl(spec.category)}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!plan} onClick={() => onConfirm(spec)}>Confirm purchase</button></>}>
      {err && <div className="warning">{err}</div>}
      <div className="grid cols-2">
        <div>
          <label className="field">Price <SourceTag s={spec.price.source} />
            <input type="number" value={spec.price.value} onChange={(e) => setSpec({ ...spec, price: { value: +e.target.value, source: { type: 'user_override', label: 'Overridden on review screen' }, override: { original: initial.price.value, overriddenOn: state.currentDate } } })} />
          </label>
          {spec.price.source.range && <div className="small muted">Reference range {formatMoney(spec.price.source.range.low, c, true)}–{formatMoney(spec.price.source.range.high, c, true)}</div>}
          <div style={{ marginTop: 10 }}>
            <label className="field">Financing
              <select value={financing ? financing.kind : 'cash'} onChange={(e) => { const v = e.target.value; setSpec({ ...spec, financing: v === 'cash' ? undefined : { kind: v as any, downPaymentPct: financing?.downPaymentPct ?? 0.3, annualRate: financing?.annualRate ?? (undefined as any), termMonths: financing?.termMonths ?? (undefined as any) } }); }}>
                <option value="cash">Pay cash</option><option value="mortgage">Mortgage</option><option value="auto_loan">Auto loan</option><option value="aircraft_loan">Aircraft loan</option><option value="marine_loan">Marine loan</option><option value="business_loan">Business acquisition loan</option><option value="securities_backed">Securities-backed line (interest-only)</option><option value="personal_loan">Personal loan</option><option value="custom">Custom</option>
              </select>
            </label>
            {financing && (<div className="row" style={{ marginTop: 8 }}>
              <label className="field">Down payment %<input type="number" step="1" value={Math.round((financing.downPaymentPct ?? 0.3) * 100)} onChange={(e) => setSpec({ ...spec, financing: { ...financing, downPaymentPct: +e.target.value / 100, downPayment: undefined } })} /></label>
              <label className="field">Rate % (blank = default)<input type="number" step="0.05" value={financing.annualRate != null ? +(financing.annualRate * 100).toFixed(3) : ''} onChange={(e) => setSpec({ ...spec, financing: { ...financing, annualRate: e.target.value === '' ? (undefined as any) : +e.target.value / 100 } })} /></label>
              <label className="field">Term (months)<input type="number" value={financing.termMonths ?? ''} onChange={(e) => setSpec({ ...spec, financing: { ...financing, termMonths: e.target.value === '' ? (undefined as any) : +e.target.value } })} /></label>
            </div>)}
          </div>
          {plan?.storage.needsStorage && (<div style={{ marginTop: 10 }}>
            <label className="field">Storage
              <select value={spec.storageLocationId === null ? 'none' : spec.storageLocationId ?? 'auto'} onChange={(e) => setSpec({ ...spec, storageLocationId: e.target.value === 'auto' ? undefined : e.target.value === 'none' ? null : e.target.value })}>
                <option value="auto">Auto-assign{plan.storage.locationName ? ` (${plan.storage.locationName})` : ' (none available)'}</option>
                <option value="none">Leave unassigned</option>
                {Object.values(state.storage).filter((l) => l.status === 'active' && l.accepts.includes(spec.category)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            {!plan.storage.locationId && plan.storage.options.length > 0 && <div className="notice"><b>All storage is full.</b> Options: <ul style={{ margin: '4px 0 0 16px' }}>{plan.storage.options.map((o) => <li key={o}>{o}</li>)}</ul></div>}
          </div>)}
        </div>
        {plan && (<div>
          <KV rows={[
            ['Purchase price', <Money v={plan.price} c={c} compact={false} />],
            ['Sales / transfer tax', <Money v={plan.salesTax} c={c} compact={false} />],
            ...plan.feeBreakdown.map((f) => [f.label, <Money v={f.amount} c={c} compact={false} />] as [string, React.ReactNode]),
            ...(plan.loanAmount > 0 ? [['Financed', <Money v={plan.loanAmount} c={c} compact={false} />], [`Loan: ${(plan.loanRate * 100).toFixed(2)}% · ${plan.loanTermMonths} mo`, <><Money v={plan.loanMonthlyPayment} c={c} compact={false} />/mo</>]] as [string, React.ReactNode][] : []),
            ['Immediate cash requirement', <Money v={plan.cashRequired} c={c} compact={false} />, true],
          ]} />
          <h3 style={{ margin: '14px 0 6px', fontSize: 11, letterSpacing: '.1em', color: 'var(--ink-3)' }}>ESTIMATED ANNUAL OWNERSHIP</h3>
          <KV rows={[...plan.recurring.map((r) => [r.name, <Money v={r.annual} c={c} compact={false} />] as [string, React.ReactNode]), ...(plan.loanAmount ? [['Loan interest (year 1 approx.)', <Money v={plan.loanAmount * plan.loanRate} c={c} compact={false} />] as [string, React.ReactNode]] : []), ['Estimated value change', <Money v={plan.estimatedAnnualValueChange} c={c} compact={false} signed />], ['Total annual cost', <Money v={plan.annualOwnershipCost} c={c} compact={false} />, true]]} />
        </div>)}
      </div>
      {plan && (<div className="card" style={{ marginTop: 16 }}>
        <h3>Financial position after purchase</h3>
        <div className="grid cols-3">
          <div><div className="small muted">Cash</div><Change from={plan.before.cash} to={plan.after.cash} c={c} /></div>
          <div><div className="small muted">Total assets</div><Change from={plan.before.totalAssets} to={plan.after.totalAssets} c={c} /></div>
          <div><div className="small muted">Liabilities</div><Change from={plan.before.totalLiabilities} to={plan.after.totalLiabilities} c={c} /></div>
          <div><div className="small muted">Net worth</div><Change from={plan.before.netWorth} to={plan.after.netWorth} c={c} /></div>
          <div><div className="small muted">Annual lifestyle burn</div><Change from={plan.before.annualLifestyleBurn} to={plan.after.annualLifestyleBurn} c={c} /></div>
          <div><div className="small muted">Monthly cash flow</div><Change from={plan.before.monthlyCashFlow} to={plan.after.monthlyCashFlow} c={c} /></div>
        </div>
        {plan.warnings.map((w) => <div className="warning" key={w}>{w}</div>)}
      </div>)}
      {plan && <details style={{ marginTop: 12 }}><summary className="small muted" style={{ cursor: 'pointer' }}>Assumptions ({plan.assumptions.length})</summary><AssumptionList items={plan.assumptions} c={c} /></details>}
      <div className="disclaimer">All figures are simulated estimates computed from the current simulation state. Reference prices are not live quotes.</div>
    </Modal>
  );
};

export const AssumptionList: React.FC<{ items: { label: string; value: string | number; kind: string; source?: any }[]; c: string }> = ({ items, c }) => (
  <div className="assump" style={{ marginTop: 8 }}>
    {items.map((a, i) => (<React.Fragment key={i}><span className="k">{a.label}</span><span className="mono">{typeof a.value === 'number' ? formatMoney(a.value, c, false) : a.value}</span><span className={`tag ${a.kind === 'real_world_data' ? 'src-retrieved_real_world' : a.kind === 'user_override' ? 'src-user_override' : a.kind === 'calculated_value' ? 'src-calculated_estimate' : ''}`}>{a.kind.replace(/_/g, ' ')}</span></React.Fragment>))}
  </div>
);

export const SaleReview: React.FC<{ state: SimulationState; assetId: string; initialPrice?: number; onConfirm: (price: number) => void; onClose: () => void }> = ({ state, assetId, initialPrice, onConfirm, onClose }) => {
  const a = state.assets[assetId];
  const [price, setPrice] = useState(initialPrice ?? a.currentValue);
  const c = state.profile.currency;
  let plan: SalePlan | null = null; let err: string | null = null;
  try { plan = planSale(state, assetId, { value: price, source: { type: 'user_entered' } }); } catch (e: any) { err = e.message; }
  return (
    <Modal title={`Sell ${a.name}`} sub={`Carrying value ${formatMoney(a.currentValue, c, false)} · cost basis ${formatMoney(a.costBasis, c, false)} · bought ${a.purchaseDate}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!plan} onClick={() => onConfirm(price)}>Confirm sale</button></>}>
      {err && <div className="warning">{err}</div>}
      <label className="field">Sale price<input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} /></label>
      {plan && (<div style={{ marginTop: 12 }}>
        <KV rows={[['Sale price', <Money v={plan.salePrice} c={c} compact={false} />], ...plan.feeBreakdown.map((f) => [f.label, <Money v={-f.amount} c={c} compact={false} />] as [string, React.ReactNode]), ...(plan.loanPayoff ? [['Loan payoff', <Money v={-plan.loanPayoff} c={c} compact={false} />] as [string, React.ReactNode]] : []), ['Net cash proceeds', <Money v={plan.netProceeds} c={c} compact={false} />, true], [`Taxable gain (${plan.longTerm ? 'long-term' : 'short-term'})`, <Money v={plan.taxableGain} c={c} compact={false} signed />], ['Estimated capital gains tax (settles annually)', <Money v={plan.estimatedCapitalGainsTax} c={c} compact={false} />], ['Carrying costs ended (annual)', <Money v={plan.endedRecurringAnnual} c={c} compact={false} />]]} />
        <div className="grid cols-3" style={{ marginTop: 14 }}>
          <div><div className="small muted">Cash</div><Change from={plan.before.cash} to={plan.after.cash} c={c} /></div>
          <div><div className="small muted">Net worth</div><Change from={plan.before.netWorth} to={plan.after.netWorth} c={c} /></div>
          <div><div className="small muted">Annual burn</div><Change from={plan.before.annualLifestyleBurn} to={plan.after.annualLifestyleBurn} c={c} /></div>
        </div>
        {plan.warnings.map((w) => <div className="warning" key={w}>{w}</div>)}
      </div>)}
    </Modal>
  );
};

/** Proposal review: assistant-created structures (staff, projects, custom assets...) shown before commit. */
export const ProposalReview: React.FC<{ state: SimulationState; proposal: Proposal; onConfirm: (p: Proposal) => void; onClose: () => void }> = ({ state, proposal: initial, onConfirm, onClose }) => {
  const [proposal, setProposal] = useState(initial);
  const c = state.profile.currency;
  const preview = useMemo(() => { try { return { p: previewProposal(state, proposal), err: null }; } catch (e: any) { return { p: null, err: e.message as string }; } }, [state, proposal]);
  const setAmount = (idx: number, v: number) => {
    const prims = structuredClone(proposal.primitives);
    const p: any = prims[idx];
    const ov = { type: 'user_override' as const, label: 'Overridden on review screen' };
    if (p.kind === 'recurring_expense' || p.kind === 'one_time_expense' || p.kind === 'income_stream') p.amount = { value: v, source: ov, override: { original: p.amount.value, overriddenOn: state.currentDate } };
    else if (p.kind === 'staff') p.baseSalary = { value: v, source: ov, override: { original: p.baseSalary.value, overriddenOn: state.currentDate } };
    else if (p.kind === 'project') p.input.estimatedCost = { value: v, source: ov, override: { original: p.input.estimatedCost.value, overriddenOn: state.currentDate } };
    else if (p.kind === 'custom_asset') p.value = { value: v, source: ov, override: { original: p.value.value, overriddenOn: state.currentDate } };
    else if (p.kind === 'asset') p.spec.price = { value: v, source: ov, override: { original: p.spec.price.value, overriddenOn: state.currentDate } };
    else if (p.kind === 'storage_location') p.monthlyRent = v;
    else if (p.kind === 'liability') p.principal = v;
    setProposal({ ...proposal, primitives: prims });
  };
  const amountOf = (p: any): { v: number; unit: string; src?: any } => {
    switch (p.kind) {
      case 'recurring_expense': case 'income_stream': return { v: p.amount.value, unit: `/${p.interval.replace('ly', '')}`, src: p.amount.source };
      case 'one_time_expense': return { v: p.amount.value, unit: ' once', src: p.amount.source };
      case 'staff': return { v: p.baseSalary.value, unit: '/yr base', src: p.baseSalary.source };
      case 'project': return { v: p.input.estimatedCost.value, unit: ' estimate', src: p.input.estimatedCost.source };
      case 'custom_asset': return { v: p.value.value, unit: ' value', src: p.value.source };
      case 'asset': return { v: p.spec.price.value, unit: ' price', src: p.spec.price.source };
      case 'storage_location': return { v: p.monthlyRent ?? 0, unit: '/month rent' };
      case 'liability': return { v: p.principal, unit: ' principal' };
      case 'event': return { v: 0, unit: '' };
      default: return { v: 0, unit: '' };
    }
  };
  const nameOf = (p: any) => p.kind === 'asset' ? p.spec.name : p.kind === 'staff' ? p.role : p.kind === 'project' ? p.input.name : p.kind === 'event' ? p.spec.name : p.name;
  return (
    <Modal title={proposal.title} sub={`Proposed by ${proposal.createdBy === 'llm' ? 'AI assistant' : 'assistant'} · ${proposal.primitives.length} financial object${proposal.primitives.length > 1 ? 's' : ''}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Reject</button><button className="btn primary" disabled={!preview.p} onClick={() => onConfirm(proposal)}>Confirm & commit</button></>}>
      <div className="notice" style={{ whiteSpace: 'pre-wrap' }}>{proposal.explanation}</div>
      {preview.err && <div className="warning">{preview.err}</div>}
      <table className="data" style={{ marginTop: 10 }}>
        <thead><tr><th>Object</th><th>Type</th><th className="num">Amount</th><th>Source</th></tr></thead>
        <tbody>{proposal.primitives.map((p, i) => { const a = amountOf(p); return (<tr key={i}><td>{nameOf(p)}</td><td className="muted">{lbl(p.kind)}</td><td className="num">{p.kind === 'event' ? <Money v={preview.p?.lines.find((l) => l.label === (p as any).spec.name)?.amount ?? 0} c={c} compact={false} /> : <span><input type="number" style={{ width: 140, textAlign: 'right' }} value={a.v} onChange={(e) => setAmount(i, +e.target.value)} /><span className="muted small">{a.unit}</span></span>}</td><td><SourceTag s={a.src} /></td></tr>); })}</tbody>
      </table>
      {preview.p && (<div className="card" style={{ marginTop: 14 }}>
        <h3>Impact</h3>
        <div className="grid cols-4">
          <div><div className="small muted">Immediate cash</div><Money v={preview.p.immediateCash} c={c} /></div>
          <div><div className="small muted">Annual recurring</div><Money v={preview.p.annualRecurring} c={c} /></div>
          <div><div className="small muted">New assets</div><Money v={preview.p.newAssetValue} c={c} /></div>
          <div><div className="small muted">New debt</div><Money v={preview.p.newDebt} c={c} /></div>
        </div>
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          <div><div className="small muted">Cash</div><Change from={preview.p.before.cash} to={preview.p.after.cash} c={c} /></div>
          <div><div className="small muted">Net worth</div><Change from={preview.p.before.netWorth} to={preview.p.after.netWorth} c={c} /></div>
          <div><div className="small muted">Annual burn</div><Change from={preview.p.before.annualLifestyleBurn} to={preview.p.after.annualLifestyleBurn} c={c} /></div>
        </div>
        {preview.p.warnings.map((w) => <div className="warning" key={w}>{w}</div>)}
      </div>)}
      {(proposal.assumptions.length > 0 || proposal.primitives.some((p: any) => p.assumptions?.length)) && <details style={{ marginTop: 12 }}><summary className="small muted" style={{ cursor: 'pointer' }}>Assumptions & sources</summary><AssumptionList items={[...proposal.assumptions, ...proposal.primitives.flatMap((p: any) => p.assumptions ?? [])]} c={c} /></details>}
    </Modal>
  );
};

import React, { useState } from 'react';
import type { Store } from '../store';
import type { Asset } from '../../engine';
import { assetGain, annualCarryingCost, revalueAsset, updateValueRule, assignStorage, commitSale, label as lbl, formatMoney, formatDate } from '../../engine';
import { Card, Money, SourceTag, KV, Empty, Date_ } from '../components/ui';
import { SaleReview, AssumptionList } from '../components/reviews';

const CATS = ['real_estate', 'vehicle', 'aircraft', 'yacht', 'art', 'jewelry_watches', 'collectible', 'business', 'public_security', 'private_investment', 'land', 'furniture', 'luxury_goods', 'custom_physical', 'custom_financial'];

export const Assets: React.FC<{ store: Store; filter?: string[]; title?: string }> = ({ store, filter, title }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [cat, setCat] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [showSold, setShowSold] = useState(false);
  const owned = Object.values(s.assets).filter((a) => (showSold ? true : a.status === 'owned') && (!filter || filter.includes(a.category)) && (cat === 'all' || a.category === cat)).sort((a, b) => b.currentValue - a.currentValue);
  const cats = Array.from(new Set(Object.values(s.assets).filter((a) => a.status === 'owned' && (!filter || filter.includes(a.category))).map((a) => a.category)));
  const total = owned.filter((a) => a.status === 'owned').reduce((x, a) => x + a.currentValue, 0);
  return (
    <div>
      <h1 className="page-title">{title ?? 'Assets'}</h1>
      <p className="page-sub">{owned.filter((a) => a.status === 'owned').length} owned · <Money v={total} c={c} /> · click a row for details, valuation, storage and sale</p>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className={`btn small ${cat === 'all' ? 'primary' : ''}`} onClick={() => setCat('all')}>All</button>
        {(filter ?? CATS).filter((k) => cats.includes(k as any)).map((k) => <button key={k} className={`btn small ${cat === k ? 'primary' : ''}`} onClick={() => setCat(k)}>{lbl(k)}</button>)}
        <label className="small muted" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} /> show sold</label>
      </div>
      <Card>
        {owned.length === 0 ? <Empty text="No assets in this category yet. Use Purchase or ask an assistant." /> : (<div className="scroll-x"><table className="data">
          <thead><tr><th>Asset</th><th>Category</th><th>Location</th><th className="num">Purchase</th><th className="num">Current value</th><th className="num">Gain / loss</th><th className="num">Annual carry</th><th>Source</th></tr></thead>
          <tbody>{owned.map((a) => (<tr key={a.id} className="clickable" onClick={() => setSel(a.id)} style={a.status !== 'owned' ? { opacity: 0.5 } : undefined}>
            <td>{a.name}{a.status !== 'owned' && <span className="tag" style={{ marginLeft: 6 }}>sold</span>}</td><td className="muted">{lbl(a.category)}</td><td className="muted small">{a.storageLocationId ? s.storage[a.storageLocationId]?.name : a.details.kind === 'property' ? a.details.property.address : a.liquidity === 'liquid' ? 'Brokerage' : '—'}</td>
            <td className="num"><Money v={a.purchasePrice} c={c} /></td><td className="num"><Money v={a.status === 'owned' ? a.currentValue : a.sale?.price ?? 0} c={c} /></td><td className="num"><Money v={a.status === 'owned' ? assetGain(a) : a.sale?.gain ?? 0} c={c} signed /></td><td className="num"><Money v={annualCarryingCost(s, a.id)} c={c} /></td><td><SourceTag s={a.acquisition?.price.source ?? a.lastValuation?.source} /></td>
          </tr>))}</tbody>
        </table></div>)}
      </Card>
      {sel && s.assets[sel] && <AssetDrawer store={store} asset={s.assets[sel]} onClose={() => setSel(null)} />}
    </div>
  );
};

export const AssetDrawer: React.FC<{ store: Store; asset: Asset; onClose: () => void }> = ({ store, asset: a, onClose }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [sell, setSell] = useState(false);
  const [newVal, setNewVal] = useState(a.currentValue);
  const [rate, setRate] = useState((a.valueRule.annualRate * 100).toFixed(1));
  const recs = a.recurringIds.map((id) => s.recurring[id]).filter((r) => r && r.status === 'active');
  const loans = a.liabilityIds.map((id) => s.liabilities[id]).filter((l) => l && l.status === 'active');
  const vals = s.valuations.filter((v) => v.assetId === a.id).slice(-8).reverse();
  const locs = Object.values(s.storage).filter((l) => l.status === 'active' && l.accepts.includes(a.category));
  const details: [string, React.ReactNode][] = [];
  if (a.details.kind === 'property') { const p = a.details.property; details.push(['Address', p.address], ['Type / use', `${p.propertyType} · ${lbl(p.use)}`], ['Size', `${p.squareFeet?.toLocaleString() ?? '—'} sq ft · ${p.bedrooms ?? '—'} bd / ${p.bathrooms ?? '—'} ba`], ['Garage / parking / storage', `${p.garageCapacity} / ${p.parkingSpaces} / ${p.storageCapacity}`]); }
  if (a.details.kind === 'vehicle') details.push(['Vehicle', `${a.details.vehicle.year} ${a.details.vehicle.make} ${a.details.vehicle.model}`]);
  if (a.details.kind === 'aircraft') details.push(['Aircraft', `${a.details.aircraft.manufacturer} ${a.details.aircraft.model} (${a.details.aircraft.year}) · ${a.details.aircraft.annualFlightHours} hrs/yr`]);
  if (a.details.kind === 'yacht') details.push(['Yacht', `${a.details.yacht.builder} ${a.details.yacht.model} · ${a.details.yacht.lengthMeters}m`]);
  if (a.details.kind === 'security') details.push(['Holding', `${lbl(a.details.security.assetClass)} · exp. ${(a.details.security.expectedAnnualReturn * 100).toFixed(1)}%/yr · vol ${(a.details.security.annualVolatility * 100).toFixed(0)}% · yield ${(a.details.security.dividendYield * 100).toFixed(1)}%`]);
  if (a.details.kind === 'generic') for (const [k, v] of Object.entries(a.details.fields)) details.push([lbl(k), String(v)]);
  return (
    <div className="drawer">
      <div className="btn-row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 400 }}>{a.name}</h2><button className="btn small ghost" onClick={onClose}>✕</button></div>
      <div className="small muted" style={{ marginBottom: 12 }}>{lbl(a.category)} · {a.status} · {lbl(a.liquidity)} · created by {a.createdBy}</div>
      <div className="grid cols-2" style={{ marginBottom: 12 }}>
        <div><div className="small muted">Current value</div><div className="hero" style={{ fontSize: 26 }}>{formatMoney(a.currentValue, c, true)}</div></div>
        <div><div className="small muted">Gain / loss vs basis</div><div className="hero" style={{ fontSize: 26 }}><Money v={assetGain(a)} c={c} signed /></div></div>
      </div>
      <KV rows={[['Purchase price', <><Money v={a.purchasePrice} c={c} compact={false} /> <SourceTag s={a.acquisition?.price.source} /></>], ['Purchase date', formatDate(a.purchaseDate)], ['Cost basis (incl. fees, capitalized work)', <Money v={a.costBasis} c={c} compact={false} />], ...(a.acquisition ? [['Acquisition taxes + fees', <Money v={a.acquisition.taxes + a.acquisition.fees} c={c} compact={false} />] as [string, React.ReactNode]] : []), ['Annual carrying cost', <Money v={annualCarryingCost(s, a.id)} c={c} compact={false} />], ['Last valued', a.lastValuation ? <>{formatDate(a.lastValuation.date)} <SourceTag s={a.lastValuation.source} /></> : 'simulation only'], ...details]} />
      {a.acquisition?.listing && <div className="notice small">Acquisition snapshot: {a.acquisition.listing.source.label} {a.acquisition.listing.source.reference && <a href={a.acquisition.listing.source.reference} target="_blank" rel="noreferrer">↗</a>} · listed {formatMoney(a.acquisition.listing.listingPrice, c, false)} · retrieved {a.acquisition.listing.source.retrievedOn}{a.acquisition.listing.listingId ? ` · ref ${a.acquisition.listing.listingId}` : ''}. Frozen at purchase; later valuations never change it.</div>}
      {a.status === 'owned' && (<>
        <Card title="Valuation" style={{ marginTop: 14 }}>
          <div className="row">
            <label className="field">New estimated value<input type="number" value={newVal} onChange={(e) => setNewVal(+e.target.value)} /></label>
            <button className="btn" style={{ flex: 0 }} onClick={() => store.apply((st) => { const d = structuredClone(st); revalueAsset(d, a.id, newVal, { type: 'user_override', label: 'Manual revaluation' }); return d; }, 'Revalued')}>Record valuation</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="field">Annual value change assumption %<input type="number" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
            <button className="btn" style={{ flex: 0 }} onClick={() => store.mutate((d) => updateValueRule(d, a.id, { annualRate: +rate / 100 }), 'Value rule updated')}>Override rule</button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Rule: {(a.valueRule.annualRate * 100).toFixed(1)}%/yr ± {(a.valueRule.annualVolatility * 100).toFixed(0)}% <SourceTag s={a.valueRule.source} /> {a.valueRule.source.label && `· ${a.valueRule.source.label}`}</div>
          {vals.length > 0 && <table className="data" style={{ marginTop: 8 }}><tbody>{vals.map((v) => <tr key={v.id}><td><Date_ d={v.date} /></td><td className="num"><Money v={v.previousValue} c={c} /> → <Money v={v.newValue} c={c} /></td><td><SourceTag s={v.source} /></td></tr>)}</tbody></table>}
        </Card>
        {locs.length > 0 && (<Card title="Storage" style={{ marginTop: 14 }}>
          <select value={a.storageLocationId ?? ''} onChange={(e) => store.mutate((d) => assignStorage(d, a.id, e.target.value || null), 'Moved')}>
            <option value="">Unassigned</option>
            {locs.map((l) => { const occ = Object.values(s.assets).filter((x) => x.status === 'owned' && x.storageLocationId === l.id).length; return <option key={l.id} value={l.id} disabled={occ >= l.capacity && a.storageLocationId !== l.id}>{l.name} ({occ}/{l.capacity})</option>; })}
          </select>
        </Card>)}
      </>)}
      <Card title="Attached recurring costs" style={{ marginTop: 14 }}>
        {recs.length === 0 ? <div className="muted small">None.</div> : <table className="data"><tbody>{recs.map((r) => <tr key={r.id}><td>{r.name.replace(` — ${a.name}`, '')}</td><td className="muted small">{r.interval}</td><td className="num"><Money v={r.amount.value} c={c} compact={false} /></td><td><SourceTag s={r.amount.source} /></td></tr>)}</tbody></table>}
        {loans.map((l) => <div key={l.id} className="small" style={{ marginTop: 6 }}>Loan: {l.name} · balance <Money v={l.balance} c={c} /> · {(l.annualRate * 100).toFixed(2)}% · <Money v={l.monthlyPayment} c={c} />/mo</div>)}
      </Card>
      {a.assumptions.length > 0 && <Card title="Assumptions & sources" style={{ marginTop: 14 }}><AssumptionList items={a.assumptions} c={c} /></Card>}
      {a.status === 'owned' && a.resaleAllowed && <div className="btn-row" style={{ marginTop: 16 }}><button className="btn danger" onClick={() => setSell(true)}>Sell {a.name}</button></div>}
      {a.sale && <div className="notice">Sold {formatDate(a.sale.date)} for {formatMoney(a.sale.price, c, false)}; proceeds {formatMoney(a.sale.proceeds, c, false)}; gain vs basis {formatMoney(a.sale.gain, c, false)}.</div>}
      {sell && <SaleReview state={s} assetId={a.id} onClose={() => setSell(false)} onConfirm={(price) => { if (store.apply((st) => commitSale(st, a.id, { value: price, source: { type: 'user_entered' } }).state, `Sold ${a.name}`)) { setSell(false); onClose(); } }} />}
    </div>
  );
};

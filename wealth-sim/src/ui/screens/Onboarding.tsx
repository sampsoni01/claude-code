import React, { useState } from 'react';
import { createSimulation, JURISDICTIONS, type SimulationConfig, type TaxJurisdictionId, type SimulationState } from '../../engine';
import { Card } from '../components/ui';

const PRESETS: { name: string; desc: string; cfg: Partial<SimulationConfig> }[] = [
  { name: 'Highly paid executive', desc: '$4M salary, $6M cash, $12M portfolio, one mortgaged home.', cfg: { annualSalary: 4_000_000, startingCash: 6_000_000, investments: [{ name: 'Diversified ETF portfolio', value: 12_000_000, assetClass: 'etf' }], properties: [{ name: 'Upper West Side apartment', value: 9_000_000, address: 'New York, NY', propertyType: 'apartment', use: 'primary_residence', squareFeet: 3_800, bedrooms: 4, bathrooms: 3.5, garageCapacity: 1, mortgageBalance: 4_500_000, mortgageRate: 0.0625, mortgageMonthsRemaining: 320 }], lifestyle: [{ name: 'Travel & dining', monthly: 25_000, category: 'travel' }, { name: 'Private school (2 children)', monthly: 11_000, category: 'education' }] } },
  { name: 'Founder after exit', desc: '$180M net worth, mostly liquid; no salary.', cfg: { annualSalary: 0, startingCash: 40_000_000, investments: [{ name: 'Index funds', value: 90_000_000, assetClass: 'etf' }, { name: 'Venture fund commitments', value: 25_000_000, assetClass: 'venture' }, { name: 'Municipal bonds', value: 20_000_000, assetClass: 'bond' }], properties: [{ name: 'Pacific Heights home', value: 22_000_000, address: 'San Francisco, CA', propertyType: 'house', use: 'primary_residence', squareFeet: 7_500, bedrooms: 6, bathrooms: 6, garageCapacity: 3 }], lifestyle: [{ name: 'Lifestyle', monthly: 120_000, category: 'custom' }], taxJurisdiction: 'US-CA', location: 'San Francisco, CA' } },
  { name: 'Asset-rich billionaire', desc: '$2.4B net worth, $15M cash. Big business stake, illiquid holdings.', cfg: { annualSalary: 1_500_000, startingCash: 15_000_000, investments: [{ name: 'Public equities', value: 300_000_000, assetClass: 'stock' }, { name: 'Private equity funds', value: 250_000_000, assetClass: 'private_equity' }], businesses: [{ name: 'Meridian Industrial Holdings (65%)', value: 1_700_000_000, industry: 'Industrial manufacturing', annualRevenue: 900_000_000, annualOperatingExpenses: 520_000_000, annualPayroll: 210_000_000, employees: 3_200, ownershipPct: 0.65, annualGrowthRate: 0.06, distributionRate: 0.25 }], properties: [{ name: 'Palm Beach estate', value: 85_000_000, address: 'Palm Beach, FL', propertyType: 'estate', use: 'primary_residence', squareFeet: 22_000, bedrooms: 10, bathrooms: 14, garageCapacity: 12, storageCapacity: 100 }, { name: 'Aspen chalet', value: 30_000_000, address: 'Aspen, CO', propertyType: 'chalet', use: 'vacation_residence', squareFeet: 9_000, bedrooms: 6, bathrooms: 7, garageCapacity: 4 }], lifestyle: [{ name: 'Household & lifestyle', monthly: 450_000, category: 'custom' }], taxJurisdiction: 'US-FL', location: 'Palm Beach, FL' } },
  { name: 'London family office', desc: '£120M across property, a rental portfolio, and funds.', cfg: { annualSalary: 800_000, startingCash: 9_000_000, currency: 'GBP', taxJurisdiction: 'UK', location: 'London', investments: [{ name: 'Global equity funds', value: 45_000_000, assetClass: 'etf' }, { name: 'Gilts', value: 12_000_000, assetClass: 'bond' }], properties: [{ name: 'Kensington townhouse', value: 28_000_000, address: 'Kensington, London', propertyType: 'townhouse', use: 'primary_residence', squareFeet: 7_800, bedrooms: 6, bathrooms: 6, garageCapacity: 2 }, { name: 'Mayfair rental block', value: 32_000_000, address: 'Mayfair, London', propertyType: 'multifamily', use: 'rental_property', squareFeet: 18_000, garageCapacity: 0, monthlyRent: 145_000, mortgageBalance: 14_000_000, mortgageRate: 0.055, mortgageMonthsRemaining: 240 }], lifestyle: [{ name: 'Household', monthly: 90_000, category: 'custom' }] } },
];

export const Onboarding: React.FC<{ onCreate: (s: SimulationState) => void; onImport: (json: string) => void }> = ({ onCreate, onImport }) => {
  const [cfg, setCfg] = useState<SimulationConfig>({ name: 'Alex Meridian', location: 'New York, NY', taxJurisdiction: 'US-NY', currency: 'USD', startDate: '2026-01-01', annualSalary: 3_000_000, startingCash: 20_000_000, investments: [{ name: 'Diversified ETF portfolio', value: 30_000_000, assetClass: 'etf' }], properties: [{ name: 'Tribeca loft', value: 15_000_000, address: 'Tribeca, New York, NY', propertyType: 'penthouse', use: 'primary_residence', squareFeet: 5_000, bedrooms: 4, bathrooms: 4, garageCapacity: 2, mortgageBalance: 5_000_000, mortgageRate: 0.06, mortgageMonthsRemaining: 300 }], businesses: [], debts: [], lifestyle: [{ name: 'Travel & dining', monthly: 40_000, category: 'travel' }], realismEvents: true, seed: Math.floor(Math.random() * 1e9) });
  const set = (patch: Partial<SimulationConfig>) => setCfg({ ...cfg, ...patch });
  const nw = cfg.startingCash + (cfg.investments ?? []).reduce((s, i) => s + i.value, 0) + (cfg.properties ?? []).reduce((s, p) => s + p.value - (p.mortgageBalance ?? 0), 0) + (cfg.businesses ?? []).reduce((s, b) => s + b.value, 0) - (cfg.debts ?? []).reduce((s, d) => s + d.balance, 0);
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="content onboard">
      <h1 className="page-title">Create a simulation</h1>
      <p className="page-sub">Everything here is fictional. Configure who you are and what you start with; the engine handles the rest.</p>
      <Card title="Start from a preset">
        <div className="grid cols-4">{PRESETS.map((p) => <button key={p.name} className="btn" style={{ textAlign: 'left', whiteSpace: 'normal', padding: 12 }} onClick={() => set({ ...p.cfg, businesses: p.cfg.businesses ?? [], debts: [] })}><b>{p.name}</b><div className="small muted" style={{ marginTop: 4 }}>{p.desc}</div></button>)}</div>
      </Card>
      <Card title="Profile">
        <div className="row">
          <label className="field">Name<input value={cfg.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Primary location<input value={cfg.location} onChange={(e) => set({ location: e.target.value })} /></label>
          <label className="field">Tax jurisdiction<select value={cfg.taxJurisdiction} onChange={(e) => { const j = e.target.value as TaxJurisdictionId; set({ taxJurisdiction: j, currency: JURISDICTIONS[j].currency }); }}>{Object.values(JURISDICTIONS).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
          <label className="field">Currency<input value={cfg.currency} onChange={(e) => set({ currency: e.target.value })} /></label>
          <label className="field">Start date<input type="date" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>{JURISDICTIONS[cfg.taxJurisdiction].notes} Taxes are simplified simulated estimates.</div>
      </Card>
      <Card title="Income & cash">
        <div className="row">
          <label className="field">Annual salary<input type="number" value={cfg.annualSalary} onChange={(e) => set({ annualSalary: +e.target.value })} /></label>
          <label className="field">Starting cash<input type="number" value={cfg.startingCash} onChange={(e) => set({ startingCash: +e.target.value })} /></label>
          <label className="field">Monthly lifestyle spend<input type="number" value={cfg.lifestyle?.[0]?.monthly ?? 0} onChange={(e) => set({ lifestyle: [{ name: 'Lifestyle spending', monthly: +e.target.value, category: 'custom' }] })} /></label>
        </div>
      </Card>
      <Card title="Investments" right={<button className="btn small" onClick={() => set({ investments: [...(cfg.investments ?? []), { name: 'New holding', value: 1_000_000, assetClass: 'etf' }] })}>+ Add</button>}>
        {(cfg.investments ?? []).map((inv, i) => (<div className="row" key={i} style={{ marginBottom: 6 }}>
          <label className="field">Name<input value={inv.name} onChange={(e) => { const a = [...cfg.investments!]; a[i] = { ...inv, name: e.target.value }; set({ investments: a }); }} /></label>
          <label className="field">Value<input type="number" value={inv.value} onChange={(e) => { const a = [...cfg.investments!]; a[i] = { ...inv, value: +e.target.value }; set({ investments: a }); }} /></label>
          <label className="field">Class<select value={inv.assetClass} onChange={(e) => { const a = [...cfg.investments!]; a[i] = { ...inv, assetClass: e.target.value as any }; set({ investments: a }); }}>{['stock', 'etf', 'bond', 'private_equity', 'venture', 'real_estate_fund', 'alternative', 'cash_equivalent'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></label>
          <button className="btn small ghost" style={{ flex: 0 }} onClick={() => set({ investments: cfg.investments!.filter((_, k) => k !== i) })}>✕</button>
        </div>))}
      </Card>
      <Card title="Real estate" right={<button className="btn small" onClick={() => set({ properties: [...(cfg.properties ?? []), { name: 'New property', value: 5_000_000, address: cfg.location, propertyType: 'house', use: 'vacation_residence', garageCapacity: 2 }] })}>+ Add</button>}>
        {(cfg.properties ?? []).map((p, i) => { const up = (patch: any) => { const a = [...cfg.properties!]; a[i] = { ...p, ...patch }; set({ properties: a }); }; return (<div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
          <div className="row">
            <label className="field">Name<input value={p.name} onChange={(e) => up({ name: e.target.value })} /></label>
            <label className="field">Address<input value={p.address} onChange={(e) => up({ address: e.target.value })} /></label>
            <label className="field">Type<input value={p.propertyType} onChange={(e) => up({ propertyType: e.target.value })} /></label>
            <label className="field">Use<select value={p.use} onChange={(e) => up({ use: e.target.value })}>{['primary_residence', 'vacation_residence', 'investment_property', 'rental_property', 'commercial_property', 'land'].map((u) => <option key={u} value={u}>{u.replace('_', ' ')}</option>)}</select></label>
            <button className="btn small ghost" style={{ flex: 0 }} onClick={() => set({ properties: cfg.properties!.filter((_, k) => k !== i) })}>✕</button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="field">Value<input type="number" value={p.value} onChange={(e) => up({ value: +e.target.value })} /></label>
            <label className="field">Sq ft<input type="number" value={p.squareFeet ?? ''} onChange={(e) => up({ squareFeet: +e.target.value })} /></label>
            <label className="field">Garage spaces<input type="number" value={p.garageCapacity} onChange={(e) => up({ garageCapacity: +e.target.value })} /></label>
            <label className="field">Mortgage balance<input type="number" value={p.mortgageBalance ?? 0} onChange={(e) => up({ mortgageBalance: +e.target.value })} /></label>
            <label className="field">Rate %<input type="number" step="0.05" value={((p.mortgageRate ?? 0.06) * 100).toFixed(2)} onChange={(e) => up({ mortgageRate: +e.target.value / 100 })} /></label>
            <label className="field">Months left<input type="number" value={p.mortgageMonthsRemaining ?? 300} onChange={(e) => up({ mortgageMonthsRemaining: +e.target.value })} /></label>
            {(p.use === 'rental_property' || p.use === 'commercial_property') && <label className="field">Monthly rent<input type="number" value={p.monthlyRent ?? 0} onChange={(e) => up({ monthlyRent: +e.target.value })} /></label>}
          </div>
        </div>); })}
      </Card>
      <Card title="Businesses" right={<button className="btn small" onClick={() => set({ businesses: [...(cfg.businesses ?? []), { name: 'New business', value: 20_000_000, industry: 'Services', annualRevenue: 15_000_000, annualOperatingExpenses: 7_000_000, annualPayroll: 5_000_000, employees: 60, ownershipPct: 1, annualGrowthRate: 0.05, distributionRate: 0.5 }] })}>+ Add</button>}>
        {(cfg.businesses ?? []).map((b, i) => { const up = (patch: any) => { const a = [...cfg.businesses!]; a[i] = { ...b, ...patch }; set({ businesses: a }); }; return (<div className="row" key={i} style={{ marginBottom: 8 }}>
          <label className="field">Name<input value={b.name} onChange={(e) => up({ name: e.target.value })} /></label>
          <label className="field">Your stake value<input type="number" value={b.value} onChange={(e) => up({ value: +e.target.value })} /></label>
          <label className="field">Revenue<input type="number" value={b.annualRevenue} onChange={(e) => up({ annualRevenue: +e.target.value })} /></label>
          <label className="field">Op. expenses<input type="number" value={b.annualOperatingExpenses} onChange={(e) => up({ annualOperatingExpenses: +e.target.value })} /></label>
          <label className="field">Payroll<input type="number" value={b.annualPayroll} onChange={(e) => up({ annualPayroll: +e.target.value })} /></label>
          <label className="field">Ownership %<input type="number" value={b.ownershipPct * 100} onChange={(e) => up({ ownershipPct: +e.target.value / 100 })} /></label>
          <label className="field">Distribution %<input type="number" value={b.distributionRate * 100} onChange={(e) => up({ distributionRate: +e.target.value / 100 })} /></label>
          <label className="field">Growth %<input type="number" value={b.annualGrowthRate * 100} onChange={(e) => up({ annualGrowthRate: +e.target.value / 100 })} /></label>
          <button className="btn small ghost" style={{ flex: 0 }} onClick={() => set({ businesses: cfg.businesses!.filter((_, k) => k !== i) })}>✕</button>
        </div>); })}
      </Card>
      <Card title="Other debt" right={<button className="btn small" onClick={() => set({ debts: [...(cfg.debts ?? []), { name: 'Securities-backed line', kind: 'securities_backed', balance: 5_000_000, annualRate: 0.065, monthsRemaining: 0, interestOnly: true }] })}>+ Add</button>}>
        {(cfg.debts ?? []).map((d, i) => { const up = (patch: any) => { const a = [...cfg.debts!]; a[i] = { ...d, ...patch }; set({ debts: a }); }; return (<div className="row" key={i} style={{ marginBottom: 6 }}>
          <label className="field">Name<input value={d.name} onChange={(e) => up({ name: e.target.value })} /></label>
          <label className="field">Kind<select value={d.kind} onChange={(e) => up({ kind: e.target.value })}>{['securities_backed', 'personal_loan', 'business_loan', 'auto_loan', 'custom'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select></label>
          <label className="field">Balance<input type="number" value={d.balance} onChange={(e) => up({ balance: +e.target.value })} /></label>
          <label className="field">Rate %<input type="number" step="0.05" value={(d.annualRate * 100).toFixed(2)} onChange={(e) => up({ annualRate: +e.target.value / 100 })} /></label>
          <label className="field">Months (0 = interest-only)<input type="number" value={d.monthsRemaining} onChange={(e) => up({ monthsRemaining: +e.target.value, interestOnly: +e.target.value === 0 })} /></label>
          <button className="btn small ghost" style={{ flex: 0 }} onClick={() => set({ debts: cfg.debts!.filter((_, k) => k !== i) })}>✕</button>
        </div>); })}
      </Card>
      <Card>
        <div className="row" style={{ alignItems: 'center' }}>
          <div><div className="small muted">Starting net worth</div><div className="hero">{cfg.currency} {fmt(nw)}</div><div className="small muted">Cash {fmt(cfg.startingCash)} · Net worth and cash are tracked separately.</div></div>
          <label className="field" style={{ flex: 0, minWidth: 200 }}><span><input type="checkbox" checked={cfg.realismEvents} onChange={(e) => set({ realismEvents: e.target.checked })} /> Realism events (optional)</span></label>
          <div className="btn-row" style={{ flex: 0 }}>
            <label className="btn">Import save<input type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) onImport(await f.text()); }} /></label>
            <button className="btn primary" onClick={() => onCreate(createSimulation(cfg))}>Start simulation</button>
          </div>
        </div>
      </Card>
    </div>
  );
};

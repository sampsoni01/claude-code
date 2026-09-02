import React, { useState } from 'react';
import type { Store } from '../store';
import { createProject, cancelProject, createEvent, cancelEvent, estimateEvent, PROJECT_REFERENCE, label as lbl, formatMoney, type EventSpec } from '../../engine';
import { Card, Money, Empty, SourceTag, Date_, KV } from '../components/ui';
import { AssumptionList } from '../components/reviews';

export const ProjectsEvents: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [tab, setTab] = useState<'projects' | 'events'>('projects');
  const props = Object.values(s.assets).filter((a) => a.status === 'owned' && ['real_estate', 'aircraft', 'yacht', 'land'].includes(a.category));
  const [pf, setPf] = useState({ key: 'kitchen_renovation', name: '', asset: props[0]?.id ?? '', cost: 300_000, months: 5, contingency: 15, cap: 50, immediate: false });
  const ref = PROJECT_REFERENCE[pf.key];
  const sqft = (s.assets[pf.asset]?.details.kind === 'property' ? (s.assets[pf.asset].details as any).property.squareFeet : undefined) ?? 5000;
  const low = ref.lowPerSqFt ? ref.lowPerSqFt * sqft : ref.low!, high = ref.highPerSqFt ? ref.highPerSqFt * sqft : ref.high!;
  const [ef, setEf] = useState<EventSpec>({ name: 'Summer party', kind: 'party', location: s.profile.location, guestCount: 150, venueTier: 'premium', foodTier: 'premium', entertainment: 'band', security: true, transportation: false, decorTier: 'premium', production: false });
  const est = estimateEvent(ef);
  const projects = Object.values(s.projects).sort((a, b) => (a.status === 'in_progress' ? -1 : 1) - (b.status === 'in_progress' ? -1 : 1));
  const events = Object.values(s.events).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div>
      <div className="tabs"><button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects & renovations</button><button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Events</button></div>
      {tab === 'projects' ? (<>
        <h1 className="page-title">Projects</h1>
        <p className="page-sub">Large projects pay out over time: a deposit, then monthly draws. Part of renovation spend is capitalized into the property; the rest is expensed.</p>
        <Card title="New project" style={{ marginBottom: 14 }}>
          <div className="row">
            <label className="field">Type<select value={pf.key} onChange={(e) => { const r = PROJECT_REFERENCE[e.target.value]; const sq = sqft; const l = r.lowPerSqFt ? r.lowPerSqFt * sq : r.low!, h = r.highPerSqFt ? r.highPerSqFt * sq : r.high!; setPf({ ...pf, key: e.target.value, cost: Math.round((l + h) / 2 / 1000) * 1000, months: r.months }); }}>{Object.entries(PROJECT_REFERENCE).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></label>
            <label className="field">Attached to<select value={pf.asset} onChange={(e) => setPf({ ...pf, asset: e.target.value })}><option value="">— none —</option>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="field">Name (optional)<input value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="field">Estimated cost (ref. {formatMoney(low, c, true)}–{formatMoney(high, c, true)})<input type="number" value={pf.cost} onChange={(e) => setPf({ ...pf, cost: +e.target.value })} /></label>
            <label className="field">Duration (months)<input type="number" value={pf.months} onChange={(e) => setPf({ ...pf, months: +e.target.value })} /></label>
            <label className="field">Contingency %<input type="number" value={pf.contingency} onChange={(e) => setPf({ ...pf, contingency: +e.target.value })} /></label>
            <label className="field">Capitalized into asset %<input type="number" value={pf.cap} onChange={(e) => setPf({ ...pf, cap: +e.target.value })} /></label>
            <label className="field"><span><input type="checkbox" checked={pf.immediate} onChange={(e) => setPf({ ...pf, immediate: e.target.checked })} /> pay all now</span></label>
            <button className="btn primary" style={{ flex: 0 }} onClick={() => store.mutate((d) => { createProject(d, { name: pf.name || `${ref.label}${pf.asset ? ` — ${d.assets[pf.asset].name}` : ''}`, attachedAssetId: pf.asset || undefined, estimatedCost: { value: pf.cost, source: { type: pf.cost === Math.round((low + high) / 2 / 1000) * 1000 ? 'calculated_estimate' : 'user_entered', label: `Reference ${formatMoney(low, c, true)}–${formatMoney(high, c, true)}`, range: { low, high } } }, costRange: { low, high }, durationMonths: pf.months, contingencyRate: pf.contingency / 100, capitalizationRate: pf.cap / 100, payImmediately: pf.immediate }); }, 'Project started')}>Start project</button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Budget incl. contingency: <Money v={pf.cost * (1 + pf.contingency / 100)} c={c} />. Reference ranges are built-in estimates, not quotes.</div>
        </Card>
        <Card>{projects.length === 0 ? <Empty text="No projects." /> : projects.map((p) => { const paid = p.payments.filter((x) => x.paid).length; const budget = p.payments.reduce((x, y) => x + y.amount, 0); return (<div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}><div><b>{p.name}</b> <span className={`tag ${p.status === 'in_progress' ? 'src-retrieved_real_world' : ''}`}>{lbl(p.status)}</span><div className="small muted">{p.attachedAssetId ? s.assets[p.attachedAssetId]?.name : 'not attached'} · started {p.startDate} · {p.durationMonths} months · {p.capitalizationRate * 100}% capitalized{p.overrunRate ? ` · overrun +${(p.overrunRate * 100).toFixed(0)}%` : ''}</div></div><div className="btn-row"><span className="mono"><Money v={p.actualCost} c={c} /> / <Money v={budget} c={c} /></span>{(p.status === 'in_progress' || p.status === 'planned') && <button className="btn small ghost" onClick={() => store.mutate((d) => cancelProject(d, p.id), 'Project cancelled')}>cancel</button>}</div></div>
          <div className="progress" style={{ margin: '6px 0' }}><div style={{ width: `${(paid / p.payments.length) * 100}%` }} /></div>
          <div className="small muted">Estimate <Money v={p.estimatedCost.value} c={c} /> <SourceTag s={p.estimatedCost.source} />{p.costRange && <> · range <Money v={p.costRange.low} c={c} />–<Money v={p.costRange.high} c={c} /></>} · {paid}/{p.payments.length} payments</div>
          <details><summary className="small muted" style={{ cursor: 'pointer' }}>Schedule & assumptions</summary><table className="data" style={{ marginTop: 6 }}><tbody>{p.payments.map((x, i) => <tr key={i}><td><Date_ d={x.date} /></td><td className="num"><Money v={x.amount * (x.paid ? 1 : 1 + p.overrunRate)} c={c} compact={false} /></td><td className="muted">{x.paid ? 'paid' : 'scheduled'}</td></tr>)}</tbody></table><AssumptionList items={p.assumptions} c={c} /></details>
        </div>); })}</Card>
      </>) : (<>
        <h1 className="page-title">Events</h1>
        <p className="page-sub">Costs are built from guest count and tier choices using per-guest reference rates. Paid in full on the event date.</p>
        <Card title="Plan an event" style={{ marginBottom: 14 }}>
          <div className="row">
            <label className="field">Name<input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></label>
            <label className="field">Kind<select value={ef.kind} onChange={(e) => setEf({ ...ef, kind: e.target.value })}>{['party', 'birthday party', 'wedding', 'private dinner', 'fundraiser', 'corporate retreat', 'concert', 'yacht party', 'gala'].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="field">Location<input value={ef.location} onChange={(e) => setEf({ ...ef, location: e.target.value })} /></label>
            <label className="field">Guests<input type="number" value={ef.guestCount} onChange={(e) => setEf({ ...ef, guestCount: +e.target.value })} /></label>
            <label className="field">Date<input type="date" value={ef.date ?? s.currentDate} min={s.currentDate} onChange={(e) => setEf({ ...ef, date: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {(['venueTier', 'foodTier', 'decorTier'] as const).map((k) => <label key={k} className="field">{lbl(k.replace('Tier', ''))}<select value={ef[k]} onChange={(e) => setEf({ ...ef, [k]: e.target.value })}>{['standard', 'premium', 'ultra'].map((t) => <option key={t}>{t}</option>)}</select></label>)}
            <label className="field">Entertainment<select value={ef.entertainment} onChange={(e) => setEf({ ...ef, entertainment: e.target.value as any })}>{['none', 'dj', 'band', 'headline_act'].map((t) => <option key={t} value={t}>{lbl(t)}</option>)}</select></label>
            <label className="field"><span><input type="checkbox" checked={ef.security} onChange={(e) => setEf({ ...ef, security: e.target.checked })} /> security</span></label>
            <label className="field"><span><input type="checkbox" checked={ef.transportation} onChange={(e) => setEf({ ...ef, transportation: e.target.checked })} /> transport</span></label>
            <label className="field"><span><input type="checkbox" checked={ef.production} onChange={(e) => setEf({ ...ef, production: e.target.checked })} /> production</span></label>
          </div>
          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <KV rows={[...est.lineItems.map((l) => [l.label, <Money v={l.amount} c={c} compact={false} />] as [string, React.ReactNode]), ['Estimated total', <Money v={est.total} c={c} compact={false} />, true]]} />
            <div><div className="small muted">Per guest: <Money v={est.total / Math.max(1, ef.guestCount)} c={c} compact={false} />. Every line is a simulation assumption.</div><button className="btn primary" style={{ marginTop: 10 }} onClick={() => store.mutate((d) => { createEvent(d, ef); }, 'Event planned')}>Book event</button></div>
          </div>
        </Card>
        <Card>{events.length === 0 ? <Empty text="No events." /> : <table className="data"><thead><tr><th>Date</th><th>Event</th><th>Guests</th><th className="num">Cost</th><th>Status</th><th></th></tr></thead><tbody>{events.map((e) => <tr key={e.id}><td><Date_ d={e.date} /></td><td>{e.name}<div className="small muted">{e.kind} · {e.location}</div></td><td>{e.guestCount}</td><td className="num"><Money v={e.totalCost} c={c} /></td><td className="muted">{e.status}</td><td>{e.status === 'planned' && <button className="btn small ghost" onClick={() => store.mutate((d) => cancelEvent(d, e.id), 'Event cancelled')}>cancel</button>}</td></tr>)}</tbody></table>}</Card>
      </>)}
    </div>
  );
};

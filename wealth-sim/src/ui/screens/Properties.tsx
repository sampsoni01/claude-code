import React, { useState } from 'react';
import type { Store } from '../store';
import { createStorageLocation, closeStorageLocation, occupancy, label as lbl } from '../../engine';
import { Card, Money, Empty } from '../components/ui';
import { Assets } from './Assets';

export const Properties: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const [tab, setTab] = useState<'properties' | 'storage'>('properties');
  const [form, setForm] = useState({ name: 'Rented garage', kind: 'rented_garage', capacity: 2, rent: 1500 });
  const locs = Object.values(s.storage).filter((l) => l.status === 'active');
  return (
    <div>
      <div className="tabs"><button className={tab === 'properties' ? 'active' : ''} onClick={() => setTab('properties')}>Properties</button><button className={tab === 'storage' ? 'active' : ''} onClick={() => setTab('storage')}>Garages & storage</button></div>
      {tab === 'properties' ? <Assets store={store} filter={['real_estate', 'land']} title="Real estate" /> : (
        <div>
          <h1 className="page-title">Garages & storage</h1>
          <p className="page-sub">Every physical asset lives in exactly one place. Properties provide garages automatically; rent more when you run out.</p>
          <Card title="Add storage" style={{ marginBottom: 14 }}>
            <div className="row">
              <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="field">Kind<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{['rented_garage', 'commercial_vehicle_storage', 'hangar', 'marina', 'warehouse', 'custom'].map((k) => <option key={k} value={k}>{lbl(k)}</option>)}</select></label>
              <label className="field">Capacity<input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: +e.target.value })} /></label>
              <label className="field">Monthly rent<input type="number" value={form.rent} onChange={(e) => setForm({ ...form, rent: +e.target.value })} /></label>
              <button className="btn primary" style={{ flex: 0 }} onClick={() => store.mutate((d) => { createStorageLocation(d, { name: form.name, kind: form.kind as any, capacity: form.capacity, monthlyRent: form.rent }); }, 'Storage added')}>Add</button>
            </div>
          </Card>
          <Card>
            {locs.length === 0 ? <Empty text="No storage locations." /> : <table className="data"><thead><tr><th>Location</th><th>Kind</th><th>Accepts</th><th className="num">Used / capacity</th><th className="num">Monthly cost</th><th>Contents</th><th></th></tr></thead>
              <tbody>{locs.map((l) => { const occ = occupancy(s, l.id); const rent = l.recurringId ? s.recurring[l.recurringId]?.amount.value ?? 0 : 0; const inside = Object.values(s.assets).filter((a) => a.status === 'owned' && a.storageLocationId === l.id); return (<tr key={l.id}>
                <td>{l.name}{l.propertyId && <div className="small muted">{s.assets[l.propertyId]?.name}</div>}</td><td className="muted">{lbl(l.kind)}</td><td className="small muted">{l.accepts.map(lbl).join(', ')}</td><td className="num"><span className={occ >= l.capacity ? 'warn' : ''}>{occ} / {l.capacity}</span><div className="progress" style={{ marginTop: 4 }}><div style={{ width: `${Math.min(100, (occ / Math.max(1, l.capacity)) * 100)}%` }} /></div></td><td className="num"><Money v={rent} c={c} compact={false} /></td><td className="small">{inside.map((a) => a.name).join(', ') || '—'}</td>
                <td>{!l.propertyId && <button className="btn small ghost" disabled={occ > 0} onClick={() => store.mutate((d) => closeStorageLocation(d, l.id), 'Storage closed')}>close</button>}</td>
              </tr>); })}</tbody></table>}
          </Card>
          <Card title="Unassigned physical assets" style={{ marginTop: 14 }}>
            {(() => { const un = Object.values(s.assets).filter((a) => a.status === 'owned' && a.storageLocationId === null && ['vehicle', 'aircraft', 'yacht', 'art', 'collectible', 'jewelry_watches', 'furniture', 'luxury_goods', 'custom_physical'].includes(a.category)); return un.length === 0 ? <div className="muted small">Everything is stored.</div> : <div className="small">{un.map((a) => a.name).join(' · ')} — assign from the asset detail panel.</div>; })()}
          </Card>
        </div>
      )}
    </div>
  );
};

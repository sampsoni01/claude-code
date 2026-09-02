import React, { useState } from 'react';
import type { Store } from '../store';
import { SCENARIOS, JURISDICTIONS, serialize, deserialize, reconcile, type MarketScenarioId } from '../../engine';
import { Card, KV } from '../components/ui';
import { getLLMConfig, setLLMConfig } from '../llm';

export const Settings: React.FC<{ store: Store; onReset: () => void }> = ({ store, onReset }) => {
  const s = store.state!;
  const sc = s.settings.scenario;
  const rec = reconcile(s);
  const [llm, setLlm] = useState(getLLMConfig());
  const upd = (patch: Partial<typeof sc>) => store.mutate((d) => { d.settings.scenario = { ...d.settings.scenario, ...patch, id: 'custom', name: 'Custom scenario' }; }, 'Scenario updated');
  const download = () => { const blob = new Blob([serialize(s)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `wealth-sim-${s.profile.name.replace(/\s+/g, '_')}-${s.currentDate}.json`; a.click(); };
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Market regime, realism, persistence, and integrations.</p>
      <div className="grid cols-2">
        <Card title="Market scenario">
          <select value={sc.id} onChange={(e) => store.mutate((d) => { d.settings.scenario = { ...SCENARIOS[e.target.value as MarketScenarioId] }; }, 'Scenario changed')}>{Object.values(SCENARIOS).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <div className="row" style={{ marginTop: 10 }}>
            {([['equityDrift', 'Equity drift %'], ['bondDrift', 'Bond drift %'], ['realEstateDrift', 'Real estate drift %'], ['privateDrift', 'Private/business drift %'], ['inflation', 'Inflation %'], ['rateShift', 'Rate shift %']] as const).map(([k, l]) => <label key={k} className="field">{l}<input type="number" step="0.5" value={+((sc[k] as number) * 100).toFixed(2)} onChange={(e) => upd({ [k]: +e.target.value / 100 } as any)} /></label>)}
            <label className="field">Volatility ×<input type="number" step="0.1" value={sc.volatilityMultiplier} onChange={(e) => upd({ volatilityMultiplier: +e.target.value })} /></label>
            <label className="field">Business growth ×<input type="number" step="0.1" value={sc.businessGrowthMultiplier} onChange={(e) => upd({ businessGrowthMultiplier: +e.target.value })} /></label>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Drifts are added to each holding's own expected return. Inflation is applied to recurring expenses every January.</div>
        </Card>
        <Card title="Realism & taxes">
          <label className="field"><span><input type="checkbox" checked={s.settings.realismEventsEnabled} onChange={(e) => store.mutate((d) => { d.settings.realismEventsEnabled = e.target.checked; }, 'Realism events ' + (e.target.checked ? 'enabled' : 'disabled'))} /> Realism events (repairs, reassessments, business surprises, cost overruns…)</span></label>
          <label className="field" style={{ marginTop: 8 }}>Monthly event probability %<input type="number" step="1" value={Math.round(s.settings.realismEventRate * 100)} onChange={(e) => store.mutate((d) => { d.settings.realismEventRate = +e.target.value / 100; })} /></label>
          <label className="field" style={{ marginTop: 8 }}>Tax settlement month<select value={s.settings.taxSettlementMonth} onChange={(e) => store.mutate((d) => { d.settings.taxSettlementMonth = +e.target.value; })}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
          <div className="small muted" style={{ marginTop: 8 }}>Jurisdiction: {JURISDICTIONS[s.profile.taxJurisdiction].name}. {JURISDICTIONS[s.profile.taxJurisdiction].notes}</div>
        </Card>
        <Card title="Save & load">
          <div className="small muted">Autosaved to this browser after every change. Export a file to keep or move a simulation; IDs and history are preserved exactly.</div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={download}>Export JSON</button>
            <label className="btn">Import JSON<input type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { store.replace(deserialize(await f.text())); store.toast('Simulation loaded'); } catch (err: any) { store.toast(err.message, 'err'); } }} /></label>
            <button className="btn" disabled={!store.canUndo} onClick={store.undoLast}>Undo last change</button>
            <button className="btn danger" onClick={() => { if (confirm('Start over? The current simulation is discarded (export it first if you want to keep it).')) onReset(); }}>New simulation</button>
          </div>
          <KV rows={[['Simulation id', s.id], ['Schema version', String(s.schemaVersion)], ['Ledger entries', s.ledger.length.toLocaleString()], ['Reconciliation', rec.ok ? '✓ consistent' : `✗ ${rec.issues.length} issue(s)`], ['RNG state', String(s.rngState)]]} />
        </Card>
        <Card title="AI research (optional)">
          <div className="small muted">Add a Claude API key to let assistants handle open-ended requests ("hire a private historian", "build an underground wine cellar") by proposing structures from the same financial primitives. The key stays in this browser. Without it, the built-in assistants still cover purchases, staff, projects, events, horses, storage, and what-ifs.</div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">API key<input type="password" value={llm.apiKey} onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })} placeholder="sk-ant-…" /></label>
            <label className="field">Model<input value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })} /></label>
            <button className="btn primary" style={{ flex: 0 }} onClick={() => { setLLMConfig(llm); store.toast('AI settings saved'); }}>Save</button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Note: calling the API directly from a browser requires the key to be enabled for direct browser access; otherwise route through your own backend.</div>
        </Card>
      </div>
    </div>
  );
};

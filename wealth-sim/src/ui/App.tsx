import React, { useState } from 'react';
import { useSimStore } from './store';
import { advanceTime, deserialize, computeMetrics, formatDate, formatMoney } from '../engine';
import { Onboarding } from './screens/Onboarding';
import { Dashboard } from './screens/Dashboard';
import { Assets } from './screens/Assets';
import { Properties } from './screens/Properties';
import { Liabilities } from './screens/Liabilities';
import { Investments } from './screens/Investments';
import { Lifestyle } from './screens/Lifestyle';
import { ProjectsEvents } from './screens/ProjectsEvents';
import { Businesses } from './screens/Businesses';
import { Ledger } from './screens/Ledger';
import { Statements } from './screens/Statements';
import { Timeline } from './screens/Timeline';
import { ScenarioLab } from './screens/ScenarioLab';
import { Assistant } from './screens/Assistant';
import { Purchase } from './screens/Purchase';
import { Settings } from './screens/Settings';

const NAV: { group: string; items: [string, string][] }[] = [
  { group: 'Overview', items: [['dashboard', 'Dashboard'], ['assistant', 'Assistants'], ['scenario', 'Scenario Lab']] },
  { group: 'Holdings', items: [['assets', 'Assets'], ['properties', 'Real estate & storage'], ['investments', 'Investments'], ['businesses', 'Businesses'], ['liabilities', 'Liabilities']] },
  { group: 'Life', items: [['purchase', 'Purchase'], ['lifestyle', 'Lifestyle & staff'], ['projects', 'Projects & events']] },
  { group: 'Records', items: [['ledger', 'Ledger'], ['statements', 'Statements'], ['timeline', 'Timeline'], ['settings', 'Settings']] },
];

export const App: React.FC = () => {
  const store = useSimStore();
  const [screen, setScreen] = useState('dashboard');
  const [advancing, setAdvancing] = useState(false);
  const s = store.state;
  if (!s) return <Onboarding onCreate={(st) => { store.replace(st); setScreen('dashboard'); }} onImport={(json) => { try { store.replace(deserialize(json)); } catch (e: any) { store.toast(e.message, 'err'); } }} />;
  const m = computeMetrics(s);
  const c = s.profile.currency;
  const advance = (unit: 'day' | 'month' | 'quarter' | 'year', n: number) => { setAdvancing(true); setTimeout(() => { store.apply((st) => advanceTime(st, unit, n), `Advanced ${n} ${unit}${n > 1 ? 's' : ''}`); setAdvancing(false); }, 10); };
  const go = (sc: string) => setScreen(sc);
  const screens: Record<string, React.ReactNode> = {
    dashboard: <Dashboard store={store} go={go} />, assets: <Assets store={store} />, properties: <Properties store={store} />, liabilities: <Liabilities store={store} />, investments: <Investments store={store} />, lifestyle: <Lifestyle store={store} />, projects: <ProjectsEvents store={store} />, businesses: <Businesses store={store} go={go} />, ledger: <Ledger store={store} />, statements: <Statements store={store} />, timeline: <Timeline store={store} />, scenario: <ScenarioLab store={store} />, assistant: <Assistant store={store} go={go} />, purchase: <Purchase store={store} />, settings: <Settings store={store} onReset={() => { localStorage.removeItem('wealth-sim:save:default'); store.replace(null); }} />,
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Meridian<small>Wealth simulation</small></div>
        <nav className="nav">{NAV.map((g) => (<div key={g.group}><div className="nav-group">{g.group}</div>{g.items.map(([id, label]) => <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id)}>{label}{id === 'assets' && <span className="badge">{Object.values(s.assets).filter((a) => a.status === 'owned').length}</span>}</button>)}</div>))}</nav>
        <div style={{ marginTop: 'auto', padding: 10 }} className="small muted">Net worth <b className="mono" style={{ color: 'var(--ink)' }}>{formatMoney(m.netWorth, c, true)}</b><br />Cash <b className="mono" style={{ color: m.cash < 0 ? 'var(--bad)' : 'var(--ink)' }}>{formatMoney(m.cash, c, true)}</b><br /><span style={{ fontSize: 10 }}>Fictional simulation. Not financial advice.</span></div>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="date">{formatDate(s.currentDate)}</span><span className="who">{s.profile.name} · {s.profile.location} · {s.settings.scenario.name}</span>
          <span className="spacer" />
          <span className="small muted">Advance</span>
          <button className="btn small" disabled={advancing} onClick={() => advance('day', 1)}>Day</button>
          <button className="btn small" disabled={advancing} onClick={() => advance('month', 1)}>Month</button>
          <button className="btn small" disabled={advancing} onClick={() => advance('quarter', 1)}>Quarter</button>
          <button className="btn small primary" disabled={advancing} onClick={() => advance('year', 1)}>{advancing ? 'Processing…' : 'Year'}</button>
          <button className="btn small ghost" disabled={!store.canUndo} onClick={store.undoLast} title="Undo last change">↶</button>
        </div>
        <div className="content">{screens[screen] ?? screens.dashboard}</div>
      </div>
      {store.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} style={{ bottom: 20 + store.toasts.indexOf(t) * 52 }}>{t.text}</div>)}
    </div>
  );
};

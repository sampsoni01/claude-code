import React, { useState } from 'react';
import type { Store } from '../store';
import { createRecurring, endRecurring, overrideRecurringAmount, hireStaff, terminateStaff, monthlyAmount, STAFF_REFERENCE, SERVICE_REFERENCE, label as lbl, computeMetrics } from '../../engine';
import { Card, Money, SourceTag, Stat, Empty } from '../components/ui';
import { AssumptionList } from '../components/reviews';

export const Lifestyle: React.FC<{ store: Store }> = ({ store }) => {
  const s = store.state!;
  const c = s.profile.currency;
  const m = computeMetrics(s);
  const [tab, setTab] = useState<'expenses' | 'income' | 'staff'>('expenses');
  const [form, setForm] = useState({ name: '', category: 'travel', amount: 10_000, interval: 'monthly' as any, direction: 'expense' as 'expense' | 'income' });
  const [staffForm, setStaffForm] = useState({ key: 'chef', salary: STAFF_REFERENCE.chef.typical });
  const items = Object.values(s.recurring).filter((r) => r.status === 'active' && r.direction === (tab === 'income' ? 'income' : 'expense') && (tab !== 'expenses' || !r.staffId)).sort((a, b) => monthlyAmount(b.amount.value, b.interval) - monthlyAmount(a.amount.value, a.interval));
  const staff = Object.values(s.staff).filter((x) => x.status === 'active');
  const staffAnnual = staff.reduce((x, st) => x + (s.recurring[st.recurringId]?.amount.value ?? 0) * 12, 0);
  const lifestyleMonthly = items.filter((r) => r.direction === 'expense').reduce((x, r) => x + monthlyAmount(r.amount.value, r.interval), 0);
  return (
    <div>
      <h1 className="page-title">Lifestyle & recurring</h1>
      <p className="page-sub">Every recurring line posts to the ledger on its schedule. Amounts inflate each January by the scenario's inflation rate.</p>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Card><Stat label="Monthly lifestyle burn" value={<Money v={m.annualLifestyleBurn / 12} c={c} />} sub="incl. asset carrying costs & loan interest" /></Card>
        <Card><Stat label="Annual lifestyle burn" value={<Money v={m.annualLifestyleBurn} c={c} />} /></Card>
        <Card><Stat label="Staff payroll /yr" value={<Money v={staffAnnual} c={c} />} sub={`${staff.length} on payroll`} /></Card>
        <Card><Stat label="Recurring income /mo" value={<Money v={m.monthlyIncome} c={c} />} sub={<>passive <Money v={m.passiveMonthlyIncome} c={c} /></>} /></Card>
      </div>
      <div className="tabs"><button className={tab === 'expenses' ? 'active' : ''} onClick={() => setTab('expenses')}>Expenses</button><button className={tab === 'income' ? 'active' : ''} onClick={() => setTab('income')}>Income streams</button><button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>Staff</button></div>
      {tab !== 'staff' && (<>
        <Card title={`Add ${tab === 'income' ? 'income stream' : 'recurring expense'}`} style={{ marginBottom: 14 }}>
          <div className="row">
            <label className="field">Name<input value={form.name} placeholder={tab === 'income' ? 'Board fees' : 'Personal trainer'} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{(tab === 'income' ? ['salary', 'bonus', 'consulting', 'rental', 'royalty', 'dividend', 'interest', 'custom'] : ['housing', 'staff', 'security', 'travel', 'dining', 'clothing', 'shopping', 'entertainment', 'membership', 'health', 'education', 'charity', 'subscription', 'professional_services', 'insurance', 'maintenance', 'storage', 'custom']).map((k) => <option key={k} value={k}>{lbl(k)}</option>)}</select></label>
            <label className="field">Amount<input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} /></label>
            <label className="field">Interval<select value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}>{['weekly', 'monthly', 'quarterly', 'annual'].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <button className="btn primary" style={{ flex: 0 }} disabled={!form.name} onClick={() => { store.mutate((d) => { createRecurring(d, { name: form.name, direction: tab === 'income' ? 'income' : 'expense', category: form.category as any, amount: { value: form.amount, source: { type: 'user_entered' } }, interval: form.interval, accountId: d.settings.defaultAccountId, createdBy: 'user' }); }, 'Added'); setForm({ ...form, name: '' }); }}>Add</button>
          </div>
          {tab === 'expenses' && <div className="chips">{Object.entries(SERVICE_REFERENCE).slice(0, 12).map(([k, r]) => <button key={k} className="chip" onClick={() => setForm({ ...form, name: r.name, category: r.category, amount: r.interval === 'monthly' ? Math.round(r.typical / 12) : r.typical, interval: r.interval })}>{r.name}</button>)}</div>}
        </Card>
        <Card>
          {items.length === 0 ? <Empty text="Nothing here yet." /> : <div className="scroll-x"><table className="data"><thead><tr><th>Item</th><th>Category</th><th>Attached to</th><th className="num">Amount</th><th>Interval</th><th className="num">Monthly</th><th className="num">Annual</th><th>Source</th><th></th></tr></thead>
            <tbody>{items.map((r) => (<tr key={r.id}><td>{r.name}{r.amount.override && <div className="small muted">was {r.amount.override.original.toLocaleString()} · overridden {r.amount.override.overriddenOn}</div>}</td><td className="muted">{lbl(r.category)}</td><td className="small muted">{r.assetId ? s.assets[r.assetId]?.name : r.storageLocationId ? s.storage[r.storageLocationId]?.name : '—'}</td>
              <td className="num"><input type="number" style={{ width: 120, textAlign: 'right' }} defaultValue={r.amount.value} key={r.amount.value} onBlur={(e) => { const v = +e.target.value; if (v !== r.amount.value) store.mutate((d) => overrideRecurringAmount(d, r.id, v), 'Amount overridden'); }} /></td><td className="muted">{r.interval}</td><td className="num"><Money v={monthlyAmount(r.amount.value, r.interval)} c={c} compact={false} /></td><td className="num"><Money v={monthlyAmount(r.amount.value, r.interval) * 12} c={c} /></td><td><SourceTag s={r.amount.source} /></td>
              <td><button className="btn small ghost" onClick={() => store.mutate((d) => endRecurring(d, r.id), 'Ended')}>end</button></td></tr>))}</tbody>
            <tfoot><tr><td colSpan={5} style={{ textAlign: 'right' }} className="muted">Total</td><td className="num"><Money v={tab === 'income' ? items.reduce((x, r) => x + monthlyAmount(r.amount.value, r.interval), 0) : lifestyleMonthly} c={c} /></td><td className="num"><Money v={(tab === 'income' ? items.reduce((x, r) => x + monthlyAmount(r.amount.value, r.interval), 0) : lifestyleMonthly) * 12} c={c} /></td><td /><td /></tr></tfoot></table></div>}
        </Card>
      </>)}
      {tab === 'staff' && (<>
        <Card title="Hire" style={{ marginBottom: 14 }}>
          <div className="row">
            <label className="field">Role<select value={staffForm.key} onChange={(e) => setStaffForm({ key: e.target.value, salary: STAFF_REFERENCE[e.target.value].typical })}>{Object.entries(STAFF_REFERENCE).map(([k, r]) => <option key={k} value={k}>{r.role}</option>)}</select></label>
            <label className="field">Base salary (ref. {STAFF_REFERENCE[staffForm.key].low.toLocaleString()}–{STAFF_REFERENCE[staffForm.key].high.toLocaleString()})<input type="number" value={staffForm.salary} onChange={(e) => setStaffForm({ ...staffForm, salary: +e.target.value })} /></label>
            <div className="small muted" style={{ flex: 2 }}>+22% employer payroll & benefits (simulation assumption) → <Money v={staffForm.salary * 1.22} c={c} />/yr. {STAFF_REFERENCE[staffForm.key].notes}</div>
            <button className="btn primary" style={{ flex: 0 }} onClick={() => { const ref = STAFF_REFERENCE[staffForm.key]; const source: import('../../engine').SourceInfo = staffForm.salary === ref.typical ? { type: 'builtin_reference', label: 'Typical reference salary', range: { low: ref.low, high: ref.high } } : { type: 'user_entered' }; store.mutate((d) => { hireStaff(d, { role: ref.role, baseSalary: { value: staffForm.salary, source } }); }, 'Hired'); }}>Hire</button>
          </div>
        </Card>
        <Card>
          {staff.length === 0 ? <Empty text="No staff on payroll." /> : staff.map((st) => (<div key={st.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="btn-row" style={{ justifyContent: 'space-between' }}><div><b>{st.role}</b>{st.name ? ` — ${st.name}` : ''} <span className="small muted">since {st.startDate}{st.assignedAssetId ? ` · ${s.assets[st.assignedAssetId]?.name}` : ''}</span></div><div className="btn-row"><span className="mono"><Money v={(s.recurring[st.recurringId]?.amount.value ?? 0) * 12} c={c} />/yr loaded</span><button className="btn small ghost" onClick={() => store.mutate((d) => terminateStaff(d, st.id), 'Employment ended')}>end</button></div></div>
            <AssumptionList items={st.assumptions} c={c} />
          </div>))}
        </Card>
      </>)}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import type { Store } from '../store';
import { respond, ASSISTANTS, advanceTime, commitProposal, commitSale, SCENARIOS, nextId, type Proposal, type AssistantReply } from '../../engine';
import { ProposalReview, SaleReview } from '../components/reviews';
import { llmRespond, hasLLM } from '../llm';

interface Msg { id: string; role: 'user' | 'assistant'; text: string; assistantId?: string; proposal?: Proposal; choices?: { label: string; command: string }[]; action?: AssistantReply['action']; done?: boolean }

export const Assistant: React.FC<{ store: Store; go: (s: string) => void }> = ({ store, go }) => {
  const s = store.state!;
  const [msgs, setMsgs] = useState<Msg[]>(() => s.assistantHistory.slice(-40).map((m) => ({ id: m.id, role: m.role, text: m.text, assistantId: m.assistantId, done: true })));
  const [input, setInput] = useState('');
  const [who, setWho] = useState<string>('auto');
  const [review, setReview] = useState<{ msgId: string; proposal: Proposal } | null>(null);
  const [sale, setSale] = useState<{ msgId: string; assetId: string; price: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  const persist = (role: 'user' | 'assistant', text: string, assistantId?: string) => store.mutate((d) => { d.assistantHistory.push({ id: nextId(d, 'msg'), date: d.currentDate, role, text, assistantId }); d.assistantHistory = d.assistantHistory.slice(-200); });
  const send = async (text: string) => {
    if (!text.trim()) return;
    const um: Msg = { id: `u${Date.now()}`, role: 'user', text };
    setMsgs((m) => [...m, um]); setInput('');
    let reply: AssistantReply;
    setBusy(true);
    try {
      reply = respond(store.state!, text, who === 'auto' ? undefined : who);
      // If built-in parser fell back to help text and an LLM is configured, ask it for a proposal.
      if (!reply.proposal && !reply.action && !reply.scenario && reply.choices && hasLLM()) {
        const llm = await llmRespond(store.state!, text, msgs.slice(-8).map((m) => ({ role: m.role, text: m.text })));
        if (llm) reply = llm;
      }
    } catch (e: any) { reply = { assistantId: 'cfo', text: `Something went wrong: ${e.message}` }; }
    setBusy(false);
    const am: Msg = { id: `a${Date.now()}`, role: 'assistant', text: reply.text, assistantId: reply.assistantId, proposal: reply.proposal, choices: reply.choices, action: reply.action };
    setMsgs((m) => [...m, am]);
    // persist plain history; proposals persist only when committed
    store.mutate((d) => { d.assistantHistory.push({ id: nextId(d, 'msg'), date: d.currentDate, role: 'user', text }); d.assistantHistory.push({ id: nextId(d, 'msg'), date: d.currentDate, role: 'assistant', text: reply.text, assistantId: reply.assistantId }); d.assistantHistory = d.assistantHistory.slice(-200); });
    if (reply.action?.kind === 'advance') { const a = reply.action; store.apply((st) => advanceTime(st, a.unit, a.n), `Advanced ${a.n} ${a.unit}${a.n > 1 ? 's' : ''}`); }
    if (reply.action?.kind === 'scenario_set') { const a = reply.action; store.mutate((d) => { d.settings.scenario = { ...SCENARIOS[a.scenario] }; }, 'Scenario changed'); }
    if (reply.action?.kind === 'navigate') go(reply.action.screen);
    if (reply.scenario) go('scenario');
    void persist;
  };
  const persona = (id?: string) => ASSISTANTS.find((a) => a.id === id) ?? ASSISTANTS[0];
  return (
    <div>
      <h1 className="page-title">Assistants</h1>
      <p className="page-sub">Your family-office team. They read the live books, research from the reference data, and propose structures you review before anything is committed.</p>
      <div className="chat">
        <div className="btn-row"><select value={who} onChange={(e) => setWho(e.target.value)}><option value="auto">Auto-route to the right specialist</option>{ASSISTANTS.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.title}</option>)}</select>{hasLLM() ? <span className="tag src-retrieved_real_world">AI research enabled</span> : <span className="small muted">Built-in assistants only · add an API key in Settings for open-ended AI research</span>}</div>
        <div className="thread">
          {msgs.length === 0 && <div className="msg assistant"><div className="who">{persona('cfo').name} · CFO</div>Good to have you. Ask me to buy, sell, hire, plan, or run a what-if. Try: "Buy a Ferrari 12Cilindri", "Find me a penthouse under $30M", "Hire a private chef", "What if I quit my job?", "Advance 1 year".</div>}
          {msgs.map((m) => (<div key={m.id} className={`msg ${m.role}`}>
            {m.role === 'assistant' && <div className="who">{persona(m.assistantId).name} · {persona(m.assistantId).title}</div>}
            {m.text}
            {m.proposal && !m.done && <div className="chips"><button className="chip" onClick={() => setReview({ msgId: m.id, proposal: m.proposal! })}>Review & confirm</button><button className="chip" onClick={() => setMsgs((x) => x.map((y) => y.id === m.id ? { ...y, done: true } : y))}>Dismiss</button></div>}
            {m.proposal && m.done && <div className="small muted" style={{ marginTop: 6 }}>✓ handled</div>}
            {m.action?.kind === 'sell' && !m.done && <div className="chips"><button className="chip" onClick={() => setSale({ msgId: m.id, assetId: (m.action as any).assetId, price: (m.action as any).price.value })}>Review sale</button></div>}
            {m.choices && <div className="chips">{m.choices.map((ch) => <button key={ch.command} className="chip" onClick={() => send(ch.command)}>{ch.label}</button>)}</div>}
          </div>))}
          {busy && <div className="msg assistant muted">Researching…</div>}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }}><input value={input} onChange={(e) => setInput(e.target.value)} placeholder='e.g. "Buy a Gulfstream G700 with 30% down", "Keep three horses", "Renovate the kitchen for $500k"' autoFocus /><button className="btn primary" disabled={busy}>Send</button></form>
      </div>
      {review && <ProposalReview state={s} proposal={review.proposal} onClose={() => setReview(null)} onConfirm={(p) => { if (store.apply((st) => commitProposal(st, p).state, `Committed: ${p.title}`)) { setMsgs((x) => x.map((y) => y.id === review.msgId ? { ...y, done: true } : y)); setReview(null); } }} />}
      {sale && <SaleReview state={s} assetId={sale.assetId} initialPrice={sale.price} onClose={() => setSale(null)} onConfirm={(price) => { if (store.apply((st) => commitSale(st, sale.assetId, { value: price, source: { type: 'user_entered' } }).state, 'Sold')) { setMsgs((x) => x.map((y) => y.id === sale.msgId ? { ...y, done: true } : y)); setSale(null); } }} />}
    </div>
  );
};

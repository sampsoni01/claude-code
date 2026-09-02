import { describe, it, expect } from 'vitest';
import { makeSim } from './helpers';
import { postTransaction, reverseTransaction, validatePostings, computeMetrics, reconcile, atomic, ValidationError } from '../src/engine';

describe('ledger', () => {
  it('rejects unbalanced postings', () => {
    expect(() => validatePostings([{ kind: 'cash', accountId: 'a', amount: -100 }, { kind: 'expense', category: 'custom', amount: 50 }])).toThrow(ValidationError);
  });

  it('opening balances reconcile and net worth = cash + assets − liabilities', () => {
    const s = makeSim();
    const m = computeMetrics(s);
    expect(m.cash).toBe(20_000_000);
    expect(m.totalAssets).toBe(20_000_000 + 30_000_000 + 15_000_000);
    expect(m.totalLiabilities).toBe(5_000_000);
    expect(m.netWorth).toBe(60_000_000);
    expect(reconcile(s).ok).toBe(true);
  });

  it('prevents duplicate transactions with the same idempotency key', () => {
    const s = makeSim();
    const acct = s.settings.defaultAccountId;
    postTransaction(s, { type: 'one_time_expense', category: 'custom', description: 'x', postings: [{ kind: 'cash', accountId: acct, amount: -100 }, { kind: 'expense', category: 'custom', amount: 100 }], idempotencyKey: 'dup' });
    expect(() => postTransaction(s, { type: 'one_time_expense', category: 'custom', description: 'x', postings: [{ kind: 'cash', accountId: acct, amount: -100 }, { kind: 'expense', category: 'custom', amount: 100 }], idempotencyKey: 'dup' })).toThrow(/Duplicate/);
    expect(s.accounts[acct].balance).toBe(19_999_900);
  });

  it('reversal restores balances and keeps both entries', () => {
    const s = makeSim();
    const acct = s.settings.defaultAccountId;
    const t = postTransaction(s, { type: 'one_time_expense', category: 'custom', description: 'oops', postings: [{ kind: 'cash', accountId: acct, amount: -5000 }, { kind: 'expense', category: 'custom', amount: 5000 }] });
    expect(s.accounts[acct].balance).toBe(19_995_000);
    reverseTransaction(s, t.id, 'mistake');
    expect(s.accounts[acct].balance).toBe(20_000_000);
    expect(s.ledger.find((x) => x.id === t.id)!.reversedBy).toBeDefined();
    expect(() => reverseTransaction(s, t.id, 'again')).toThrow();
    expect(reconcile(s).ok).toBe(true);
  });

  it('atomic rollback leaves original untouched on failure', () => {
    const s = makeSim();
    const before = JSON.stringify(s);
    expect(() => atomic(s, (d) => {
      postTransaction(d, { type: 'one_time_expense', category: 'custom', description: 'a', postings: [{ kind: 'cash', accountId: d.settings.defaultAccountId, amount: -1 }, { kind: 'expense', category: 'custom', amount: 1 }] });
      throw new Error('boom');
    })).toThrow('boom');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('never silently changes balances: every balance is derivable from the ledger', () => {
    const s = makeSim();
    // tamper with a balance directly → reconcile must catch it
    s.accounts[s.settings.defaultAccountId].balance += 1;
    expect(reconcile(s).ok).toBe(false);
  });
});

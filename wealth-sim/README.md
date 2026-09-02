# Meridian — Wealth Simulation

A fictional financial life simulator. You configure a very wealthy persona, then buy, sell, hire, build, borrow and advance time while a single accounting engine tracks what happens to cash, liquidity, net worth, debt, taxes and cash flow.

Nothing here is a bank, broker, store, or financial advice. All money, prices, taxes, assistants and market moves are simulated.

## Run it

```bash
cd wealth-sim
npm install
npm run dev        # http://localhost:5173
npm test           # engine accounting tests (vitest)
npm run build      # typecheck + production bundle in dist/
```

The app is a static single-page build. State autosaves to the browser and can be exported/imported as JSON from Settings.

## Layout

```
src/engine/   pure TypeScript simulation engine (no UI dependencies)
src/ui/       React screens; they only call engine functions and render
tests/        accounting behaviour tests
```

### Engine modules

| Module | Responsibility |
|---|---|
| `types.ts` | The whole data model: accounts, assets, liabilities, recurring items, staff, storage, projects, events, ledger, valuations, timeline, settings. |
| `ledger.ts` | The only code allowed to change a balance. Every transaction is a set of postings that must satisfy `Δcash + Δassets − Δliabilities = income − expenses + valuation + realized gain + equity`. Idempotency keys stop duplicates; reversals post the opposite entry. |
| `atomic.ts` | Runs an operation on a deep copy so a failure part-way leaves the original state untouched. |
| `metrics.ts` | Net worth, liquid net worth, cash, income/expense rates, burn, allocation, upcoming payments. |
| `state.ts` | Builds a simulation from a profile (salary, cash, portfolio, properties, businesses, debts). Opening balances go through the ledger like everything else. |
| `costModels.ts` | Category cost models: acquisition taxes/fees and recurring ownership costs for real estate, vehicles, aircraft, yachts, art, business stakes, securities and custom assets. Every figure is labelled as a simulation assumption. |
| `purchase.ts` / `sell.ts` | Plan (preview) and commit for purchases and sales: cash vs financed, storage assignment, acquisition snapshots, fees, capital gains, loan payoff, ending attached costs. |
| `loans.ts` | Amortizing, interest-only and balloon loans. Interest is an expense; principal reduces cash and debt. |
| `recurring.ts` | Recurring expenses/income, staff payroll with employer overhead, annual inflation, user overrides. |
| `storage.ts` | Garages, hangars, marinas, warehouses. Capacity is enforced; an asset is in at most one place. |
| `investments.ts` / `business.ts` | Monthly market moves per holding (drift + volatility × scenario), dividends, account interest; business P&L with distributions vs retained earnings and annual profit × multiple revaluation. |
| `projects.ts` / `events.ts` | Renovations with deposit + monthly draws, contingency, overruns and partial capitalization; events priced from guest count and tiers. |
| `tax.ts` | Simplified jurisdiction tables (US states, UK, CH, AE, SG, MC, generic) for withholding, capital gains, dividends, sales and property tax, with an annual settlement. Clearly an estimate. |
| `time.ts` | Day-stepped clock. Advancing processes salary, recurring items, loans, projects, events, month-end markets, business results, realism events, snapshots and the yearly tax settlement, deterministically from a seeded RNG stored in state. |
| `statements.ts` | Balance sheet, income statement, cash-flow statement and a reconciliation that rebuilds every balance from the ledger. |
| `scenarioLab.ts` | What-if projections on a cloned state (purchases, quitting, spend levels, shocks, market regimes) vs baseline. |
| `realism.ts` | Optional traceable random events: repairs, reassessments, premium increases, vacancies, business surprises, overruns, tax adjustments, recessions. |
| `catalog.ts` | Built-in reference prices for cars, homes, jets, yachts, art, watches, businesses, staff roles and services. Reference data, not the limit of what can be bought. |
| `externalData.ts` | Provider layer with tiers (official → dealer/broker → public web → comparables → AI estimate → user). Ships a built-in provider and manual listing import; register your own for live retrieval. |
| `proposals.ts` | The only way assistants and the AI adapter create things: proposals made of primitives (asset, recurring expense, one-time expense, income stream, staff, project, event, storage location, liability, custom asset). Previewed, then committed atomically. |
| `assistant.ts` | Built-in specialist assistants (CFO, lifestyle, real estate, automotive, investment, business, property manager) that parse instructions into proposals, sale plans, scenarios or time advances. |
| `persistence.ts` | Versioned save files with forward migrations; ids are never regenerated. |

`src/ui/llm.ts` is an optional adapter that lets Claude (via the official SDK, with web search) propose objects for open-ended requests. Its output is constrained to the same primitives and validated before it reaches the review screen; it can never post to the ledger directly.

## Accounting rules the engine enforces

- Buying an asset converts cash into an asset. Net worth moves only by taxes, fees and later value changes.
- Loan principal is not an expense. Interest is.
- Unrealized appreciation is not income. Realized gains are recorded on disposal relative to carrying value; tax gains relative to cost basis.
- Business revenue is not personal income. Distributions are.
- Net worth, cash and liquid assets are separate numbers, and the app will let you run out of cash while rich.
- Every balance is derivable from the ledger. `reconcile()` runs after every UI operation and rejects the change if the books disagree.
- Each value carries a source: user-entered, built-in reference, retrieved real-world, calculated estimate, market estimate, simulation-generated, or user override. Acquisition snapshots are frozen at purchase.

## Tests

`npm test` covers cash and financed purchases, sales with loan payoff, principal vs interest, recurring items, day-by-day vs jump time advancement, appreciation/depreciation, investment returns and scenarios, storage capacity, taxes, business income and distributions, reversals and atomic rollback, net worth, statement reconciliation, assistant-created custom objects, external listing import, duplicate prevention and save/load.

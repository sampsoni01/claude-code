/* STRATEGIAN — the decision library.
   Each entry is an issue that lands on your desk. `weight` decides how
   likely it is to surface given the current state of the country; a
   weight of 0 means it is not relevant right now.                       */
(function (S) {
  'use strict';

  const D = S.Decisions = {};

  /* Short labels for the effect chips shown on each option. */
  D.LABELS = {
    'society.approval': 'Approval', 'society.unrest': 'Unrest', 'society.stability': 'Stability',
    'society.corruption': 'Corruption', 'society.cohesion': 'Cohesion', 'society.inequality': 'Inequality',
    'society.latent': 'Resentment', 'society.scandal': 'Scandal',
    'economy.shock': 'Economy', 'economy.reserves': 'Reserves', 'economy.debt': 'Debt',
    'economy.businessConfidence': 'Business conf.', 'economy.consumerConfidence': 'Consumer conf.',
    'economy.inflation': 'Inflation', 'economy.marketIndex': 'Markets', 'economy.reserveStatus': 'Reserve status',
    'national.prestige': 'Prestige', 'national.softPower': 'Soft power', 'national.concessions': 'Concessions',
    'national.aggressionScore': 'Aggression',
    'military.readiness': 'Readiness', 'military.morale': 'Forces morale', 'military.equipment': 'Equipment',
    'military.tech': 'Mil. tech',
    'intel.strength': 'Intelligence', 'world.tension': 'World tension',
    'quality.education': 'Education', 'quality.health': 'Health', 'quality.infra': 'Infrastructure',
    'quality.science': 'Science', 'quality.culture': 'Culture', 'quality.security': 'Security',
    'quality.energy': 'Energy', 'quality.admin': 'Admin capacity', 'quality.welfareQ': 'Welfare',
    'budget.alloc.defense': 'Defence budget', 'budget.alloc.education': 'Education budget',
    'budget.alloc.health': 'Health budget', 'budget.alloc.welfare': 'Welfare budget',
    'budget.alloc.infra': 'Infra budget', 'budget.alloc.research': 'R&D budget',
    'budget.alloc.intel': 'Intel budget', 'budget.alloc.interior': 'Interior budget',
    'budget.alloc.culture': 'Culture budget', 'budget.alloc.energy': 'Energy budget',
    'policy.interior.surveillance': 'Surveillance', 'policy.interior.pressFreedom': 'Press freedom',
    'policy.interior.civilLiberties': 'Civil liberties', 'policy.interior.policing': 'Policing',
    'policy.interior.propaganda': 'State messaging', 'policy.interior.immigration': 'Immigration',
    'policy.interior.anticorruption': 'Anti-corruption',
    'policy.econ.regulation': 'Regulation', 'policy.econ.stateOwnership': 'State ownership',
    'policy.econ.subsidies': 'Subsidies', 'policy.econ.laborProtection': 'Labour protection',
    'policy.trade.tariff': 'Tariffs', 'policy.trade.openness': 'Trade openness',
    'policy.tax.income': 'Income tax', 'policy.tax.corporate': 'Corporate tax', 'policy.tax.vat': 'VAT',
    'policy.tax.wealth': 'Wealth tax', 'policy.mil.conscription': 'Conscription',
    'policy.mil.veteranCare': 'Veteran care', 'policy.mil.rndShare': 'Mil. R&D share',
    'policy.social.traditionalism': 'Traditionalism', 'policy.social.devolution': 'Devolution',
    'policy.social.familyPolicy': 'Family policy', 'policy.energy.transition': 'Energy transition',
    'pop.total': 'Population'
  };

  const FACTION_LABEL = {
    military: 'Generals', business: 'Business', labour: 'Labour', intelligentsia: 'Academia',
    clergy: 'Traditionalists', nationalists: 'Nationalists', reformers: 'Reformers', provinces: 'Provinces'
  };
  D.FACTION_LABEL = FACTION_LABEL;

  /* ===================================================== VARIATION =======
     The library is finite, so the same issue will come round again across
     playthroughs. What stops it reading identically is that each instance
     draws its own framing and its own specifics, once, and remembers them
     in the decision's context — which is also what makes the brief, the
     advisers and the options describe one coherent situation.           */
  D.variant = function (st, ctx, key, arr) {
    ctx._v = ctx._v || {};
    if (ctx._v[key] == null) ctx._v[key] = st.rng.int(0, arr.length - 1);
    return arr[ctx._v[key] % arr.length];
  };

  // Concrete nouns: a named region, industry, firm, union, official.
  D.flavour = function (st, ctx) {
    if (ctx._f) return ctx._f;
    const F = S.FLAVOUR;
    ctx._f = {
      region: st.rng.pick(F.regions),
      region2: st.rng.pick(F.regions),
      city: st.rng.pick(F.cities),
      industry: st.rng.pick(F.industries),
      industry2: st.rng.pick(F.industries),
      firm: st.rng.pick(F.firms),
      official: st.rng.pick(F.officials),
      union: st.rng.pick(F.unions),
      university: st.rng.pick(F.universities)
    };
    return ctx._f;
  };

  /* ------------------------------------------------- the paper trail ----
     Matters can look back at what you decided before. This is what lets a
     nationalisation produce an arbitration ruling two years later, or a
     press crackdown produce a foreign delegation asking about it.       */
  D.ruled = function (st, id) { return !!(st.rulings && st.rulings[id]); };
  D.chose = function (st, id, i) {
    const r = st.rulings && st.rulings[id];
    if (!r) return false;
    return Array.isArray(i) ? i.indexOf(r.i) >= 0 : r.i === i;
  };
  D.ruling = function (st, id) { return (st.rulings && st.rulings[id]) || null; };
  D.yearsSince = function (st, id) {
    const r = D.ruling(st, id);
    return r ? (S.absDay(st.date) - r.day) / 365 : null;
  };
  // "the nationalisation of four years ago" — phrasing for callbacks.
  D.ago = function (st, id) {
    const y = D.yearsSince(st, id);
    if (y == null) return 'earlier';
    if (y < 1.2) return 'last year';
    if (y < 2.2) return 'two years ago';
    if (y < 3.2) return 'three years ago';
    if (y < 6) return Math.round(y) + ' years ago';
    return 'a long time ago now';
  };

  /* Some decisions generate their own scenario. That has to happen the first
     time anything asks for it — the brief, an option, or the deadline
     lapsing — because a player who never opens the file still lives in the
     country it describes. */
  D.ensureDisaster = function (st, ctx) {
    if (ctx.kind) return ctx;
    ctx.kind = st.rng.pick(['flood', 'earthquake', 'cyclone', 'wildfire complex', 'drought']);
    ctx.region = st.rng.pick(['the eastern provinces', 'the coastal belt', 'the northern uplands', 'the delta region']);
    // A disaster strikes a region, not a nation. The affected population grows
    // with the country but nothing like linearly, so a vast state does not
    // automatically suffer a vast death toll.
    const affected = Math.min(st.pop.total, 8 + st.pop.total * 0.10) * 1e6;
    // Vulnerability is infrastructure, health capacity and warning time.
    const vuln = S.clamp(2.6 - st.quality.infra / 45 - st.quality.health / 70, 0.35, 2.6);
    ctx.deaths = Math.round(affected * st.rng.range(0.00025, 0.0009) * vuln);
    ctx.displaced = Math.round(ctx.deaths * st.rng.int(18, 45));
    return ctx;
  };
  D.ensurePandemic = function (st, ctx) {
    if (ctx.base) return ctx;
    // Unmitigated deaths, before any policy response.
    const prepared = st.flags.pandemicPrepared ? 0.55 : 1;
    ctx.base = Math.round(st.pop.total * st.rng.range(900, 2600) * prepared *
      S.clamp(1.7 - st.quality.health / 80, 0.5, 1.7));
    return ctx;
  };
  D.disasterName = function (ctx) {
    return 'The ' + S.titleCase(String(ctx.region || 'regional').replace('the ', '')) +
      ' ' + S.titleCase(String(ctx.kind || 'disaster'));
  };

  /* Convenience builders --------------------------------------------- */
  const gov = (st) => st.nation.governmentId;
  const authoritarian = (st) => ['junta', 'personalist', 'party', 'theocratic'].indexOf(gov(st)) >= 0;
  const democratic = (st) => ['liberal', 'managed'].indexOf(gov(st)) >= 0;

  /* ==================================================================== */
  /*                            THE LIBRARY                               */
  /* ==================================================================== */
  D.LIB = [

    /* ------------------------------------------------------------ BUDGET */
    {
      id: 'budget_annual', core: true, cat: 'budget', title: 'The Annual Budget Framework',
      from: 'Minister of Finance', urgency: 'pressing', deadline: 21,
      weight: (st) => (st.date.month === 9 ? 40 : 0),
      brief: (st) => `<p>The budget framework for next year must be finalised within three weeks. The Treasury has modelled three envelopes.</p>
        <p>Current programme spending runs at ${S.round(S.sum(S.MINISTRIES, (m) => st.budget.alloc[m.id]), 1)}% of output against revenue of ${S.round(st.economy.revenue / st.economy.gdp * 100, 1)}%. Debt stands at ${S.round(st.economy.debtGdp, 0)}% of GDP and the current market borrowing rate is ${S.round(st.economy.bondYield, 1)}%.</p>`,
      advisors: (st) => [
        { who: 'Finance Minister', role: 'Treasury', said: st.economy.debtGdp > 90 ? 'Debt is high enough that one failed auction could trigger a crisis. We should consolidate now, on our own terms.' : 'We have fiscal room. The choice is between current spending and long-term investment.' },
        { who: 'Chief Economist', role: 'Central Bank', said: st.economy.inflation > 6 ? 'With inflation at this level, an expansionary budget will force offsetting rate rises.' : 'Demand is adequate. A modest expansion would not be inflationary.' },
        { who: 'Chief Whip', role: 'Legislature', said: 'Spending cuts carry a high electoral cost. Every programme has organised beneficiaries.' }
      ],
      options: [
        {
          label: 'Consolidation budget', detail: 'Reduce every ministry allocation by about 10%. Lowers debt; reduces services and approval.',
          effects: { 'society.approval': -6, 'economy.shock': -0.8, 'society.unrest': +4 },
          fn: (st) => { for (const m in st.budget.alloc) st.budget.alloc[m] *= 0.90; },
          factions: { business: +7, labour: -8, provinces: -5, reformers: -2 },
          headline: 'Austerity Budget Cuts Across Every Department'
        },
        {
          label: 'Steady-state budget', detail: 'Maintain current allocations without change.',
          effects: { 'society.approval': +1 }, factions: {},
          headline: 'Budget Holds Course; No Major Changes'
        },
        {
          label: 'Expansionary budget', detail: 'Increase all allocations by about 10%, funded by borrowing. Raises demand, inflation and debt.',
          effects: { 'society.approval': +6, 'economy.shock': +0.9, 'economy.inflation': +0.8 },
          fn: (st) => { for (const m in st.budget.alloc) st.budget.alloc[m] *= 1.10; },
          factions: { labour: +8, provinces: +6, business: -4 },
          headline: 'Government Announces Major Spending Package'
        },
        {
          label: 'Rebalance toward investment', detail: 'Shift funds from welfare into education, research and infrastructure.',
          effects: { 'society.approval': -3, 'budget.alloc.education': +0.6, 'budget.alloc.research': +0.5, 'budget.alloc.infra': +0.5, 'budget.alloc.welfare': -1.4 },
          factions: { intelligentsia: +9, business: +4, labour: -7, reformers: +6 },
          headline: 'Budget Shifts Billions from Welfare to Investment'
        }
      ]
    },
    {
      id: 'tax_reform', cat: 'budget', title: 'Tax Reform Commission Reports',
      from: 'Revenue Service', urgency: 'routine', deadline: 30,
      weight: (st) => 8 + (st.economy.deficit / st.economy.gdp * 100) * 2,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>The commission you appointed has reported. Its central finding: compliant taxpayers face high effective rates while widespread evasion goes uncollected.</p>`,
          `<p>Leaked documents have made ${f.firm}'s tax arrangements public. The arrangements were legal; press and public reaction is strongly negative.</p>`,
          `<p>The Revenue Service has informed the Treasury that enforcement is failing. Collection in ${f.region} has largely ceased, and the avoidance structures used by ${f.firm} are spreading to the professions.</p>`
        ]);
        return framing + `<p>Effective income tax stands at ${st.policy.tax.income}%, corporation tax at ${st.policy.tax.corporate}%, and the informal economy consumes ${S.round(st.economy.informal, 0)}% of activity. Revenue is ${S.round(st.economy.revenue / st.economy.gdp * 100, 1)}% of output against spending of ${S.round(st.economy.spending / st.economy.gdp * 100, 1)}%.</p>`;
      },
      advisors: () => [
        { who: 'Revenue Commissioner', role: 'Collection', said: 'Stronger enforcement powers would raise more revenue than any rate increase.' },
        { who: 'Business Council', role: 'Industry', said: 'Raising the corporate rate will push investment and production abroad.' },
        { who: 'Union Congress', role: 'Labour', said: 'Wealth is effectively untaxed. Tax it before raising taxes on wages.' }
      ],
      options: [
        {
          label: 'Broaden the base, cut the rates', detail: 'Close exemptions and lower headline rates. Broadens the tax base and reduces evasion.',
          effects: { 'policy.tax.income': -3, 'policy.tax.corporate': -3, 'economy.informal': -4, 'economy.businessConfidence': +6, 'society.approval': -2 },
          factions: { business: +8, reformers: +5, labour: -4 },
          headline: 'Tax Overhaul: Lower Rates, Fewer Loopholes'
        },
        {
          label: 'Tax wealth and capital', detail: 'Introduce a wealth levy and raise capital taxation. Reduces inequality; risks capital flight.',
          effects: { 'policy.tax.wealth': +0.6, 'policy.tax.corporate': +3, 'society.inequality': -3, 'economy.businessConfidence': -8, 'society.approval': +4 },
          factions: { labour: +11, reformers: +6, business: -14 },
          risk: { p: 0.25, text: 'Capital flight', fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.012; st.economy.shock -= 0.8; } },
          headline: 'Wealth Levy Announced; Markets React'
        },
        {
          label: 'Enforcement campaign', detail: 'Increase Revenue Service funding and prosecute evasion publicly.',
          effects: { 'budget.alloc.admin': +0.25, 'economy.informal': -6, 'society.corruption': -4, 'quality.admin': +3, 'society.approval': -1 },
          factions: { reformers: +9, business: -5, provinces: -3 },
          headline: 'Revenue Service Given Sweeping New Powers'
        },
        {
          label: 'Shelve the report', detail: 'Take no action on the recommendations.',
          effects: { 'society.approval': +1, 'society.corruption': +1 },
          factions: { reformers: -6, business: +2 }
        }
      ]
    },
    {
      id: 'debt_wall', cat: 'budget', title: 'A Refinancing Wall',
      from: 'Debt Management Office', urgency: 'urgent', deadline: 12,
      weight: (st) => st.economy.debtGdp > 85 && st.economy.creditScore < 55 ? 30 : 0,
      brief: (st) => `<p>A large tranche of paper matures next quarter into a market charging ${S.round(st.economy.bondYield, 1)}%. At current spreads, rolling it costs an extra ${S.money(st.economy.debt * 0.012)} a year in service.</p>
        <p>Our rating is ${st.economy.creditRating}. Reserves cover ${S.round(st.economy.reserveMonths, 1)} months of imports.</p>`,
      advisors: (st) => [
        { who: 'Debt Manager', role: 'Treasury', said: 'We can roll the debt, but the current premium reflects market doubt about our position, not fundamentals.' },
        { who: 'Central Bank Governor', role: 'Monetary', said: st.economy.inflation > 8 ? 'Direct purchases would add money creation to existing high inflation. I will comply if directed, but the cost should be stated.' : 'I could absorb some of it without much price effect.' }
      ],
      options: [
        {
          label: 'Roll it in the market', detail: 'Pay the premium and preserve credibility.',
          effects: { 'economy.debt': 0, 'economy.reserveStatus': +2 },
          fn: (st) => { st.economy.avgDebtRate += 0.8; },
          factions: { business: +4 }, headline: 'Treasury Rolls Debt at Higher Yields'
        },
        {
          label: 'Have the central bank absorb it', detail: 'Finance the tranche by money creation. Low immediate cost; raises inflation.',
          effects: { 'economy.inflation': +2.2, 'economy.reserveStatus': -6, 'economy.businessConfidence': -6 },
          fn: (st) => { st.policy.monetary.emission = S.clamp(st.policy.monetary.emission + 10, 0, 100); },
          factions: { business: -9, labour: +2 }, headline: 'Central Bank to Purchase Government Debt Directly'
        },
        {
          label: 'Emergency spending freeze', detail: 'Freeze non-essential outlays until the tranche clears.',
          effects: { 'society.approval': -5, 'economy.shock': -0.6, 'economy.creditScore': +0 },
          fn: (st) => { for (const m in st.budget.alloc) if (m !== 'defense' && m !== 'health') st.budget.alloc[m] *= 0.94; },
          factions: { business: +8, labour: -8, provinces: -6 }, headline: 'Spending Freeze Announced Ahead of Debt Auction'
        },
        {
          label: 'Approach the multilateral lenders', detail: 'Request a lending programme. Provides reserves; conditions include subsidy cuts.',
          effects: { 'economy.reserves': 0, 'society.approval': -7, 'national.prestige': -6, 'economy.reserveStatus': +14 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.04; st.flags.imfProgramme = true; st.policy.econ.subsidies = Math.max(0, st.policy.econ.subsidies - 15); },
          then: { id: 'imf_review', days: 540 },
          factions: { nationalists: -12, business: +6, labour: -8 },
          headline: 'Government Enters Multilateral Lending Programme'
        }
      ]
    },

    /* ----------------------------------------------------------- ECONOMY */
    {
      id: 'central_bank_independence', cat: 'economy', title: 'The Question of the Central Bank',
      from: 'Office of the Leader', urgency: 'routine', deadline: 25,
      weight: (st) => (st.economy.inflation > 7 || st.policy.monetary.rate > 9) ? 16 : 5,
      brief: (st) => `<p>The Governor has set rates at ${S.round(st.policy.monetary.rate, 1)}% against inflation of ${S.round(st.economy.inflation, 1)}%. Businesses and households are pressing for lower rates.</p>
        <p>The statute allows the government to direct the Bank. No government has used the power in decades. A direction would lower rates quickly but would permanently damage monetary credibility.</p>`,
      advisors: () => [
        { who: 'Bank Governor', role: 'Monetary', said: 'A government direction would immediately damage monetary credibility and raise long-term borrowing costs.' },
        { who: 'Political Adviser', role: 'Office', said: 'Voters respond to borrowing costs, not institutional arrangements. A rate cut would be popular.' }
      ],
      options: [
        { label: 'Reaffirm independence in law', detail: 'Entrench independence in statute. Strengthens credibility; forgoes control of rates.',
          effects: { 'economy.businessConfidence': +9, 'economy.reserveStatus': +5, 'society.approval': -3, 'economy.inflation': -0.6 },
          factions: { business: +10, intelligentsia: +6, labour: -4 }, headline: 'Central Bank Independence Written into Law' },
        { label: 'Leave the arrangement alone', detail: 'No change to the current arrangement.', effects: {}, factions: {} },
        { label: 'Direct the Bank to cut rates', detail: 'Order a 3-point cut. Raises growth now; raises inflation and damages credibility.',
          effects: { 'economy.shock': +1.2, 'economy.inflation': +1.8, 'economy.businessConfidence': -10, 'economy.reserveStatus': -8, 'society.approval': +5 },
          fn: (st) => { st.policy.monetary.rate = Math.max(0, st.policy.monetary.rate - 3); st.flags.bankDirected = true; },
          factions: { business: -12, labour: +6, reformers: -8 }, headline: 'Government Orders Rate Cut; Governor Silent' },
        { label: 'Replace the Governor', detail: 'Install a compliant Governor. Secures control of rates; markets will react badly.',
          effects: { 'economy.businessConfidence': -16, 'economy.reserveStatus': -10, 'society.corruption': +3, 'economy.inflation': +1.0 },
          fn: (st) => { st.flags.bankCaptured = true; }, requires: (st) => !democratic(st) || st.society.approval > 55,
          factions: { business: -16, reformers: -12, nationalists: +5 }, headline: 'Central Bank Governor Dismissed' }
      ]
    },
    {
      id: 'currency_crisis', cat: 'economy', title: 'The Currency Is Under Attack',
      from: 'Central Bank', urgency: 'urgent', deadline: 5,
      weight: (st) => (st.economy.fx < 78 && st.economy.fxTarget < st.economy.fx * 0.94) ? 34 : 0,
      brief: (st) => `<p>The currency has fallen to ${S.round(st.economy.fx, 1)} against its launch value and the selling has become disorderly. Reserves stand at ${S.money(st.economy.reserves)} — ${S.round(st.economy.reserveMonths, 1)} months of imports.</p>
        <p>Import prices are already feeding through. The Bank wants a decision before the market opens.</p>`,
      advisors: (st) => [
        { who: 'Bank Governor', role: 'Monetary', said: 'Defending the currency spends reserves needed for food and fuel imports. Raising rates costs output and jobs. Those are the available instruments.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'A devaluation cuts real wages and will raise consumer prices within two weeks.' }
      ],
      options: [
        { label: 'Defend the currency with reserves', detail: 'Intervene with reserves to support the rate. Costly; the effect may not hold.',
          effects: { 'economy.reserveStatus': -8 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.03; st.economy.fx *= 1.06; },
          factions: { business: +4, labour: +2 }, headline: 'Central Bank Intervenes Heavily to Defend Currency' },
        { label: 'Raise rates sharply', detail: 'A 5-point emergency rise. Supports the currency at significant cost to output.',
          effects: { 'economy.shock': -1.6, 'society.approval': -5 },
          fn: (st) => { st.policy.monetary.rate = Math.min(35, st.policy.monetary.rate + 5); },
          factions: { business: -6, labour: -9 }, headline: 'Emergency Rate Rise as Currency Slides' },
        { label: 'Impose capital controls', detail: 'Restrict capital outflows. Halts the run; deters future investment.',
          effects: { 'policy.monetary.capitalControls': +35, 'economy.businessConfidence': -14, 'economy.reserveStatus': -6 },
          factions: { business: -15, labour: +5, nationalists: +6 }, headline: 'Capital Controls Imposed Overnight' },
        { label: 'Let it float and manage the fallout', detail: 'Accept a devaluation; provide targeted support for low incomes. Raises inflation.',
          effects: { 'economy.inflation': +3.5, 'society.approval': -6, 'society.unrest': +5, 'economy.shock': +0.4 },
          fn: (st) => { st.policy.monetary.regime = 'float'; st.economy.fx *= 0.90; },
          factions: { business: +3, labour: -8 }, headline: 'Currency Left to Float; Sharp Fall Expected' }
      ]
    },
    {
      id: 'nationalisation', cat: 'economy', title: 'The Strategic Industry Question',
      from: 'Ministry of Industry', urgency: 'routine', deadline: 28,
      weight: (st) => 9 + (st.economy.sectors.resources > 12 ? 8 : 0),
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>A foreign consortium controls the largest ${f.industry} complex in the country. The operation is efficient and profitable; most profits are repatriated abroad.</p>`,
          `<p>${f.firm} has announced it will move its ${f.industry} profits offshore through a legal structure dating from the 1990s.</p>`,
          `<p>The ${f.industry} concession in ${f.region} is due for renewal this year. The current terms are widely regarded as unfavourable to the state.</p>`
        ]);
        return framing + `<p>The nationalist bloc has campaigned on the issue for a month. Legal advice: expropriation is lawful under domestic statute but would bring roughly a decade of international arbitration. State ownership currently stands at ${S.round(st.policy.econ.stateOwnership, 0)}/100.</p>`;
      },
      advisors: (st) => [
        { who: 'Industry Minister', role: 'Cabinet', said: 'The state could operate the complex, with some initial loss of efficiency.' },
        { who: 'Foreign Minister', role: 'Diplomacy', said: 'Expropriation would immediately raise the risk premium on all foreign investment here.' },
        { who: 'Nationalist Caucus', role: 'Legislature', said: 'The resource is national property and should be under national control.' }
      ],
      options: [
        { label: 'Nationalise the complex', detail: 'Expropriate with deferred compensation at book value. Expect arbitration and investor withdrawal.',
          effects: { 'policy.econ.stateOwnership': +12, 'economy.businessConfidence': -18, 'national.prestige': -4, 'society.approval': +7, 'economy.reserves': +0 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.012; st.diplomacy.nations.forEach((n) => { n.relation -= 5; }); },
          then: [{ id: 'arbitration_ruling', days: 620 }, { id: 'soe_performance', days: 1500 }],
          factions: { nationalists: +14, labour: +9, business: -18 },
          risk: { p: 0.4, text: 'Arbitration award against us', fn: (st) => { st.economy.debt += st.economy.gdp * 0.02; } },
          headline: 'Government Nationalises Foreign-Owned Complex' },
        { label: 'Renegotiate the concession', detail: 'Higher royalties, local content rules, a state stake.',
          effects: { 'economy.reserves': +0, 'policy.econ.stateOwnership': +4, 'economy.businessConfidence': -4, 'society.approval': +4 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.005; },
          factions: { nationalists: +7, business: -4, labour: +4 }, headline: 'Concession Terms Renegotiated on Better Terms' },
        { label: 'Leave it alone', detail: 'Retain the current arrangement. Preserves investor confidence.',
          effects: { 'economy.businessConfidence': +5 },
          factions: { business: +7, nationalists: -9, labour: -4 } }
      ]
    },
    {
      id: 'subsidy_reform', cat: 'economy', title: 'The Fuel Subsidy',
      from: 'Ministry of Energy', urgency: 'pressing', deadline: 18,
      weight: (st) => st.policy.econ.subsidies > 45 || st.world.oil > 130 ? 20 : 6,
      brief: (st) => `<p>Fuel and bread subsidies consume a substantial share of the budget and rise with world prices. Their annual cost now exceeds the education budget.</p>
        <p>Removal has caused serious unrest in comparable countries. Retention is fiscally unsustainable at current prices.</p>`,
      advisors: () => [
        { who: 'Finance Minister', role: 'Treasury', said: 'This is the largest single transfer in the budget, and most of the benefit goes to higher-income households.' },
        { who: 'Interior Minister', role: 'Security', said: 'The last attempt to cut these subsidies caused four days of rioting in the capital. Security preparations should come first.' }
      ],
      options: [
        { label: 'Remove subsidies overnight', detail: 'Immediate removal. Large fiscal saving; high probability of serious unrest.',
          effects: { 'policy.econ.subsidies': -35, 'society.unrest': +18, 'society.approval': -12, 'economy.inflation': +2.6, 'economy.shock': +0.5 },
          factions: { business: +10, labour: -14, reformers: +3 },
          risk: { p: 0.45, text: 'Mass unrest', fn: (st) => { st.society.unrest += 12; st.society.stability -= 8; } },
          headline: 'Fuel Subsidies Abolished; Prices Double Overnight' },
        { label: 'Phase out over three years with cash transfers', detail: 'Gradual removal with compensating payments. Slower savings; lower unrest risk.',
          effects: { 'policy.econ.subsidies': -14, 'society.unrest': +5, 'society.approval': -4, 'quality.welfareQ': +3, 'budget.alloc.welfare': +0.5 },
          factions: { labour: -4, business: +5, reformers: +6 }, headline: 'Subsidy Reform Paired with Direct Cash Payments' },
        { label: 'Keep them and find the money elsewhere', detail: 'Retain subsidies; fund them by cutting infrastructure and research budgets.',
          effects: { 'society.approval': +4, 'economy.shock': -0.3 },
          fn: (st) => { st.budget.alloc.infra *= 0.93; st.budget.alloc.research *= 0.93; },
          factions: { labour: +7, business: -5, reformers: -5 } }
      ]
    },
    {
      id: 'tech_champion', cat: 'economy', title: 'A National Technology Champion',
      from: 'Ministry of Science', urgency: 'routine', deadline: 30,
      weight: (st) => st.quality.science > 35 ? 11 : 4,
      brief: () => `<p>Three of our largest firms have proposed a state-backed consortium to build sovereign capability in advanced semiconductors and computing. They want capital, procurement guarantees and protection from imports.</p>
        <p>The proposal is a large industrial-policy commitment. Comparable programmes abroad have produced both durable industries and sustained losses.</p>`,
      advisors: () => [
        { who: 'Science Minister', role: 'Cabinet', said: 'Without domestic capability we remain dependent on foreign suppliers for critical technology.' },
        { who: 'Treasury', role: 'Finance', said: 'State-selected industrial ventures have a poor historical success rate, and unsuccessful ones tend to request further funding.' }
      ],
      options: [
        { label: 'Fund it at scale', detail: 'Provide capital and procurement guarantees at the requested scale.',
          effects: { 'budget.alloc.research': +0.9, 'quality.science': +4, 'economy.businessConfidence': +5, 'economy.shock': +0.3 },
          factions: { business: +8, intelligentsia: +7, labour: +3 },
          risk: { p: 0.3, text: 'Programme flounders', fn: (st) => { st.society.corruption += 3; st.society.scandal -= 3; } },
          headline: 'State Backs National Semiconductor Consortium' },
        { label: 'Fund research, not firms', detail: 'Direct the funds to universities and public laboratories instead of the consortium.',
          effects: { 'budget.alloc.research': +0.5, 'quality.science': +3, 'quality.education': +1 },
          factions: { intelligentsia: +10, business: -3 }, headline: 'Government Doubles University Research Funding' },
        { label: 'Decline', detail: 'Reject the proposal and leave the sector to private investment.',
          effects: { 'economy.businessConfidence': -2 }, factions: { business: -5, intelligentsia: -4 } }
      ]
    },

    /* ------------------------------------------------------------- TRADE */
    {
      id: 'tariff_pressure', cat: 'economy', title: 'Domestic Industry Demands Protection',
      from: 'Ministry of Trade', urgency: 'routine', deadline: 24,
      weight: (st) => st.economy.unemployment > 7 ? 18 : 8,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const jobs = Math.round(st.pop.total * 1000 * st.rng.range(0.3, 1.1));
        ctx.jobs = ctx.jobs || jobs;
        const framing = D.variant(st, ctx, 'frame', [
          `<p>Imports have taken a third of the domestic market in ${f.industry} and ${f.industry2} in four years. <b>${S.num(ctx.jobs)}</b> jobs are at risk, concentrated in ${f.region}.</p>`,
          `<p>${f.firm} has announced it will close its ${f.industry} works in ${f.region} unless the government acts on import competition. <b>${S.num(ctx.jobs)}</b> jobs are at stake; the firm is the dominant employer in the area.</p>`,
          `<p>${f.union} has occupied the ${f.industry} plants in ${f.region} pending a government response on import competition. <b>${S.num(ctx.jobs)}</b> jobs are at stake and media coverage is extensive.</p>`
        ]);
        return framing + `<p>Our current average tariff is ${S.round(st.policy.trade.tariff, 1)}%. Unemployment stands at ${S.round(st.economy.unemployment, 1)}%.</p>`;
      },
      advisors: () => [
        { who: 'Trade Minister', role: 'Cabinet', said: 'Protection raises prices for all consumers to support a small number of firms. It would, however, keep those firms operating.' },
        { who: 'Regional Governors', role: 'Provinces', said: 'Those towns have one employer. When it closes there is nothing else.' }
      ],
      options: [
        { label: 'Impose protective tariffs', detail: 'Raise duties sharply on the affected goods.',
          effects: { 'policy.trade.tariff': +7, 'economy.inflation': +0.7, 'society.approval': +4, 'economy.businessConfidence': -3 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.tradeVolume > st.economy.gdp * 0.01) n.relation -= 6; }); },
          factions: { labour: +9, provinces: +8, business: -5, nationalists: +7 },
          risk: { p: 0.35, text: 'Retaliation', fn: (st) => { st.economy.exports *= 0.95; st.economy.shock -= 0.5; } },
          headline: 'Sweeping Tariffs Imposed to Protect Domestic Industry' },
        { label: 'Adjustment assistance instead', detail: 'Retraining, relocation grants, regional investment.',
          effects: { 'budget.alloc.welfare': +0.3, 'budget.alloc.education': +0.2, 'society.approval': +1, 'quality.education': +1 },
          factions: { labour: +4, provinces: +4, business: +3, reformers: +5 }, headline: 'Government Funds Retraining, Rejects Tariffs' },
        { label: 'Do nothing', detail: 'Take no action and allow the adjustment to run its course.',
          effects: { 'society.approval': -3, 'economy.shock': +0.2 },
          factions: { labour: -8, provinces: -7, business: +6 } }
      ]
    },
    {
      id: 'chokepoint', cat: 'economy', title: 'A Strait Has Closed',
      from: 'Ministry of Trade', urgency: 'urgent', deadline: 8,
      weight: (st) => st.world.tension > 45 ? 14 : 3,
      brief: (st) => `<p>A regional confrontation has closed one of the world's shipping chokepoints. Insurance for the route has become unobtainable overnight.</p>
        <p>Roughly a fifth of our imports and a quarter of our energy transit the strait. Oil is already at ${S.round(st.world.oil, 0)}.</p>`,
      advisors: () => [
        { who: 'Trade Minister', role: 'Cabinet', said: 'We have eleven days of commercial fuel stocks. After that it is rationing or the strategic reserve.' },
        { who: 'Chief of Naval Staff', role: 'Defence', said: 'We can escort. It commits us to a confrontation we may not want.' }
      ],
      options: [
        { label: 'Release the strategic reserve', detail: 'Cover the shortfall from stocks. Depletes the reserve.',
          effects: { 'quality.energy': -4, 'economy.inflation': -0.8, 'society.approval': +3 },
          headline: 'Strategic Reserves Released to Steady Fuel Prices' },
        { label: 'Escort our shipping', detail: 'Deploy naval escorts for merchant traffic. Risks confrontation.',
          effects: { 'military.readiness': -5, 'world.tension': +8, 'national.prestige': +5, 'national.aggressionScore': +8 },
          factions: { military: +6, nationalists: +9 },
          risk: { p: 0.25, text: 'Naval incident', fn: (st) => { st.world.tension += 8; st.society.unrest += 3; } },
          headline: 'Naval Task Group Deployed to Escort Merchant Traffic' },
        { label: 'Ration and reroute', detail: 'Longer routes, higher costs, managed shortages.',
          effects: { 'economy.shock': -1.0, 'economy.inflation': +1.4, 'society.approval': -5, 'society.unrest': +4 },
          headline: 'Fuel Rationing Introduced as Shipping Reroutes' },
        { label: 'Convene the trading powers', detail: 'Seek a negotiated reopening. Slower than the alternatives.',
          effects: { 'national.prestige': +4, 'world.tension': -4, 'economy.inflation': +0.8 },
          factions: { intelligentsia: +4 }, headline: 'Emergency Conference Convened on Shipping Crisis' }
      ]
    },

    /* ---------------------------------------------------------- MILITARY */
    {
      id: 'procurement_scandal', cat: 'military', title: 'The Procurement Programme Is in Trouble',
      from: 'Chief of the General Staff', urgency: 'pressing', deadline: 20,
      weight: (st) => st.society.corruption > 35 ? 16 : 8,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>The main combat systems programme is four years late and has consumed twice its authorisation. The auditor has found irregularities in three of the five prime contracts, all of them held by ${f.firm}.</p>`,
          `<p>${f.official} has resigned rather than certify the annual procurement accounts, citing irregularities in contracts held by ${f.firm}.</p>`,
          `<p>A consignment received at the ${f.region} depot contained roughly a quarter of the equipment invoiced. The accompanying documentation had been approved at every stage.</p>`
        ]);
        return framing + `<p>Readiness stands at ${S.round(st.military.readiness, 0)} and equipment at ${S.round(st.military.equipment, 0)}. Cancellation leaves a capability gap; continuation retains the current contractors.</p>`;
      },
      advisors: () => [
        { who: 'Chief of Staff', role: 'Defence', said: 'Whatever you decide, decide it this month. My commanders are training on equipment we told them would be replaced.' },
        { who: 'Auditor General', role: 'Oversight', said: 'I can name the responsible officials. Whether the names are published is a decision for the government.' }
      ],
      options: [
        { label: 'Cancel and re-tender', detail: 'Terminate the contracts and run a new tender. Accepts a capability gap in the interim.',
          effects: { 'military.equipment': -6, 'society.corruption': -4, 'society.approval': +3, 'quality.admin': +2 },
          factions: { military: -8, reformers: +10, business: -6 }, headline: 'Flagship Defence Programme Cancelled' },
        { label: 'Restructure and continue', detail: 'Replace programme management and reset milestones while retaining the contractors.',
          effects: { 'military.equipment': +2, 'economy.shock': -0.1, 'society.corruption': +1 },
          factions: { military: +5, business: +5, reformers: -5 }, headline: 'Defence Programme Restructured, Not Cancelled' },
        { label: 'Prosecute publicly', detail: 'Refer the named officials for prosecution, announced publicly.',
          effects: { 'society.corruption': -7, 'society.approval': +6, 'military.morale': -5, 'quality.admin': +2 },
          factions: { reformers: +14, military: -11, business: -9 },
          risk: { p: 0.3, text: 'Investigation reaches your own office', fn: (st) => { st.society.scandal -= 6; st.society.approval -= 4; } },
          headline: 'Senior Officials Arrested in Defence Procurement Case' },
        { label: 'Bury the audit', detail: 'Classify the audit and take no further action.',
          effects: { 'society.corruption': +4, 'policy.interior.pressFreedom': -3 },
          factions: { military: +7, business: +6, reformers: -12 },
          risk: { p: 0.35, text: 'It leaks', fn: (st) => { st.society.scandal -= 10; st.society.approval -= 7; S.News.custom(st, 'Leaked Audit Reveals Buried Defence Scandal', 'bad'); } } }
      ]
    },
    {
      id: 'conscription_debate', cat: 'military', title: 'The Manpower Question',
      from: 'Ministry of Defence', urgency: 'routine', deadline: 26,
      weight: (st) => (st.wars.length ? 22 : 8) + (st.military.readiness < 45 ? 8 : 0),
      brief: (st) => `<p>The armed forces are ${S.headcount(st.military.manpower)} strong against an establishment they cannot fill. Recruitment has missed target for three years running.</p>
        <p>Conscription currently sits at ${st.policy.mil.conscription} on the national scale.</p>`,
      advisors: (st) => [
        { who: 'Chief of Staff', role: 'Defence', said: st.wars.length ? 'I am rotating exhausted formations because there is nobody to replace them.' : 'Conscription would add numbers but lower average quality. I would prefer a smaller professional force.' },
        { who: 'Education Minister', role: 'Cabinet', said: 'Every conscript is a student or an apprentice we do not get for two years.' }
      ],
      options: [
        { label: 'Universal conscription', detail: 'Require service from the full cohort. Increases numbers; reduces average quality and delays entry to education and work.',
          effects: { 'policy.mil.conscription': +35, 'military.readiness': -4, 'society.approval': -7, 'society.cohesion': +5, 'economy.shock': -0.4 },
          factions: { military: +8, nationalists: +11, labour: -6, reformers: -9, intelligentsia: -7 },
          headline: 'Universal Military Service Introduced' },
        { label: 'Selective service expansion', detail: 'Enlarge the draft pool with selection by lottery.',
          effects: { 'policy.mil.conscription': +15, 'society.approval': -3, 'society.cohesion': +2 },
          factions: { military: +5, nationalists: +5, reformers: -4 } },
        { label: 'Professionalise: better pay and conditions', detail: 'Raise pay and conditions to meet recruitment targets with volunteers.',
          effects: { 'budget.alloc.defense': +0.35, 'policy.mil.veteranCare': +12, 'military.morale': +7, 'military.readiness': +4 },
          factions: { military: +11, labour: +3 }, headline: 'Forces Pay Rise Announced in Recruitment Drive' },
        { label: 'Abolish conscription entirely', detail: 'Move to a smaller all-volunteer force; return the conscript cohort to the civilian economy.',
          effects: { 'policy.mil.conscription': -100, 'military.readiness': +3, 'society.approval': +5, 'economy.shock': +0.4 },
          factions: { military: -9, nationalists: -12, reformers: +10, intelligentsia: +8 },
          headline: 'Conscription Abolished; Forces to Go All-Volunteer' }
      ]
    },
    {
      id: 'nuclear_program', cat: 'military', title: 'The Nuclear Option',
      from: 'Strategic Directorate', urgency: 'routine', deadline: 30,
      weight: (st) => (st.military.nuclear < 25 && st.quality.science > 45 && st.world.tension > 35) ? 14 : 0,
      brief: (st) => `<p>The directorate reports that we could field a credible deterrent within a decade. The technical requirements can be met; the principal cost is the diplomatic response once the programme becomes known.</p>
        <p>World tension stands at ${S.round(st.world.tension, 0)}. ${st.diplomacy.nations.filter((n) => n.nuclear).length} states already hold weapons.</p>`,
      advisors: () => [
        { who: 'Strategic Director', role: 'Defence', said: 'A deterrent is the strongest available guarantee against invasion. No nuclear-armed state has been invaded.' },
        { who: 'Foreign Minister', role: 'Diplomacy', said: 'The sanctions regime that would follow would impose costs an economy of our size cannot absorb.' }
      ],
      options: [
        { label: 'Pursue weapons openly', detail: 'Withdraw from the framework and build.',
          effects: { 'world.tension': +14, 'national.prestige': +6, 'budget.alloc.defense': +0.5 },
          fn: (st) => { st.policy.mil.nuclearPosture = 'minimal'; st.diplomacy.nations.forEach((n) => { n.relation -= 14; if (n.power > 60) n.sanctioningUs = true; }); },
          factions: { military: +10, nationalists: +14, intelligentsia: -8 },
          headline: 'Nation Announces Nuclear Weapons Programme' },
        { label: 'Develop latent capability quietly', detail: 'Build the option without declaring it. Threshold status.',
          effects: { 'world.tension': +4, 'intel.strength': -3, 'budget.alloc.research': +0.2 },
          fn: (st) => { st.policy.mil.nuclearPosture = 'latent'; },
          factions: { military: +6, nationalists: +6 },
          risk: { p: 0.3, text: 'The programme is exposed', fn: (st) => { st.diplomacy.nations.forEach((n) => { n.relation -= 10; }); st.world.tension += 8; S.News.custom(st, 'Foreign Intelligence Exposes Covert Nuclear Work', 'bad'); } } },
        { label: 'Renounce and seek guarantees', detail: 'Formally renounce weapons and seek security guarantees from an existing nuclear power.',
          effects: { 'world.tension': -6, 'national.prestige': +3, 'national.softPower': +5 },
          fn: (st) => { st.policy.mil.nuclearPosture = 'renounced'; st.diplomacy.nations.forEach((n) => { if (n.ideology === S.Dip.ownIdeology(st)) n.relation += 8; }); },
          factions: { intelligentsia: +9, nationalists: -12, military: -6 },
          headline: 'Nation Formally Renounces Nuclear Weapons' }
      ]
    },
    {
      id: 'border_incident', cat: 'military', title: 'Shots Fired on the Border',
      from: 'Chief of the General Staff', urgency: 'urgent', deadline: 4,
      weight: (st) => st.diplomacy.nations.some((n) => n.relation < -40) ? 18 : 4,
      brief: (st) => {
        const n = st.diplomacy.nations.filter((x) => x.relation < -30).sort((a, b) => a.relation - b.relation)[0];
        return `<p>A patrol exchanged fire with ${n ? n.adj : 'foreign'} forces at the frontier. Four of ours are dead. Their account differs from ours in every particular.</p>
          <p>The wire services have the story. The position taken in the next four hours will be difficult to alter later.</p>`;
      },
      options: [
        { label: 'Retaliate proportionately', detail: 'A measured strike on the responsible unit.',
          effects: { 'world.tension': +9, 'society.approval': +5, 'national.prestige': +3, 'national.aggressionScore': +10 },
          fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation < -30).sort((a, b) => a.relation - b.relation)[0]; if (n) { n.relation -= 12; n.grievance = (n.grievance || 0) + 15; } },
          factions: { military: +9, nationalists: +12 },
          risk: { p: 0.22, text: 'Escalation to open war', fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation < -40)[0]; if (n) S.Mil.startWar(st, n.id, { aggressor: true, intensity: 55 }); } },
          headline: 'Retaliatory Strike Ordered After Border Deaths' },
        { label: 'Protest and reinforce', detail: 'Lodge a formal protest and reinforce the frontier without military action.',
          effects: { 'world.tension': +3, 'military.readiness': -2, 'society.approval': +1 },
          factions: { military: +3, nationalists: -3 }, headline: 'Border Reinforced After Fatal Exchange' },
        { label: 'Play it down', detail: 'Characterise the incident as a misunderstanding and minimise coverage.',
          effects: { 'world.tension': -2, 'society.approval': -4, 'policy.interior.pressFreedom': -2 },
          factions: { nationalists: -11, military: -6, intelligentsia: +2 } },
        { label: 'Propose a joint investigation', detail: 'Invite them to establish the facts with us.',
          effects: { 'national.prestige': +4, 'world.tension': -5, 'society.approval': -2 },
          fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation < -30)[0]; if (n) n.relation += 8; },
          factions: { intelligentsia: +6, nationalists: -8 }, headline: 'Joint Inquiry Proposed into Border Deaths' }
      ]
    },
    {
      id: 'doctrine_review', cat: 'military', title: 'Strategic Defence Review',
      from: 'Ministry of Defence', urgency: 'routine', deadline: 30,
      weight: (st) => (st.date.year % 5 === 0 ? 20 : 5),
      brief: (st) => `<p>The five-yearly review is due. It requires a decision on the primary mission of the armed forces.</p>
        <p>Current doctrine: ${S.Mil.DOCTRINES[st.policy.mil.doctrine].name}. Force quality index ${S.round(st.military.quality, 0)}; world power ranking ${S.ordinal(S.Mil.worldRank(st).findIndex((x) => x.self) + 1)}.</p>`,
      advisors: () => [
        { who: 'Chief of Staff', role: 'Defence', said: 'The mission should be defined first; force structure and cost follow from it.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'The budget constraint is fixed. The mission must be defined within it.' }
      ],
      options: [
        { label: 'Territorial defence', detail: 'Structure the forces for defence of national territory only. The lowest-cost option.',
          effects: { 'budget.alloc.defense': -0.4, 'national.prestige': -3, 'economy.shock': +0.2 },
          fn: (st) => { st.policy.mil.doctrine = 'defensive'; },
          factions: { military: -3, nationalists: -4, business: +5, labour: +3 } },
        { label: 'Strategic deterrence', detail: 'Structure the forces to make any attack visibly costly to an aggressor.',
          effects: { 'national.prestige': +2, 'world.tension': +2 },
          fn: (st) => { st.policy.mil.doctrine = 'deterrence'; }, factions: { military: +5, nationalists: +4 } },
        { label: 'Expeditionary power', detail: 'Build capacity to project force abroad: bases, transport and carriers. The highest-cost option.',
          effects: { 'budget.alloc.defense': +0.6, 'national.prestige': +8, 'world.tension': +6 },
          fn: (st) => { st.policy.mil.doctrine = 'expeditionary'; },
          factions: { military: +10, nationalists: +9, business: -4, labour: -5 },
          headline: 'Defence Review Commits to Global Power Projection' },
        { label: 'Asymmetric defence', detail: 'Structure for dispersed, low-cost resistance to invasion rather than conventional forces.',
          effects: { 'budget.alloc.defense': -0.6, 'national.prestige': -5, 'economy.shock': +0.3 },
          fn: (st) => { st.policy.mil.doctrine = 'asymmetric'; },
          factions: { military: -6, nationalists: -7, reformers: +5, business: +6 } }
      ]
    },

    /* --------------------------------------------------------- DIPLOMACY */
    {
      id: 'summit_invitation', cat: 'diplomacy', title: 'An Invitation to the Summit',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 22,
      weight: () => 10,
      brief: (st) => `<p>The major economies have invited us to a leaders' summit. The formal agenda covers trade rules and climate finance.</p>
        <p>Our prestige stands at ${S.round(st.national.prestige, 0)}. Both attendance and absence will be read abroad as signals.</p>`,
      advisors: () => [
        { who: 'Foreign Minister', role: 'Diplomacy', said: 'The rules under discussion will apply to us whether or not we attend. Attendance gives us influence over their content.' },
        { who: 'Nationalist Caucus', role: 'Legislature', said: 'Each communiqué we sign transfers a measure of sovereignty to an international body.' }
      ],
      options: [
        { label: 'Attend and lead', detail: 'Attend, table proposals and commit resources to joint initiatives.',
          effects: { 'national.prestige': +7, 'national.softPower': +5, 'world.tension': -3, 'society.approval': -1 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.relation > 0) n.relation += 5; }); },
          factions: { intelligentsia: +6, business: +5, nationalists: -6 }, headline: 'Leader Takes Centre Stage at World Summit' },
        { label: 'Attend quietly', detail: 'Attend without making binding commitments.',
          effects: { 'national.prestige': +2 }, factions: {} },
        { label: 'Decline the invitation', detail: 'Refuse attendance and accept the diplomatic cost.',
          effects: { 'national.prestige': -6, 'national.softPower': -4, 'society.approval': +2 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.power > 50) n.relation -= 5; }); },
          factions: { nationalists: +9, intelligentsia: -7 }, headline: 'Government Snubs World Summit' }
      ]
    },
    {
      id: 'foreign_aid_scandal', cat: 'diplomacy', title: 'Where Did the Aid Go?',
      from: 'Foreign Ministry', urgency: 'pressing', deadline: 16,
      weight: (st) => st.policy.foreign.aid > 30 ? 12 : 3,
      brief: () => `<p>An investigative outlet has traced a substantial share of last year's development assistance into the private accounts of officials in a recipient state — and into two firms with links to our own governing circle.</p>`,
      advisors: () => [
        { who: 'Foreign Minister', role: 'Diplomacy', said: 'Some diversion occurs in every aid programme. The material question is whether funds returned to firms connected to this government.' },
        { who: 'Attorney General', role: 'Justice', said: 'I can open an investigation. Its scope cannot be controlled once it begins.' }
      ],
      options: [
        { label: 'Full public inquiry', detail: 'Commission an independent inquiry with published findings. The outcome cannot be controlled.',
          effects: { 'society.corruption': -5, 'society.approval': +3, 'quality.admin': +2 },
          factions: { reformers: +12, intelligentsia: +7, business: -6 },
          risk: { p: 0.4, text: 'It reaches your circle', fn: (st) => { st.society.scandal -= 9; st.society.approval -= 6; } },
          headline: 'Independent Inquiry Opened into Aid Programme' },
        { label: 'Suspend aid to the recipient', detail: 'Suspend assistance to the recipient state without addressing the domestic allegations.',
          effects: { 'policy.foreign.aid': -10, 'national.softPower': -3, 'society.approval': +2 },
          factions: { nationalists: +6, intelligentsia: -3 } },
        { label: 'Deny and discredit the reporting', detail: 'Reject the allegations and challenge the credibility of the outlet.',
          effects: { 'policy.interior.pressFreedom': -5, 'society.corruption': +3, 'society.latent': +4 },
          factions: { reformers: -11, intelligentsia: -10, nationalists: +4 },
          risk: { p: 0.4, text: 'Second story lands', fn: (st) => { st.society.scandal -= 12; st.society.approval -= 8; } } }
      ]
    },
    {
      id: 'refugee_flow', cat: 'diplomacy', title: 'Refugees at the Frontier',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 12,
      weight: (st) => (st.world.globalWars > 0 || st.world.tension > 50) ? 18 : 6,
      brief: (st) => `<p>Conflict in a neighbouring region has pushed several hundred thousand people toward our border. They are arriving faster than they can be processed and the camps were designed for a tenth of this.</p>
        <p>Current immigration posture: ${st.policy.interior.immigration}/100. The question is politically contentious.</p>`,
      advisors: () => [
        { who: 'Interior Minister', role: 'Security', said: 'We can close the frontier, but the operation will be highly visible and widely reported.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'Admitted refugees are a net fiscal cost in the short term and net contributors over the long term.' }
      ],
      options: [
        { label: 'Open the border and integrate', detail: 'Reception, work rights, schooling.',
          effects: { 'policy.interior.immigration': +18, 'national.softPower': +8, 'society.unrest': +6, 'society.cohesion': -5, 'budget.alloc.welfare': +0.3, 'society.approval': -4, 'pop.total': +0.4 },
          factions: { intelligentsia: +10, reformers: +8, nationalists: -14, clergy: -4 },
          headline: 'Borders Opened to Refugees; Reception Centres Established' },
        { label: 'Controlled intake with quotas', detail: 'Admit a fixed annual quota through a formal process.',
          effects: { 'policy.interior.immigration': +6, 'national.softPower': +3, 'society.unrest': +2, 'pop.total': +0.12 },
          factions: { nationalists: -4, intelligentsia: +3 } },
        { label: 'Seal the border', detail: 'Close the frontier with troops and physical barriers.',
          effects: { 'policy.interior.immigration': -18, 'national.softPower': -9, 'society.approval': +5, 'society.cohesion': +3, 'world.tension': +3 },
          factions: { nationalists: +13, clergy: +4, intelligentsia: -11, reformers: -8 },
          headline: 'Border Sealed; Troops Deployed to Frontier' },
        { label: 'Pay a neighbour to hold them', detail: 'Fund a neighbouring state to host the refugees on our behalf.',
          effects: { 'economy.reserves': 0, 'national.softPower': -5, 'society.approval': +3 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.006; const n = st.rng.pick(st.diplomacy.nations); n.relation += 8; },
          factions: { nationalists: +7, intelligentsia: -7 } }
      ]
    },

    /* ------------------------------------------------------------- CIVIC */
    {
      id: 'constitutional_reform', cat: 'civic', title: 'Constitutional Reform',
      from: 'Office of the Leader', urgency: 'routine', deadline: 30,
      weight: (st) => (st.society.stability > 45 && st.date.year > st.startYear + 1 && !st.flags.recentConstitution) ? 9 : 0,
      brief: (st) => `<p>The constitutional committee has reported. Its recommendations run from technical tidying to a fundamental restructuring of where power sits in this country.</p>
        <p>You currently govern as a ${S.gov(st).name.toLowerCase()}. Legitimacy stands at ${S.round(st.society.legitimacy, 0)}; stability at ${S.round(st.society.stability, 0)}.</p>`,
      advisors: (st) => [
        { who: 'Attorney General', role: 'Justice', said: 'Constitutional provisions outlast governments. Powers created now will be available to future governments of any character.' },
        { who: 'Political Adviser', role: 'Office', said: st.society.approval > 55 ? 'You will never have more capital to spend on this than you do today.' : 'You do not have the standing for a fight of this size.' }
      ],
      options: [
        { label: 'Strengthen democratic institutions', detail: 'Entrench independent courts, term limits and legislative oversight.',
          effects: { 'society.freedom': +8, 'society.corruption': -6, 'quality.admin': +4, 'national.softPower': +8, 'society.stability': +4 },
          fn: (st) => { st.flags.recentConstitution = true; if (!democratic(st)) S.game.changeGovernment(st, 'managed'); else S.game.changeGovernment(st, 'liberal'); },
          factions: { reformers: +16, intelligentsia: +12, military: -6, nationalists: -5 },
          headline: 'Sweeping Constitutional Reforms Strengthen Courts and Limits' },
        { label: 'Centralise executive authority', detail: 'Emergency powers made permanent. Fewer veto points.',
          effects: { 'policy.interior.civilLiberties': -12, 'society.freedom': -10, 'society.latent': +8, 'society.stability': +5 },
          fn: (st) => { st.flags.recentConstitution = true; S.game.changeGovernment(st, democratic(st) ? 'managed' : 'personalist'); },
          factions: { reformers: -16, intelligentsia: -14, military: +6, nationalists: +8 },
          headline: 'Executive Powers Vastly Expanded in Constitutional Overhaul' },
        { label: 'Devolve power to the regions', detail: 'Real budgets and real authority to the provinces.',
          effects: { 'policy.social.devolution': +25, 'society.cohesion': -3, 'quality.admin': -2, 'society.stability': +3 },
          factions: { provinces: +18, nationalists: -6, reformers: +5 },
          headline: 'Constitutional Settlement Devolves Power to the Regions' },
        { label: 'Technical amendments only', detail: 'Adopt the technical corrections and no substantive change.',
          effects: {}, factions: { reformers: -4 } }
      ]
    },
    {
      id: 'press_crackdown', cat: 'civic', title: 'The Press Has Gone Too Far',
      from: 'Ministry of Information', urgency: 'routine', deadline: 20,
      weight: (st) => (st.society.approval < 45 && st.policy.interior.pressFreedom > 25) ? 15 : 5,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>Three outlets have run coordinated investigations into the government. Some of it is accurate. Some of it is not. All of it is damaging.</p>`,
          `<p>A reporter has published an eight-month investigation into ${f.official}. No factual challenge to the reporting has been made.</p>`,
          `<p>A broadcaster is running nightly reports from ${f.region} on undelivered government commitments. The reporting is accurate and widely watched.</p>`
        ]);
        return framing + `<p>Press freedom currently sits at ${st.policy.interior.pressFreedom}/100 and approval at ${S.round(st.society.approval, 0)}%. Corruption is measured at ${S.round(st.society.corruption, 0)}/100.</p>`;
      },
      advisors: (st) => [
        { who: 'Information Minister', role: 'Cabinet', said: 'A licensing regime is the least visible instrument available and attracts the least public reaction.' },
        { who: 'Attorney General', role: 'Justice', said: 'Every measure under consideration is lawful. The wider consequences are a separate question.' },
        { who: 'Intelligence Chief', role: 'Services', said: 'A controlled press stops providing accurate information about public opinion.' }
      ],
      options: [
        { label: 'Ignore it', detail: 'Take no action against the outlets.',
          effects: { 'society.approval': -2, 'policy.interior.pressFreedom': +2 },
          factions: { intelligentsia: +6, reformers: +5 } },
        { label: 'Sue for defamation', detail: 'Bring proceedings through the courts. Slow and costly.',
          effects: { 'policy.interior.pressFreedom': -5, 'society.approval': +1, 'society.latent': +2 },
          factions: { intelligentsia: -6, reformers: -5 } },
        { label: 'Licensing and ownership rules', detail: 'Introduce licensing and ownership requirements for media outlets.',
          effects: { 'policy.interior.pressFreedom': -18, 'policy.interior.propaganda': +10, 'society.approval': +3, 'society.latent': +7, 'national.softPower': -6 },
          factions: { intelligentsia: -14, reformers: -12, nationalists: +6 },
          headline: 'New Media Licensing Regime Announced' },
        { label: 'Arrest the editors', detail: 'Detain the responsible editors.',
          requires: (st) => authoritarian(st) || st.policy.interior.civilLiberties < 35,
          effects: { 'policy.interior.pressFreedom': -30, 'society.latent': +14, 'society.unrest': +6, 'national.softPower': -14, 'society.approval': +2 },
          factions: { intelligentsia: -22, reformers: -20, military: +3 },
          headline: 'Editors Detained in Overnight Raids' }
      ]
    },
    {
      id: 'corruption_purge', cat: 'civic', title: 'An Anti-Corruption Campaign',
      from: 'Office of the Leader', urgency: 'routine', deadline: 26,
      weight: (st) => st.society.corruption > 45 ? 18 : 6,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>Corruption is measured at ${S.round(st.society.corruption, 0)}/100 and is now visible enough that ordinary people discuss it openly.</p>`,
          `<p>${f.official} was filmed accepting a cash payment in ${f.city}. The footage has circulated nationally.</p>`,
          `<p>An audit of public works in ${f.region} found that a third of the money never reached a construction site. Corruption stands at ${S.round(st.society.corruption, 0)}/100.</p>`
        ]);
        return framing + `<p>A campaign would be popular. The same powers could also be applied selectively against political opponents.</p>`;
      },
      advisors: () => [
        { who: 'Interior Minister', role: 'Security', said: 'Give me the files and I will give you arrests within the month.' },
        { who: 'Political Adviser', role: 'Office', said: 'A number of likely targets are financial supporters of this government. The scope of any campaign should be settled first.' }
      ],
      options: [
        { label: 'Independent commission with real powers', detail: 'Establish an independent body with full investigative powers. Effective but slow; its targets cannot be chosen.',
          effects: { 'society.corruption': -12, 'quality.admin': +5, 'society.approval': +6, 'economy.businessConfidence': -5 },
          factions: { reformers: +16, intelligentsia: +9, business: -10, provinces: -8, military: -5 },
          risk: { p: 0.3, text: 'Allies indicted', fn: (st) => { st.society.scandal -= 6; st.factions.forEach((f) => { if (f.id === 'provinces' || f.id === 'business') f.loyalty -= 6; }); } },
          then: { id: 'purge_backlash', days: 1100, chance: 0.55 },
          headline: 'Independent Anti-Corruption Commission Established' },
        { label: 'Targeted campaign against rivals', detail: 'Direct enforcement at political opponents only. Limited effect on overall corruption.',
          effects: { 'society.corruption': -3, 'society.approval': +4, 'society.latent': +6, 'policy.interior.surveillance': +8 },
          factions: { reformers: -8, business: -6, nationalists: +5 },
          then: { id: 'purge_backlash', days: 900, chance: 0.8 },
          headline: 'High-Profile Arrests as Anti-Corruption Drive Begins' },
        { label: 'Administrative reform instead', detail: 'Digitise procedures, simplify regulation and raise official salaries.',
          effects: { 'society.corruption': -7, 'quality.admin': +6, 'budget.alloc.admin': +0.3 },
          factions: { reformers: +8, intelligentsia: +5 } },
        { label: 'Do nothing', detail: 'Take no action on the findings.',
          effects: { 'society.corruption': +2, 'society.approval': -3 },
          factions: { reformers: -9, business: +5, provinces: +5 } }
      ]
    },
    {
      id: 'surveillance_bill', cat: 'civic', title: 'The Surveillance Powers Bill',
      from: 'Ministry of the Interior', urgency: 'routine', deadline: 24,
      weight: (st) => (st.society.unrest > 35 || st.wars.length) ? 16 : 7,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>The security services want bulk collection powers, real-time access to communications metadata, and the ability to compel decryption.</p>`,
          `<p>A plot was disrupted in ${f.city} last month. The services have since submitted a bill seeking expanded powers.</p>`,
          `<p>The Intelligence Director has requested compelled-decryption powers, citing cases she states were lost without them. The case files cannot be independently verified.</p>`
        ]);
        return framing + `<p>Surveillance currently sits at ${st.policy.interior.surveillance}/100; civil liberties at ${st.policy.interior.civilLiberties}/100. Collection capability is rated ${S.round(st.intel.strength, 0)}.</p>`;
      },
      advisors: () => [
        { who: 'Intelligence Chief', role: 'Services', said: 'Every plot we have stopped in five years came from communications data. Every one.' },
        { who: 'Attorney General', role: 'Justice', said: 'Powers granted for counter-terrorism have historically been extended to ordinary criminal and tax matters within a decade.' }
      ],
      options: [
        { label: 'Grant the full powers', detail: 'Everything they asked for.',
          effects: { 'policy.interior.surveillance': +25, 'policy.interior.civilLiberties': -12, 'intel.strength': +9, 'society.latent': +8, 'quality.security': +4 },
          factions: { intelligentsia: -12, reformers: -13, military: +5 }, headline: 'Sweeping Surveillance Powers Passed' },
        { label: 'Grant with judicial warrants', detail: 'Grant the powers subject to judicial warrant.',
          effects: { 'policy.interior.surveillance': +12, 'intel.strength': +5, 'society.latent': +2, 'quality.security': +2 },
          factions: { intelligentsia: -3, reformers: -2 } },
        { label: 'Reject the bill', detail: 'Retain the existing powers unchanged.',
          effects: { 'intel.strength': -3, 'policy.interior.civilLiberties': +5, 'society.freedom': +3 },
          factions: { intelligentsia: +10, reformers: +9, military: -5 } }
      ]
    },
    {
      id: 'strike_wave', cat: 'civic', title: 'A General Strike',
      from: 'Ministry of Labour', urgency: 'urgent', deadline: 7,
      weight: (st) => (st.economy.inflation > 8 || S.Soc.factionLoyalty(st, 'labour') < 35) ? 22 : 3,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>The union congress has called an indefinite general strike over the cost of living. Transport, ports and power generation are affected. Inflation stands at ${S.round(st.economy.inflation, 1)}%.</p>`,
          `<p>${f.union} walked out on Monday; by Thursday four other unions had joined. The action has no central leadership with the authority to end it.</p>`,
          `<p>A pay dispute at ${f.firm} has widened into a general strike. ${f.city} is largely shut and the ports have stopped.</p>`
        ]);
        return framing + `<p>Every day costs roughly ${S.money(st.economy.gdp * 0.0016)} in lost output. Real wages have fallen for ${st.rng.int(2, 5)} consecutive quarters.</p>`;
      },
      advisors: () => [
        { who: 'Labour Minister', role: 'Cabinet', said: 'The central demand is a wage indexation formula. It is costly, but it is a specific figure that can be negotiated.' },
        { who: 'Interior Minister', role: 'Security', said: 'I can clear the ports in a day. I cannot make anyone work afterwards.' }
      ],
      options: [
        { label: 'Negotiate an indexation deal', detail: 'Link wages to prices. Ends the strike; entrenches inflation.',
          effects: { 'economy.inflation': +1.6, 'society.approval': +5, 'society.unrest': -10, 'policy.econ.laborProtection': +8 },
          factions: { labour: +16, business: -9 }, headline: 'Wage Indexation Deal Ends General Strike' },
        { label: 'Targeted concessions to key sectors', detail: 'Settle separately with the sectors capable of the greatest economic damage.',
          effects: { 'society.unrest': -5, 'economy.shock': -0.2, 'society.approval': +1 },
          factions: { labour: +5, business: -3, reformers: -3 } },
        { label: 'Declare essential services and compel work', detail: 'Designate essential services and order a return to work under penalty.',
          effects: { 'society.unrest': +8, 'society.latent': +8, 'economy.shock': +0.3, 'policy.econ.laborProtection': -10 },
          factions: { labour: -18, business: +12, military: +2 },
          risk: { p: 0.3, text: 'Strike spreads', fn: (st) => { st.society.unrest += 12; st.economy.shock -= 1.0; } },
          headline: 'Government Orders Strikers Back to Work' },
        { label: 'Break the strike with force', detail: 'End the strike by police action and arrests.',
          requires: (st) => !democratic(st) || st.policy.interior.policing > 60,
          effects: { 'society.unrest': +14, 'society.latent': +18, 'society.approval': -8, 'policy.econ.laborProtection': -18 },
          factions: { labour: -26, business: +14, reformers: -12 },
          headline: 'Police Clear Ports as Strike Is Broken' }
      ]
    },

    /* ------------------------------------------------------------ SOCIAL */
    {
      id: 'education_reform', cat: 'social', title: 'The Education White Paper',
      from: 'Minister of Education', urgency: 'routine', deadline: 28,
      weight: (st) => st.quality.education < 70 ? 14 : 7,
      brief: (st) => `<p>Attainment has been flat for a decade. Education quality is measured at ${S.round(st.quality.education, 0)}/100 against a spend of ${S.round(st.budget.alloc.education, 2)}% of output.</p>
        <p>The white paper offers four routes. None will show measurable results within a single term of office.</p>`,
      advisors: () => [
        { who: 'Education Minister', role: 'Cabinet', said: 'No reform made this year will show in the statistics during this term. The investment case stands regardless.' },
        { who: 'Business Council', role: 'Industry', said: 'We import engineers because we do not produce them. Fix the technical schools.' }
      ],
      options: [
        { label: 'Universal early years and basic schooling', detail: 'Fund early years and basic schooling universally. The highest measured returns; the longest lag.',
          effects: { 'budget.alloc.education': +0.8, 'quality.education': +4, 'society.inequality': -3 },
          factions: { labour: +9, intelligentsia: +7, reformers: +6 }, headline: 'Universal Early Years Programme Announced' },
        { label: 'Technical and vocational expansion', detail: 'Apprenticeships and polytechnics matched to industry.',
          effects: { 'budget.alloc.education': +0.5, 'quality.education': +2, 'economy.shock': +0.4, 'economy.businessConfidence': +5 },
          factions: { business: +10, labour: +6 }, headline: 'Major Expansion of Technical Colleges' },
        { label: 'Elite universities and research', detail: 'Concentrate resources in elite universities and research institutions.',
          effects: { 'budget.alloc.education': +0.4, 'budget.alloc.research': +0.3, 'quality.science': +4, 'society.inequality': +2, 'policy.social.eduUniversity': +15 },
          factions: { intelligentsia: +12, business: +5, labour: -5 } },
        { label: 'Rewrite the national curriculum', detail: 'Rewrite the curriculum around national history and civic tradition.',
          effects: { 'society.cohesion': +7, 'quality.education': -1, 'policy.social.traditionalism': +10, 'national.softPower': -2 },
          factions: { nationalists: +11, clergy: +9, intelligentsia: -12 },
          headline: 'National Curriculum Rewritten Around Patriotic History' }
      ]
    },
    {
      id: 'health_crisis', cat: 'social', title: 'The Hospitals Are Failing',
      from: 'Minister of Health', urgency: 'pressing', deadline: 14,
      weight: (st) => st.quality.health < 55 ? 20 : 6,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>Waiting lists have reached levels that are being reported as a national scandal. Staff are leaving for better-paid work abroad faster than they can be replaced.</p>`,
          `<p>The main hospital in ${f.region} is admitting emergency cases only. The regional health board raised the situation with the ministry repeatedly before it reached the press.</p>`,
          `<p>A child died in a hospital corridor in ${f.city} while waiting for a bed. The case has received national attention; the inquest has not yet reported.</p>`
        ]);
        return framing + `<p>Health quality stands at ${S.round(st.quality.health, 0)}/100 against a health budget of ${S.round(st.budget.alloc.health, 2)}% of output.</p>`;
      },
      advisors: () => [
        { who: 'Health Minister', role: 'Cabinet', said: 'The requirements are funding, staff and time, in that order. There is no faster alternative.' },
        { who: 'Treasury', role: 'Finance', said: 'Health spending is fully absorbed at any level provided. Demand has no natural ceiling.' }
      ],
      options: [
        { label: 'Emergency funding package', detail: 'Provide immediate additional funding without structural change.',
          effects: { 'budget.alloc.health': +1.0, 'quality.health': +4, 'society.approval': +7 },
          factions: { labour: +9, business: -4 }, headline: 'Emergency Funding Package for Hospitals' },
        { label: 'Recruit abroad and raise pay', detail: 'Recruit staff from abroad and raise domestic pay to slow departures.',
          effects: { 'budget.alloc.health': +0.5, 'policy.interior.immigration': +8, 'quality.health': +3, 'society.approval': +3 },
          factions: { labour: +6, nationalists: -6 } },
        { label: 'Open the system to private provision', detail: 'Contract private providers to add capacity. Politically contested.',
          effects: { 'quality.health': +2, 'society.inequality': +3, 'society.approval': -3, 'economy.businessConfidence': +5 },
          factions: { business: +11, labour: -12, reformers: +2 }, headline: 'Health Service Opened to Private Contractors' },
        { label: 'Restructure and ration', detail: 'Set explicit treatment priorities within the existing budget. Unpopular; fiscally sustainable.',
          effects: { 'quality.health': +1, 'society.approval': -6, 'budget.alloc.health': -0.2, 'quality.admin': +2 },
          factions: { labour: -8, business: +5 } }
      ]
    },
    {
      id: 'social_liberalisation', cat: 'social', title: 'A Question of Social Law',
      from: 'Ministry of Justice', urgency: 'routine', deadline: 26,
      weight: (st) => 9,
      brief: (st) => `<p>A coalition of civil society groups has petitioned for reform of the family and personal status laws. A counter-petition, larger, opposes any change.</p>
        <p>Traditional authority holds ${S.round(S.Soc.factionLoyalty(st, 'clergy'), 0)}/100 loyalty; the reform movement ${S.round(S.Soc.factionLoyalty(st, 'reformers'), 0)}/100.</p>`,
      advisors: () => [
        { who: 'Justice Minister', role: 'Cabinet', said: 'Whatever we do, half the country will consider it an attack on their way of life.' },
        { who: 'Political Adviser', role: 'Office', said: 'No available option gains more support than it loses. The main consideration is the long-term record.' }
      ],
      options: [
        { label: 'Liberalise', detail: 'Reform the statutes. Significant opposition is expected.',
          effects: { 'society.freedom': +7, 'national.softPower': +6, 'society.cohesion': -6, 'policy.social.traditionalism': -18, 'policy.interior.civilLiberties': +6 },
          factions: { reformers: +15, intelligentsia: +11, clergy: -18, nationalists: -8 },
          headline: 'Landmark Social Reforms Pass Into Law' },
        { label: 'Codify tradition', detail: 'Write the existing settlement into hard law.',
          effects: { 'society.cohesion': +7, 'society.freedom': -6, 'national.softPower': -6, 'policy.social.traditionalism': +18 },
          factions: { clergy: +16, nationalists: +9, reformers: -15, intelligentsia: -11 },
          headline: 'Traditional Family Law Entrenched in New Statute' },
        { label: 'Refer to a referendum', detail: 'Put the question to a national vote and implement the result.',
          effects: { 'society.approval': -2, 'society.unrest': +4 },
          fn: (st) => {
            const lib = S.Soc.factionLoyalty(st, 'reformers') + st.quality.education - S.Soc.factionLoyalty(st, 'clergy');
            if (lib > 40) { st.policy.social.traditionalism -= 12; st.society.freedom += 4; st.national.softPower += 3; }
            else { st.policy.social.traditionalism += 12; st.society.cohesion += 4; }
          },
          factions: { reformers: +4, clergy: +4, intelligentsia: +3 }, headline: 'Social Question Put to a National Referendum' },
        { label: 'Leave the law alone', detail: 'Make no change to the law.',
          effects: {}, factions: { reformers: -5, clergy: -3 } }
      ]
    },
    {
      id: 'housing_crisis', cat: 'social', title: 'Urban Housing Costs',
      from: 'Ministry of Infrastructure', urgency: 'routine', deadline: 25,
      weight: (st) => st.pop.urban > 55 ? 14 : 6,
      brief: (st, ctx) => {
        const f = D.flavour(st, ctx);
        const framing = D.variant(st, ctx, 'frame', [
          `<p>Housing costs in the three largest cities have outpaced wages for a decade. Young professionals are leaving; essential workers commute two hours each way.</p>`,
          `<p>A tent encampment has formed on the approach road to ${f.city}. A substantial share of its residents are in employment.</p>`,
          `<p>${f.union} has published a survey showing its members now spend more than half their income on rent. The figure has been on the front pages for a week.</p>`
        ]);
        return framing + `<p>Housing costs are the most frequently cited grievance in public opinion research, and no available measure works quickly. Inequality is measured at ${S.round(st.society.inequality, 0)}/100; ${S.round(st.pop.urban, 0)}% of the country is urban.</p>`;
      },
      advisors: () => [
        { who: 'Infrastructure Minister', role: 'Cabinet', said: 'Increased construction is the only measure with a record of lowering costs, and it takes about six years to show results.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'Roughly half of household wealth is held in housing. Measures that lower prices will reduce it.' }
      ],
      options: [
        { label: 'Mass public housebuilding', detail: 'State construction at scale.',
          effects: { 'budget.alloc.infra': +0.8, 'quality.infra': +3, 'society.inequality': -4, 'society.approval': +5, 'economy.shock': +0.5 },
          factions: { labour: +12, provinces: +7, business: -3 }, headline: 'Largest Public Housing Programme in a Generation' },
        { label: 'Deregulate planning', detail: 'Remove planning restrictions and rely on private construction. Local opposition is expected.',
          effects: { 'policy.econ.regulation': -8, 'quality.infra': +2, 'economy.shock': +0.4, 'society.approval': -2 },
          factions: { business: +11, provinces: -6, reformers: +5 } },
        { label: 'Rent controls', detail: 'Cap rents. Immediate relief for tenants; reduces future supply.',
          effects: { 'society.approval': +7, 'economy.businessConfidence': -7, 'quality.infra': -2 },
          factions: { labour: +13, business: -12 }, headline: 'Rent Controls Imposed in Major Cities' },
        { label: 'Move the capital functions out', detail: 'Relocate ministries to secondary cities.',
          effects: { 'budget.alloc.infra': +0.4, 'quality.admin': -3, 'society.approval': +2 },
          factions: { provinces: +14, intelligentsia: -4 }, headline: 'Ministries to Relocate Out of the Capital' }
      ]
    },
    {
      id: 'culture_investment', cat: 'social', title: 'The Soft Power Strategy',
      from: 'Ministry of Culture', urgency: 'routine', deadline: 30,
      weight: () => 9,
      brief: (st) => `<p>The ministry proposes a decade-long programme: international broadcasting, film and music funds, scholarships for foreign students, cultural institutes in thirty capitals.</p>
        <p>Our culture index stands at ${S.round(st.quality.culture, 0)}; soft power at ${S.round(st.national.softPower, 0)}.</p>`,
      advisors: () => [
        { who: 'Culture Minister', role: 'Cabinet', said: 'Cultural presence abroad builds influence that military and economic instruments do not reach.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'The programme has no measurable financial return under any model the Treasury uses.' }
      ],
      options: [
        { label: 'Fund it fully', detail: 'Fund the full ten-year programme.',
          effects: { 'budget.alloc.culture': +0.6, 'quality.culture': +5, 'national.softPower': +8 },
          factions: { intelligentsia: +10, business: -2 }, headline: 'Nation Launches Global Cultural Programme' },
        { label: 'Scholarships and exchange only', detail: 'Fund scholarships and exchanges only. Returns accrue over decades.',
          effects: { 'budget.alloc.culture': +0.2, 'budget.alloc.education': +0.2, 'national.softPower': +4 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { n.affinity += 2; }); },
          factions: { intelligentsia: +7 } },
        { label: 'State broadcasting abroad', detail: 'Fund state international broadcasting only.',
          effects: { 'budget.alloc.culture': +0.3, 'policy.interior.propaganda': +10, 'national.softPower': +3, 'quality.culture': +1 },
          factions: { nationalists: +6, intelligentsia: -4 } },
        { label: 'Decline', detail: 'Reject the programme.', effects: {}, factions: { intelligentsia: -6 } }
      ]
    },

    /* -------------------------------------------------------- INTELLIGENCE */
    {
      id: 'covert_op', cat: 'intel', title: 'A Covert Action Proposal',
      from: 'Director of Intelligence', urgency: 'pressing', deadline: 15,
      weight: (st) => st.intel.strength > 40 ? 13 : 4,
      brief: (st) => {
        const n = st.diplomacy.nations.filter((x) => x.relation < -20).sort((a, b) => a.relation - b.relation)[0] ||
          st.rng.pick(st.diplomacy.nations);
        return `<p>The service proposes an operation against ${n.name}: cultivating opposition networks, degrading a strategic programme, and shaping the information environment ahead of their political season.</p>
          <p>Our collection capability is rated ${S.round(st.intel.strength, 0)}/100. The service assesses deniability as adequate; that assessment cannot be verified in advance.</p>`;
      },
      options: [
        { label: 'Authorise the full operation', detail: 'Authorise all proposed measures.',
          effects: { 'intel.strength': -2, 'world.tension': +5 },
          fn: (st) => {
            const n = st.diplomacy.nations.filter((x) => x.relation < -20)[0] || st.diplomacy.nations[0];
            if (st.rng.chance(0.35 + st.intel.strength / 260)) {
              n.power = Math.max(6, n.power * 0.93); n.relation -= 5;
              st.intel.strength += 5;
              S.News.custom(st, 'Unexplained Crisis Grips ' + n.name, '');
            } else {
              n.relation -= 25; n.grievance = (n.grievance || 0) + 30;
              st.national.prestige -= 8; st.world.tension += 8;
              st.diplomacy.nations.forEach((o) => { o.relation -= 5; });
              S.News.custom(st, 'Our Operatives Exposed in ' + n.name + '; Diplomatic Crisis', 'bad');
            }
          },
          factions: { military: +5, intelligentsia: -6, nationalists: +6 } },
        { label: 'Approve intelligence collection only', detail: 'Authorise collection only, with no active measures.',
          effects: { 'intel.strength': +4, 'budget.alloc.intel': +0.08 }, factions: { military: +2 } },
        { label: 'Refuse and put it in writing', detail: 'Establish a limit and a paper trail.',
          effects: { 'intel.strength': -2, 'national.softPower': +3 },
          factions: { intelligentsia: +7, military: -4, reformers: +5 } }
      ]
    },
    {
      id: 'mole_hunt', cat: 'intel', title: 'There Is a Leak',
      from: 'Counter-Intelligence', urgency: 'urgent', deadline: 10,
      weight: (st) => st.intel.strength < 70 ? 10 : 6,
      brief: () => `<p>Three operations have been compromised in eighteen months. The pattern points to a source inside the service or the ministry. Counter-intelligence wants authority for an internal investigation with no limits.</p>
        <p>Comparable investigations elsewhere have taken years and caused lasting damage to the services conducting them.</p>`,
      advisors: () => [
        { who: 'Counter-Intelligence', role: 'Services', said: 'Someone is reading our traffic. Until the source is found, all current operations must be assumed compromised.' },
        { who: 'Cabinet Secretary', role: 'Administration', said: 'An unrestricted internal investigation damages trust across the institution and tends to widen as it proceeds.' }
      ],
      options: [
        { label: 'Full internal investigation', detail: 'An unrestricted internal investigation with no set end date.',
          effects: { 'intel.strength': -6, 'society.corruption': -2 },
          fn: (st) => { if (st.rng.chance(0.55)) { st.intel.strength += 14; S.game.event('The source was identified and rolled up. Damage assessment continues.', 'good'); } else { st.intel.strength -= 6; st.factions.forEach((f) => { if (f.id === 'military') f.loyalty -= 5; }); S.game.event('The investigation found no source and left lasting damage to trust within the service.', 'bad'); } },
          factions: { military: -4, intelligentsia: -5 } },
        { label: 'Targeted counter-intelligence operation', detail: 'Feed controlled information and watch what moves.',
          effects: { 'intel.strength': +3 },
          fn: (st) => { if (st.rng.chance(0.40 + st.intel.strength / 300)) { st.intel.strength += 10; S.game.event('The controlled material was traced. The source has been identified and is being used to pass false information.', 'good'); } },
          factions: {} },
        { label: 'Restructure and compartmentalise', detail: 'Assume compromise. Rebuild around it.',
          effects: { 'intel.strength': -3, 'quality.admin': +2 },
          fn: (st) => { st.intel.compartmented = true; }, factions: {} }
      ]
    },
    {
      id: 'cyber_attack', cat: 'intel', title: 'Critical Infrastructure Has Been Hit',
      from: 'National Cyber Centre', urgency: 'urgent', deadline: 5,
      weight: (st) => st.world.tension > 30 ? 15 : 6,
      brief: (st) => `<p>The grid operator in two regions lost control of its systems for eleven hours. Water treatment reported anomalies. Attribution points, with moderate confidence, at a state actor.</p>
        <p>Moderate confidence is insufficient grounds for military action.</p>`,
      advisors: () => [
        { who: 'Cyber Director', role: 'Services', said: 'The intrusion was made detectable deliberately. Some response is expected.' },
        { who: 'Foreign Minister', role: 'Diplomacy', said: 'Attribute publicly and you must act. Do not attribute and everyone assumes you cannot.' }
      ],
      options: [
        { label: 'Attribute publicly and sanction', detail: 'Name the state responsible and impose sanctions.',
          effects: { 'world.tension': +7, 'society.approval': +4, 'national.prestige': +3 },
          fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation < -10)[0] || st.diplomacy.nations[0]; n.relation -= 15; n.grievance = (n.grievance || 0) + 12; },
          factions: { nationalists: +8, military: +5 }, headline: 'Government Names State Actor Behind Grid Attack' },
        { label: 'Respond in kind, quietly', detail: 'Conduct an equivalent deniable operation against their infrastructure.',
          effects: { 'world.tension': +4, 'intel.strength': -3 },
          fn: (st) => { if (st.rng.chance(0.3)) { st.world.tension += 8; S.News.custom(st, 'Foreign Grid Failure Sparks Attribution Row', ''); } },
          factions: { military: +6, intelligentsia: -3 } },
        { label: 'Harden and say nothing', detail: 'Fund defensive hardening without public attribution.',
          effects: { 'budget.alloc.intel': +0.15, 'budget.alloc.infra': +0.2, 'quality.energy': +2, 'intel.strength': +3, 'society.approval': -3 },
          factions: { nationalists: -6, business: +4 } }
      ]
    },

    /* ------------------------------------------------------------ ENERGY */
    {
      id: 'energy_transition', cat: 'economy', title: 'The Energy Transition',
      from: 'Ministry of Energy', urgency: 'routine', deadline: 30,
      weight: (st) => 11 + (st.world.climate > 40 ? 6 : 0),
      brief: (st) => `<p>The grid needs twenty years of investment decided in the next two. Climate stress is at ${S.round(st.world.climate, 0)}/100 and rising; our energy quality is ${S.round(st.quality.energy, 0)}/100.</p>
        <p>All options carry a high cost; they differ mainly in when the cost falls.</p>`,
      advisors: () => [
        { who: 'Energy Minister', role: 'Cabinet', said: 'Any new generation takes roughly a decade to come online. The decision should be made on that horizon.' },
        { who: 'Industry', role: 'Business', said: 'Low energy costs and low emissions are competing objectives in the near term. The priority needs to be stated.' }
      ],
      options: [
        { label: 'Full renewable and grid build-out', detail: 'High capital cost now; low operating cost and emissions later.',
          effects: { 'budget.alloc.energy': +0.7, 'policy.energy.transition': +30, 'quality.energy': +4, 'economy.shock': -0.3, 'national.softPower': +4 },
          factions: { intelligentsia: +9, reformers: +8, business: -5 }, headline: 'Nation Commits to Full Grid Decarbonisation' },
        { label: 'Nuclear programme', detail: 'Reliable baseload with long build times and significant political opposition.',
          effects: { 'budget.alloc.energy': +0.6, 'quality.energy': +5, 'quality.science': +2, 'policy.energy.transition': +15, 'society.unrest': +3 },
          factions: { business: +6, intelligentsia: +4, provinces: -5 }, headline: 'Government Approves New Nuclear Fleet' },
        { label: 'Exploit domestic fossil reserves', detail: 'Lowest near-term cost; raises emissions and long-term climate exposure.',
          effects: { 'economy.shock': +0.7, 'quality.energy': +3, 'policy.energy.transition': -20, 'national.softPower': -5 },
          fn: (st) => { st.economy.sectors.resources += 2; st.world.climate += 2; },
          factions: { business: +10, labour: +6, intelligentsia: -10 }, headline: 'New Fossil Extraction Licences Issued' },
        { label: 'Do the minimum', detail: 'Maintain the existing grid and defer the investment decision.',
          effects: { 'quality.energy': -1 }, factions: { reformers: -5 } }
      ]
    },

    /* ------------------------------------------------------------ CRISIS */
    {
      id: 'natural_disaster', cat: 'crisis', title: 'Catastrophe in the Provinces',
      from: 'Emergency Committee', urgency: 'urgent', deadline: 3,
      // A disaster of this scale is a generational event, and the model
      // refuses to let one arrive while the last is still being buried.
      weight: (st) => (S.Aftermath.canCatastrophe(st) ? 6 + st.world.climate * 0.10 : 0),
      brief: (st, ctx) => {
        D.ensureDisaster(st, ctx);
        return `<p>A ${ctx.kind} has struck ${ctx.region}. The confirmed dead stand at <b>${S.num(ctx.deaths)}</b> and the figure is rising. Roughly <b>${S.num(ctx.displaced)}</b> people have lost their homes.</p>
          <p>This is the most severe disaster in a generation. Search-and-rescue outcomes depend heavily on the first seventy-two hours; the scale of the response must be decided now.</p>`;
      },
      advisors: () => [
        { who: 'Emergency Committee', role: 'Cabinet Office', said: 'Delay in the first three days raises the death toll at a measurable rate. Speed is the controlling factor.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'Whatever we spend now we will spend again on reconstruction, for years. Budget for both.' }
      ],
      options: [
        {
          label: 'Full national mobilisation', detail: 'Commit the armed forces and emergency funds at maximum scale, immediately.',
          effects: { 'society.approval': +9, 'military.readiness': -6 },
          fn: (st, ctx) => {
            D.ensureDisaster(st, ctx);
            st.economy.reserves -= st.economy.gdp * 0.020;
            ctx.deaths = Math.round(ctx.deaths * 0.72);
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'disaster_' + ctx.kind, name: D.disasterName(ctx),
              desc: S.num(ctx.deaths) + ' dead, ' + S.num(ctx.displaced) + ' displaced. Reconstruction under way.',
              severity: 62, years: 5, deaths: ctx.deaths,
              growth: -0.7, approval: -1, unrest: +2,
              qualityDrag: { infra: -14, health: -6 }
            });
            S.Aftermath.schedule(st, 'disaster_reconstruction', ctx, 70);
            S.Aftermath.schedule(st, 'disaster_inquiry', ctx, 420);
          },
          factions: { military: +4, provinces: +14, labour: +6 },
          headline: 'Army Deployed as Nation Mobilises for Disaster Relief'
        },
        {
          label: 'Standard emergency response', detail: 'Execute the existing emergency plan at its funded level.',
          effects: { 'society.approval': +1 },
          fn: (st, ctx) => {
            D.ensureDisaster(st, ctx);
            st.economy.reserves -= st.economy.gdp * 0.008;
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'disaster_' + ctx.kind, name: D.disasterName(ctx),
              desc: S.num(ctx.deaths) + ' dead, ' + S.num(ctx.displaced) + ' displaced.',
              severity: 78, years: 6, deaths: ctx.deaths,
              growth: -1.0, approval: -2, unrest: +4,
              qualityDrag: { infra: -20, health: -9 }
            });
            S.Aftermath.schedule(st, 'disaster_reconstruction', ctx, 70);
            S.Aftermath.schedule(st, 'disaster_inquiry', ctx, 420);
          },
          factions: { provinces: +3 }
        },
        {
          label: 'Appeal for international assistance', detail: 'Request foreign assistance. Adds capacity; carries a prestige cost.',
          effects: { 'national.prestige': -5 },
          fn: (st, ctx) => {
            D.ensureDisaster(st, ctx);
            st.economy.reserves += st.economy.gdp * 0.010;
            ctx.deaths = Math.round(ctx.deaths * 0.80);
            st.diplomacy.nations.forEach((n) => { if (n.relation > 10) { n.relation += 6; n.affinity += 3; } });
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'disaster_' + ctx.kind, name: D.disasterName(ctx),
              desc: S.num(ctx.deaths) + ' dead. Recovery is being run partly by foreign agencies.',
              severity: 66, years: 5, deaths: ctx.deaths,
              growth: -0.7, approval: -1, unrest: +3,
              qualityDrag: { infra: -15, health: -5 }
            });
            S.Aftermath.schedule(st, 'disaster_reconstruction', ctx, 70);
            S.Aftermath.schedule(st, 'disaster_inquiry', ctx, 420);
          },
          factions: { nationalists: -8, provinces: +6 },
          headline: 'Government Appeals for International Disaster Aid'
        },
        {
          label: 'Downplay the scale', detail: 'Understate the casualty figures and restrict coverage.',
          effects: { 'society.approval': -6, 'society.latent': +10, 'policy.interior.pressFreedom': -4 },
          fn: (st, ctx) => {
            D.ensureDisaster(st, ctx);
            ctx.deaths = Math.round(ctx.deaths * 1.45);
            ctx.coverUp = true;
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'disaster_' + ctx.kind, name: D.disasterName(ctx),
              desc: 'The official toll was never believed. ' + S.num(ctx.deaths) + ' are thought to have died.',
              severity: 92, years: 8, deaths: ctx.deaths,
              growth: -1.3, approval: -4, unrest: +7,
              qualityDrag: { infra: -24, health: -12 }
            });
            S.Aftermath.schedule(st, 'disaster_inquiry', ctx, 300);
          },
          factions: { provinces: -16, reformers: -8 },
          risk: {
            p: 0.6, text: 'The real toll emerges',
            fn: (st) => {
              st.society.approval -= 12; st.society.unrest += 10; st.society.latent += 10;
              S.News.custom(st, 'True Death Toll Revealed; Government Accused of Cover-Up', 'bad');
            }
          }
        }
      ]
    },
    {
      id: 'disaster_reconstruction', cat: 'crisis', dynamic: true, title: 'The Reconstruction Bill',
      from: 'Ministry of Infrastructure', urgency: 'pressing', deadline: 20,
      brief: (st, ctx) => `<p>The emergency phase is over. ${S.num(ctx.displaced || 0)} people remain in temporary accommodation. The ministry has costed reconstruction at two standards: replacement and improved resilience.</p>
        <p>The damage will continue to reduce output until it is repaired. The choice of programme determines for how long.</p>`,
      advisors: () => [
        { who: 'Infrastructure Minister', role: 'Cabinet', said: 'Rebuild to the old standard and we do this again in fifteen years. Rebuild properly and we do not.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'The higher-standard programme costs a full point of output a year for five years. That should be stated before the decision.' }
      ],
      options: [
        {
          label: 'Rebuild better, and to a higher standard', detail: 'A five-year reconstruction programme with resilience built in.',
          effects: { 'society.approval': +4 },
          fn: (st) => {
            S.Actions.startProgramme(st, {
              key: 'nationalinfra', name: 'Reconstruction Programme', dept: 'infra', years: 5, costPct: 0.95,
              desc: 'Rebuilding the affected regions to a higher standard.',
              perYear: { 'quality.infra': 1.6 }, headline: 'Five-Year Reconstruction Programme Approved'
            });
            const scar = (st.scars || [])[0];
            if (scar) { scar.years = Math.max(2, scar.years - 2); scar.severity *= 0.85; }
          },
          factions: { provinces: +12, labour: +8, business: -3 }
        },
        {
          label: 'Restore what was there, no more', detail: 'Rebuild to the previous standard. Cheaper and faster; the vulnerability remains.',
          effects: { 'society.approval': +1 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.012; st.quality.infra += 3; st.flags.rebuiltCheap = true; },
          factions: { business: +4, provinces: +3 }
        },
        {
          label: 'Cash compensation and let people relocate', detail: 'Pay compensation directly and accept permanent outward migration from the region.',
          effects: { 'society.approval': -2 },
          fn: (st, ctx) => {
            st.economy.reserves -= st.economy.gdp * 0.008;
            st.society.inequality -= 1;
            const scar = (st.scars || []).find((s) => s.deaths);
            if (scar) { scar.desc += ' The region has lost a third of its population permanently.'; scar.years += 2; }
          },
          factions: { provinces: -14, business: +6 }
        },
        {
          label: 'The regions must fund their own recovery', detail: 'Assign reconstruction costs to the regional governments.',
          effects: { 'society.approval': -6, 'society.unrest': +6 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.deaths);
            if (scar) { scar.years += 4; scar.severity = Math.min(120, scar.severity + 12); }
          },
          factions: { provinces: -22, business: +8 },
          headline: 'Provinces Told to Fund Their Own Reconstruction'
        }
      ]
    },
    {
      id: 'disaster_inquiry', cat: 'civic', dynamic: true, title: 'The Inquiry Reports',
      from: 'Office of the Attorney General', urgency: 'routine', deadline: 25,
      brief: (st, ctx) => `<p>The inquiry into the disaster has reported. It finds that warnings existed, that they were not acted on, and that the failures were institutional rather than individual. No individual is recommended for prosecution.</p>
        <p>${ctx.coverUp ? 'It also finds that the official death toll was knowingly understated.' : 'The bereaved families have asked to be in the room when you respond.'}</p>`,
      advisors: () => [
        { who: 'Attorney General', role: 'Justice', said: 'Accept the findings in full or reject them in full. A partial acceptance will satisfy neither the families nor the institutions.' },
        { who: 'Political Adviser', role: 'Office', said: 'The duration of press coverage now depends on the response.' }
      ],
      options: [
        {
          label: 'Accept every finding and apologise', detail: 'A formal apology, compensation, and the reforms in full.',
          effects: { 'society.approval': +5, 'quality.admin': +4, 'national.softPower': +4 },
          fn: (st) => {
            st.economy.reserves -= st.economy.gdp * 0.006;
            const scar = (st.scars || []).find((s) => s.deaths);
            if (scar) { scar.severity *= 0.82; scar.unrest = Math.max(0, scar.unrest - 3); scar.desc += ' The state has accepted responsibility.'; }
          },
          factions: { reformers: +12, provinces: +10, intelligentsia: +8 },
          headline: 'Leader Apologises in Full for Disaster Failures'
        },
        {
          label: 'Accept the findings, resist the compensation', detail: 'Accept the findings while contesting the compensation claims.',
          effects: { 'society.approval': -1, 'quality.admin': +2 },
          factions: { reformers: +3, provinces: -4, business: +3 }
        },
        {
          label: 'Reject the report', detail: 'Dispute the methodology and take no further action.',
          effects: { 'society.approval': -7, 'society.latent': +10, 'quality.admin': -2 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.deaths);
            if (scar) { scar.severity = Math.min(120, scar.severity + 10); scar.years += 2; scar.unrest += 3; }
          },
          factions: { reformers: -14, provinces: -12, intelligentsia: -10 },
          then: { id: 'inquiry_vindicated', days: 1300, chance: 0.7 },
          headline: 'Government Rejects Inquiry Findings; Families Walk Out'
        },
        {
          label: 'Prosecute the officials named', detail: 'Bring charges against the officials named in the report.',
          effects: { 'society.approval': +6, 'quality.admin': -3, 'society.corruption': -2 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.deaths);
            if (scar) scar.severity *= 0.9;
          },
          factions: { reformers: +8, provinces: +6, business: -5 },
          risk: { p: 0.3, text: 'The prosecutions collapse in court', fn: (st) => { st.society.approval -= 5; st.quality.admin -= 2; } },
          headline: 'Senior Officials Charged Over Disaster Response'
        }
      ]
    },
    {
      id: 'pandemic', cat: 'crisis', title: 'A Novel Pathogen',
      from: 'Chief Medical Officer', urgency: 'urgent', deadline: 6,
      weight: (st) => (st.flags.pandemicDone || !S.Aftermath.canCatastrophe(st)) ? 0 : 3,
      brief: (st, ctx) => {
        D.ensurePandemic(st, ctx);
        return `<p>A respiratory pathogen with a high secondary attack rate has been confirmed in three cities. The modelling puts unmitigated deaths at around <b>${S.num(ctx.base)}</b>, with a wide band around it.</p>
          <p>${st.flags.pandemicPrepared ? 'The stockpile and surge plans you funded are being activated now, and the modelling already reflects them.' : 'There is no stockpile and no surge plan. The health system has limited capacity and the economy has none.'}</p>`;
      },
      advisors: () => [
        { who: 'Chief Medical Officer', role: 'Health', said: 'Early action will be criticised as excessive if it succeeds, because the avoided deaths will not be visible. It remains the correct course.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'A full closure costs roughly a tenth of annual output. That figure should be on the record before the decision.' }
      ],
      options: [
        {
          label: 'Immediate national closure', detail: 'Everything stops. Support payments for everyone.',
          effects: { 'economy.shock': -3.2, 'quality.health': +2, 'society.approval': +3, 'budget.alloc.welfare': +1.2, 'society.unrest': +6 },
          fn: (st, ctx) => {
            D.ensurePandemic(st, ctx);
            st.flags.pandemicDone = true;
            const deaths = Math.round(ctx.base * 0.28);
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'pandemic', name: 'The Pandemic',
              desc: S.num(deaths) + ' dead. The closure reduced the toll at a severe fiscal cost.',
              severity: 70, years: 6, deaths: deaths,
              growth: -0.9, approval: -2, unrest: +3, qualityDrag: { health: -8, education: -10 }
            });
            S.Aftermath.schedule(st, 'pandemic_aftermath', { deaths: deaths, closure: true }, 500);
          },
          factions: { labour: +6, business: -14, reformers: -3 },
          headline: 'National Closure Ordered as Pathogen Spreads'
        },
        {
          label: 'Targeted measures and surge capacity', detail: 'Restrict high-risk settings and expand hospital capacity while keeping the economy open.',
          effects: { 'economy.shock': -1.2, 'budget.alloc.health': +0.6 },
          fn: (st, ctx) => {
            D.ensurePandemic(st, ctx);
            st.flags.pandemicDone = true;
            const deaths = Math.round(ctx.base * 0.58);
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'pandemic', name: 'The Pandemic',
              desc: S.num(deaths) + ' dead. The targeted measures remain publicly contested.',
              severity: 62, years: 5, deaths: deaths,
              growth: -0.6, approval: -1, unrest: +3, qualityDrag: { health: -10, education: -5 }
            });
            S.Aftermath.schedule(st, 'pandemic_aftermath', { deaths: deaths }, 500);
          },
          factions: { business: -4, labour: -2 }
        },
        {
          label: 'Keep the country open', detail: 'Accept the mortality. Protect output.',
          effects: { 'economy.shock': -0.5, 'quality.health': -5, 'society.approval': -7, 'society.unrest': +8 },
          fn: (st, ctx) => {
            D.ensurePandemic(st, ctx);
            st.flags.pandemicDone = true;
            const deaths = ctx.base;
            S.Aftermath.markCatastrophe(st);
            S.Aftermath.addScar(st, {
              kind: 'pandemic', name: 'The Pandemic',
              desc: S.num(deaths) + ' dead. The country was not closed; the decision remains publicly contested.',
              severity: 95, years: 9, deaths: deaths,
              growth: -0.5, approval: -4, unrest: +6, qualityDrag: { health: -18 }
            });
            S.Aftermath.schedule(st, 'pandemic_aftermath', { deaths: deaths, open: true }, 500);
          },
          factions: { business: +11, labour: -12, clergy: -5 },
          headline: 'Government Rejects Closure; Hospitals Brace'
        }
      ]
    },
    {
      id: 'pandemic_aftermath', cat: 'social', dynamic: true, title: 'After the Pandemic',
      from: 'Chief Medical Officer', urgency: 'routine', deadline: 25,
      brief: (st, ctx) => `<p>The emergency is over. <b>${S.num(ctx.deaths || 0)}</b> people are dead, the health service is exhausted, and a cohort of children has lost the better part of two years of schooling.</p>
        <p>None of this recovers without intervention. A decision is required on the scale of the response.</p>`,
      advisors: () => [
        { who: 'Chief Medical Officer', role: 'Health', said: 'My staff are leaving. If you do one thing, make it retention.' },
        { who: 'Education Minister', role: 'Cabinet', said: 'The learning loss is measurable and it will follow that cohort into the labour market for forty years.' }
      ],
      options: [
        {
          label: 'Fund recovery across health and schools', detail: 'Catch-up teaching, staff retention, mental health provision.',
          effects: { 'budget.alloc.health': +0.5, 'budget.alloc.education': +0.5, 'society.approval': +4 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.kind === 'pandemic');
            if (scar) { scar.years = Math.max(2, scar.years - 3); scar.qualityDrag = { health: -4 }; }
          },
          factions: { labour: +8, intelligentsia: +8 },
          headline: 'Major Recovery Package for Health and Schools'
        },
        {
          label: 'Build the preparedness we did not have', detail: 'Establish a permanent agency, a stockpile and a response plan for future outbreaks.',
          effects: { 'budget.alloc.health': +0.3, 'society.approval': +1 },
          fn: (st) => { st.flags.pandemicPrepared = true; st.flags.pandemicDone = false; st.quality.health += 3; },
          factions: { intelligentsia: +7, business: -2 }
        },
        {
          label: 'Hold a public inquiry', detail: 'Establish what happened while the witnesses still remember.',
          effects: { 'quality.admin': +4, 'society.approval': -2 },
          fn: (st) => {
            if (st.rng.chance(0.5)) { st.society.scandal -= 7; S.News.custom(st, 'Inquiry Finds Government Delayed Fatally', 'bad'); }
            else { st.society.approval += 4; S.News.custom(st, 'Inquiry Broadly Clears the Government\'s Handling', 'good'); }
          },
          factions: { reformers: +9, intelligentsia: +7 }
        },
        {
          label: 'Declare it over and move on', detail: 'Close the emergency programmes and make no further provision.',
          effects: { 'society.approval': +2, 'society.latent': +6 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.kind === 'pandemic');
            if (scar) { scar.years += 3; scar.approval -= 1; }
          },
          factions: { intelligentsia: -8, labour: -6 }
        }
      ]
    },
    {
      id: 'assassination_attempt', cat: 'crisis', title: 'An Attempt on Your Life',
      from: 'Protective Detail', urgency: 'urgent', deadline: 3,
      weight: (st) => (st.society.unrest > 50 || st.society.latent > 55) ? 8 : 1,
      brief: () => `<p>A device detonated forty metres from your motorcade. Two of the detail are dead. You are unhurt.</p>
        <p>No group has claimed responsibility. The services have three working theories and no confirmed evidence. The public response chosen now will shape the security climate for the coming year.</p>`,
      options: [
        { label: 'Address the nation calmly', detail: 'A public address emphasising continuity and restraint.',
          effects: { 'society.approval': +8, 'society.cohesion': +5, 'national.prestige': +3 },
          factions: { reformers: +6, intelligentsia: +5 }, headline: 'Leader Addresses Nation Hours After Attack' },
        { label: 'Declare a state of emergency', detail: 'Assume emergency powers and impose curfews.',
          effects: { 'policy.interior.surveillance': +18, 'policy.interior.civilLiberties': -14, 'society.unrest': -8, 'society.latent': +10, 'society.approval': +4 },
          factions: { military: +7, nationalists: +9, reformers: -12, intelligentsia: -11 },
          headline: 'State of Emergency Declared After Assassination Attempt' },
        { label: 'Mass arrests of the opposition', detail: 'Attribute the attack to the opposition and detain its members.',
          requires: (st) => authoritarian(st),
          effects: { 'policy.interior.civilLiberties': -22, 'society.latent': +20, 'society.unrest': +6, 'national.softPower': -12, 'society.approval': +2 },
          factions: { reformers: -24, intelligentsia: -20, military: +6 },
          risk: { p: 0.3, text: 'Backlash', fn: (st) => { st.society.unrest += 14; st.society.stability -= 8; } },
          headline: 'Thousands Detained in Nationwide Sweep' },
        { label: 'Quiet, thorough investigation', detail: 'Conduct the investigation without public measures.',
          effects: { 'intel.strength': +5, 'society.approval': +2, 'budget.alloc.intel': +0.1 },
          factions: { intelligentsia: +4 } }
      ]
    },

    /* --------------------------------------------------- DYNAMIC / EVENT */
    {
      id: 'war_memorial', cat: 'social', dynamic: true, title: 'What to Do About the Dead',
      from: 'Office of the Leader', urgency: 'routine', deadline: 30,
      brief: (st, ctx) => `<p>${S.num(ctx.dead || 0)} of our people died in ${ctx.war}. The veterans' associations, the bereaved families and the General Staff all want different things, and all three have written to you.</p>
        <p>The form of commemoration chosen will affect how long the war remains a live political grievance.</p>`,
      advisors: () => [
        { who: 'Chief of Staff', role: 'Defence', said: 'The forces need public acknowledgement that the losses are valued. Morale depends on it.' },
        { who: 'Political Adviser', role: 'Office', said: 'A memorial is a one-off cost. A settlement for the wounded is a recurring cost for a generation. Both can be funded.' }
      ],
      options: [
        {
          label: 'A national memorial and a full veterans\' settlement', detail: 'Fund both the memorial and the full settlement.',
          effects: { 'society.cohesion': +7, 'society.approval': +5, 'military.morale': +9 },
          fn: (st) => {
            st.economy.reserves -= st.economy.gdp * 0.010;
            st.policy.mil.veteranCare = S.clamp(st.policy.mil.veteranCare + 18, 0, 100);
            const scar = (st.scars || []).find((s) => s.tag === 'war');
            if (scar) { scar.severity *= 0.85; scar.unrest = Math.max(0, scar.unrest - 3); }
          },
          factions: { military: +14, nationalists: +10, labour: +5 },
          headline: 'National Memorial Unveiled; Veterans\' Settlement Passes'
        },
        {
          label: 'A memorial only', detail: 'Fund the memorial; defer the pension settlement on cost grounds.',
          effects: { 'society.cohesion': +4, 'military.morale': +2 },
          factions: { nationalists: +7, military: -3 }
        },
        {
          label: 'A public reckoning instead', detail: 'Commission a public account of the decisions that led to the war.',
          effects: { 'quality.admin': +4, 'national.softPower': +5, 'society.approval': -3 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.tag === 'war');
            if (scar) { scar.years = Math.max(2, scar.years - 2); scar.unrest = Math.max(0, scar.unrest - 4); }
            st.national.aggressionScore = Math.max(0, st.national.aggressionScore - 15);
          },
          factions: { intelligentsia: +12, reformers: +10, military: -12, nationalists: -12 },
          headline: 'Government Orders Full Public Reckoning on the War'
        },
        {
          label: 'Move on quietly', detail: 'Hold no ceremony, open no inquiry and allocate no funds.',
          effects: { 'society.approval': -4, 'military.morale': -8, 'society.latent': +6 },
          fn: (st) => {
            const scar = (st.scars || []).find((s) => s.tag === 'war');
            if (scar) { scar.years += 3; scar.unrest += 3; }
          },
          factions: { military: -16, nationalists: -14 }
        }
      ]
    },
    {
      id: 'election_approaching', cat: 'civic', dynamic: true, title: 'The Election Is Next Year',
      from: 'Chief of Staff, Office of the Leader', urgency: 'pressing', deadline: 40,
      brief: (st) => `<p>The country votes in twelve months. Approval stands at <b>${S.round(st.society.approval, 0)}%</b>; inflation at ${S.round(st.economy.inflation, 1)}% and unemployment at ${S.round(st.economy.unemployment, 1)}%.</p>
        <p>On present numbers the projected vote share is around <b>${S.round(S.clamp(50 + (st.society.approval - 47) * 0.8 + 5, 2, 98), 0)}%</b>. Anything below fifty and you leave office.</p>`,
      advisors: (st) => [
        { who: 'Campaign Director', role: 'Party', said: st.society.approval < 45 ? 'We are behind. Something has to change and it has to be visible before the summer.' : 'We are ahead. The priority is avoiding unforced errors.' },
        { who: 'Finance Minister', role: 'Treasury', said: 'Each measure the campaign requests carries a fiscal cost that will fall due after the election.' }
      ],
      options: [
        { label: 'Pre-election giveaway', detail: 'Tax cuts and transfer payments timed before the vote.',
          effects: { 'society.approval': +8, 'economy.shock': +0.6, 'economy.inflation': +0.9, 'policy.tax.income': -3, 'budget.alloc.welfare': +0.8 },
          factions: { labour: +8, business: -4, reformers: -4 }, headline: 'Government Announces Pre-Election Package' },
        { label: 'Run on the record', detail: 'Campaign on the government record without new commitments.',
          effects: { 'society.approval': +2, 'national.prestige': +2 },
          factions: { reformers: +5, intelligentsia: +4 } },
        { label: 'Rally the base on identity', detail: 'Centre the campaign on identity, immigration and national tradition.',
          effects: { 'society.approval': +5, 'society.cohesion': +4, 'society.unrest': +4, 'policy.interior.propaganda': +10, 'policy.interior.immigration': -8 },
          factions: { nationalists: +12, clergy: +6, intelligentsia: -9, reformers: -8 },
          headline: 'Campaign Turns to Identity and Borders' },
        { label: 'Shape the electoral process', detail: 'Redraw boundaries, pressure broadcasters and delay selected voter registrations.',
          requires: (st) => S.gov(st).mods.legitimacyFrom !== 'approval',
          effects: { 'society.latent': +12, 'policy.interior.pressFreedom': -10, 'society.approval': +6, 'national.softPower': -6 },
          factions: { reformers: -14, intelligentsia: -12 },
          risk: { p: 0.3, text: 'The manipulation is exposed', fn: (st) => { st.society.approval -= 9; st.society.unrest += 10; } },
          headline: 'Opposition Alleges Electoral Manipulation' }
      ]
    },
    {
      id: 'peace_feeler', cat: 'military', dynamic: true, title: 'A Channel Has Opened',
      from: 'Foreign Ministry', urgency: 'pressing', deadline: 10,
      brief: (st, ctx) => {
        const w = st.wars.find((x) => x.id === ctx.war);
        const n = w && w.enemyId ? S.dip(st, w.enemyId) : null;
        if (!w) return '<p>The moment has passed.</p>';
        return `<p>A third party has passed a message. ${n ? n.name : 'The enemy'} would receive a delegation.</p>
          <p>War score stands at ${S.round(w.score, 0)} in ${w.score > 0 ? 'our' : 'their'} favour. Home support for the war is ${S.round(w.homeSupport, 0)}%. Our forces have taken roughly ${S.headcount(w.casualties / 1e6)} casualties.</p>`;
      },
      advisors: (st, ctx) => {
        const w = st.wars.find((x) => x.id === ctx.war);
        return [
          { who: 'Chief of Staff', role: 'Defence', said: w && w.score > 20 ? 'Another two months and I can take what we are being offered at the table.' : 'The force cannot sustain this indefinitely. Talk while we still have cards.' },
          { who: 'Foreign Minister', role: 'Diplomacy', said: 'Talks do not commit us to an outcome. Refusing them commits us to the war.' }
        ];
      },
      options: [
        { label: 'Open negotiations', detail: 'Send a delegation and open talks.',
          effects: {}, opensNegotiation: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); return w ? { kind: 'peace', nation: w.enemyId, ctx: { war: w.id } } : null; } },
        { label: 'Refuse and escalate', detail: 'Answer with an offensive instead.',
          effects: { 'world.tension': +5 },
          fn: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); if (w) { w.posture = 'full'; w.intensity = Math.min(100, w.intensity + 15); w.peaceOffered = false; } },
          factions: { nationalists: +8, military: +4, labour: -6 } },
        { label: 'Explore quietly without committing', detail: 'Back channel only. No delegation, no publicity.',
          effects: {},
          fn: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); if (w) w.peaceOffered = false; },
          factions: { intelligentsia: +3 } }
      ]
    },
    {
      id: 'capitulation', cat: 'military', dynamic: true, title: 'The Front Is Collapsing',
      from: 'Chief of the General Staff', urgency: 'urgent', deadline: 5,
      brief: (st, ctx) => {
        const w = st.wars.find((x) => x.id === ctx.war);
        if (!w) return '<p>The situation has moved on.</p>';
        const n = w.enemyId ? S.dip(st, w.enemyId) : null;
        return `<p>The line has broken in three places. Formations are combat-ineffective and the reserve is committed. War score stands at <b>${S.round(w.score, 0)}</b>.</p>
          <p>The Chief of Staff has advised that <i>capitulation</i> must now be considered. ${n ? n.name + ' will take a surrender.' : 'The rebels will take a surrender.'} If we fight on and lose, the terms will be worse and will be dictated in our capital.</p>`;
      },
      advisors: (st, ctx) => {
        const w = st.wars.find((x) => x.id === ctx.war) || {};
        return [
          { who: 'Chief of Staff', role: 'Defence', said: 'Resistance can be extended by roughly three months. The outcome will not change.' },
          { who: 'Foreign Minister', role: 'Diplomacy', said: 'Terms agreed now will be negotiated. Terms after a full collapse will be dictated, and may include occupation.' },
          { who: 'Nationalist Caucus', role: 'Legislature', said: 'Surrender is unacceptable. The war must be continued.' }
        ];
      },
      options: [
        { label: 'Negotiate terms of surrender', detail: 'Open surrender negotiations while some leverage remains.',
          effects: { 'national.prestige': -8, 'society.approval': -4 },
          opensNegotiation: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); return w && w.enemyId ? { kind: 'peace', nation: w.enemyId, ctx: { war: w.id } } : null; },
          fn: (st, ctx) => {
            const w = st.wars.find((x) => x.id === ctx.war);
            if (!w || w.enemyId) return;
            // You cannot negotiate a surrender to your own rebels and remain.
            if (w.type === 'civil') S.game.lose('civilwar');
            else S.Mil.endWar(st, w, 'defeat');
          },
          factions: { nationalists: -14, military: -4, labour: +6 } },
        { label: 'Withdraw to the final defensive line', detail: 'Fall back to the final defensive line to slow the advance.',
          effects: { 'military.morale': -6, 'society.unrest': +6 },
          fn: (st, ctx) => {
            const w = st.wars.find((x) => x.id === ctx.war);
            if (w) { w.posture = 'defend'; w.intensity = Math.max(25, w.intensity - 20); w.score = Math.min(-40, w.score + 12); }
          },
          factions: { military: +4, nationalists: +6 } },
        { label: 'Total mobilisation', detail: 'Conscript the full remaining population of military age. A low-probability measure.',
          effects: { 'policy.mil.conscription': +40, 'society.unrest': +14, 'economy.shock': -2.0, 'military.morale': +6 },
          fn: (st, ctx) => {
            const w = st.wars.find((x) => x.id === ctx.war);
            if (w) { w.intensity = 100; w.score += st.rng.chance(0.35 + st.society.cohesion / 300) ? 22 : -6; }
          },
          factions: { nationalists: +16, military: +8, labour: -12, business: -10 },
          headline: 'Total Mobilisation Ordered as the Front Gives Way' }
      ]
    },
    {
      id: 'war_unpopular', cat: 'military', dynamic: true, title: 'The Country Has Stopped Supporting the War',
      from: 'Office of the Leader', urgency: 'urgent', deadline: 8,
      brief: (st, ctx) => {
        const w = st.wars.find((x) => x.id === ctx.war);
        if (!w) return '<p>The situation has changed.</p>';
        return `<p>Support for ${w.name} has fallen to ${S.round(w.homeSupport, 0)}%. There were three hundred thousand people in the capital on Saturday. The casualty lists are being read aloud on the steps of the legislature.</p>`;
      },
      options: [
        { label: 'Seek terms immediately', detail: 'End it, on whatever terms are available.',
          effects: { 'society.approval': +4, 'national.prestige': -5 },
          opensNegotiation: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); return w ? { kind: 'peace', nation: w.enemyId, ctx: { war: w.id } } : null; },
          factions: { nationalists: -10, military: -6, labour: +9 } },
        { label: 'Reduce intensity and hold', detail: 'Reduce operations and casualties without ending the war.',
          effects: { 'society.approval': +2 },
          fn: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); if (w) { w.posture = 'defend'; w.intensity = Math.max(20, w.intensity - 20); } },
          factions: { military: -3, labour: +4 } },
        { label: 'Suppress the protests and continue', detail: 'Disperse the protests and continue the war.',
          effects: { 'society.unrest': +12, 'society.latent': +14, 'policy.interior.policing': +10, 'society.approval': -6 },
          fn: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); if (w) w.homeSupport += 6; },
          factions: { nationalists: +9, military: +6, labour: -14, reformers: -12 },
          headline: 'Anti-War Demonstrations Broken Up by Police' },
        { label: 'Rally the nation', detail: 'A national address restating the case for the war.',
          effects: { 'policy.interior.propaganda': +8, 'society.cohesion': +4 },
          fn: (st, ctx) => { const w = st.wars.find((x) => x.id === ctx.war); if (w) w.homeSupport += 10 * (st.society.approval / 55); },
          factions: { nationalists: +5 } }
      ]
    },
    {
      id: 'nuclear_threat_incoming', cat: 'military', dynamic: true, title: 'Nuclear Signalling',
      from: 'Strategic Directorate', urgency: 'urgent', deadline: 2,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        return `<p>${n ? n.name : 'The enemy'} has dispersed mobile launchers and raised alert levels. Their state media is discussing the doctrine of last resort in language that has not been used in decades.</p>
          <p>Our own arsenal is rated ${S.round(st.military.nuclear, 0)}/100. Our posture is ${S.Mil.NUCLEAR_POSTURES[st.policy.mil.nuclearPosture].name}.</p>`;
      },
      options: [
        { label: 'Halt offensive operations', detail: 'Suspend offensive operations to reduce escalation risk.',
          effects: { 'world.tension': -6, 'national.prestige': -4, 'society.approval': -3 },
          fn: (st, ctx) => { st.wars.forEach((w) => { if (w.enemyId === ctx.nation) { w.posture = 'defend'; w.intensity = Math.max(20, w.intensity - 25); } }); },
          factions: { nationalists: -9, military: -4, intelligentsia: +8 } },
        { label: 'Raise our own alert level', detail: 'Match their alert level and make the deterrent visible.',
          effects: { 'world.tension': +12, 'military.readiness': +3, 'society.unrest': +6 },
          factions: { military: +7, nationalists: +9 },
          risk: { p: 0.10, text: 'Miscalculation', fn: (st, ctx) => { const w = st.wars.find((x) => x.enemyId === ctx.nation); if (w) S.Mil.nuclearExchange(st, w); } } },
        { label: 'Open an emergency channel', detail: 'Establish direct contact between capitals immediately.',
          effects: { 'world.tension': -8, 'intel.strength': -2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation += 6; n.grievance = Math.max(0, (n.grievance || 0) - 10); } },
          factions: { intelligentsia: +6, nationalists: -5 } },
        { label: 'Call the bluff and press the offensive', detail: 'Assess the signalling as bluff and continue offensive operations.',
          effects: { 'world.tension': +18, 'society.approval': +2 },
          fn: (st, ctx) => { st.wars.forEach((w) => { if (w.enemyId === ctx.nation) { w.posture = 'full'; w.intensity = 100; } }); },
          factions: { nationalists: +12, military: +5, intelligentsia: -14 },
          risk: { p: 0.28, text: 'They were not bluffing', fn: (st, ctx) => { const w = st.wars.find((x) => x.enemyId === ctx.nation); if (w) S.Mil.nuclearExchange(st, w); } } }
      ]
    },
    {
      id: 'foreign_ultimatum', cat: 'diplomacy', dynamic: true, title: 'An Ultimatum',
      from: 'Foreign Ministry', urgency: 'urgent', deadline: 6,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        return `<p>${n.name} has delivered a formal ultimatum. The demands involve significant concessions of sovereignty.</p>
          <p>Their military power is rated ${S.round(n.milPower, 0)} against our ${S.round(st.military.power, 0)}. Relations stand at ${S.round(n.relation, 0)}.</p>`;
      },
      options: [
        { label: 'Negotiate', detail: 'Open negotiations to establish their minimum terms.',
          effects: {}, opensNegotiation: (st, ctx) => ({ kind: 'ultimatum', nation: ctx.nation, ctx: {} }) },
        { label: 'Reject outright', detail: 'Reject the ultimatum publicly.',
          effects: { 'society.approval': +6, 'national.prestige': +4, 'world.tension': +8 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 20; n.grievance = (n.grievance || 0) + 20; },
          factions: { nationalists: +14, military: +6 },
          risk: { p: 0.35, text: 'They act on it', fn: (st, ctx) => { S.Mil.startWar(st, ctx.nation, { aggressor: false, intensity: 65 }); } } },
        { label: 'Comply', detail: 'Accept the demands in full.',
          effects: { 'society.approval': -10, 'national.prestige': -12, 'national.concessions': +2, 'world.tension': -6 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation += 18; n.grievance = 0; },
          factions: { nationalists: -20, military: -10, reformers: -5 },
          headline: 'Government Accepts Foreign Demands in Full' },
        { label: 'Seek allies and stall', detail: 'Delay a reply while seeking statements of support from friendly powers.',
          effects: { 'world.tension': +3 },
          fn: (st, ctx) => {
            let helped = 0;
            st.diplomacy.nations.forEach((o) => { if (o.id !== ctx.nation && o.relation > 45) { helped++; o.relation += 3; } });
            if (helped >= 2) { const n = S.dip(st, ctx.nation); n.relation += 5; st.national.prestige += 4; S.game.event('Two friendly powers issued statements of support. The ultimatum quietly lapsed.', 'good'); }
            else { st.national.prestige -= 5; S.game.event('No state offered support. The ultimatum stands and our isolation has been noted abroad.', 'bad'); }
          },
          factions: { intelligentsia: +4 } }
      ]
    },
    {
      id: 'hostile_incident', cat: 'diplomacy', dynamic: true, title: 'A Deliberate Provocation',
      from: 'Foreign Ministry', urgency: 'pressing', deadline: 8,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        const kind = st.rng.pick(['expelled our ambassador', 'seized one of our fishing vessels', 'flown bombers through our identification zone',
          'arrested three of our nationals on espionage charges', 'sponsored riots outside our embassy']);
        ctx.kind = ctx.kind || kind;
        return `<p>${n.name} has ${ctx.kind}. The act falls below the threshold of war but is plainly deliberate.</p>
          <p>Relations stand at ${S.round(n.relation, 0)}. The action appears designed to test our response.</p>`;
      },
      options: [
        { label: 'Respond symmetrically', detail: 'Do the same thing back, immediately.',
          effects: { 'society.approval': +3, 'world.tension': +4 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 8; },
          factions: { nationalists: +7, military: +3 } },
        { label: 'Escalate economically', detail: 'Sanctions, trade restrictions, asset freezes.',
          effects: { 'world.tension': +6, 'economy.shock': -0.3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 14; n.tradeStatus = 'restricted'; },
          factions: { nationalists: +9, business: -6 } },
        { label: 'Protest and let it pass', detail: 'Lodge a formal protest and take no further action.',
          effects: { 'society.approval': -3, 'world.tension': -2 },
          factions: { nationalists: -8, intelligentsia: +4 } },
        { label: 'Offer talks', detail: 'Treat the provocation as an opening.',
          effects: { 'world.tension': -4, 'national.prestige': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation += 6; n.grievance = Math.max(0, (n.grievance || 0) - 8); },
          factions: { nationalists: -6, intelligentsia: +6 } }
      ]
    },
    {
      id: 'alliance_offer', cat: 'diplomacy', dynamic: true, title: 'An Offer of Alliance',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 18,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        return `<p>${n.name} has proposed a formal defence relationship. Relations stand at ${S.round(n.relation, 0)} and their military power is rated ${S.round(n.milPower, 0)} against our ${S.round(st.military.power, 0)}.</p>
          <p>A defence treaty would commit us to their conflicts and commit them to ours.</p>`;
      },
      options: [
        { label: 'Negotiate the terms', detail: 'Accept in principle and negotiate the terms.',
          effects: {}, opensNegotiation: (st, ctx) => ({ kind: 'alliance', nation: ctx.nation, ctx: {} }) },
        { label: 'Accept the standard text', detail: 'Sign the offered text without amendment. Faster; the terms favour them.',
          effects: { 'national.prestige': +4, 'world.tension': +2 },
          fn: (st, ctx) => { S.Dip.signTreaty(st, ctx.nation, 'defense'); },
          factions: { military: +5, nationalists: -3 } },
        { label: 'Decline politely', detail: 'Decline and retain full freedom of action.',
          effects: {},
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 6; n.cooldown = 12; },
          factions: { nationalists: +5, intelligentsia: -3 } }
      ]
    },
    {
      id: 'trade_offer', cat: 'diplomacy', dynamic: true, title: 'A Trade Agreement Is Proposed',
      from: 'Ministry of Trade', urgency: 'routine', deadline: 20,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        return `<p>${n.name} proposes a comprehensive trade agreement. Bilateral volume currently runs at ${S.money(n.tradeVolume)} a year; their economy is ${S.money(n.gdp)}.</p>
          <p>Our tariff wall averages ${S.round(st.policy.trade.tariff, 1)}%. Domestic producers in the exposed sectors have already been in touch.</p>`;
      },
      options: [
        { label: 'Negotiate the agreement', detail: 'Negotiate the tariff schedules in detail.',
          effects: {}, opensNegotiation: (st, ctx) => ({ kind: 'trade', nation: ctx.nation, ctx: {} }) },
        { label: 'Sign a simple mutual-access deal', detail: 'Sign a limited reciprocal-access agreement.',
          effects: { 'economy.shock': +0.3, 'policy.trade.openness': +5 },
          fn: (st, ctx) => { S.Dip.signTreaty(st, ctx.nation, 'trade'); },
          factions: { business: +6, labour: -4 } },
        { label: 'Decline', detail: 'Decline and retain the existing tariffs.',
          effects: {},
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 5; n.cooldown = 10; },
          factions: { labour: +5, nationalists: +5, business: -6 } }
      ]
    },
    {
      id: 'aid_request', cat: 'diplomacy', dynamic: true, title: 'A Request for Assistance',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 16,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        return `<p>${n.name} has requested emergency assistance — ${st.rng.pick(['budget support', 'famine relief', 'vaccine supply', 'post-disaster reconstruction', 'balance-of-payments support'])}. They approached us before any other state.</p>
          <p>Their relation to us is ${S.round(n.relation, 0)}; their cultural affinity ${S.round(n.affinity, 0)}.</p>`;
      },
      options: [
        { label: 'Grant it generously', detail: 'Provide more than requested, announced publicly.',
          effects: { 'national.softPower': +6, 'national.prestige': +3, 'society.approval': -2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation += 18; n.affinity += 8; st.economy.reserves -= st.economy.gdp * 0.008; },
          factions: { intelligentsia: +5, nationalists: -5 } },
        { label: 'Grant it with conditions', detail: 'Provide assistance in exchange for specific concessions.',
          effects: { 'national.softPower': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation += 8; st.economy.reserves -= st.economy.gdp * 0.004; if (st.rng.chance(0.5)) S.Dip.signTreaty(st, ctx.nation, 'trade'); },
          factions: { business: +4 } },
        { label: 'Decline', detail: 'Refuse the request.',
          effects: { 'society.approval': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 10; n.affinity -= 4; },
          factions: { nationalists: +5, intelligentsia: -5 } }
      ]
    },
    {
      id: 'great_power_demand', cat: 'diplomacy', dynamic: true, title: 'A Great Power Wants Something',
      from: 'Foreign Ministry', urgency: 'pressing', deadline: 14,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        const ask = st.rng.pick(['basing rights at our southern port', 'our vote at the international body next month',
          'exclusion of their rival from our telecoms network', 'transit rights for military cargo',
          'suspension of our energy contract with their rival']);
        ctx.ask = ctx.ask || ask;
        return `<p>${n.name} has requested, in terms close to a demand, ${ctx.ask}.</p>
          <p>They are rated at power ${S.round(n.power, 0)}. Refusal damages relations with them; agreement damages relations with their rivals.</p>`;
      },
      options: [
        { label: 'Agree', detail: 'Grant the request and accept the cost with their rivals.',
          effects: { 'national.prestige': -3, 'national.concessions': +1, 'society.approval': -3 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation); n.relation += 22;
            st.diplomacy.nations.forEach((o) => { if (o.id !== n.id && o.relation < 0 && o.power > 55) o.relation -= 10; });
          },
          factions: { nationalists: -12, business: +4 } },
        { label: 'Refuse', detail: 'Decline the request and accept the damage to relations.',
          effects: { 'national.prestige': +5, 'society.approval': +4 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 16; n.grievance = (n.grievance || 0) + 12; },
          factions: { nationalists: +12, intelligentsia: +3 } },
        { label: 'Demand payment', detail: 'Offer to grant the request in exchange for payment.',
          effects: { 'national.prestige': -1 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation);
            if (st.rng.chance(0.55 + (st.national.prestige - 50) / 200)) {
              st.economy.reserves += st.economy.gdp * 0.015; n.relation += 8;
              S.game.event('Payment was made without publicity, above the expected amount.', 'good');
            } else { n.relation -= 12; S.game.event('They declined to pay. Relations have been damaged by the request.', 'bad'); }
          },
          factions: { business: +7, nationalists: +3 } },
        { label: 'Play both sides', detail: 'Signal agreement to both powers without delivering to either.',
          effects: { 'national.prestige': -2 },
          fn: (st, ctx) => {
            if (st.rng.chance(0.45 + st.intel.strength / 250)) {
              st.diplomacy.nations.forEach((o) => { if (o.power > 55) o.relation += 6; });
              S.game.event('Both capitals currently believe they hold our commitment.', 'good');
            } else {
              st.diplomacy.nations.forEach((o) => { if (o.power > 55) o.relation -= 14; });
              st.national.prestige -= 8;
              S.game.event('The parallel assurances were exposed. Relations with both powers have deteriorated.', 'bad');
            }
          },
          factions: { intelligentsia: -4, nationalists: +2 } }
      ]
    },
    {
      id: 'mediation_offer', cat: 'diplomacy', dynamic: true, title: 'An Offer to Mediate',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 14,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        return `<p>${n.name} has offered to mediate an end to our war. They are not fully neutral, but both sides regard them as an acceptable channel.</p>`;
      },
      options: [
        { label: 'Accept mediation', detail: 'Let them convene it.',
          effects: { 'national.prestige': +2, 'world.tension': -3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation += 10; const w = st.wars.find((x) => x.type === 'conventional'); if (w) { w.peaceOffered = true; S.game.pushDecision('peace_feeler', { war: w.id }); } },
          factions: { intelligentsia: +6, nationalists: -5 } },
        { label: 'Decline', detail: 'Refuse mediation and continue the war.',
          effects: { 'society.approval': +1 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); n.relation -= 6; },
          factions: { nationalists: +7, military: +3 } }
      ]
    }
  ];

  /* Index by id for dynamic lookup. */
  D.BY_ID = {};
  D.LIB.forEach((d) => { D.BY_ID[d.id] = d; });

})(window.S);

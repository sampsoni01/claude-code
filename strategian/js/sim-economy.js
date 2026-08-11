/* STRATEGIAN — economic simulation
   Everything here runs on annual rates scaled by dt (one day = 1/365).   */
(function (S) {
  'use strict';

  const Econ = S.Econ = {};

  /* Neutral funding levels, as a share of GDP. Spending at the benchmark
     produces a middling public service; double it for excellence.        */
  Econ.BENCHMARK = {
    defense: 2.6, education: 4.8, health: 6.6, infra: 3.0, welfare: 10.0,
    research: 2.0, intel: 0.55, interior: 1.5, culture: 0.90, energy: 1.0,
    foreign: 0.5, admin: 1.9
  };

  /* Which national-quality stock each ministry feeds. */
  Econ.QUALITY_OF = {
    education: 'education', health: 'health', infra: 'infra', research: 'science',
    interior: 'security', culture: 'culture', energy: 'energy', admin: 'admin',
    welfare: 'welfareQ', intel: null, defense: null, foreign: null
  };

  Econ.gdpPerCapita = function (st) {
    return (st.economy.gdpReal * 1000) / st.pop.total; // units per head
  };

  /* Government effectiveness multiplier — corruption and capacity tax
     every unit of spending before it reaches a school or a road.         */
  Econ.efficiency = function (st) {
    const gov = S.govMods(st);
    const admin = st.quality.admin;
    const corr = st.society.corruption;
    let e = 0.55 + (admin / 100) * 0.50 - (corr / 100) * 0.30;
    e *= (gov.efficiency || 1);
    return S.clamp(e, 0.40, 1.18);
  };

  /* ------------------------------------------------------------ revenue */
  Econ.computeRevenue = function (st) {
    const p = st.policy.tax, e = st.economy;
    const gdp = e.gdp;
    const formal = 1 - e.informal / 100;
    const corr = st.society.corruption;

    // Compliance falls with the rate itself (avoidance) and, far more sharply,
    // with corruption. A clean state can levy high rates and still collect.
    function compliance(rate, maxRate) {
      const load = S.clamp(rate / maxRate, 0, 1.4);
      const c = 1 - Math.pow(load, 2.2) * (0.14 + corr / 130) - corr / 460;
      return S.clamp(c, 0.16, 0.99);
    }

    // The income line represents income tax and social contributions together.
    const laborBase = gdp * 0.55 * formal;
    const profitBase = gdp * 0.145 * formal;
    const consumeBase = gdp * 0.62 * (0.55 + 0.45 * formal);
    const wealthBase = gdp * 3.4;
    const importBase = e.imports;

    const r = {};
    r.income = laborBase * (p.income / 100) * compliance(p.income, 60);
    r.corporate = profitBase * (p.corporate / 100) * compliance(p.corporate, 45);
    r.vat = consumeBase * (p.vat / 100) * compliance(p.vat, 30);
    r.wealth = wealthBase * (p.wealth / 100) * compliance(p.wealth * 12, 60);
    r.tariff = importBase * (st.policy.trade.tariff / 100) * 0.92;

    // State-owned enterprises and resource rents.
    const soe = st.policy.econ.stateOwnership / 100;
    r.state = gdp * 0.055 * soe * (0.55 + 0.45 * (1 - corr / 100));
    r.resource = gdp * e.sectors.resources / 100 * 0.48 * (st.world.oil / 100) *
      (0.4 + 0.6 * (st.policy.econ.stateOwnership / 100 + 0.35));
    // Concessional finance and development assistance, for those who need it.
    if (st.flags.aidRecipient) {
      const goodwill = S.clamp(0.5 + S.avg(st.diplomacy.nations, (n) => n.relation) / 200, 0.15, 1.1);
      r.aid = gdp * 0.040 * goodwill * (st.economy.sanctionPressure > 30 ? 0.3 : 1);
    }
    // Fees, licences, dividends, fines — the long tail of a functioning state.
    r.other = gdp * 0.030 * (0.55 + 0.45 * (st.quality.admin / 70));

    let total = 0;
    for (const k in r) total += r[k];
    e.revenueBreakdown = r;
    return total;
  };

  /* ------------------------------------------------------------ spending */
  Econ.computeSpending = function (st) {
    const gdp = st.economy.gdp;
    let prog = 0;
    for (const m in st.budget.alloc) prog += (st.budget.alloc[m] / 100) * gdp;
    const service = st.economy.debt * (st.economy.avgDebtRate / 100);
    st.economy.debtService = service;
    st.economy.programSpending = prog;
    // Wars are funded off-budget and show up as a separate line.
    let warCost = 0;
    st.wars.forEach((w) => { warCost += w.annualCost || 0; });
    st.economy.warSpending = warCost;
    return prog + service + warCost;
  };

  /* --------------------------------------------- the financing constraint
     A government can only run the deficit that someone is willing to fund.
     Past that point it prints, defaults on its obligations in real terms, or
     cuts — usually all three at once, and never by choice.                */
  Econ.financingConstraint = function (st, dt) {
    const e = st.economy;
    // Maximum sustainable deficit, as a share of GDP.
    const capacity = 0.025 + (e.creditScore / 100) * 0.085 + (e.reserveStatus / 100) * 0.035
      + (st.flags.imfProgramme ? 0.015 : 0);
    const ratio = e.deficit / e.gdp;
    const excess = ratio - capacity;
    e.financingGap = Math.max(0, excess) * 100;

    if (excess <= 0) {
      e.forcedAusterity = S.drift(e.forcedAusterity || 0, 0, 2 * dt);
      return;
    }
    // Roughly half the gap is closed by unplanned cuts; the rest is printed.
    const cutRate = S.clamp(excess * 1.4, 0, 0.45);
    const floor = { defense: 0.8, interior: 0.5, admin: 0.6, health: 0.8 };
    for (const m in st.budget.alloc) {
      const lo = floor[m] != null ? floor[m] : 0.05;
      st.budget.alloc[m] = Math.max(lo, st.budget.alloc[m] * (1 - cutRate * dt));
    }
    e.forcedAusterity = S.drift(e.forcedAusterity || 0, excess * 100, 3 * dt);
    e.monetisedGap = excess * 100 * 0.5;
    st.society.approval -= excess * 22 * dt;
    st.society.unrest += excess * 26 * dt;
    if (!st.flags.austerityWarned && excess > 0.03) {
      st.flags.austerityWarned = true;
      S.game.event('The Treasury cannot fund the budget as written. Payments are being sequenced and departments told to cut where they can.', 'bad');
      S.News.custom(st, 'Treasury Begins Sequencing Payments as Funding Dries Up', 'bad');
      S.game.pushDecision('debt_wall', {});
    }
  };

  /* ------------------------------------------------- potential growth */
  Econ.potentialGrowth = function (st) {
    const q = st.quality, pol = st.policy, gov = S.govMods(st);
    const gdppc = Econ.gdpPerCapita(st);

    // Catch-up: poor countries have more headroom than rich ones. This is the
    // dominant term — institutions and human capital modulate it, not replace it.
    const catchUp = 4.4 * Math.exp(-gdppc / 22000);
    const base = 0.35 + catchUp;

    const human = (q.education - 62) * 0.010 + (q.health - 62) * 0.005;
    const physical = (q.infra - 62) * 0.008 + (q.energy - 55) * 0.004;
    const innovation = (q.science - 62) * 0.010 * (gov.techPenalty || 1);
    const institutions = (38 - st.society.corruption) * 0.008 + (q.admin - 62) * 0.006;
    const openness = (pol.trade.openness - 50) * 0.007 - (pol.trade.tariff - 5) * 0.012;
    const regulation = -(pol.econ.regulation - 45) * 0.007;
    const statism = -Math.max(0, pol.econ.stateOwnership - 30) * 0.010;
    const labour = -Math.max(0, pol.econ.laborProtection - 60) * 0.008;
    const stability = (st.society.stability - 58) * 0.012;
    const demog = (st.pop.workingAge - 63) * 0.045;
    const taxDrag = -Math.max(0, (pol.tax.corporate - 24)) * 0.011 -
      Math.max(0, (pol.tax.income - 36)) * 0.008;
    const world = (st.world.growth - 2.6) * 0.30;
    const warDrag = -S.sum(st.wars, (w) => (w.intensity / 100) * 0.9);
    const sanctions = -(st.economy.sanctionPressure / 100) * 1.8;
    const energyDrag = -Math.max(0, st.world.oil - 100) / 100 * (st.economy.energyImportDep / 100) * 2.2;

    let g = base + human + physical + innovation + institutions + openness +
      regulation + statism + labour + stability + demog + taxDrag + world +
      warDrag + sanctions + energyDrag + (gov.growthBonus || 0);

    return S.clamp(g, -9, 12);
  };

  /* --------------------------------------------------------- trade flows */
  Econ.updateTrade = function (st) {
    const e = st.economy, pol = st.policy;
    const fxCompetitiveness = 100 / Math.max(35, e.fx); // weak currency → cheap exports
    const quality = 0.45 + 0.55 * (e.productivity / 100);
    const openness = 0.5 + 0.5 * (pol.trade.openness / 100);

    // Partner willingness: relations, tariffs they levy, embargoes.
    let access = 0, weightTotal = 0;
    st.diplomacy.nations.forEach((n) => {
      const w = n.gdp;
      weightTotal += w;
      let a = 0.5 + n.relation / 260;
      if (n.tradeStatus === 'embargo') a = 0.02;
      else if (n.tradeStatus === 'restricted') a *= 0.45;
      else if (n.tradeStatus === 'preferred') a *= 1.35;
      if (n.sanctioningUs) a *= 0.35;
      access += w * S.clamp(a, 0, 1.6);
    });
    access = weightTotal ? access / weightTotal : 0.5;
    e.marketAccess = access;

    const baseExportShare = st.pop.total < 20 ? 0.44 : st.pop.total < 200 ? 0.30 : 0.17;
    const exportShare = baseExportShare * fxCompetitiveness * quality * openness * access *
      (1 - st.economy.sanctionPressure / 190);
    const importShare = baseExportShare * 1.02 * (e.fx / 100) * openness *
      (1 - pol.trade.tariff / 145) * (0.8 + 0.4 * (e.consumerConfidence / 60));

    e.exports = S.clamp(exportShare, 0.02, 0.85) * e.gdp;
    e.imports = S.clamp(importShare, 0.02, 0.85) * e.gdp;
    e.tradeBalance = e.exports - e.imports;
    e.energyImportDep = S.clamp(35 - e.sectors.resources * 1.4 - st.quality.energy * 0.18, -20, 45);
  };

  /* ------------------------------------------------------------- fx rate */
  Econ.updateFx = function (st, dt) {
    const e = st.economy, w = st.world, pol = st.policy;
    const rateDiff = pol.monetary.rate - (w.rate + Math.max(0, e.inflation - w.inflation) * 0.55);
    const balance = (e.tradeBalance / e.gdp) * 100;
    const infDiff = e.inflation - w.inflation;

    // Multiplicative in log space so no combination of shocks can drive the
    // equilibrium negative or produce a discontinuity.
    let logT = 0;
    logT += S.clamp(rateDiff, -12, 12) * 0.011;
    logT += S.clamp(balance, -14, 14) * 0.018;
    logT -= S.clamp(infDiff, -20, 90) * 0.011;
    logT += (st.society.stability - 55) * 0.0035;
    logT += (e.reserveStatus - 30) * 0.0022;
    logT -= (e.sanctionPressure / 100) * 0.22;
    logT -= S.clamp((e.debtGdp - 80) / 100, 0, 1.6) * 0.10;
    logT -= (pol.monetary.emission - 50) * 0.0040;
    if (st.wars.length) logT -= 0.05 * S.sum(st.wars, (x) => x.intensity / 100);

    let target = 100 * Math.exp(S.clamp(logT, -2.4, 1.0));
    target = S.clamp(target, 8, 260);
    e.fxTarget = target;

    let speed = 1.6; // annual convergence speed
    if (pol.monetary.regime === 'peg') speed = 0.25;
    else if (pol.monetary.regime === 'managed') speed = 0.8;
    speed *= 1 - pol.monetary.capitalControls / 190;

    // Defending a peg burns reserves.
    if (pol.monetary.regime === 'peg' && target < e.fx * 0.97) {
      const strain = (e.fx - target) / e.fx;
      e.reserves -= e.gdp * strain * 0.55 * dt;
      e.pegStrain = S.clamp(strain * 100, 0, 100);
      if (e.reserves <= 0) {
        e.reserves = 0;
        pol.monetary.regime = 'float';
        S.game.event('The peg broke. Reserves are exhausted and the currency is now floating — badly.', 'bad');
        S.News.push(st, 'currency', { severity: 'major' });
      }
    } else { e.pegStrain = Math.max(0, (e.pegStrain || 0) - 20 * dt); }

    const before = e.fx;
    e.fx = S.drift(e.fx, target, speed * dt);
    const noise = st.rng.normal(0, 0.9) * (pol.monetary.regime === 'float' ? 1 : 0.3);
    e.fx = S.clamp(e.fx * (1 + noise * dt), 5, 300);

    // Annualised rate of depreciation — this, not the level, drives import prices.
    const instant = ((before / e.fx) - 1) / dt;
    e.fxDepreciation = S.drift(e.fxDepreciation || 0, S.clamp(instant * 100, -60, 200), 4 * dt);
  };

  /* ---------------------------------------------------------- inflation */
  Econ.updateInflation = function (st, dt) {
    const e = st.economy, pol = st.policy, w = st.world;
    const gov = S.govMods(st);

    // Expectations: anchored near target while credibility holds, otherwise
    // they track recent experience — which is what makes inflation persistent.
    const credible = !st.flags.bankDirected && !st.flags.bankCaptured &&
      e.inflation < 14 && st.society.stability > 42;
    e.expectations = S.drift(e.expectations == null ? e.inflation : e.expectations,
      credible ? (2.2 * 0.6 + e.inflation * 0.4) : e.inflation, 1.6 * dt);

    const moneyExcess = (pol.monetary.emission - 50) * 0.11;
    const outputGap = S.clamp(e.growth - e.potential, -6, 6) * 0.55;
    // Real policy rate against a neutral real rate of ~1.5%.
    const realRate = pol.monetary.rate - e.expectations;
    const tightness = S.clamp(realRate - 1.5, -10, 14) * 0.34;
    // Pass-through comes from the *rate* of depreciation, not the level.
    const fxPass = S.clamp((e.fxDepreciation || 0) * (e.imports / e.gdp) * 0.55, -8, 22);
    const tariffPush = pol.trade.tariff * 0.045;
    const energyPush = S.clamp(((w.oil - 100) / 100) * (e.energyImportDep / 100) * 6.0, -6, 14);
    const foodPush = S.clamp(((w.grain - 100) / 100) * 2.6, -4, 9);
    const wagePush = Math.max(0, 5.2 - e.unemployment) * 0.38;
    const subsidyDrag = -pol.econ.subsidies * 0.010;

    // Whatever the market will not fund gets printed.
    const monetisation = S.clamp((e.monetisedGap || 0) *
      (0.55 + st.society.corruption / 200), 0, 26);

    let target = e.expectations * 0.72 + w.inflation * 0.14 + moneyExcess + outputGap -
      tightness + fxPass + tariffPush + energyPush + foodPush + wagePush + subsidyDrag + monetisation;

    if (pol.monetary.regime === 'peg') target = target * 0.5 + w.inflation * 0.5;
    if (pol.econ.priceControls) target -= 4.5;

    // Wages and prices are sticky downward; deep deflation is rare and slow.
    target = S.clamp(target, -2.5, Math.max(12, e.inflation * 1.7 + 10));
    e.inflationTarget = target;

    const speed = credible ? 1.3 : 2.6;
    e.inflation = S.drift(e.inflation, target, speed * dt);
    e.inflation += st.rng.normal(0, 0.6) * dt * (credible ? 1 : 3);
    e.inflation = S.clamp(e.inflation, -8, 900);
    void gov;
  };

  /* --------------------------------------------- the central bank's rule */
  // Unless you have taken direct control, a Taylor-type rule sets the policy
  // rate. This is the single most stabilising institution in the model — which
  // is exactly why seizing it is such an interesting decision.
  Econ.centralBankRule = function (st, dt) {
    const e = st.economy, pol = st.policy.monetary;
    if (st.flags.bankDirected || st.flags.bankCaptured) {
      // A captured bank drifts toward whatever is politically convenient.
      if (st.flags.bankCaptured) pol.rate = S.drift(pol.rate, Math.max(0, e.inflation * 0.35), 0.9 * dt);
      return;
    }
    const gapInf = e.inflation - 2.5;
    const gapOut = e.growth - e.potential;
    let target = 1.6 + e.inflation + gapInf * 0.5 + gapOut * 0.4;
    if (st.economy.fx < 80) target += (80 - st.economy.fx) * 0.08; // defend the currency
    if (pol.regime === 'peg') target = st.world.rate + 1.5 + Math.max(0, 90 - e.fx) * 0.10;
    // No central bank strangles the sovereign to death; there is a limit to
    // how far above inflation it will go before the finance ministry objects.
    target = S.clamp(target, 0, Math.min(32, e.inflation + 9));
    pol.rate = S.drift(pol.rate, target, 3.2 * dt);
  };

  /* ------------------------------------------------------- headline loop */
  Econ.tick = function (st, dt) {
    const e = st.economy, pol = st.policy;

    Econ.updateTrade(st);

    /* --- budget --- */
    const revenue = Econ.computeRevenue(st);
    const spending = Econ.computeSpending(st);
    e.revenue = revenue;
    e.spending = spending;
    e.deficit = spending - revenue;
    Econ.financingConstraint(st, dt);

    // Sovereign wealth funds absorb surpluses before debt is repaid.
    if (e.deficit < 0 && e.swf != null) {
      const toFund = -e.deficit * 0.45;
      e.swf += toFund * dt;
      e.debt += (e.deficit + toFund) * dt;
    } else {
      e.debt += e.deficit * dt;
    }
    if (e.debt < 0) { e.reserves += -e.debt * 0.5; e.debt = 0; }

    /* --- risk premium and debt service --- */
    const rating = Econ.creditScore(st);
    e.creditScore = rating;
    e.creditRating = Econ.ratingLabel(rating);
    // Deep, trusted markets charge less fear premium for the same debt.
    const depth = 1 - S.clamp(e.reserveStatus, 0, 100) / 230;
    const premium = (S.clamp((100 - rating) * 0.11, 0, 18) +
      Math.max(0, e.inflation - 6) * 0.22 + (e.defaultHistory ? 3.0 : 0)) * depth;
    e.riskPremium = premium;
    e.bondYield = pol.monetary.rate + premium;
    // The stock reprices only as it matures — roughly a seventh of it a year.
    e.avgDebtRate = S.drift(e.avgDebtRate, e.bondYield, 0.16 * dt);

    /* --- inflation, fx, the policy rate --- */
    Econ.updateInflation(st, dt);
    Econ.centralBankRule(st, dt);
    Econ.updateFx(st, dt);

    /* --- growth --- */
    e.potential = Econ.potentialGrowth(st);
    const confidence = (e.businessConfidence - 50) * 0.030 + (e.consumerConfidence - 50) * 0.022;
    const monetaryStance = -(pol.monetary.rate - (2 + e.inflation)) * 0.16;
    const fiscalStance = S.clamp((e.deficit / e.gdp) * 100, -8, 12) * 0.11;
    const inflationPain = -Math.max(0, e.inflation - 9) * 0.14 - Math.max(0, e.inflation - 25) * 0.30;
    const unrestDrag = -Math.max(0, st.society.unrest - 45) * 0.048;
    // Economies that have fallen a long way below their previous peak tend to
    // bounce: idle capacity is cheap and someone eventually uses it.
    e.gdpPeak = Math.max(e.gdpPeak || e.gdpReal, e.gdpReal);
    const rebound = S.clamp((e.gdpPeak / Math.max(1, e.gdpReal) - 1) * 1.6, 0, 3.0);
    const cycle = S.clamp(confidence + monetaryStance + fiscalStance + inflationPain +
      unrestDrag + rebound + e.shock, -9, 7);

    const targetGrowth = e.potential + cycle;
    e.growth = S.drift(e.growth, targetGrowth, 2.4 * dt) + st.rng.normal(0, 0.55) * dt;
    e.growth = S.clamp(e.growth, -22, 16);
    e.shock = S.drift(e.shock, 0, 2.2 * dt);

    /* --- levels --- */
    const realFactor = 1 + (e.growth / 100) * dt;
    e.gdpReal *= realFactor;
    e.gdp *= realFactor * (1 + (e.inflation / 100) * dt);
    e.debtGdp = (e.debt / e.gdp) * 100;

    /* --- labour market (Okun) --- */
    const structural = 4.2 + (100 - st.quality.education) * 0.022 +
      Math.max(0, pol.econ.laborProtection - 55) * 0.045 +
      (st.pop.youthShare - 16) * 0.16 + (e.informal * 0.035) -
      (pol.econ.subsidies * 0.012);
    const okun = -(e.growth - e.potential) * 0.42;
    const uTarget = S.clamp(structural + okun * 1.4, 1.2, 48);
    e.unemployment = S.drift(e.unemployment, uTarget, 1.5 * dt);

    /* --- productivity and structure --- */
    const prodTarget = 22 + st.quality.education * 0.34 + st.quality.science * 0.26 +
      st.quality.infra * 0.18 - st.society.corruption * 0.13 +
      (pol.trade.openness - 50) * 0.07;
    e.productivity = S.drift(e.productivity, S.clamp(prodTarget, 5, 100), 0.55 * dt);

    const informalTarget = S.clamp(14 + st.society.corruption * 0.42 +
      Math.max(0, pol.tax.vat - 18) * 0.75 + Math.max(0, pol.tax.income - 38) * 0.42 -
      st.quality.admin * 0.30 - (Econ.gdpPerCapita(st) / 3200), 2, 68);
    e.informal = S.drift(e.informal, informalTarget, 0.7 * dt);

    /* --- confidence --- */
    const bizTarget = 50 + (e.growth - 2) * 4.2 - (e.inflation - 4) * 1.1 -
      (pol.tax.corporate - 22) * 0.55 - (pol.econ.regulation - 45) * 0.25 +
      (st.society.stability - 55) * 0.42 - st.wars.length * 6 -
      e.sanctionPressure * 0.16 - Math.max(0, e.debtGdp - 100) * 0.09;
    e.businessConfidence = S.drift(e.businessConfidence, S.clamp(bizTarget, 2, 98), 1.8 * dt);

    const conTarget = 50 + (e.growth - 2) * 3.0 - Math.max(0, e.inflation - 3) * 1.9 -
      (e.unemployment - 5) * 1.9 + (st.society.approval - 50) * 0.28 +
      (st.quality.welfareQ - 50) * 0.12;
    e.consumerConfidence = S.drift(e.consumerConfidence, S.clamp(conTarget, 2, 98), 1.9 * dt);

    /* --- equity market --- */
    const mktTarget = 100 * Math.pow(1.055, (st.date.year - st.startYear)) *
      (1 + (e.businessConfidence - 50) * 0.011) *
      (1 - S.clamp(pol.monetary.rate - 4, -4, 22) * 0.021) *
      (1 - st.world.tension * 0.0022) * (st.world.market / 100) *
      (1 - S.clamp(pol.tax.corporate - 22, 0, 40) * 0.008);
    e.marketIndex = S.drift(e.marketIndex, Math.max(15, mktTarget), 3.2 * dt);
    e.marketIndex *= 1 + st.rng.normal(0, 0.11) * Math.sqrt(dt) * 4.2;
    e.marketIndex = Math.max(8, e.marketIndex);

    /* --- reserves --- */
    const reserveFlow = e.tradeBalance * 0.16 + (e.reserveStatus > 60 ? e.gdp * 0.004 : 0) -
      (e.sanctionPressure / 100) * e.gdp * 0.010;
    e.reserves = Math.max(0, e.reserves + reserveFlow * dt);
    e.reserveMonths = e.imports > 0 ? (e.reserves / (e.imports / 12)) : 0;
    const rsTarget = S.clamp(e.reserveStatus + (e.tradeBalance > 0 ? 0.4 : -0.4) +
      (st.society.stability - 55) * 0.05 - e.inflation * 0.10, 0, 100);
    e.reserveStatus = S.drift(e.reserveStatus, rsTarget, 0.35 * dt);

    /* --- public service quality stocks --- */
    Econ.updateQuality(st, dt);

    /* --- sanctions decay --- */
    let sanction = 0;
    st.diplomacy.nations.forEach((n) => { if (n.sanctioningUs) sanction += n.power * 0.55; });
    e.sanctionPressure = S.clamp(S.drift(e.sanctionPressure, S.clamp(sanction, 0, 100), 2.0 * dt), 0, 100);

    /* --- default watch --- */
    if (e.debtGdp > 180 && e.creditScore < 12 && !e.defaultHistory && st.rng.chance(0.5 * dt)) {
      Econ.triggerDefault(st);
    }
  };

  /* --------------------------------------------- public service quality */
  Econ.updateQuality = function (st, dt) {
    const eff = Econ.efficiency(st);
    const gdppc = Econ.gdpPerCapita(st);
    // A poor country cannot buy first-world services at any share of a small GDP.
    const wealthFactor = 0.45 + 0.55 * S.sat(gdppc / 1000, 14);
    const gov = S.govMods(st);

    for (const m in Econ.QUALITY_OF) {
      const key = Econ.QUALITY_OF[m];
      if (!key) continue;
      const ratio = st.budget.alloc[m] / Econ.BENCHMARK[m];
      // Administrative capacity is driven by funding and corruption directly —
      // routing it through `eff` would make it its own feedback loop.
      const mult = key === 'admin'
        ? (1 - st.society.corruption / 200) * (S.govMods(st).efficiency || 1)
        : eff;
      // Benchmark funding buys a competent service; excellence costs more.
      let target = (35 + 55 * Math.pow(S.clamp(ratio, 0, 3.2), 0.45)) * wealthFactor * mult;
      if (key === 'science') target *= (gov.techPenalty || 1);
      if (key === 'culture') target += (gov.cultureBonus || 0) * 0.5 + st.policy.interior.propaganda * 0.05;
      if (key === 'security') target += st.policy.interior.policing * 0.16;
      if (key === 'education') target += (st.policy.social.eduUniversity - 30) * 0.04;
      target = S.clamp(target, 2, 100);
      // Institutional stocks move slowly — years, not months.
      st.quality[key] = S.drift(st.quality[key], target, 0.42 * dt);
    }
  };

  /* --------------------------------------------------------- creditworthiness */
  Econ.creditScore = function (st) {
    const e = st.economy;
    let s = 100;
    s -= S.clamp(e.debtGdp - 40, 0, 220) * 0.28;
    s -= S.clamp((e.deficit / e.gdp) * 100, 0, 22) * 2.1;
    s -= S.clamp(e.inflation - 4, 0, 90) * 0.75;
    s += (st.society.stability - 55) * 0.34;
    s += (e.growth - 2) * 1.9;
    s += (e.reserveStatus - 30) * 0.18;
    s -= e.sanctionPressure * 0.24;
    s -= st.wars.length * 5;
    s -= (e.defaultHistory || 0) * 9;
    s -= st.society.corruption * 0.14;
    return S.clamp(s, 0, 100);
  };
  Econ.ratingLabel = function (score) {
    const t = ['D', 'C', 'CC', 'CCC', 'B-', 'B', 'B+', 'BB', 'BB+', 'BBB', 'BBB+', 'A-', 'A', 'A+', 'AA', 'AA+', 'AAA'];
    return t[S.clamp(Math.floor(score / 100 * (t.length - 1)), 0, t.length - 1)];
  };

  Econ.triggerDefault = function (st) {
    const e = st.economy;
    e.defaultHistory = (e.defaultHistory || 0) + 1;
    e.debt *= 0.55;
    e.shock -= 6;
    e.reserveStatus = Math.max(0, e.reserveStatus - 22);
    st.society.approval -= 9;
    st.society.unrest += 12;
    S.game.event('SOVEREIGN DEFAULT. The state has suspended payment on its external debt. Credit markets are closed to you.', 'bad');
    S.News.push(st, 'default', { severity: 'major' });
  };

  /* ---------------------------------------------------------- world tick */
  Econ.worldTick = function (st, dt) {
    const w = st.world, rng = st.rng;
    w.growth = S.clamp(S.drift(w.growth, 2.7 - w.tension * 0.012, 0.8 * dt) + rng.normal(0, 0.5) * dt, -5, 7);
    w.inflation = S.clamp(S.drift(w.inflation, 2.6 + Math.max(0, w.oil - 100) * 0.028, 1.0 * dt) + rng.normal(0, 0.4) * dt, -2, 40);
    w.rate = S.clamp(S.drift(w.rate, 1.4 + w.inflation * 0.85, 0.9 * dt), 0, 25);

    // Commodity prices: mean-reverting with fat-ish tails and war premiums.
    const warPremium = 1 + S.sum(st.wars, (x) => x.intensity / 260) + w.globalWars * 0.06;
    w.oil = S.clamp(S.drift(w.oil, 100 * warPremium * (1 + w.tension * 0.0045), 1.1 * dt) *
      (1 + rng.normal(0, 0.16) * Math.sqrt(dt) * 3.4), 22, 480);
    w.grain = S.clamp(S.drift(w.grain, 100 * (1 + w.tension * 0.003) * (1 + w.climate * 0.004), 1.0 * dt) *
      (1 + rng.normal(0, 0.14) * Math.sqrt(dt) * 3.2), 35, 420);
    w.market = S.clamp(S.drift(w.market, 100 + (w.growth - 2.7) * 12 - w.tension * 0.35, 1.6 * dt) *
      (1 + rng.normal(0, 0.10) * Math.sqrt(dt) * 3.6), 25, 320);
    w.climate = S.clamp(w.climate + 0.055 * dt - st.policy.energy.transition * 0.0004 * dt, 0, 100);
    w.techLevel += 0.9 * dt;
  };

})(window.S);

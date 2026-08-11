/* STRATEGIAN — society, legitimacy, factions and internal security */
(function (S) {
  'use strict';

  const Soc = S.Soc = {};

  /* Composite repression index from the interior-policy sliders. */
  Soc.repression = function (st) {
    const i = st.policy.interior;
    const r = (i.surveillance * 0.30) + (i.policing * 0.20) +
      ((100 - i.pressFreedom) * 0.26) + ((100 - i.civilLiberties) * 0.24);
    return S.clamp(r, 0, 100);
  };

  /* Legitimacy — the reason people obey when nobody is watching. */
  Soc.legitimacy = function (st) {
    const gov = S.govMods(st);
    const e = st.economy;
    const perf = S.clamp(50 + (e.growth - 2) * 5.5 - Math.max(0, e.inflation - 5) * 1.4 -
      (e.unemployment - 6) * 1.5 + (st.quality.health + st.quality.education - 100) * 0.13, 0, 100);
    switch (gov.legitimacyFrom) {
      case 'approval': return st.society.approval * 0.72 + perf * 0.18 + st.society.cohesion * 0.10;
      case 'performance': return perf * 0.66 + st.society.approval * 0.16 + st.quality.admin * 0.18;
      case 'force': return Soc.repression(st) * 0.42 + Soc.militaryLoyalty(st) * 0.34 + perf * 0.24;
      case 'fear': return Soc.repression(st) * 0.50 + st.society.cohesion * 0.18 + perf * 0.20 +
        Soc.militaryLoyalty(st) * 0.12;
      case 'faith': return st.society.cohesion * 0.46 + Soc.factionLoyalty(st, 'clergy') * 0.30 + perf * 0.24;
      default: return st.society.approval * 0.42 + perf * 0.38 + Soc.repression(st) * 0.20;
    }
  };

  Soc.factionLoyalty = function (st, id) {
    const f = st.factions.find((x) => x.id === id);
    return f ? f.loyalty : 50;
  };
  Soc.militaryLoyalty = function (st) { return Soc.factionLoyalty(st, 'military'); };

  /* Weighted danger from disaffected but powerful factions. */
  Soc.factionDanger = function (st) {
    let d = 0;
    st.factions.forEach((f) => {
      const anger = Math.max(0, 50 - f.loyalty);
      d += anger * (f.power / 100) * (f.id === 'military' ? 1.7 : 1);
    });
    return S.clamp(d / 2.6, 0, 100);
  };

  /* --------------------------------------------------------------- tick */
  Soc.tick = function (st, dt) {
    const s = st.society, e = st.economy, pol = st.policy, gov = S.govMods(st);

    s.repression = Soc.repression(st);
    const rep = s.repression;

    /* ---- approval ----
       People judge a government against what they are used to, not against
       Switzerland. The reference point adapts over a few years, which is why
       an improving poor country can be popular and a stagnating rich one
       cannot. Only genuinely extreme conditions carry an absolute penalty. */
    const realIncome = e.growth - Math.max(0, e.inflation - 2) * 0.55;
    const services = (st.quality.health + st.quality.education + st.quality.infra +
      st.quality.welfareQ + st.quality.security) / 5;
    if (!s.ref) {
      s.ref = { services: services, corruption: s.corruption, inflation: e.inflation, unemployment: e.unemployment };
    }
    const ref = s.ref;
    let aTarget = 50
      + realIncome * 2.6
      - (e.inflation - ref.inflation) * 1.25 - Math.max(0, e.inflation - 14) * 0.60
      - (e.unemployment - ref.unemployment) * 1.60 - Math.max(0, e.unemployment - 13) * 0.55
      + (services - ref.services) * 0.60
      - (s.corruption - ref.corruption) * 0.30 - Math.max(0, s.corruption - 60) * 0.12
      + (st.national.prestige - 45) * 0.09
      + s.honeymoon
      + s.scandal
      + (pol.interior.propaganda * 0.10 * (gov.legitimacyFrom === 'approval' ? 0.35 : 1))
      - Math.max(0, s.inequality - 48) * 0.14
      - Math.max(0, s.unrest - 55) * 0.14
      + S.Aftermath.approvalOffset(st);

    // The reference adapts over roughly three years.
    ref.services = S.drift(ref.services, services, 0.34 * dt);
    ref.corruption = S.drift(ref.corruption, s.corruption, 0.30 * dt);
    ref.inflation = S.drift(ref.inflation, e.inflation, 0.45 * dt);
    ref.unemployment = S.drift(ref.unemployment, e.unemployment, 0.40 * dt);

    // War moves opinion sharply in both directions.
    st.wars.forEach((w) => {
      aTarget += (w.score / 100) * 9 * (w.homeSupport / 100);
      aTarget -= (w.casualtiesRatio || 0) * 16;
      aTarget -= (100 - w.homeSupport) * 0.055;
    });

    // Under repression, measured approval is partly manufactured.
    if (gov.legitimacyFrom === 'fear' || gov.legitimacyFrom === 'force') {
      aTarget = aTarget * 0.55 + (35 + rep * 0.45) * 0.45;
    }
    aTarget = S.clamp(aTarget, 2, 97);
    s.approvalTrue = S.drift(s.approvalTrue == null ? aTarget : s.approvalTrue, aTarget, 2.1 * dt);
    s.approval = s.approvalTrue;
    s.honeymoon = S.drift(s.honeymoon, 0, 1.6 * dt);
    s.scandal = S.drift(s.scandal, 0, 1.1 * dt);

    /* ---- latent resentment: the bill repression defers ---- */
    const repressionExcess = Math.max(0, rep - 45);
    s.latent += (repressionExcess * 0.020 * (gov.latentResentment || 1)
      + Math.max(0, s.inequality - 50) * 0.012
      + Math.max(0, e.inflation - 12) * 0.020
      - (s.approvalTrue - 55) * 0.010
      - st.quality.welfareQ * 0.004) * dt * 10;
    s.latent = S.clamp(s.latent, 0, 100);

    /* ---- unrest ---- */
    let uTarget = 24
      + Math.max(0, s.inequality - 40) * 0.34
      + Math.max(0, e.unemployment - 6) * 1.25
      + Math.max(0, e.inflation - 6) * 1.05
      + Math.max(0, 50 - s.approvalTrue) * 0.42
      + s.latent * 0.40
      + s.corruption * 0.16
      + (st.pop.youthShare - 15) * 0.55
      - st.quality.welfareQ * 0.10
      - st.quality.security * 0.10
      - s.cohesion * 0.10
      - st.quality.culture * 0.03;

    // Educated, connected populations resent unfreedom more.
    uTarget += Math.max(0, (st.quality.education - 55)) * (rep / 100) * 0.30;
    // But visible force does suppress street action in the short run.
    uTarget *= (1 - (rep / 100) * 0.42 * (gov.unrestFromRepression ? (2 - gov.unrestFromRepression) : 1));
    if (gov.unrestFromRepression > 1) uTarget *= 1 + (rep / 100) * (gov.unrestFromRepression - 1) * 0.8;

    st.wars.forEach((w) => { uTarget += (100 - w.homeSupport) * 0.06 + w.intensity * 0.03; });
    uTarget += st.economy.sanctionPressure * 0.10;
    uTarget += S.Aftermath.unrestOffset(st);

    s.unrest = S.drift(s.unrest, S.clamp(uTarget, 0, 100), 1.9 * dt);

    /* ---- cohesion, corruption, inequality, freedom ---- */
    const cohTarget = 46 + (gov.cohesion ? (gov.cohesion - 1) * 40 : 0)
      + st.quality.culture * 0.20 + pol.interior.propaganda * 0.10
      - Math.max(0, s.inequality - 45) * 0.22 - st.wars.length * 2
      + (st.national.prestige - 50) * 0.13 - pol.interior.immigration * 0.05;
    s.cohesion = S.drift(s.cohesion, S.clamp(cohTarget, 5, 98), 0.9 * dt);

    // Percentage points per year — deliberately slow in both directions.
    const corrPerYear = (gov.corruptionDrift || 0) * 70
      - (pol.interior.anticorruption || 0) * 0.012
      + Math.max(0, pol.econ.stateOwnership - 40) * 0.012
      + Math.max(0, pol.econ.subsidies - 40) * 0.010
      - (st.quality.admin - 55) * 0.008
      - (pol.interior.pressFreedom - 50) * 0.008
      + (12 - s.corruption) * 0.045   // no state ever reaches zero
      + (s.unrest > 70 ? 1.2 : 0);
    s.corruption = S.clamp(s.corruption + S.clamp(corrPerYear, -4, 6) * dt, 3, 97);

    const ineqTarget = 30 + (pol.tax.income < 25 ? 12 : 0)
      - (pol.tax.wealth * 2.2) - (st.quality.welfareQ - 50) * 0.24
      - (st.quality.education - 50) * 0.16 + s.corruption * 0.22
      + Math.max(0, pol.econ.stateOwnership - 60) * -0.10
      + (e.informal * 0.16) - (pol.econ.laborProtection - 50) * 0.10
      - (pol.tax.corporate - 20) * 0.14;
    s.inequality = S.drift(s.inequality, S.clamp(ineqTarget, 12, 88), 0.5 * dt);

    const freeTarget = S.clamp(50 + (gov.freedom || 0) + (pol.interior.pressFreedom - 50) * 0.42 +
      (pol.interior.civilLiberties - 50) * 0.44 - pol.interior.surveillance * 0.22, 0, 100);
    s.freedom = S.drift(s.freedom, freeTarget, 1.4 * dt);

    s.crime = S.drift(s.crime, S.clamp(46 - st.quality.security * 0.30 + s.inequality * 0.30 +
      e.unemployment * 0.9 - st.quality.education * 0.16 + e.informal * 0.10, 2, 98), 0.9 * dt);

    s.legitimacy = S.drift(s.legitimacy, S.clamp(Soc.legitimacy(st), 0, 100), 1.5 * dt);

    /* ---- stability ---- */
    const stabTarget = 58 - s.unrest * 0.55 - Soc.factionDanger(st) * 0.35
      + (s.legitimacy - 50) * 0.35 + (st.quality.admin - 50) * 0.20
      + (s.cohesion - 50) * 0.15
      - st.wars.length * 3.2 - Math.max(0, e.inflation - 15) * 0.30;
    s.stability = S.drift(s.stability, S.clamp(stabTarget, 0, 100), 1.6 * dt);

    /* ---- factions ---- */
    Soc.updateFactions(st, dt);

    /* ---- population ---- */
    const p = st.pop;
    const birthPull = 1.9 - st.quality.education * 0.012 - (S.Econ.gdpPerCapita(st) / 60000) +
      (st.policy.social.familyPolicy || 0) * 0.006;
    p.growth = S.drift(p.growth, S.clamp(birthPull - 0.4 + pol.interior.immigration * 0.004, -1.2, 3.2), 0.4 * dt);
    p.total *= 1 + (p.growth / 100) * dt;
    p.urban = S.clamp(p.urban + (0.55 - p.urban / 160) * dt, 5, 100);
    p.workingAge = S.clamp(S.drift(p.workingAge, 66 - Math.max(0, (1.9 - p.growth)) * 4.5, 0.25 * dt), 48, 74);
    p.youthShare = S.clamp(S.drift(p.youthShare, 8 + p.growth * 5.5, 0.25 * dt), 5, 34);

    /* ---- prestige and culture reach ---- */
    const nat = st.national;
    // Economic weight is our share of world output, not an absolute figure —
    // otherwise inflation alone would make us prestigious.
    let foreignGdp = 0;
    st.diplomacy.nations.forEach((n) => { foreignGdp += n.gdp; });
    const share = e.gdpReal / Math.max(1, e.gdpReal + foreignGdp);
    const econWeight = 34 * S.sat(share, 0.15);
    const prestigeTarget = 8
      + econWeight
      + S.clamp(st.military.power, 0, 130) * 0.22
      + st.quality.culture * 0.20
      + st.quality.science * 0.14
      + (s.freedom - 50) * 0.06
      + nat.diplomaticWins * 1.4
      - nat.diplomaticLosses * 1.6
      - e.sanctionPressure * 0.14
      - Math.max(0, s.unrest - 50) * 0.20;
    nat.prestige = S.drift(nat.prestige, S.clamp(prestigeTarget, 2, 100), 0.75 * dt);

    const softTarget = st.quality.culture * 0.44 + st.quality.education * 0.18 +
      (s.freedom - 40) * 0.16 + nat.prestige * 0.20 +
      (st.budget.alloc.culture / S.Econ.BENCHMARK.culture) * 6 - e.sanctionPressure * 0.10;
    nat.softPower = S.drift(nat.softPower, S.clamp(softTarget, 2, 100), 0.7 * dt);
  };

  /* ------------------------------------------------------------ factions */
  Soc.updateFactions = function (st, dt) {
    const pol = st.policy, e = st.economy, q = st.quality, s = st.society;
    const bm = S.Econ.BENCHMARK;
    const targets = {
      military: 46 + (st.budget.alloc.defense / bm.defense - 1) * 26 + st.military.readiness * 0.12
        + (pol.mil.veteranCare - 50) * 0.14 + S.sum(st.wars, (w) => w.score * 0.10)
        - (st.wars.length && st.military.readiness < 45 ? 12 : 0)
        + (pol.mil.doctrine === 'expeditionary' ? 4 : 0) - (s.freedom - 50) * 0.04,
      business: 44 - (pol.tax.corporate - 22) * 0.85 - (pol.econ.regulation - 45) * 0.34
        - (pol.econ.stateOwnership - 25) * 0.42 + (e.businessConfidence - 50) * 0.34
        + (pol.trade.openness - 50) * 0.16 - (pol.tax.wealth * 2.4) + (s.stability - 55) * 0.20,
      labour: 46 - (e.unemployment - 6) * 2.1 - Math.max(0, e.inflation - 4) * 1.3
        + (pol.econ.laborProtection - 50) * 0.34 + (q.welfareQ - 50) * 0.30
        + (pol.tax.wealth * 1.8) - (pol.tax.vat - 16) * 0.55,
      intelligentsia: 42 + (pol.interior.pressFreedom - 50) * 0.42 + (pol.interior.civilLiberties - 50) * 0.36
        + (st.budget.alloc.research / bm.research - 1) * 16 + (st.budget.alloc.education / bm.education - 1) * 14
        - pol.interior.surveillance * 0.20,
      clergy: 46 - (pol.interior.civilLiberties - 50) * 0.20 + (s.cohesion - 50) * 0.26
        + (pol.social.traditionalism || 50) * 0.24 - (q.science - 50) * 0.06 - pol.interior.immigration * 0.08,
      nationalists: 42 + (st.national.prestige - 50) * 0.34 + st.military.power * 0.12
        - pol.interior.immigration * 0.22 - (pol.trade.openness - 50) * 0.14
        + S.sum(st.wars, (w) => w.score * 0.14) - st.national.concessions * 3.2,
      reformers: 44 - (s.corruption - 40) * 0.42 + (s.freedom - 50) * 0.34
        + (q.education - 50) * 0.14 - Math.max(0, e.unemployment - 8) * 1.2
        - pol.interior.surveillance * 0.16,
      provinces: 44 + (st.budget.alloc.infra / bm.infra - 1) * 22 + (pol.social.devolution || 40) * 0.24
        - (s.inequality - 45) * 0.16 + (q.infra - 50) * 0.14
    };
    st.factions.forEach((f) => {
      const t = S.clamp(targets[f.id] != null ? targets[f.id] : 50, 0, 100);
      f.loyalty = S.drift(f.loyalty, t, 0.85 * dt);
      f.loyalty = S.clamp(f.loyalty, 0, 100);
    });
  };

  /* ------------------------------------------------- catastrophe watches */
  Soc.dangerCheck = function (st, dt) {
    const s = st.society, gov = S.govMods(st);
    const rng = st.rng;

    /* --- coup --- */
    const milLoy = Soc.militaryLoyalty(st);
    const milPow = (st.factions.find((f) => f.id === 'military') || {}).power || 50;
    let coupPressure = Math.max(0, 42 - milLoy) * (milPow / 100) * (gov.coupRisk || 1);
    if (s.legitimacy < 35) coupPressure *= 1.5;
    if (st.wars.some((w) => w.score < -35)) coupPressure *= 1.4;
    st.risk.coup = S.clamp(coupPressure * 1.5, 0, 100);
    if (coupPressure > 12 && rng.chance((coupPressure / 100) * 0.30 * dt)) {
      const loyalists = Soc.factionLoyalty(st, 'nationalists') * 0.3 + s.legitimacy * 0.4 + st.intel.strength * 0.3;
      if (loyalists < 42 || rng.chance(0.45)) return S.game.lose('coup');
      S.game.event('A coup attempt was crushed. Loyal units surrounded the plotters before dawn. Purges follow.', 'bad');
      st.factions.forEach((f) => { if (f.id === 'military') { f.loyalty += 8; f.power -= 6; } });
      st.military.readiness -= 8; s.unrest += 6;
      S.News.push(st, 'coup_failed', { severity: 'major' });
    }

    /* --- civil war --- */
    const cwPressure = Math.max(0, s.unrest - 62) * 1.4 + Math.max(0, 32 - s.stability) * 1.2 +
      Math.max(0, 35 - s.legitimacy) * 0.6 + Soc.factionDanger(st) * 0.5;
    st.risk.civilWar = S.clamp(cwPressure, 0, 100);
    if (cwPressure > 55 && !st.flags.civilWarWarned) {
      st.flags.civilWarWarned = true;
      S.game.event('Interior warns: parts of the country are no longer under effective government control.', 'bad');
    }
    if (cwPressure > 70 && rng.chance((cwPressure - 70) / 100 * 0.55 * dt)) {
      if (!st.wars.some((w) => w.type === 'civil')) {
        S.Mil.startCivilWar(st);
      }
    }

    /* --- economic collapse --- */
    const e = st.economy;
    const collapse = Math.max(0, e.inflation - 45) * 0.8 + Math.max(0, e.debtGdp - 150) * 0.2 +
      (e.reserveMonths < 1 ? 20 : 0) + (e.defaultHistory || 0) * 8 + Math.max(0, -e.growth - 4) * 4;
    st.risk.collapse = S.clamp(collapse, 0, 100);
    if (collapse > 75 && rng.chance((collapse - 75) / 100 * 0.5 * dt)) return S.game.lose('collapse');

    /* --- deposed by institutions (democracies only) --- */
    if (gov.legitimacyFrom === 'approval' && s.approval < 16 && s.unrest > 60 &&
      rng.chance(0.22 * dt)) return S.game.lose('deposed');
    return null;
  };

  /* ------------------------------------------------------------ elections */
  Soc.runElection = function (st) {
    const gov = S.govMods(st);
    const rng = st.rng;
    // An election is a choice between you and an alternative, not a referendum
    // on perfection: 50% approval is a comfortable win, not a coin toss.
    const base = st.society.approval;
    const manipulation = gov.legitimacyFrom === 'approval' ? 0 :
      (st.policy.interior.propaganda * 0.22 + Soc.repression(st) * 0.20);
    const oppositionStrength = (Soc.factionLoyalty(st, 'reformers') < 40 ? 3 : 0) +
      (st.society.unrest > 55 ? 4 : 0);
    const incumbency = 5;
    const share = S.clamp(50 + (base - 47) * 0.80 + manipulation + incumbency -
      oppositionStrength + rng.normal(0, 4.5), 2, 98);
    st.national.lastElection = { year: st.date.year, share: S.round(share, 1) };
    if (share < 50) {
      if (gov.legitimacyFrom === 'approval') return S.game.lose('votedout');
      // Autocracies simply declare a result — at a cost.
      st.society.latent += 12; st.society.unrest += 8;
      S.game.event('The published result bears little relation to the count. Observers walked out; the streets noticed.', 'bad');
      S.News.push(st, 'election_stolen', { severity: 'major' });
      return null;
    }
    st.society.honeymoon = 7;
    S.game.event('Returned to office with ' + S.round(share, 1) + '% of the vote. A fresh mandate — and a shorter clock.', 'good');
    S.News.push(st, 'election_won', { severity: 'major', pct: S.round(share, 1) });
    return null;
  };

})(window.S);

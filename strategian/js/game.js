/* STRATEGIAN — game state, the clock, decisions and win/loss conditions */
(function (S) {
  'use strict';

  const G = S.game = {};

  // Two running speeds only. Anything faster and matters arrived and expired
  // before they could be read, which made the clock the opponent.
  G.SPEEDS = [0, 1100, 560]; // ms per in-game day; index 0 = paused
  G.SPEED_NAMES = ['❚❚', '▶', '▶▶'];
  G.SPEED_TITLES = ['Pause', 'Normal', 'Fast'];
  G.MAX_INBOX = 5;
  G.SAVE_KEY = 'strategian.save.v1';

  S.govMods = function (st) {
    const g = S.GOVERNMENTS.find((x) => x.id === st.nation.governmentId);
    return g ? g.mods : {};
  };
  S.gov = function (st) {
    return S.GOVERNMENTS.find((x) => x.id === st.nation.governmentId) || S.GOVERNMENTS[0];
  };

  /* ==================================================== NEW GAME SETUP */
  G.newGame = function (cfg) {
    const arch = S.ARCHETYPES.find((a) => a.id === cfg.archetypeId) || S.ARCHETYPES[0];
    const govDef = S.GOVERNMENTS.find((g) => g.id === cfg.governmentId) || S.GOVERNMENTS[0];
    const seed = cfg.seed || (Date.now() & 0x7fffffff);
    const rng = S.makeRng(seed);
    const startYear = 2027;

    const st = {
      version: 1, seed: seed, rng: rng,
      startYear: startYear,
      date: { day: 1, month: 0, year: startYear, dayOfYear: 1 },
      speed: 0, autoPause: true, lastSpeed: 1,
      nation: {
        name: cfg.nationName || arch.name,
        leader: cfg.leaderName || 'Alvara Denn',
        leaderTitle: S.LEADER_TITLES[govDef.id] || 'Leader',
        archetypeId: arch.id, governmentId: govDef.id,
        region: arch.id === 'hegemon' ? 'West' : arch.id === 'continental' ? 'North' :
          arch.id === 'rising' ? 'South' : arch.id === 'petro' ? 'Gulf' : 'Crossroads'
      },
      pop: {
        total: arch.pop, growth: arch.pop > 500 ? 1.1 : arch.pop < 40 ? 0.5 : 0.7,
        urban: arch.urban, workingAge: 64, youthShare: arch.pop > 500 ? 20 : 15
      },
      economy: {
        gdp: arch.gdp, gdpReal: arch.gdp, potential: arch.economy.growth,
        growth: arch.economy.growth, inflation: arch.economy.inflation,
        unemployment: arch.economy.unemployment, productivity: arch.economy.productivity,
        currencyName: cfg.currencyName || arch.currency.name,
        currencySymbol: cfg.currencySymbol || arch.currency.symbol,
        fx: 100, fxTarget: 100, pegStrain: 0,
        debt: arch.gdp * arch.economy.debtGdp / 100, debtGdp: arch.economy.debtGdp,
        deficit: 0, revenue: 0, spending: 0, debtService: 0,
        avgDebtRate: Math.min(arch.economy.rate * 0.4 + 1.0, 6.5),
        reserves: arch.gdp * (arch.economy.reserveStatus / 100) * 0.16 + arch.gdp * 0.02,
        reserveStatus: arch.economy.reserveStatus, reserveMonths: 4,
        creditScore: 60, creditRating: 'BBB', riskPremium: 2, bondYield: arch.economy.rate + 2,
        marketIndex: 100, businessConfidence: 52, consumerConfidence: 50,
        exports: arch.gdp * 0.2, imports: arch.gdp * 0.2, tradeBalance: 0,
        informal: S.clamp(78 - arch.economy.productivity * 0.78, 4, 62),
        sectors: G.sectorsFor(arch),
        sanctionPressure: arch.tags.indexOf('Under sanctions') >= 0 ? 45 : 0,
        energyImportDep: 20, marketAccess: 0.6, shock: 0,
        swf: arch.id === 'petro' ? arch.gdp * 0.6 : null,
        defaultHistory: arch.id === 'developing' || arch.id === 'postconflict' ? 1 : 0,
        revenueBreakdown: {}, programSpending: 0, warSpending: 0
      },
      quality: {
        education: arch.society.education, health: arch.society.health, infra: arch.society.infra,
        science: arch.tech, culture: arch.society.culture, security: 50,
        energy: 45 + arch.society.infra * 0.2, admin: S.clamp(85 - arch.society.corruption * 0.6, 10, 95),
        welfareQ: S.clamp(arch.society.health * 0.6 + 20, 5, 95)
      },
      society: {
        approval: arch.society.approval, approvalTrue: arch.society.approval,
        unrest: S.clamp(60 - arch.society.stability * 0.6, 3, 90),
        stability: arch.society.stability, corruption: arch.society.corruption,
        freedom: arch.society.freedom, inequality: arch.society.inequality,
        latent: 10, repression: 0, legitimacy: 55, cohesion: 55,
        crime: S.clamp(70 - arch.society.stability * 0.5, 5, 95),
        honeymoon: 6, scandal: 0
      },
      national: {
        prestige: arch.prestige, softPower: arch.society.culture * 0.7 + 10,
        diplomaticWins: 0, diplomaticLosses: 0, concessions: 0,
        aggressionScore: 0, warsWon: 0, warsLost: 0, lastElection: null
      },
      military: {
        manpower: arch.military.manpower, equipment: arch.military.equipment,
        readiness: arch.military.readiness, tech: arch.tech * 0.85,
        morale: 55, logistics: 40 + arch.society.infra * 0.4, veterancy: 25,
        nuclear: arch.military.nuclear, quality: 50, power: 10, spendAbs: 0,
        nuclearPosture: arch.military.nuclear > 60 ? 'assured' : arch.military.nuclear > 10 ? 'minimal' : 'renounced'
      },
      intel: {
        strength: arch.intel, accuracy: 0.5, coverage: arch.intel,
        ops: [], compartmented: false
      },
      policy: G.defaultPolicy(arch),
      budget: { alloc: G.defaultBudget(arch) },
      factions: S.FACTIONS.map((f) => ({
        id: f.id,
        power: G.factionPower(f.id, arch, govDef),
        loyalty: G.factionLoyalty(f.id, arch, govDef)
      })),
      diplomacy: { nations: [], treaties: [] },
      world: {
        oil: 100, grain: 100, growth: 2.7, inflation: 2.6, rate: 3.2, market: 100,
        tension: 32, climate: 30, techLevel: 100, globalWars: 0
      },
      wars: [], foreignWars: [],
      scars: [], scheduled: [], programmes: [], actionCooldown: {}, rulings: {},
      autoPaused: false, resumeSpeed: 1,
      inbox: [], headlines: [], log: [], news: {},
      flags: { aidRecipient: arch.tags.indexOf('Aid dependent') >= 0 || arch.tags.indexOf('IMF programme') >= 0 },
      counters: { decisionCooldown: {} },
      risk: { coup: 0, civilWar: 0, collapse: 0 },
      victoryProgress: {}, peaceStreak: 0,
      negotiation: null, ended: null,
      settings: { autoPause: true, autoResume: true, theme: cfg.theme || 'dark' }
    };

    // Foreign powers.
    st.diplomacy.nations = S.WORLD_NATIONS.map((n) => {
      const defenseShare = n.ideology === 'authoritarian' || n.ideology === 'party' ? 3.6 :
        n.ideology === 'liberal' ? 2.0 : 2.5;
      return {
        id: n.id, name: n.name, adj: n.adj, color: n.color, region: n.region,
        power: n.power, ideology: n.ideology, personality: n.personality,
        gdp: n.gdp, nuclear: n.nuclear, nuclearLevel: n.nuclear ? 60 + rng.range(0, 30) : 0,
        notes: n.notes,
        defenseShare: defenseShare, milQuality: 35 + n.power * 0.55, manpower: n.gdp / 2400,
        milPower: 10,
        relation: 0, relationTarget: 0, affinity: 20, threatPerception: 20,
        trust: 50, grievance: 0, tradeVolume: 0, tradeStatus: 'normal',
        treaties: [], allyOfUs: false, atWar: false, sanctioningUs: false,
        stance: 'neutral', cooldown: 0, blocOf: null, warSupport: 1
      };
    });

    // Opening relations reflect ideology and archetype.
    st.diplomacy.nations.forEach((n) => {
      const gap = S.Dip.ideologyGap(st, n);
      n.relation = S.clamp(30 - gap * 0.65 + rng.range(-12, 12), -80, 80);
      n.affinity = S.clamp(20 + (arch.society.culture - 40) * 0.35 - gap * 0.15, 0, 80);
      if (st.economy.sanctionPressure > 20 && (n.ideology === 'liberal' || n.ideology === 'democratic')) {
        n.sanctioningUs = true; n.relation -= 30;
      }
      n.tradeVolume = st.economy.gdp * 0.006 * (n.gdp / 4000);
    });

    S.Mil.recomputeForeign(st);
    S.Mil.recompute(st);
    S.Econ.updateTrade(st);

    if (arch.startWars.indexOf('insurgency') >= 0) {
      S.Mil.startInsurgency(st, 'The Northern Insurgency');
    }

    // Content cadence is measured from today, not from year zero, so nothing
    // fires on the first tick.
    G.buildRoster(st);
    const day0 = S.absDay(st.date);
    st.counters.lastDecisionDay = day0 + 4;
    st.counters.lastEventDay = day0 + 12;
    st.counters.lastAmbientDay = day0;

    G.state = st;
    S.game.state = st;

    // Seed the news feed so the first screen is not empty.
    S.News.custom(st, st.nation.leaderTitle + ' ' + st.nation.leader + ' Takes Office', 'good',
      'A new administration inherits ' + (st.economy.debtGdp > 90 ? 'a debt problem' :
        st.society.unrest > 45 ? 'a restive country' : 'a country waiting to see'));
    for (let i = 0; i < 3; i++) S.News.ambient(st);
    G.event('You have taken office. The country is yours to run.', 'good');
    return st;
  };

  G.sectorsFor = function (arch) {
    const map = {
      hegemon: { agri: 1, industry: 18, services: 62, resources: 5, tech: 14 },
      continental: { agri: 5, industry: 30, services: 40, resources: 21, tech: 4 },
      industrial: { agri: 1, industry: 30, services: 55, resources: 2, tech: 12 },
      rising: { agri: 16, industry: 26, services: 46, resources: 6, tech: 6 },
      petro: { agri: 2, industry: 14, services: 40, resources: 42, tech: 2 },
      entrepot: { agri: 0, industry: 18, services: 66, resources: 1, tech: 15 },
      developing: { agri: 22, industry: 22, services: 44, resources: 10, tech: 2 },
      postconflict: { agri: 34, industry: 14, services: 40, resources: 11, tech: 1 }
    };
    return map[arch.id] || map.developing;
  };

  G.defaultPolicy = function (arch) {
    const dev = arch.gdp / arch.pop; // per-capita output, in thousands
    const rich = dev > 20;
    // Fiscal capacity rises with development — poor states cannot collect
    // income tax at European rates however much they might like to.
    const cap = S.sat(dev, 25);
    const petro = arch.id === 'petro';
    return {
      tax: {
        income: petro ? 10 : S.round(20 + 22 * cap, 0),
        corporate: petro ? 12 : (rich ? 24 : 26),
        vat: petro ? 6 : S.round(11 + 10 * cap, 0),
        wealth: rich ? 0.6 : 0.2
      },
      monetary: {
        rate: arch.economy.rate, emission: 50, regime: arch.id === 'petro' ? 'peg' : 'float',
        capitalControls: arch.id === 'continental' || arch.id === 'postconflict' ? 35 : 8
      },
      econ: {
        stateOwnership: arch.id === 'continental' ? 45 : arch.id === 'petro' ? 55 : arch.id === 'postconflict' ? 30 : 18,
        regulation: rich ? 52 : 44, laborProtection: rich ? 58 : 40,
        subsidies: arch.id === 'petro' ? 62 : arch.id === 'developing' ? 45 : 25,
        priceControls: false
      },
      trade: { tariff: rich ? 3 : 11, openness: rich ? 72 : 50 },
      mil: {
        conscription: arch.military.manpower > 0.8 ? 45 : 10,
        doctrine: arch.military.doctrine,
        nuclearPosture: arch.military.nuclear > 60 ? 'assured' : arch.military.nuclear > 10 ? 'minimal' : 'renounced',
        readinessTarget: arch.military.readiness, rndShare: rich ? 22 : 10, veteranCare: rich ? 55 : 32
      },
      interior: {
        policing: 45, surveillance: S.clamp(70 - arch.society.freedom * 0.6, 10, 90),
        pressFreedom: arch.society.freedom, civilLiberties: arch.society.freedom,
        propaganda: S.clamp(60 - arch.society.freedom * 0.5, 5, 80),
        immigration: rich ? 45 : 25, anticorruption: 30
      },
      social: {
        eduUniversity: 30, traditionalism: S.clamp(70 - arch.society.education * 0.4, 15, 85),
        devolution: 35, familyPolicy: 30
      },
      energy: { transition: rich ? 35 : 15, reserves: 40 },
      foreign: {
        stance: arch.id === 'hegemon' ? 'interventionist' : arch.id === 'entrepot' ? 'engaged' : 'defensive',
        aid: rich ? 30 : 8
      }
    };
  };

  G.defaultBudget = function (arch) {
    const b = {};
    for (const m in S.Econ.BENCHMARK) b[m] = S.Econ.BENCHMARK[m];
    const dev = arch.gdp / arch.pop;
    const poor = dev < 8;
    b.defense = arch.military.manpower * 1.25 + arch.military.equipment * 0.018;
    b.defense = S.clamp(b.defense, 0.9, 6.5);
    if (poor) {
      b.welfare *= 0.32; b.health *= 0.55; b.education *= 0.7; b.research *= 0.35;
      b.culture *= 0.5; b.foreign *= 0.4; b.energy *= 0.7; b.admin *= 0.85;
    }
    if (arch.id === 'petro') { b.welfare *= 1.2; b.energy *= 1.4; b.research *= 0.6; }
    if (arch.id === 'continental') { b.welfare *= 0.72; b.health *= 0.68; b.education *= 0.8; b.research *= 0.7; }
    if (arch.id === 'entrepot') {
      // A small, efficient state with no hinterland and a young population.
      for (const k in b) b[k] *= 0.66;
      b.defense = 2.9; b.infra *= 1.5; b.education *= 1.4; b.admin *= 1.3;
    }
    if (arch.id === 'rising') { b.welfare *= 0.85; b.infra *= 1.15; }
    if (arch.id === 'postconflict') { b.interior *= 1.6; b.infra *= 0.6; b.welfare *= 0.8; }
    // Rich, well-run states start above benchmark — which is why their public
    // services are good, and why letting them slip to benchmark is a choice.
    if (dev > 30) { b.education *= 1.25; b.health *= 1.15; b.research *= 1.3; b.admin *= 1.1; }
    b.intel = S.clamp(arch.intel * 0.008, 0.12, 1.1);
    for (const k in b) b[k] = S.round(b[k], 2);
    return b;
  };

  G.factionPower = function (id, arch, govDef) {
    const base = {
      military: 45, business: 55, labour: 45, intelligentsia: 40,
      clergy: 35, nationalists: 40, reformers: 35, provinces: 40
    }[id];
    let p = base;
    if (govDef.id === 'junta' && id === 'military') p += 35;
    if (govDef.id === 'theocratic' && id === 'clergy') p += 35;
    if (govDef.id === 'party' && id === 'labour') p += 10;
    if (govDef.id === 'liberal' && (id === 'intelligentsia' || id === 'reformers')) p += 12;
    if (govDef.id === 'technocracy' && id === 'intelligentsia') p += 20;
    if (arch.society.education > 75 && (id === 'intelligentsia' || id === 'reformers')) p += 8;
    if (arch.society.education < 45 && id === 'clergy') p += 12;
    if (arch.gdp / arch.pop > 25 && id === 'business') p += 10;
    if (arch.id === 'postconflict' && id === 'military') p += 20;
    if (arch.pop > 300 && id === 'provinces') p += 12;
    return S.clamp(p, 10, 100);
  };

  G.factionLoyalty = function (id, arch, govDef) {
    let l = 55;
    if (govDef.id === 'junta' && id === 'military') l += 25;
    if (govDef.id === 'theocratic' && id === 'clergy') l += 25;
    if (govDef.id === 'liberal' && (id === 'reformers' || id === 'intelligentsia')) l += 12;
    if (govDef.id === 'personalist' && id === 'reformers') l -= 20;
    if (arch.society.corruption > 60 && id === 'reformers') l -= 15;
    if (arch.society.freedom < 35 && id === 'intelligentsia') l -= 15;
    return S.clamp(l + (arch.society.approval - 50) * 0.3, 10, 92);
  };

  /* ============================================================== CLOCK */
  G.timer = null;
  G.setSpeed = function (s) {
    const st = G.state;
    if (!st || st.ended) return;
    st.speed = s;
    if (s > 0) st.lastSpeed = s;
    if (G.timer) { clearInterval(G.timer); G.timer = null; }
    if (s > 0) G.timer = setInterval(G.tick, G.SPEEDS[s]);
    if (S.UI) S.UI.refreshTopbar();
  };
  G.togglePause = function () {
    const st = G.state; if (!st) return;
    // A deliberate pause is yours to undo; it clears the automatic one.
    st.autoPaused = false;
    G.setSpeed(st.speed > 0 ? 0 : (st.lastSpeed || 1));
  };
  /* The clock stops itself for anything urgent and starts itself again once
     you have dealt with it, so the only pauses you manage are your own. */
  G.pauseForDecision = function () {
    const st = G.state;
    if (!st || !st.settings.autoPause || st.speed === 0) return;
    st.autoPaused = true;
    st.resumeSpeed = st.speed;
    G.setSpeed(0);
  };

  G.resumeAfterDecision = function () {
    const st = G.state;
    if (!st || st.ended || !st.autoPaused) return;
    if (!st.settings.autoResume) return;
    // Stay stopped while anything urgent is still outstanding, or while a
    // negotiation is open — those are deliberately turn-based.
    if (st.negotiation) return;
    if (st.inbox.some((i) => i.urgency === 'urgent')) return;
    st.autoPaused = false;
    if (st.speed === 0) G.setSpeed(st.resumeSpeed || st.lastSpeed || 1);
  };

  /* --------------------------------------------------------------- tick */
  G.tick = function () {
    const st = G.state;
    if (!st || st.ended) return;
    const dt = 1 / 365;

    // advance the calendar
    const d = st.date;
    d.day++; d.dayOfYear++;
    const dim = S.DAYS_IN_MONTH[d.month] + (d.month === 1 && d.year % 4 === 0 ? 1 : 0);
    if (d.day > dim) { d.day = 1; d.month++; }
    if (d.month > 11) { d.month = 0; d.year++; d.dayOfYear = 1; G.onNewYear(st); }

    // simulation
    S.Econ.worldTick(st, dt);
    S.Econ.tick(st, dt);
    S.Soc.tick(st, dt);
    S.Mil.tick(st, dt);
    S.Dip.tick(st, dt);
    S.Actions.programmeTick(st, dt);
    S.Aftermath.tick(st, dt);
    G.updateIntel(st, dt);

    if (d.day === 1) G.onNewMonth(st);

    // content cadence
    const abs = S.absDay(d);
    if (abs - st.counters.lastDecisionDay >= G.decisionInterval(st) && st.inbox.length < G.MAX_INBOX) {
      st.counters.lastDecisionDay = abs;
      G.rollDecision(st);
    }
    if (abs - st.counters.lastEventDay >= st.rng.int(30, 55)) {
      st.counters.lastEventDay = abs;
      G.rollEvent(st);
    }
    if (abs - st.counters.lastAmbientDay >= st.rng.int(6, 13)) {
      st.counters.lastAmbientDay = abs;
      S.News.ambient(st);
    }

    // deadlines
    for (let i = st.inbox.length - 1; i >= 0; i--) {
      const item = st.inbox[i];
      item.daysLeft--;
      if (item.daysLeft <= 0) {
        st.inbox.splice(i, 1);
        G.resolveDefault(st, item);
      }
    }

    G.clampState(st);
    S.News.watch(st);
    const dead = S.Soc.dangerCheck(st, dt);
    if (dead) return;
    G.checkVictory(st);

    // record history for charts, weekly
    if (abs % 7 === 0) G.recordHistory(st);

    if (S.UI) S.UI.onTick();
  };

  /* Decisions and events write directly into the state, so everything that is
     nominally a 0–100 index gets pulled back into range once per day. */
  G.clampState = function (st) {
    const s = st.society;
    ['approval', 'approvalTrue', 'unrest', 'stability', 'corruption', 'freedom',
      'inequality', 'latent', 'legitimacy', 'cohesion', 'crime', 'repression'].forEach((k) => {
        if (typeof s[k] === 'number') s[k] = S.clamp(s[k], 0, 100);
      });
    st.national.prestige = S.clamp(st.national.prestige, 0, 100);
    st.national.softPower = S.clamp(st.national.softPower, 0, 100);
    st.national.concessions = Math.max(0, st.national.concessions);
    for (const k in st.quality) st.quality[k] = S.clamp(st.quality[k], 0, 100);
    ['readiness', 'morale', 'equipment', 'tech', 'logistics', 'veterancy', 'nuclear']
      .forEach((k) => { st.military[k] = S.clamp(st.military[k], 0, 100); });
    st.military.manpower = Math.max(0.001, st.military.manpower);
    st.intel.strength = S.clamp(st.intel.strength, 0, 100);
    st.world.tension = S.clamp(st.world.tension, 0, 100);
    st.world.climate = S.clamp(st.world.climate, 0, 100);
    st.economy.reserves = Math.max(0, st.economy.reserves);
    st.economy.gdp = Math.max(0.5, st.economy.gdp);
    st.economy.gdpReal = Math.max(0.5, st.economy.gdpReal);
    st.pop.total = Math.max(0.05, st.pop.total);
    for (const m in st.budget.alloc) st.budget.alloc[m] = S.clamp(st.budget.alloc[m], 0, 30);
    for (const g in st.policy) {
      for (const k in st.policy[g]) {
        const v = st.policy[g][k];
        if (typeof v !== 'number') continue;
        if (g === 'tax' && k === 'wealth') st.policy[g][k] = S.clamp(v, 0, 12);
        else if (g === 'monetary' && k === 'rate') st.policy[g][k] = S.clamp(v, 0, 40);
        else st.policy[g][k] = S.clamp(v, 0, 100);
      }
    }
    st.factions.forEach((f) => { f.loyalty = S.clamp(f.loyalty, 0, 100); f.power = S.clamp(f.power, 5, 100); });
    st.diplomacy.nations.forEach((n) => {
      n.relation = S.clamp(n.relation, -100, 100);
      n.affinity = S.clamp(n.affinity, 0, 100);
      n.grievance = S.clamp(n.grievance || 0, 0, 100);
    });
    st.wars.forEach((w) => {
      w.intensity = S.clamp(w.intensity, 5, 100);
      w.homeSupport = S.clamp(w.homeSupport, 0, 100);
      w.score = S.clamp(w.score, -100, 100);
    });
  };

  G.decisionInterval = function (st) {
    // Crises come faster; calm periods breathe. A busy desk is the point —
    // what keeps it from exhausting the library is the size of the library.
    let base = 15;
    if (st.wars.length) base -= 3;
    if (st.society.unrest > 55) base -= 2;
    if (st.society.stability > 75 && !st.wars.length) base += 5;
    return S.clamp(base + st.rng.int(-4, 7), 6, 30);
  };

  G.updateIntel = function (st, dt) {
    const ratio = st.budget.alloc.intel / S.Econ.BENCHMARK.intel;
    const gov = S.govMods(st);
    const target = S.clamp(18 + 46 * Math.pow(S.clamp(ratio, 0, 3), 0.5) *
      (0.6 + 0.4 * st.quality.admin / 70) * (gov.intelPenalty || 1) +
      st.policy.interior.surveillance * 0.12, 3, 100);
    st.intel.strength = S.drift(st.intel.strength, target, 0.6 * dt);
    const sharing = st.diplomacy.nations.filter((n) => n.treaties.indexOf('intel') >= 0).length;
    st.intel.accuracy = S.clamp(0.22 + st.intel.strength / 150 + sharing * 0.04 -
      (st.intel.compartmented ? -0.04 : 0), 0.15, 0.96);
  };

  G.recordHistory = function (st) {
    st.history = st.history || {
      gdp: [], growth: [], inflation: [], unemployment: [], debtGdp: [], fx: [],
      market: [], approval: [], unrest: [], stability: [], prestige: [], milPower: [],
      tension: [], softPower: [], deficit: [], oil: [], labels: []
    };
    const h = st.history;
    S.pushHistory(h.gdp, S.round(st.economy.gdpReal, 1));
    S.pushHistory(h.growth, S.round(st.economy.growth, 2));
    S.pushHistory(h.inflation, S.round(st.economy.inflation, 2));
    S.pushHistory(h.unemployment, S.round(st.economy.unemployment, 2));
    S.pushHistory(h.debtGdp, S.round(st.economy.debtGdp, 1));
    S.pushHistory(h.fx, S.round(st.economy.fx, 2));
    S.pushHistory(h.market, S.round(st.economy.marketIndex, 1));
    S.pushHistory(h.approval, S.round(st.society.approval, 1));
    S.pushHistory(h.unrest, S.round(st.society.unrest, 1));
    S.pushHistory(h.stability, S.round(st.society.stability, 1));
    S.pushHistory(h.prestige, S.round(st.national.prestige, 1));
    S.pushHistory(h.softPower, S.round(st.national.softPower, 1));
    S.pushHistory(h.milPower, S.round(st.military.power, 2));
    S.pushHistory(h.tension, S.round(st.world.tension, 1));
    S.pushHistory(h.deficit, S.round((st.economy.deficit / st.economy.gdp) * 100, 2));
    S.pushHistory(h.oil, S.round(st.world.oil, 1));
    S.pushHistory(h.labels, S.MONTHS_SHORT[st.date.month] + ' ' + String(st.date.year).slice(2));
  };

  G.onNewMonth = function (st) {
    S.Dip.monthlyMoves(st);
    // The rest of the world grows too, so relative weight stays meaningful.
    st.diplomacy.nations.forEach((n) => {
      n.gdp *= 1 + (st.world.growth + (n.gdp < 2000 ? 1.4 : 0)) / 100 / 12;
    });
    if (st.date.month === 0) G.autosave();
  };

  G.onNewYear = function (st) {
    const gov = S.govMods(st);
    st.counters.yearsInOffice = (st.counters.yearsInOffice || 0) + 1;
    if (gov.elections && (st.counters.yearsInOffice + 1) % gov.elections === 0) {
      G.pushDecision('election_approaching', {});
    }
    if (gov.elections && st.counters.yearsInOffice % gov.elections === 0) {
      G.event('Election year. The country will decide whether to keep you.', '');
      S.Soc.runElection(st);
    }
    if (st.counters.yearsInOffice % 6 === 0) G.refreshRoster(st);
    // Peace tracking for the world-peace victory.
    if (st.world.tension <= 15 && !st.wars.length && (st.world.globalWars || 0) === 0) st.peaceStreak++;
    else st.peaceStreak = 0;
    G.autosave();
  };

  /* ========================================================== DECISIONS */
  /* Every world deals from its own deck. Without this, a small pool plus a
     fixed cooldown produced a near-complete rotation of the whole library
     every couple of years, identical in content across playthroughs. */
  G.ROSTER_SHARE = 0.72;

  G.buildRoster = function (st) {
    const pool = S.Decisions.LIB.filter((d) => !d.dynamic);
    const core = pool.filter((d) => d.core).map((d) => d.id);
    const rest = st.rng.shuffle(pool.filter((d) => !d.core)).map((d) => d.id);
    const keep = Math.max(12, Math.round(pool.length * G.ROSTER_SHARE) - core.length);
    st.roster = core.concat(rest.slice(0, keep));
    st.rosterOut = rest.slice(keep);
  };

  // Over a long game the roster turns over, so the back half is not the
  // same deck as the front half.
  G.refreshRoster = function (st) {
    if (!st.roster || !st.rosterOut || !st.rosterOut.length) return;
    const swaps = Math.max(1, Math.round(st.roster.length * 0.12));
    for (let i = 0; i < swaps; i++) {
      if (!st.rosterOut.length) break;
      const outIdx = st.rng.int(0, st.roster.length - 1);
      const inIdx = st.rng.int(0, st.rosterOut.length - 1);
      const leaving = st.roster[outIdx];
      const def = S.Decisions.BY_ID[leaving];
      if (def && def.core) continue;
      st.roster[outIdx] = st.rosterOut[inIdx];
      st.rosterOut[inIdx] = leaving;
    }
  };

  G.rollDecision = function (st) {
    const abs = S.absDay(st.date);
    if (!st.roster) G.buildRoster(st);
    const gaps = st.counters.decisionGap = st.counters.decisionGap || {};
    const candidates = S.Decisions.LIB.filter((d) => {
      if (d.dynamic) return false;
      if (st.roster.indexOf(d.id) < 0) return false;
      const cd = st.counters.decisionCooldown[d.id];
      // Recurrence is spaced unevenly, so nothing comes back on a metronome.
      if (cd && abs - cd < (gaps[d.id] || 1100)) return false;
      if (st.inbox.some((i) => i.def.id === d.id)) return false;
      const w = typeof d.weight === 'function' ? d.weight(st) : (d.weight || 5);
      return w > 0;
    });
    if (!candidates.length) return;
    // A per-draw jitter on top of the weight, so relevance shapes the order
    // without dictating it.
    const pick = st.rng.weighted(candidates, (d) => {
      const w = typeof d.weight === 'function' ? d.weight(st) : d.weight;
      return Math.max(0.5, w) * st.rng.range(0.45, 1.75);
    });
    if (pick) {
      gaps[pick.id] = st.rng.int(700, 1900);
      G.pushDecision(pick.id, {});
    }
  };

  G.pushDecision = function (id, ctx) {
    const st = G.state;
    const def = S.Decisions.BY_ID[id];
    if (!def) return null;
    if (st.inbox.length >= G.MAX_INBOX + 3) return null;
    // A matter concerning a state that no longer exists is not a matter.
    if (ctx && ctx.nation) {
      const cn = S.dip(st, ctx.nation);
      if (cn && cn.absorbedBy) return null;
    }
    if (st.inbox.some((i) => i.def.id === id && JSON.stringify(i.ctx) === JSON.stringify(ctx || {}))) return null;
    const item = {
      uid: S.uid('dec'), def: def, ctx: ctx || {},
      daysLeft: def.deadline || 20,
      arrived: S.dateLabel(st.date), arrivedDay: S.absDay(st.date),
      urgency: def.urgency || 'routine'
    };
    st.inbox.push(item);
    st.counters.decisionCooldown[id] = S.absDay(st.date);
    if (item.urgency === 'urgent') G.pauseForDecision();
    if (S.UI) S.UI.onNewDecision(item);
    return item;
  };

  G.availableOptions = function (st, item) {
    return item.def.options.filter((o) => !o.requires || o.requires(st));
  };

  G.resolveDecision = function (item, option) {
    const st = G.state;
    const idx = st.inbox.indexOf(item);
    if (idx >= 0) st.inbox.splice(idx, 1);
    G.applyOption(st, item, option);
  };

  G.resolveDefault = function (st, item) {
    // Inaction is a decision — the machine picks the most passive course
    // available, never one that would commit you to talks or a gamble.
    const opts = G.availableOptions(st, item);
    const weight = (o) => {
      let w = 0;
      for (const k in (o.effects || {})) w += Math.abs(o.effects[k]);
      for (const k in (o.factions || {})) w += Math.abs(o.factions[k]) * 0.5;
      if (o.risk) w += 40;
      if (o.opensNegotiation) w += 200;
      if (o.fn) w += 8;
      return w;
    };
    const option = item.def.onIgnore != null ? opts[item.def.onIgnore]
      : opts.slice().sort((a, b) => weight(a) - weight(b))[0];
    G.event('No decision was taken on "' + item.def.title + '". The default course was followed.', 'bad');
    st.society.approval -= 1.2;
    st.quality.admin -= 0.4;
    if (option) G.applyOption(st, item, option, true);
  };

  /* The numbers on an option are the ministry's estimate, not a contract.
     How close the outcome lands depends on the quality of the people who
     produced the estimate — which is one more reason to fund them. Policy
     settings and budget lines are exempt: those are levers you pull
     yourself, not results you hope for. */
  G.effectNoise = function (st) {
    const sd = 0.26 * (1 - S.clamp(st.quality.admin, 0, 100) / 170);
    return S.clamp(1 + st.rng.normal(0, sd), 0.55, 1.45);
  };

  G.applyOption = function (st, item, option, silent) {
    if (!option) return;
    const noise = G.effectNoise(st);
    // numeric effects
    if (option.effects) {
      for (const path in option.effects) {
        const isLever = path.indexOf('policy.') === 0 || path.indexOf('budget.') === 0;
        const delta = isLever ? option.effects[path] : option.effects[path] * noise;
        if (path.indexOf('budget.alloc.') === 0) {
          const key = path.split('.')[2];
          st.budget.alloc[key] = S.clamp((st.budget.alloc[key] || 0) + delta, 0, 30);
        } else if (path.indexOf('policy.') === 0) {
          const cur = S.getPath(st, path);
          if (typeof cur === 'number') S.setPath(st, path, S.clamp(cur + delta, 0, path.indexOf('tax.wealth') > 0 ? 12 : 100));
        } else {
          S.addPath(st, path, delta);
        }
      }
    }
    if (option.factions) {
      for (const fid in option.factions) {
        const f = st.factions.find((x) => x.id === fid);
        if (f) f.loyalty = S.clamp(f.loyalty + option.factions[fid] * noise, 0, 100);
      }
    }
    if (option.fn) { try { option.fn(st, item.ctx); } catch (e) { console.warn(e); } }

    let riskFired = false;
    if (option.risk && st.rng.chance(option.risk.p)) {
      riskFired = true;
      try { option.risk.fn(st, item.ctx); } catch (e) { console.warn(e); }
      G.event('Consequence: ' + option.risk.text + '.', 'bad');
    }

    // clamp the commonly-abused values
    st.society.approval = S.clamp(st.society.approval, 1, 99);
    st.society.approvalTrue = st.society.approval;
    st.society.unrest = S.clamp(st.society.unrest, 0, 100);
    st.national.prestige = S.clamp(st.national.prestige, 0, 100);
    st.intel.strength = S.clamp(st.intel.strength, 0, 100);
    st.military.readiness = S.clamp(st.military.readiness, 0, 100);

    // The record of what you decided, so later matters can refer back to it.
    st.rulings = st.rulings || {};
    st.rulings[item.def.id] = {
      i: item.def.options.indexOf(option), label: option.label,
      day: S.absDay(st.date), year: st.date.year
    };

    // Consequences that were always going to arrive later.
    if (option.then) {
      const chain = Array.isArray(option.then) ? option.then : [option.then];
      chain.forEach((t) => {
        if (t.chance != null && !st.rng.chance(t.chance)) return;
        const ctx = Object.assign({}, item.ctx, t.ctx || {});
        S.Aftermath.schedule(st, t.id, ctx, t.days || 400);
      });
    }

    if (option.headline) S.News.custom(st, option.headline, option.tone || '');
    if (!silent) {
      st.log.unshift({
        date: S.dateLabel(st.date), title: item.def.title, choice: option.label,
        cat: item.def.cat, risk: riskFired ? option.risk.text : null
      });
      if (st.log.length > 300) st.log.length = 300;
    }

    if (option.opensNegotiation) {
      const spec = option.opensNegotiation(st, item.ctx);
      if (spec) {
        S.Nego.open(st, spec.kind, spec.nation, spec.ctx);
        G.setSpeed(0);
        if (S.UI) S.UI.openNegotiation();
      }
    }
    G.resumeAfterDecision(st);
    if (S.UI) S.UI.onTick(true);
  };

  /* ============================================================= EVENTS */
  G.rollEvent = function (st) {
    const cands = S.Events.LIB.filter((e) => (typeof e.weight === 'function' ? e.weight(st) : e.weight) > 0);
    const pick = st.rng.weighted(cands, (e) => (typeof e.weight === 'function' ? e.weight(st) : e.weight));
    if (!pick) return;
    let text = null;
    try { text = pick.fire(st); } catch (e) { console.warn(e); }
    if (text) G.event(text, '');
  };

  G.event = function (text, tone) {
    const st = G.state;
    if (!st) return;
    st.log.unshift({ date: S.dateLabel(st.date), event: text, tone: tone || '' });
    if (st.log.length > 300) st.log.length = 300;
    if (S.UI) S.UI.onEvent(text, tone);
  };

  /* ==================================================== GOVERNMENT CHANGE */
  G.changeGovernment = function (st, newId) {
    if (st.nation.governmentId === newId) return;
    const old = S.gov(st);
    st.nation.governmentId = newId;
    st.nation.leaderTitle = S.LEADER_TITLES[newId] || 'Leader';
    const g = S.gov(st);
    st.society.legitimacy = S.clamp(st.society.legitimacy - 12, 0, 100);
    st.society.stability -= 6;
    st.counters.yearsInOffice = 0;
    G.event('The constitutional order has changed: from ' + old.name + ' to ' + g.name + '.', '');
    S.News.custom(st, 'A New Constitutional Order: ' + g.name + ' Proclaimed', 'major');
    st.diplomacy.nations.forEach((n) => { n.relation += (S.Dip.ideologyGap(st, n) < 30 ? 8 : -8); });
  };

  /* ========================================================== VICTORY */
  G.checkVictory = function (st) {
    if (st.ended) return;
    const vp = st.victoryProgress;
    const rank = S.Mil.worldRank(st);
    const second = rank.find((r) => !r.self);
    const milIndex = S.clamp(st.military.power / Math.max(1, rank[0].power) * 100, 0, 100);
    const lead = st.military.power - (second ? second.power : 0);
    const defeated = (st.national.warsWon || 0);

    vp.military = {
      pct: S.clamp((
        S.clamp(milIndex / 88, 0, 1) * 0.35 +
        S.clamp(lead / 20, 0, 1) * 0.25 +
        S.clamp(defeated / 3, 0, 1) * 0.25 +
        S.clamp(st.national.prestige / 75, 0, 1) * 0.15) * 100, 0, 100),
      parts: [
        { k: 'Force index vs. leader', v: S.round(milIndex, 0) + '/88', ok: milIndex >= 88 },
        { k: 'Lead over second power', v: S.round(lead, 1) + '/20', ok: lead >= 20 },
        { k: 'Rivals defeated', v: defeated + '/3', ok: defeated >= 3 },
        { k: 'Prestige', v: S.round(st.national.prestige, 0) + '/75', ok: st.national.prestige >= 75 }
      ]
    };
    const milWin = milIndex >= 88 && lead >= 20 && defeated >= 3 && st.national.prestige >= 75;

    const affine = st.diplomacy.nations.filter((n) => !n.absorbedBy && n.affinity >= 60).length;
    vp.culture = {
      pct: S.clamp((
        S.clamp(st.quality.culture / 88, 0, 1) * 0.24 +
        S.clamp(st.national.softPower / 82, 0, 1) * 0.18 +
        S.clamp(st.national.prestige / 80, 0, 1) * 0.16 +
        S.clamp(affine / 9, 0, 1) * 0.28 +
        S.clamp(st.quality.education / 78, 0, 1) * 0.14) * 100, 0, 100),
      parts: [
        { k: 'Culture index', v: S.round(st.quality.culture, 0) + '/88', ok: st.quality.culture >= 88 },
        { k: 'Soft power', v: S.round(st.national.softPower, 0) + '/82', ok: st.national.softPower >= 82 },
        { k: 'Prestige', v: S.round(st.national.prestige, 0) + '/80', ok: st.national.prestige >= 80 },
        { k: 'Nations with high affinity', v: affine + '/9', ok: affine >= 9 },
        { k: 'Education', v: S.round(st.quality.education, 0) + '/78', ok: st.quality.education >= 78 }
      ]
    };
    const cultWin = st.quality.culture >= 88 && st.national.softPower >= 82 &&
      st.national.prestige >= 80 && affine >= 9 && st.quality.education >= 78;

    const treaties = st.diplomacy.treaties.length;
    vp.peace = {
      pct: S.clamp((
        S.clamp((100 - st.world.tension) / 88, 0, 1) * 0.28 +
        S.clamp(st.peaceStreak / 5, 0, 1) * 0.32 +
        S.clamp(treaties / 10, 0, 1) * 0.25 +
        S.clamp(st.national.prestige / 72, 0, 1) * 0.15) * 100, 0, 100),
      parts: [
        { k: 'World tension', v: S.round(st.world.tension, 0) + ' (≤12)', ok: st.world.tension <= 12 },
        { k: 'Years of global peace', v: st.peaceStreak + '/5', ok: st.peaceStreak >= 5 },
        { k: 'Treaties in force', v: treaties + '/10', ok: treaties >= 10 },
        { k: 'Prestige', v: S.round(st.national.prestige, 0) + '/72', ok: st.national.prestige >= 72 }
      ]
    };
    const peaceWin = st.world.tension <= 12 && st.peaceStreak >= 5 && treaties >= 10 &&
      st.national.prestige >= 72 && !st.wars.length;

    /* Progress is as much the weakest requirement as the average of them —
       otherwise a track with one unmet condition reads as nearly won. */
    ['military', 'culture', 'peace'].forEach((k) => {
      const parts = vp[k].parts;
      const worst = parts.reduce((m, p) => Math.min(m, p.ok ? 1 : 0.34), 1);
      vp[k].pct = S.clamp(vp[k].pct * (0.45 + 0.55 * worst), 0, 100);
    });

    /* A victory has to be held, not touched. Each track must be satisfied
       continuously for three years, and nothing is decided inside a decade. */
    const streaks = st.victoryStreak = st.victoryStreak || { military: 0, culture: 0, peace: 0 };
    const met = { military: milWin, culture: cultWin, peace: peaceWin };
    const HOLD = 365 * 3;
    const MIN_YEARS = 10;
    let out = null;
    ['military', 'culture', 'peace'].forEach((k) => {
      streaks[k] = met[k] ? streaks[k] + 1 : 0;
      vp[k].holding = streaks[k];
      vp[k].parts.push({
        k: 'Held for', v: S.round(streaks[k] / 365, 1) + '/3 years',
        ok: streaks[k] >= HOLD
      });
      if (streaks[k] >= HOLD && (st.date.year - st.startYear) >= MIN_YEARS && !out) out = k;
    });
    if (out) return G.win(out);
    return null;
  };

  G.win = function (kind) {
    const st = G.state;
    if (st.ended) return;
    const v = S.VICTORY.find((x) => x.id === kind);
    st.ended = { won: true, kind: kind, name: v.name, blurb: v.blurb, date: S.dateLong(st.date) };
    G.setSpeed(0);
    if (S.UI) S.UI.showEnd();
  };

  G.lose = function (kind) {
    const st = G.state;
    if (st.ended) return;
    const d = S.DEFEATS[kind] || { name: 'The End', blurb: 'It is over.' };
    st.ended = { won: false, kind: kind, name: d.name, blurb: d.blurb, date: S.dateLong(st.date) };
    G.setSpeed(0);
    if (S.UI) S.UI.showEnd();
    return null;
  };

  /* ========================================================== SAVE/LOAD */
  G.serialise = function () {
    const st = G.state;
    if (!st) return null;
    const copy = {};
    for (const k in st) {
      if (k === 'rng' || k === 'negotiation') continue;
      copy[k] = st[k];
    }
    copy.rngState = st.rng.state();
    // decision definitions and event functions cannot be serialised
    copy.inbox = st.inbox.map((i) => ({ defId: i.def.id, ctx: i.ctx, daysLeft: i.daysLeft, arrived: i.arrived, arrivedDay: i.arrivedDay, urgency: i.urgency, uid: i.uid }));
    return JSON.stringify(copy);
  };

  G.deserialise = function (json) {
    const raw = typeof json === 'string' ? JSON.parse(json) : json;
    const st = raw;
    st.rng = S.makeRng(st.seed || 1);
    st.rng.setState(raw.rngState || st.seed || 1);
    st.inbox = (raw.inbox || []).map((i) => ({
      uid: i.uid || S.uid('dec'), def: S.Decisions.BY_ID[i.defId], ctx: i.ctx || {},
      daysLeft: i.daysLeft, arrived: i.arrived, arrivedDay: i.arrivedDay, urgency: i.urgency
    })).filter((i) => i.def);
    st.negotiation = null;
    st.speed = 0;
    // Saves written before a feature existed simply arrive without it.
    st.scars = st.scars || [];
    st.scheduled = st.scheduled || [];
    st.programmes = st.programmes || [];
    st.actionCooldown = st.actionCooldown || {};
    st.counters.decisionGap = st.counters.decisionGap || {};
    if (!st.roster) G.buildRoster(st);
    st.rulings = st.rulings || {};
    st.foreignWars = (st.foreignWars || []).map((fw) => ({
      a: fw.a, b: fw.b, started: fw.started, months: fw.months || 0,
      score: fw.score || 0, intensity: fw.intensity || 55, casA: fw.casA || 0, casB: fw.casB || 0
    }));
    st.autoPaused = false;
    st.settings = st.settings || {};
    if (st.settings.autoResume == null) st.settings.autoResume = true;
    G.state = st; S.game.state = st;
    return st;
  };

  G.autosave = function () {
    try { localStorage.setItem(G.SAVE_KEY, G.serialise()); } catch (e) { /* quota */ }
  };
  G.saveNow = function () {
    try {
      localStorage.setItem(G.SAVE_KEY, G.serialise());
      if (S.UI) S.UI.toast('Game saved.');
      return true;
    } catch (e) { if (S.UI) S.UI.toast('Save failed: ' + e.message, 'bad'); return false; }
  };
  G.hasSave = function () {
    try { return !!localStorage.getItem(G.SAVE_KEY); } catch (e) { return false; }
  };
  G.loadSave = function () {
    try {
      const raw = localStorage.getItem(G.SAVE_KEY);
      if (!raw) return null;
      return G.deserialise(raw);
    } catch (e) { console.warn(e); return null; }
  };
  G.deleteSave = function () {
    try { localStorage.removeItem(G.SAVE_KEY); } catch (e) { /* ignore */ }
  };
  G.exportSave = function () {
    const data = G.serialise();
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'strategian-' + (G.state.nation.name.replace(/\W+/g, '-').toLowerCase()) + '-' + G.state.date.year + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

})(window.S);

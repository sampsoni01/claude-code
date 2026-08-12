/* STRATEGIAN — military power, wars, fronts and escalation */
(function (S) {
  'use strict';

  const Mil = S.Mil = {};

  Mil.DOCTRINES = {
    defensive:     { name: 'Territorial Defence', desc: 'Fortify, mobilise reserves, fight only at home. Cheap, strong on defence, no reach.',
                     def: 1.30, off: 0.68, cost: 0.85, reach: 0.35, deter: 0.9 },
    deterrence:    { name: 'Strategic Deterrence', desc: 'Heavy forces and standoff weapons to make attack unthinkable. Balanced.',
                     def: 1.12, off: 0.88, cost: 1.00, reach: 0.60, deter: 1.35 },
    expeditionary: { name: 'Expeditionary Power', desc: 'Lift, logistics, carriers, bases abroad. Expensive; the only way to project.',
                     def: 0.92, off: 1.30, cost: 1.30, reach: 1.00, deter: 1.15 },
    asymmetric:    { name: 'Asymmetric Defence', desc: 'Dispersed, cheap, painful to occupy. Terrible at conventional offence.',
                     def: 1.22, off: 0.52, cost: 0.62, reach: 0.20, deter: 0.85 }
  };

  Mil.NUCLEAR_POSTURES = {
    renounced: { name: 'Renounced',        deter: 0.0, prestige: 2,  tension: -6, cost: 0 },
    latent:    { name: 'Latent Capability', deter: 0.25, prestige: 4, tension: 3,  cost: 0.4 },
    minimal:   { name: 'Minimal Deterrent', deter: 0.60, prestige: 10, tension: 8,  cost: 1.0 },
    assured:   { name: 'Assured Retaliation', deter: 1.00, prestige: 16, tension: 14, cost: 1.8 },
    firstuse:  { name: 'First-Use Declared', deter: 1.15, prestige: 12, tension: 28, cost: 2.1 }
  };

  /* Quality composite: how good the force is, independent of size. */
  Mil.quality = function (m, st) {
    const doc = Mil.DOCTRINES[st.policy.mil.doctrine];
    return S.clamp(
      m.equipment * 0.30 + m.readiness * 0.22 + m.tech * 0.18 +
      m.morale * 0.14 + m.logistics * 0.10 + m.veterancy * 0.06, 1, 100
    ) * (0.94 + doc.deter * 0.05);
  };

  /* Absolute power, comparable across nations. */
  Mil.powerOf = function (spendAbs, quality, nuclearLevel, manpowerM) {
    const scale = Math.pow(Math.max(0.3, spendAbs), 0.45);
    const nuke = 1 + (nuclearLevel / 100) * 0.85;
    const mass = 1 + Math.log10(1 + manpowerM) * 0.16;
    return (quality / 100) * scale * nuke * mass * 3.35;
  };

  Mil.recompute = function (st) {
    const m = st.military, pol = st.policy.mil, bm = S.Econ.BENCHMARK.defense;
    const spendAbs = (st.budget.alloc.defense / 100) * st.economy.gdp;
    const ratio = st.budget.alloc.defense / bm;
    const eff = S.Econ.efficiency(st);

    // Equipment and technology are stocks fed by procurement and R&D. The
    // targets are computed here; the stocks themselves move in Mil.tick.
    const rnd = pol.rndShare / 100;
    const procurement = ratio * (1 - rnd * 0.55) * eff;
    m.eqTarget = S.clamp(18 + 56 * Math.pow(S.clamp(procurement, 0, 3), 0.5) *
      (0.5 + 0.5 * st.quality.science / 60), 3, 100);

    const techTarget = S.clamp(15 + st.quality.science * 0.55 + rnd * 42 * ratio, 3, 100);
    m.techTarget = techTarget;

    const readyTarget = S.clamp(pol.readinessTarget * (0.4 + 0.6 * S.clamp(ratio, 0, 2)) * eff, 3, 100);
    m.readyTarget = readyTarget;

    const moraleTarget = S.clamp(45 + (pol.veteranCare - 50) * 0.30 + st.society.approval * 0.16 +
      S.sum(st.wars, (w) => w.score * 0.12) + (st.national.prestige - 50) * 0.10 -
      S.sum(st.wars, (w) => w.exhaustion * 0.25), 5, 100);
    m.moraleTarget = moraleTarget;

    const logiTarget = S.clamp(20 + st.quality.infra * 0.45 + ratio * 18 - st.society.corruption * 0.15, 3, 100);
    m.logiTarget = logiTarget;

    const manTarget = st.pop.total * (0.0016 + pol.conscription / 100 * 0.016) *
      (st.wars.length ? 1.35 : 1) * (st.policy.mil.doctrine === 'asymmetric' ? 1.2 : 1);
    m.manpowerTarget = manTarget;

    m.quality = Mil.quality(m, st);
    m.spendAbs = spendAbs;
    // Power uses real output so that inflation alone cannot make an army strong.
    m.power = Mil.powerOf((st.budget.alloc.defense / 100) * st.economy.gdpReal,
      m.quality, m.nuclear, m.manpower);
    m.nuclearPosture = pol.nuclearPosture;
  };

  Mil.tick = function (st, dt) {
    const m = st.military, pol = st.policy.mil;
    Mil.recompute(st);

    m.equipment = S.drift(m.equipment, m.eqTarget, 0.45 * dt);
    m.tech = S.drift(m.tech, m.techTarget, 0.55 * dt);
    m.readiness = S.drift(m.readiness, m.readyTarget, 1.5 * dt);
    m.morale = S.drift(m.morale, m.moraleTarget, 1.6 * dt);
    m.logistics = S.drift(m.logistics, m.logiTarget, 0.7 * dt);
    m.manpower = S.drift(m.manpower, m.manpowerTarget, 0.9 * dt);
    m.veterancy = S.drift(m.veterancy, st.wars.length ? 70 : 28, 0.5 * dt);

    // Nuclear stockpile follows posture, slowly and expensively.
    const np = Mil.NUCLEAR_POSTURES[pol.nuclearPosture];
    const nukeTarget = np.deter * 100 * (0.4 + 0.6 * st.quality.science / 70);
    m.nuclear = S.drift(m.nuclear, S.clamp(nukeTarget, 0, 100), 0.30 * dt);

    Mil.recompute(st);
    st.wars.forEach((w) => Mil.tickWar(st, w, dt));
    // Wars resolve on a ten-day operational cycle.
    st.wars.slice().forEach((w) => {
      w.cycle = (w.cycle || 0) + dt * 365;
      while (w.cycle >= 10) { w.cycle -= 10; Mil.resolveCycle(st, w); }
    });
  };

  /* ------------------------------------------------------- war creation */
  Mil.POSTURES = {
    defend:   { name: 'Hold the Line',   off: 0.35, def: 1.25, intensity: 0.55, cost: 0.7,  desc: 'Absorb attacks, trade space for time, minimise losses.' },
    limited:  { name: 'Limited Offensive', off: 0.85, def: 1.00, intensity: 0.85, cost: 1.0, desc: 'Push on chosen axes while keeping reserves intact.' },
    full:     { name: 'Full Offensive',  off: 1.35, def: 0.78, intensity: 1.35, cost: 1.55, desc: 'Commit everything. Fast gains, ruinous losses.' },
    attrit:   { name: 'Attrition',       off: 0.60, def: 1.10, intensity: 1.00, cost: 1.15, desc: 'Grind them down. Wins if your reserves are deeper.' },
    withdraw: { name: 'Disengage',       off: 0.10, def: 0.85, intensity: 0.30, cost: 0.45, desc: 'Pull back to defensible lines and seek terms.' }
  };

  Mil.startWar = function (st, nationId, opts) {
    opts = opts || {};
    const n = S.dip(st, nationId);
    if (!n) return null;
    if (st.wars.some((w) => w.enemyId === nationId)) return null;
    const war = {
      id: S.uid('war'),
      enemyId: nationId,
      name: opts.name || ('War with ' + n.name),
      type: opts.type || 'conventional',
      score: opts.score || 0,
      intensity: opts.intensity != null ? opts.intensity : 55,
      posture: opts.posture || 'defend',
      homeSupport: opts.homeSupport != null ? opts.homeSupport : (opts.aggressor ? 62 : 78),
      exhaustion: 0, enemyExhaustion: 0,
      casualties: 0, enemyCasualties: 0, civilianCasualties: 0,
      casualtiesRatio: 0,
      started: S.dateLabel(st.date),
      startAbs: S.absDay(st.date),
      annualCost: 0,
      aggressor: !!opts.aggressor,
      objectives: opts.objectives || ['Restore the pre-war line', 'Impose acceptable terms'],
      events: [],
      cycle: 0,
      nuclearUse: 0
    };
    st.wars.push(war);
    n.relation = -95; n.atWar = true; n.tradeStatus = 'embargo';
    st.world.tension = S.clamp(st.world.tension + 12 + n.power * 0.12, 0, 100);
    st.world.globalWars = (st.world.globalWars || 0) + 1;
    S.News.push(st, 'war_start', { severity: 'major', nation: n.name });
    S.game.event('WAR: hostilities have begun with ' + n.name + '.', 'bad');
    return war;
  };

  Mil.startCivilWar = function (st) {
    const war = {
      id: S.uid('war'), enemyId: null, name: 'Civil War',
      type: 'civil', score: -10, intensity: 70, posture: 'defend',
      homeSupport: st.society.approval, exhaustion: 0, enemyExhaustion: 0,
      casualties: 0, enemyCasualties: 0, civilianCasualties: 0, casualtiesRatio: 0,
      started: S.dateLabel(st.date), startAbs: S.absDay(st.date), annualCost: 0,
      objectives: ['Retake rebel-held provinces', 'Restore the writ of the state'],
      events: [], cycle: 0, nuclearUse: 0,
      rebelStrength: 30 + st.society.unrest * 0.4 + S.Soc.factionDanger(st) * 0.3
    };
    st.wars.push(war);
    st.society.stability -= 20;
    st.economy.shock -= 5;
    S.News.push(st, 'civil_war', { severity: 'major' });
    S.game.event('CIVIL WAR. Armed factions have declared against the government. The army is splitting.', 'bad');
    return war;
  };

  Mil.startInsurgency = function (st, name) {
    const war = {
      id: S.uid('war'), enemyId: null, name: name || 'Insurgency',
      type: 'insurgency', score: -5, intensity: 35, posture: 'defend',
      homeSupport: 65, exhaustion: 0, enemyExhaustion: 0,
      casualties: 0, enemyCasualties: 0, civilianCasualties: 0, casualtiesRatio: 0,
      started: S.dateLabel(st.date), startAbs: S.absDay(st.date), annualCost: 0,
      objectives: ['Deny the insurgency safe territory', 'Restore civil administration'],
      events: [], cycle: 0, nuclearUse: 0,
      rebelStrength: 22 + st.society.unrest * 0.25
    };
    st.wars.push(war);
    return war;
  };

  /* --------------------------------------------------------- war upkeep */
  Mil.tickWar = function (st, w, dt) {
    const doc = Mil.DOCTRINES[st.policy.mil.doctrine];
    const post = Mil.POSTURES[w.posture];
    const committed = st.military.power * post.off;
    const distance = w.type === 'civil' || w.type === 'insurgency' ? 0.25 : (1 - doc.reach * 0.7);

    w.annualCost = st.economy.gdp * (w.intensity / 100) * post.cost * 0.055 *
      (1 + distance) * (0.6 + st.military.quality / 140);

    // Support decays with time, casualties and the absence of progress.
    const months = (S.absDay(st.date) - w.startAbs) / 30;
    const supportTarget = S.clamp(
      (w.aggressor ? 58 : 76) + w.score * 0.30 - months * 0.9 -
      w.casualtiesRatio * 130 - st.economy.inflation * 0.4 +
      (st.policy.interior.propaganda * 0.18) + (st.society.cohesion - 50) * 0.24, 2, 98);
    w.homeSupport = S.drift(w.homeSupport, supportTarget, 1.4 * dt);

    w.exhaustion = S.clamp(w.exhaustion + (w.intensity / 100) * 7.5 * dt, 0, 100);
    w.enemyExhaustion = S.clamp(w.enemyExhaustion + (w.intensity / 100) * 6.2 * dt, 0, 100);

    // When both sides are spent, the fighting stops of its own accord.
    if (w.exhaustion > 93 && w.enemyExhaustion > 93 && w.type === 'conventional') {
      return Mil.endWar(st, w, 'truce');
    }

    // The staff put an operational plan to you at intervals: attack, hold,
    // or wind the war down. This is where offence and defence are chosen.
    if (w.type === 'conventional') {
      const abs = S.absDay(st.date);
      if (!w.nextDirective) w.nextDirective = w.startAbs + 90;
      if (abs >= w.nextDirective && !st.inbox.some((i) => i.def.id === 'war_directive')) {
        w.nextDirective = abs + st.rng.int(110, 180);
        S.game.pushDecision('war_directive', { war: w.id });
      }
    }
    void committed;
  };

  /* ---------------------------------------------- ten-day battle cycle */
  Mil.resolveCycle = function (st, w) {
    const rng = st.rng;
    const doc = Mil.DOCTRINES[st.policy.mil.doctrine];
    const post = Mil.POSTURES[w.posture];

    let own = st.military.power *
      (post.off * 0.55 + post.def * 0.45) *
      (st.military.readiness / 70) *
      (st.military.morale / 60) *
      (0.55 + 0.45 * st.military.logistics / 70) *
      (1 - w.exhaustion / 260) *
      (1 + st.intel.strength / 400);

    let foe;
    if (w.type === 'civil') {
      foe = st.military.power * (w.rebelStrength / 100) *
        (1 + st.society.unrest / 150) * (1 - w.enemyExhaustion / 300);
      own *= 0.75 + S.Soc.militaryLoyalty(st) / 200; // split loyalties
    } else if (w.type === 'insurgency') {
      foe = st.military.power * (w.rebelStrength / 100) * 0.55 *
        (1 + Math.max(0, st.society.unrest - 40) / 90) * (1 - w.enemyExhaustion / 320);
      own *= 0.55 + doc.def * 0.25; // conventional force is clumsy here
      own *= (0.6 + st.quality.admin / 200);
    } else {
      const n = S.dip(st, w.enemyId);
      foe = (n ? n.milPower : 20) * (1 - w.enemyExhaustion / 260) *
        (1 + (n && n.warPosture === 'full' ? 0.25 : 0));
      // Allies on both sides.
      st.diplomacy.nations.forEach((o) => {
        if (o.id === w.enemyId) return;
        if (o.allyOfUs && o.relation > 45) own += o.milPower * 0.16 * (o.warSupport || 1);
        if (n && o.blocOf === n.id && o.relation < -20) foe += o.milPower * 0.10;
      });
      // Home ground advantage.
      if (!w.aggressor) own *= 1 + doc.def * 0.18;
      else foe *= 1.14;
    }

    own *= 0.85 + rng() * 0.30;
    foe *= 0.85 + rng() * 0.30;

    const odds = own / (own + foe);
    // Wars are meant to last long enough to be governed, not resolved in a
    // fortnight: a decisive imbalance still needs roughly a year to tell.
    const swing = (odds - 0.5) * 13 * (w.intensity / 60) * (post.off * 0.6 + 0.4);
    w.score = S.clamp(w.score + swing, -100, 100);

    // Casualties scale with intensity and inversely with quality edge.
    const edge = S.clamp(own / Math.max(0.001, foe), 0.2, 5);
    // Losses per ten-day cycle as a share of the force under arms. Calibrated
    // so that a hard-fought year of modern war costs tens of thousands of
    // lives rather than the millions of a total war between mass armies.
    const baseLoss = (w.intensity / 100) * 0.0008 * st.military.manpower;
    const ourLoss = baseLoss / Math.pow(edge, 0.45) * (post.off * 0.55 + 0.65);
    const theirLoss = baseLoss * Math.pow(edge, 0.35) * 1.05;
    w.casualties += ourLoss * 1e6;
    w.enemyCasualties += theirLoss * 1e6;
    if (w.type !== 'conventional' || w.score < 0) {
      w.civilianCasualties += baseLoss * 1e6 * (w.type === 'conventional' ? 0.35 : 0.85);
    }
    // Deaths as a share of the population, scaled so that losing a tenth of a
    // percent of your people reads as a bloody war politically.
    w.casualtiesRatio = S.clamp((w.casualties / 1e6) / Math.max(0.05, st.pop.total) * 800, 0, 1.5);

    st.military.morale -= (odds < 0.45 ? 1.6 : -0.5);
    st.military.readiness -= (w.intensity / 100) * 2.4;
    st.military.equipment -= (w.intensity / 100) * 0.9;
    st.military.readiness = S.clamp(st.military.readiness, 2, 100);
    st.military.equipment = S.clamp(st.military.equipment, 2, 100);

    if (w.type === 'civil' || w.type === 'insurgency') {
      w.rebelStrength = S.clamp(w.rebelStrength - swing * 0.35 + (st.society.unrest - 45) * 0.05, 2, 130);
      if (w.rebelStrength < 6 && w.score > 45) return Mil.endWar(st, w, 'victory');
    }

    Mil.narrateCycle(st, w, odds, swing);
    Mil.checkWarOutcome(st, w);
  };

  Mil.narrateCycle = function (st, w, odds, swing) {
    const rng = st.rng;
    if (!rng.chance(0.45)) return;
    const good = swing > 1.5, bad = swing < -1.5;
    const foe = w.enemyId ? (S.dip(st, w.enemyId) || {}).adj : (w.type === 'civil' ? 'rebel' : 'insurgent');
    const lines = good ? [
      'Forward elements broke through on the northern axis; ' + foe + ' units are withdrawing in contact.',
      'A combined arms push seized the river crossings intact.',
      'Enemy logistics collapsed under sustained interdiction; the line moved.',
      'Local commanders report the initiative has passed to us.'
    ] : bad ? [
      'A counter-attack punched through the seam between two corps. Reserves committed.',
      'Supply columns are being cut faster than they can be replaced.',
      'A defensive line failed under bombardment; the withdrawal was not orderly.',
      'Casualty returns are running well ahead of replacement.'
    ] : [
      'Positions largely unchanged. Both sides are digging.',
      'Probing attacks along the whole front; nothing decisive.',
      'Weather and mud have stopped movement for the moment.',
      'An artillery war of position continues.'
    ];
    w.events.unshift({ date: S.dateLabel(st.date), text: rng.pick(lines), tone: good ? 'good' : bad ? 'bad' : '' });
    if (w.events.length > 24) w.events.length = 24;
    void odds;
  };

  /* --------------------------------------------------------- resolution */
  Mil.checkWarOutcome = function (st, w) {
    const rng = st.rng;
    const n = w.enemyId ? S.dip(st, w.enemyId) : null;

    // Nuclear escalation: a losing nuclear power is a dangerous animal.
    if (w.type === 'conventional' && n && n.nuclear && w.score > 62 && st.military.nuclear > 5) {
      const risk = (w.score - 62) / 380;
      if (rng.chance(risk)) {
        S.game.pushDecision('nuclear_threat_incoming', { nation: n.id });
      }
    }
    if (w.type === 'conventional' && n && n.nuclear && w.score > 85) {
      if (rng.chance(0.04)) return Mil.nuclearExchange(st, w);
    }

    // Before the collapse becomes final, the option to end it is put to you.
    if (w.score <= -72 && !w.capitulationOffered) {
      w.capitulationOffered = true;
      S.game.pushDecision('capitulation', { war: w.id });
    }
    // Winning the war is not the last decision: what to do with the defeated
    // country is. The terms are put to you rather than applied automatically.
    if (w.score >= 92 && w.type === 'conventional' && !w.victoryOffered) {
      w.victoryOffered = true;
      S.game.pushDecision('victory_terms', { war: w.id });
    }
    if (w.score <= -92) {
      if (w.type === 'civil') return S.game.lose('civilwar');
      if (w.type === 'conventional' && n && n.milPower > st.military.power * 1.4) return S.game.lose('defeat');
      return Mil.endWar(st, w, 'defeat');
    }
    // Either side may sue for peace when the position is clear.
    if (!w.peaceOffered && (w.score >= 55 || w.score <= -55 || w.exhaustion > 72) &&
      w.type === 'conventional' && rng.chance(0.30)) {
      w.peaceOffered = true;
      S.game.pushDecision('peace_feeler', { war: w.id });
    }
    if (w.homeSupport < 20 && !w.homeCrisis) {
      w.homeCrisis = true;
      S.game.pushDecision('war_unpopular', { war: w.id });
    }
  };

  Mil.nuclearExchange = function (st, w) {
    w.nuclearUse = 1;
    const n = w.enemyId ? S.dip(st, w.enemyId) : null;
    S.News.push(st, 'nuclear', { severity: 'major', nation: n ? n.name : 'the enemy' });
    // Any exchange between major arsenals ends the world.
    if (st.military.nuclear > 40 && n && n.power > 60) return S.game.lose('apocalypse');
    st.pop.total *= 0.86;
    st.economy.gdp *= 0.45; st.economy.gdpReal *= 0.45;
    st.society.unrest += 40; st.society.stability -= 40;
    st.national.prestige -= 45;
    st.world.tension = 100;
    st.diplomacy.nations.forEach((x) => { x.relation -= 55; });
    S.game.event('NUCLEAR WEAPONS HAVE BEEN USED. Cities are gone. There is no version of this that ends well.', 'bad');
    return null;
  };

  /* Absorption of one state by another. The loser stays in the data as a
     rump entry (old references must keep working) but is flagged and
     filtered out of every live list. */
  Mil.absorbNation = function (st, victorId, loserId) {
    const loser = S.dip(st, loserId);
    if (!loser || loser.absorbedBy) return;
    const victor = victorId === 'player' ? null : S.dip(st, victorId);
    if (victor) {
      victor.gdp += loser.gdp * 0.55;
      victor.power = S.clamp(victor.power + loser.power * 0.30, 1, 100);
      victor.manpower += loser.manpower * 0.5;
    }
    loser.absorbedBy = victorId;
    loser.atWar = false; loser.sanctioningUs = false; loser.allyOfUs = false;
    loser.gdp *= 0.05; loser.power = 3; loser.milPower = 0.5;
    loser.treaties = [];
    st.diplomacy.treaties = st.diplomacy.treaties.filter((t) => t.nation !== loserId);
    st.world.tension = S.clamp(st.world.tension + 10, 0, 100);
  };

  Mil.endWar = function (st, w, outcome, terms, opts) {
    opts = opts || {};
    const idx = st.wars.indexOf(w);
    if (idx >= 0) st.wars.splice(idx, 1);
    st.world.globalWars = Math.max(0, (st.world.globalWars || 1) - 1);
    const n = w.enemyId ? S.dip(st, w.enemyId) : null;
    if (n) {
      n.atWar = false;
      n.relation = outcome === 'victory' ? -55 : outcome === 'defeat' ? -35 : -25;
      n.tradeStatus = 'restricted';
      n.grievance = (n.grievance || 0) + (outcome === 'victory' ? 45 : outcome === 'truce' ? 8 : 15);
      if (outcome === 'victory') { n.defeatedBy = true; n.power = Math.max(6, n.power * 0.72); }
    }
    // Victory settlements: what happens to the defeated state.
    if (n && outcome === 'victory' && opts.mode) {
      if (opts.mode === 'annex') {
        Mil.absorbNation(st, 'player', n.id);
        st.pop.total += n.manpower * 40;
        st.economy.gdp += n.gdp * 9;  // rump gdp is 5% of original; recover ~45% of pre-war output
        st.economy.gdpReal += n.gdp * 9;
        st.society.unrest += 12; st.society.latent += 14;
        st.national.prestige += 6; st.national.aggressionScore += 30;
        st.world.tension = S.clamp(st.world.tension + 14, 0, 100);
        st.diplomacy.nations.forEach((o) => { if (!o.absorbedBy && o.id !== n.id) { o.relation -= 16; o.threatPerception += 14; } });
        S.News.custom(st, n.name + ' Annexed; Occupation Begins', 'bad');
        S.Aftermath.schedule(st, 'occupation_resistance', { nation: n.id }, st.rng.int(200, 520));
      } else if (opts.mode === 'client') {
        n.clientOf = 'player'; n.relation = 55; n.affinity += 12; n.grievance = 12;
        n.allyOfUs = true; n.power = Math.max(6, n.power * 0.80);
        st.economy.reserves += n.gdp * 0.03;
        st.world.tension = S.clamp(st.world.tension + 6, 0, 100);
        S.News.custom(st, 'Client Government Installed in ' + n.name, '');
      } else if (opts.mode === 'punitive') {
        st.economy.reserves += n.gdp * 0.08;
        n.gdp *= 0.94; n.power = Math.max(6, n.power * 0.85);
        n.grievance = (n.grievance || 0) + 25;
        st.world.tension = S.clamp(st.world.tension + 4, 0, 100);
        S.News.custom(st, 'Treaty Signed: ' + n.name + ' to Pay Reparations and Disarm', '');
      } else if (opts.mode === 'magnanimous') {
        n.relation = -5; n.grievance = Math.max(0, (n.grievance || 0) - 30);
        st.national.prestige += 6; st.national.softPower += 8;
        st.world.tension = Math.max(0, st.world.tension - 8);
        S.News.custom(st, 'Peace Signed With ' + n.name + ' on Moderate Terms', 'good');
      }
    }
    st.military.veterancy = Math.min(100, st.military.veterancy + 12);
    st.world.tension = Math.max(0, st.world.tension - 10);

    // A war leaves its dead behind whoever won. The grief is a live political
    // fact for years, and it schedules the settlement that follows from it.
    const dead = Math.round(w.casualties + w.civilianCasualties);
    if (dead > 2000) {
      const share = dead / 1e6 / Math.max(0.1, st.pop.total); // dead per head
      S.Aftermath.addScar(st, {
        kind: 'war_' + w.id, name: w.name,
        desc: S.headcount(dead / 1e6) + ' of our people dead. ' +
          (outcome === 'victory' ? 'Won.' : outcome === 'defeat' ? 'Lost.' : 'Settled.'),
        severity: S.clamp(35 + share * 900 + (outcome === 'defeat' ? 25 : 0), 20, 110),
        years: S.clamp(4 + share * 60, 3, 12), deaths: dead,
        growth: -S.clamp(share * 22, 0.2, 1.6),
        approval: outcome === 'defeat' ? -4 : -1,
        unrest: outcome === 'defeat' ? 5 : 2,
        qualityDrag: { infra: -S.clamp(share * 160, 2, 22), health: -S.clamp(share * 90, 1, 14) },
        tag: 'war'
      });
      S.Aftermath.schedule(st, 'war_memorial', { war: w.name, dead: dead, outcome: outcome }, 150);
      S.Aftermath.schedule(st, 'demobilisation', {}, 260);
    }

    if (outcome === 'victory') {
      st.national.prestige += 12; st.society.honeymoon += 8;
      st.national.warsWon = (st.national.warsWon || 0) + 1;
      S.game.event('VICTORY. ' + w.name + ' has ended on our terms.', 'good');
      S.News.push(st, 'war_victory', { severity: 'major', nation: n ? n.name : 'the enemy' });
    } else if (outcome === 'defeat') {
      st.national.prestige -= 18; st.society.approval -= 12; st.society.unrest += 10;
      st.economy.shock -= 3;
      st.national.warsLost = (st.national.warsLost || 0) + 1;
      S.game.event('DEFEAT. ' + w.name + ' has ended on terms dictated to us.', 'bad');
      S.News.push(st, 'war_defeat', { severity: 'major', nation: n ? n.name : 'the enemy' });
    } else {
      S.game.event(w.name + ' has ended by negotiated settlement.', '');
      S.News.push(st, 'war_peace', { severity: 'major', nation: n ? n.name : 'the enemy' });
      st.national.prestige += 3;
    }
    if (terms) S.Nego.applyTerms(st, terms);
    return null;
  };

  /* ---------------------------------------------- foreign force ratings */
  Mil.recomputeForeign = function (st) {
    st.diplomacy.nations.forEach((n) => {
      if (n.absorbedBy) { n.milPower = 0.5; return; }
      const spend = n.gdp * (n.defenseShare / 100);
      n.milPower = Mil.powerOf(spend, n.milQuality, n.nuclear ? n.nuclearLevel : 0, n.manpower);
    });
  };

  Mil.worldRank = function (st) {
    const list = st.diplomacy.nations.filter((n) => !n.absorbedBy)
      .map((n) => ({ id: n.id, name: n.name, power: n.milPower }));
    list.push({ id: 'self', name: st.nation.name, power: st.military.power, self: true });
    list.sort((a, b) => b.power - a.power);
    return list;
  };

})(window.S);

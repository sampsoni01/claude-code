/* STRATEGIAN — foreign relations, blocs, treaties and the behaviour of
   other governments. The AI here is deliberately interest-driven: nations
   respond to power, trade, ideology and grievance, not to sentiment.     */
(function (S) {
  'use strict';

  const Dip = S.Dip = {};

  S.dip = function (st, id) { return st.diplomacy.nations.find((n) => n.id === id); };

  Dip.IDEOLOGY_DISTANCE = {
    liberal: { liberal: 0, democratic: 10, managed: 45, party: 75, authoritarian: 80, monarchy: 55, populist: 45, mixed: 35 },
    democratic: { liberal: 10, democratic: 0, managed: 35, party: 65, authoritarian: 70, monarchy: 50, populist: 30, mixed: 25 },
    managed: { liberal: 45, democratic: 35, managed: 0, party: 30, authoritarian: 28, monarchy: 30, populist: 30, mixed: 20 },
    party: { liberal: 75, democratic: 65, managed: 30, party: 0, authoritarian: 22, monarchy: 45, populist: 40, mixed: 40 },
    authoritarian: { liberal: 80, democratic: 70, managed: 28, party: 22, authoritarian: 0, monarchy: 25, populist: 35, mixed: 40 },
    monarchy: { liberal: 55, democratic: 50, managed: 30, party: 45, authoritarian: 25, monarchy: 0, populist: 50, mixed: 35 },
    populist: { liberal: 45, democratic: 30, managed: 30, party: 40, authoritarian: 35, monarchy: 50, populist: 0, mixed: 30 },
    mixed: { liberal: 35, democratic: 25, managed: 20, party: 40, authoritarian: 40, monarchy: 35, populist: 30, mixed: 0 }
  };

  /* The player's government maps onto the same ideology axis. */
  Dip.ownIdeology = function (st) {
    return ({
      liberal: 'liberal', managed: 'managed', party: 'party', junta: 'authoritarian',
      personalist: 'authoritarian', technocracy: 'managed', theocratic: 'mixed'
    })[st.nation.governmentId] || 'mixed';
  };

  Dip.ideologyGap = function (st, n) {
    const mine = Dip.ownIdeology(st);
    const table = Dip.IDEOLOGY_DISTANCE[mine] || {};
    return table[n.ideology] != null ? table[n.ideology] : 40;
  };

  /* ------------------------------------------------------------ per-day */
  Dip.tick = function (st, dt) {
    S.Mil.recomputeForeign(st);
    const ourPower = st.military.power;
    const ourGdp = st.economy.gdp;

    let tensionSum = 0, weight = 0;
    st.diplomacy.nations.forEach((n) => {
      /* --- how threatening do they find us? --- */
      const powerRatio = ourPower / Math.max(3, n.milPower);
      const proximity = n.region === st.nation.region ? 1.5 : 1.0;
      let threat = S.clamp((powerRatio - 1) * 22 * proximity, -20, 70);
      threat += (st.policy.mil.doctrine === 'expeditionary' ? 10 : 0);
      threat += S.Mil.NUCLEAR_POSTURES[st.policy.mil.nuclearPosture].tension * 0.5;
      threat += st.national.aggressionScore * 0.5;
      threat -= (st.policy.foreign.stance === 'isolationist' ? 12 : 0);
      n.threatPerception = S.drift(n.threatPerception, S.clamp(threat, 0, 100), 0.8 * dt);

      /* --- equilibrium relation --- */
      const gap = Dip.ideologyGap(st, n);
      const tradeDep = S.clamp((n.tradeVolume / Math.max(1, ourGdp * 0.02)) * 12, 0, 26);
      let eq = 30 - gap * 0.55 + tradeDep
        + (n.treaties.length * 7)
        + (n.allyOfUs ? 26 : 0)
        + (st.policy.foreign.aid / 100) * 14 * (n.gdp < 2000 ? 1.6 : 0.5)
        + (st.national.softPower - 50) * 0.16
        - n.threatPerception * 0.30
        - (n.grievance || 0) * 0.55
        - (st.economy.sanctionPressure > 40 && n.ideology !== Dip.ownIdeology(st) ? 6 : 0)
        - (n.tradeStatus === 'embargo' ? 40 : n.tradeStatus === 'restricted' ? 14 : n.tradeStatus === 'preferred' ? -6 : 0)
        + (st.policy.foreign.stance === 'engaged' ? 6 : st.policy.foreign.stance === 'interventionist' ? -6 : 0);

      if (n.atWar) eq = -95;
      if (n.blocOf && n.blocOf !== 'self') eq -= 8;
      n.relationTarget = S.clamp(eq, -100, 100);
      const speed = n.atWar ? 6 : 0.55;
      n.relation = S.clamp(S.drift(n.relation, n.relationTarget, speed * dt), -100, 100);

      /* --- cultural affinity: slower, driven by soft power --- */
      const affTarget = S.clamp(st.national.softPower * 0.55 + n.relation * 0.22 -
        gap * 0.20 + (st.quality.culture - 50) * 0.20 -
        (n.ideology === 'party' || n.ideology === 'authoritarian' ? 8 : 0), 0, 100);
      n.affinity = S.drift(n.affinity, affTarget, 0.28 * dt);

      /* --- trade volume --- */
      const tvTarget = ourGdp * 0.008 * (n.gdp / 4000) *
        (n.tradeStatus === 'embargo' ? 0.02 : n.tradeStatus === 'restricted' ? 0.4 :
          n.tradeStatus === 'preferred' ? 1.5 : 1) *
        (0.4 + 0.6 * (n.relation + 100) / 200) * (1 - st.policy.trade.tariff / 160);
      n.tradeVolume = S.drift(n.tradeVolume, Math.max(0, tvTarget), 1.1 * dt);

      n.grievance = Math.max(0, (n.grievance || 0) - 3 * dt);

      /* --- their own posture --- */
      const hostility = -n.relation * 0.5 + n.threatPerception * 0.35 + (n.grievance || 0) * 0.4;
      n.stance = n.atWar ? 'war' : hostility > 55 ? 'hostile' : hostility > 30 ? 'cold' :
        n.relation > 60 ? 'friendly' : n.relation > 25 ? 'cordial' : 'neutral';

      tensionSum += Math.max(0, -n.relation) * n.power;
      weight += n.power;
    });

    const worldT = S.clamp(tensionSum / Math.max(1, weight) * 0.85 +
      st.wars.length * 8 + (st.world.globalWars || 0) * 4 +
      S.Mil.NUCLEAR_POSTURES[st.policy.mil.nuclearPosture].tension * 0.25, 0, 100);
    st.world.tension = S.drift(st.world.tension, worldT, 0.9 * dt);

    st.national.aggressionScore = Math.max(0, st.national.aggressionScore - 4 * dt);
  };

  /* --------------------------------------------- monthly foreign moves */
  Dip.monthlyMoves = function (st) {
    const rng = st.rng;
    st.diplomacy.nations.forEach((n) => {
      if (n.atWar || n.cooldown > 0) { n.cooldown = Math.max(0, (n.cooldown || 0) - 1); return; }
      const roll = rng();

      /* Hostile powers escalate. */
      if (n.stance === 'hostile') {
        if (roll < 0.10 && !n.sanctioningUs && n.power > 30) {
          n.sanctioningUs = true; n.cooldown = 6;
          S.News.push(st, 'sanctions_on_us', { nation: n.name, severity: 'major' });
          S.game.event(n.name + ' has imposed sanctions on our economy.', 'bad');
          return;
        }
        if (roll < 0.16 && n.relation < -70 && n.milPower > st.military.power * 0.7) {
          n.cooldown = 8;
          S.game.pushDecision('foreign_ultimatum', { nation: n.id });
          return;
        }
        if (roll < 0.22 && n.relation < -80 && n.milPower > st.military.power * 1.15 &&
          st.society.stability < 55) {
          n.cooldown = 12;
          S.Mil.startWar(st, n.id, { aggressor: false, intensity: 60, name: 'War with ' + n.name });
          return;
        }
        if (roll < 0.30) {
          n.cooldown = 4;
          S.game.pushDecision('hostile_incident', { nation: n.id });
          return;
        }
      }

      /* Friendly powers propose things. */
      if (n.relation > 45 && roll < 0.13 && !n.allyOfUs && n.treaties.indexOf('defense') < 0) {
        n.cooldown = 8;
        S.game.pushDecision('alliance_offer', { nation: n.id });
        return;
      }
      if (n.relation > 15 && roll < 0.16 && n.treaties.indexOf('trade') < 0) {
        n.cooldown = 6;
        S.game.pushDecision('trade_offer', { nation: n.id });
        return;
      }
      if (n.relation > 5 && roll < 0.06 && n.power < 45) {
        n.cooldown = 8;
        S.game.pushDecision('aid_request', { nation: n.id });
        return;
      }
      if (roll < 0.05 && n.power > 45) {
        n.cooldown = 7;
        S.game.pushDecision('great_power_demand', { nation: n.id });
        return;
      }
      if (roll < 0.08 && st.wars.length && n.relation > 20) {
        n.cooldown = 6;
        S.game.pushDecision('mediation_offer', { nation: n.id });
        return;
      }
      n.cooldown = Math.max(0, (n.cooldown || 0) - 1);
    });

    // Wars between third parties keep the world honest.
    if (rng.chance(0.06) && (st.world.globalWars || 0) < 3) {
      const pair = rng.shuffle(st.diplomacy.nations.filter((n) => !n.atWar)).slice(0, 2);
      if (pair.length === 2) {
        st.world.globalWars = (st.world.globalWars || 0) + 1;
        st.world.tension += 8;
        S.News.push(st, 'foreign_war', { a: pair[0].name, b: pair[1].name, severity: 'major' });
        st.foreignWars = st.foreignWars || [];
        st.foreignWars.push({ a: pair[0].id, b: pair[1].id, started: S.dateLabel(st.date), months: 0 });
      }
    }
    (st.foreignWars || []).forEach((fw, i) => {
      fw.months++;
      if (fw.months > 8 && rng.chance(0.25)) {
        st.foreignWars.splice(i, 1);
        st.world.globalWars = Math.max(0, (st.world.globalWars || 1) - 1);
        st.world.tension -= 5;
      }
    });
  };

  /* --------------------------------------------------------- treaties */
  Dip.TREATIES = {
    trade:    { name: 'Trade Agreement',      effect: 'Lower barriers, higher volumes.' },
    defense:  { name: 'Defence Pact',         effect: 'Mutual defence. They fight when you are attacked.' },
    nonagg:   { name: 'Non-Aggression Pact',  effect: 'Neither party attacks the other.' },
    culture:  { name: 'Cultural Accord',      effect: 'Exchange programmes, media access, affinity growth.' },
    arms:     { name: 'Arms Control Treaty',  effect: 'Caps arsenals; lowers world tension.' },
    energy:   { name: 'Energy Partnership',   effect: 'Secured supply or guaranteed offtake.' },
    intel:    { name: 'Intelligence Sharing', effect: 'Improves collection accuracy on shared targets.' },
    climate:  { name: 'Climate Accord',       effect: 'Binding emissions commitments.' }
  };

  Dip.signTreaty = function (st, nationId, kind) {
    const n = S.dip(st, nationId);
    if (!n || n.treaties.indexOf(kind) >= 0) return false;
    n.treaties.push(kind);
    st.diplomacy.treaties.push({ nation: nationId, kind: kind, since: S.dateLabel(st.date) });
    n.relation += 12;
    if (kind === 'defense') n.allyOfUs = true;
    if (kind === 'arms' || kind === 'climate') st.world.tension -= 3;
    if (kind === 'intel') st.intel.strength += 3;
    st.national.diplomaticWins++;
    S.News.push(st, 'treaty', { nation: n.name, kind: Dip.TREATIES[kind].name });
    return true;
  };

  Dip.breakTreaty = function (st, nationId, kind) {
    const n = S.dip(st, nationId);
    if (!n) return;
    const i = n.treaties.indexOf(kind);
    if (i >= 0) n.treaties.splice(i, 1);
    st.diplomacy.treaties = st.diplomacy.treaties.filter((t) => !(t.nation === nationId && t.kind === kind));
    if (kind === 'defense') n.allyOfUs = false;
    n.relation -= 22; n.grievance = (n.grievance || 0) + 20;
    st.national.diplomaticLosses++;
    // Everyone notices when you tear one up.
    st.diplomacy.nations.forEach((o) => { if (o.id !== nationId) o.relation -= 4; });
  };

  /* -------------------------------------------------- intelligence view */
  // Reported values are noisy; the noise shrinks as your services improve.
  Dip.observed = function (st, trueValue, scale) {
    const acc = st.intel.accuracy;
    const noise = (1 - acc) * (scale || 25);
    return trueValue + st.rng.normal(0, noise);
  };

  Dip.assessThreats = function (st) {
    const out = [];
    st.diplomacy.nations.forEach((n) => {
      const ratio = n.milPower / Math.max(1, st.military.power);
      let score = Math.max(0, -n.relation) * 0.5 + n.threatPerception * 0.20 +
        S.clamp(ratio, 0, 3) * 14 + (n.grievance || 0) * 0.4;
      if (n.atWar) score = 100;
      if (n.allyOfUs) score *= 0.35;
      out.push({
        id: n.id, name: n.name, score: S.clamp(Dip.observed(st, score, 14), 0, 100),
        ratio: ratio, relation: n.relation, nuclear: n.nuclear, stance: n.stance
      });
    });
    out.sort((a, b) => b.score - a.score);
    return out;
  };

})(window.S);

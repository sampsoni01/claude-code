/* STRATEGIAN — negotiation engine
   Every issue is normalised to a 0–100 axis where 0 is entirely their way
   and 100 is entirely yours. The counterparty runs a real utility model:
   weighted issue values against a reservation level derived from leverage,
   with hard red lines that no amount of sweetener will move.            */
(function (S) {
  'use strict';

  const Nego = S.Nego = {};

  /* ------------------------------------------------------- personalities */
  Nego.PERSONALITIES = {
    institutionalist: { concede: 'reciprocal', patience: 9,  bluff: 0.15, redlineHard: 0.85, walk: 0.10, tone: 'procedural' },
    coercive:         { concede: 'boulware',   patience: 6,  bluff: 0.55, redlineHard: 0.95, walk: 0.30, tone: 'blunt' },
    strategic:        { concede: 'integrative', patience: 10, bluff: 0.30, redlineHard: 0.90, walk: 0.14, tone: 'measured' },
    nonaligned:       { concede: 'balanced',   patience: 8,  bluff: 0.20, redlineHard: 0.75, walk: 0.12, tone: 'even' },
    cautious:         { concede: 'steady',     patience: 9,  bluff: 0.10, redlineHard: 0.80, walk: 0.08, tone: 'careful' },
    transactional:    { concede: 'integrative', patience: 7, bluff: 0.35, redlineHard: 0.70, walk: 0.18, tone: 'commercial' },
    opportunist:      { concede: 'boulware',   patience: 6,  bluff: 0.50, redlineHard: 0.80, walk: 0.25, tone: 'sly' },
    volatile:         { concede: 'erratic',    patience: 5,  bluff: 0.45, redlineHard: 0.95, walk: 0.35, tone: 'heated' },
    idealist:         { concede: 'reciprocal', patience: 10, bluff: 0.05, redlineHard: 0.70, walk: 0.08, tone: 'earnest' }
  };

  /* ============================================================== ISSUES */
  function issue(id, label, desc, wYou, wThem, redline, fmt, apply) {
    return { id, label, desc, weightYou: wYou, weightThem: wThem, redline, fmt, apply };
  }

  const F = {
    pct: (lo, hi, suffix) => (v) => S.round(lo + (hi - lo) * (v / 100), 1) + (suffix || '%'),
    invPct: (lo, hi, suffix) => (v) => S.round(hi - (hi - lo) * (v / 100), 1) + (suffix || '%'),
    money: (max) => (v) => S.money(max * (v / 100)),
    scale: (labels) => (v) => labels[S.clamp(Math.round(v / 100 * (labels.length - 1)), 0, labels.length - 1)],
    yesno: (yes, no) => (v) => (v >= 50 ? yes : no)
  };

  Nego.buildIssues = function (st, kind, n, ctx) {
    const rng = st.rng;
    const gdp = st.economy.gdp;
    const out = [];
    switch (kind) {
      case 'peace': {
        const war = st.wars.find((w) => w.id === (ctx && ctx.war)) || st.wars[0];
        const winning = war ? war.score > 0 : false;
        out.push(issue('territory', 'Territorial Settlement',
          'Where the line is drawn when the guns stop.',
          9, 10, winning ? 88 : 55,
          F.scale(['They keep all gains', 'They keep most gains', 'Pre-war borders', 'We take border districts', 'We take major territory']),
          (state, v) => {
            state.national.prestige += (v - 50) * 0.14;
            state.economy.gdpReal *= 1 + (v - 50) * 0.0009;
            state.economy.gdp *= 1 + (v - 50) * 0.0009;
            if (v < 40) state.national.concessions += 1;
          }));
        out.push(issue('reparations', 'Reparations',
          'Payment for damage done. Money is the easiest thing to argue about.',
          6, 7, 80, F.money(gdp * 0.09),
          (state, v) => {
            const amt = gdp * 0.09 * ((v - 50) / 100);
            state.economy.reserves += amt; state.economy.debt -= amt * 0.4;
          }));
        out.push(issue('prisoners', 'Prisoner Exchange',
          'All-for-all, or a phased release used as leverage for years.',
          5, 5, 92, F.scale(['They hold ours', 'Phased, slow', 'All-for-all', 'Ours first', 'Ours first, theirs conditional']),
          (state, v) => { state.society.approval += (v - 50) * 0.06; state.military.morale += (v - 50) * 0.05; }));
        out.push(issue('demil', 'Demilitarised Zone',
          'A buffer costs someone their defensive depth.',
          7, 8, 78, F.scale(['On our side, deep', 'On our side', 'Both sides equally', 'On their side', 'On their side, deep']),
          (state, v) => { state.military.readiness += (v - 50) * 0.05; }));
        if (n && n.power > 45) {
          out.push(issue('sanctions', 'Sanctions Relief',
            'The economic war outlasts the shooting one unless it is written down.',
            8, 4, 85, F.scale(['All sanctions remain', 'Most remain', 'Partial relief', 'Broad relief', 'Full immediate relief']),
            (state, v) => { if (v > 60 && n) n.sanctioningUs = false; }));
        }
        break;
      }
      case 'trade': {
        out.push(issue('tariff', 'Tariff Schedule',
          'Which side\'s producers get protected, and by how much.',
          8, 8, 82, F.scale(['Their goods duty-free', 'Favourable to them', 'Reciprocal', 'Favourable to us', 'Our goods protected']),
          (state, v) => {
            state.economy.exports *= 1 + (v - 50) * 0.0016;
            state.policy.trade.tariff = S.clamp(state.policy.trade.tariff + (v - 50) * 0.03, 0, 40);
          }));
        out.push(issue('access', 'Market Access',
          'Services, procurement, and the parts of the economy nobody photographs.',
          7, 7, 85, F.scale(['They gain full access', 'They gain broad access', 'Balanced', 'We gain broad access', 'We gain full access']),
          (state, v) => { state.economy.shock += (v - 50) * 0.012; }));
        out.push(issue('standards', 'Regulatory Standards',
          'Whose rulebook the goods must satisfy. Boring, and worth billions.',
          5, 6, 80, F.scale(['Their standards', 'Mostly theirs', 'Mutual recognition', 'Mostly ours', 'Our standards']),
          (state, v) => { state.national.softPower += (v - 50) * 0.05; }));
        out.push(issue('invest', 'Investment Protection',
          'Whose courts hear the dispute when the money goes wrong.',
          6, 5, 88, F.scale(['Their tribunals', 'Their preference', 'Neutral arbitration', 'Our preference', 'Our courts']),
          (state, v) => { state.economy.businessConfidence += (v - 50) * 0.06; }));
        break;
      }
      case 'alliance': {
        out.push(issue('commitment', 'Mutual Defence Clause',
          'Automatic, or subject to consultation? The difference is everything.',
          8, 8, 80, F.scale(['We defend them automatically', 'We commit, they consult', 'Symmetric automatic', 'They commit, we consult', 'They defend us automatically']),
          (state, v) => { if (n) { n.allyOfUs = true; n.warSupport = 0.6 + v / 200; } }));
        out.push(issue('basing', 'Basing Rights',
          'Foreign troops on someone\'s soil. Sovereignty is the currency.',
          7, 7, 85, F.scale(['Their bases on our soil', 'Some of theirs here', 'No basing', 'Some of ours there', 'Our bases on their soil']),
          (state, v) => {
            state.military.logistics += (v - 50) * 0.05;
            if (v < 40) { state.national.concessions += 1; state.society.latent += 2; }
          }));
        out.push(issue('burden', 'Burden Sharing',
          'Who pays for the shield.',
          7, 6, 82, F.pct(0, 100, '% our share'),
          (state, v) => { state.budget.alloc.defense = S.clamp(state.budget.alloc.defense - (v - 50) * 0.006, 0.2, 25); }));
        out.push(issue('tech', 'Technology Transfer',
          'Sharing the crown jewels, or renting them.',
          6, 7, 78, F.scale(['We transfer freely', 'We share broadly', 'Balanced exchange', 'They share broadly', 'They transfer freely']),
          (state, v) => { state.military.tech += (v - 50) * 0.07; state.quality.science += (v - 50) * 0.03; }));
        break;
      }
      case 'ultimatum': {
        out.push(issue('demand', 'The Core Demand',
          'What they came for. Everything else is decoration.',
          10, 10, 45,
          F.scale(['Total capitulation', 'Substantial concession', 'Face-saving compromise', 'Token gesture', 'We concede nothing']),
          (state, v) => {
            state.national.prestige += (v - 50) * 0.20;
            if (v < 45) { state.national.concessions += 2; state.society.approval -= (50 - v) * 0.12; }
            else state.national.aggressionScore += (v - 50) * 0.08;
          }));
        out.push(issue('timeline', 'Compliance Timeline',
          'Immediate, or long enough that circumstances may change.',
          5, 6, 80, F.scale(['Immediate', '30 days', '6 months', '2 years', 'Indefinite review']),
          () => {}));
        out.push(issue('verify', 'Verification Regime',
          'Inspectors, or trust. Nobody chooses trust.',
          6, 7, 78, F.scale(['Intrusive on us', 'Monitored', 'Mutual', 'Light touch', 'Self-certification']),
          (state, v) => { state.intel.strength += (v - 50) * 0.05; state.society.approval += (v - 50) * 0.03; }));
        out.push(issue('facesave', 'Public Framing',
          'Who gets to tell their people they won.',
          5, 6, 85, F.scale(['They announce victory', 'Their framing', 'Joint statement', 'Our framing', 'We announce victory']),
          (state, v) => { state.society.approval += (v - 50) * 0.08; state.national.prestige += (v - 50) * 0.06; }));
        break;
      }
      case 'arms': {
        out.push(issue('caps', 'Arsenal Ceilings',
          'How many warheads each side keeps, and who counts them.',
          7, 8, 78, F.scale(['We cut deeply', 'We cut more', 'Equal ceilings', 'They cut more', 'They cut deeply']),
          (state, v) => {
            state.military.nuclear = S.clamp(state.military.nuclear - (50 - v) * -0.25, 0, 100);
            state.world.tension -= 5;
          }));
        out.push(issue('inspect', 'Inspection Rights',
          'Short-notice access, or a schedule everyone can plan around.',
          6, 7, 80, F.scale(['Intrusive on us', 'Asymmetric', 'Reciprocal', 'Light on us', 'Nominal']),
          (state, v) => { state.intel.strength += (v - 50) * 0.04; }));
        out.push(issue('scope', 'Systems Covered',
          'Strategic only, or everything that flies.',
          6, 6, 82, F.scale(['All our systems', 'Broad on us', 'Strategic only', 'Broad on them', 'All their systems']),
          (state, v) => { state.military.equipment += (v - 50) * 0.04; }));
        break;
      }
      case 'resource': {
        out.push(issue('price', 'Contract Price',
          'The number the whole thing is really about.',
          8, 8, 82, F.money(gdp * 0.05),
          (state, v) => { state.economy.reserves += gdp * 0.05 * ((v - 50) / 100); }));
        out.push(issue('volume', 'Guaranteed Volume',
          'Security of supply, or flexibility to walk away.',
          7, 6, 85, F.scale(['They set volume', 'Their option', 'Fixed both ways', 'Our option', 'We set volume']),
          (state, v) => { state.quality.energy += (v - 50) * 0.06; }));
        out.push(issue('duration', 'Contract Duration',
          'Long contracts are cheap insurance and expensive mistakes.',
          5, 6, 85, F.scale(['20 years', '10 years', '5 years', '2 years', 'Spot only']),
          () => {}));
        out.push(issue('currency', 'Settlement Currency',
          'Whose money the world uses is a form of power.',
          6, 7, 80, F.scale(['Their currency', 'Their preference', 'Basket', 'Our preference', 'Our currency']),
          (state, v) => { state.economy.reserveStatus += (v - 50) * 0.10; }));
        break;
      }
      default: {
        out.push(issue('main', 'Principal Question', 'The matter at hand.', 8, 8, 80,
          F.scale(['Fully their way', 'Mostly theirs', 'Split', 'Mostly ours', 'Fully ours']), () => {}));
      }
    }
    // Randomise weights a little so no two negotiations feel identical.
    out.forEach((i) => {
      i.weightThem = S.clamp(i.weightThem + rng.range(-2, 2), 1, 12);
      i.weightYou = S.clamp(i.weightYou + rng.range(-1.5, 1.5), 1, 12);
      i.redline = S.clamp(i.redline + rng.range(-8, 8), 25, 98);
    });
    return out;
  };

  /* ============================================================ LEVERAGE */
  Nego.computeLeverage = function (st, nego) {
    const n = S.dip(st, nego.nationId);
    const war = nego.kind === 'peace' ? st.wars.find((w) => w.id === nego.ctx.war) : null;

    let ours = 50, theirs = 50;
    const factors = [];

    function add(label, delta, note) {
      ours += delta; theirs -= delta;
      factors.push({ label, delta, note });
    }

    if (war) {
      add('Battlefield position', war.score * 0.42, war.score > 10 ? 'We hold the initiative' :
        war.score < -10 ? 'The line is moving against us' : 'The front is static');
      add('Our war weariness', -(war.exhaustion - 40) * 0.16, 'Exhaustion ' + S.round(war.exhaustion, 0));
      add('Their war weariness', (war.enemyExhaustion - 40) * 0.16, '');
      add('Home front', (war.homeSupport - 55) * 0.14, war.homeSupport < 40 ? 'Public patience is gone' : '');
    }
    if (n) {
      const powerRatio = st.military.power / Math.max(2, n.milPower);
      add('Relative military power', S.clamp((powerRatio - 1) * 22, -26, 26),
        powerRatio > 1.2 ? 'We are materially stronger' : powerRatio < 0.85 ? 'They out-gun us' : 'Broadly matched');
      const econRatio = st.economy.gdp / Math.max(50, n.gdp);
      add('Economic weight', S.clamp((econRatio - 1) * 9, -16, 16), '');
      const dep = S.clamp((n.tradeVolume / Math.max(1, st.economy.gdp * 0.02)) * 6, 0, 14);
      add('Their trade exposure to us', dep * 0.7, dep > 6 ? 'They need our market' : '');
      add('Their grievance', -(n.grievance || 0) * 0.12, '');
      if (n.sanctioningUs) add('Sanctions pressure on us', -10, 'Their coalition is holding');
      if (n.allyOfUs) add('Existing alliance', 6, '');
    }
    add('Domestic stability', (st.society.stability - 55) * 0.18,
      st.society.stability < 40 ? 'They can see we are fragile' : '');
    add('Our standing', (st.national.prestige - 50) * 0.10, '');
    if (st.wars.length > 1) add('Fighting on other fronts', -8, 'We are committed elsewhere');
    add('Intelligence advantage', (st.intel.strength - 50) * 0.09,
      st.intel.strength > 65 ? 'We know their instructions' : '');
    if (st.economy.reserveMonths < 3) add('Reserve position', -7, 'We cannot sustain a long standoff');

    nego.leverageFactors = factors;
    nego.leverageOurs = S.clamp(ours, 2, 98);
    nego.leverageTheirs = S.clamp(theirs, 2, 98);
    return nego.leverageOurs;
  };

  /* ============================================================ UTILITY */
  Nego.theirUtility = function (nego, offer) {
    let num = 0, den = 0;
    nego.issues.forEach((i) => {
      const v = offer[i.id];
      num += i.weightThem * (100 - v);
      den += i.weightThem * 100;
    });
    return den ? num / den : 0.5;
  };
  Nego.yourUtility = function (nego, offer) {
    let num = 0, den = 0;
    nego.issues.forEach((i) => {
      num += i.weightYou * offer[i.id];
      den += i.weightYou * 100;
    });
    return den ? num / den : 0.5;
  };

  Nego.redlineViolations = function (nego, offer) {
    return nego.issues.filter((i) => offer[i.id] > i.redline);
  };

  /* Their minimum acceptable utility, falling as patience runs out. */
  Nego.reservation = function (nego) {
    const p = Nego.PERSONALITIES[nego.personality];
    const lev = (nego.leverageTheirs - 50) / 100; // -0.5 .. +0.5
    const base = 0.50 + lev * 0.62;
    const progress = nego.round / Math.max(1, nego.maxRounds);
    const decay = (p.concede === 'boulware' ? Math.pow(progress, 2.6) : progress) * 0.20;
    return S.clamp(base - decay - nego.softening, 0.08, 0.94);
  };

  Nego.acceptChance = function (nego, offer) {
    const u = Nego.theirUtility(nego, offer);
    const r = Nego.reservation(nego);
    const viol = Nego.redlineViolations(nego, offer);
    const p = Nego.PERSONALITIES[nego.personality];
    let chance = 1 / (1 + Math.exp(-(u - r) * 16));
    viol.forEach((i) => { chance *= (1 - p.redlineHard) * (0.5 + (100 - i.redline) / 200); });
    chance *= 0.55 + (nego.trust / 100) * 0.6;
    if (nego.round < 2) chance *= 0.55; // nobody accepts the opening bid
    return S.clamp(chance, 0, 0.985);
  };

  /* ================================================ COUNTEROFFER SEARCH */
  // Integrative bargaining: concede first where their gain per unit of our
  // loss is highest. That produces packages that feel intelligent.
  Nego.counterOffer = function (nego, playerOffer) {
    const p = Nego.PERSONALITIES[nego.personality];
    const target = Nego.targetUtility(nego);
    const issues = nego.issues.slice();

    // Start from their current position, then move toward the player's
    // offer on the issues that cost them least.
    const offer = {};
    issues.forEach((i) => { offer[i.id] = nego.theirOffer ? nego.theirOffer[i.id] : Math.max(0, 100 - i.redline - 12); });

    const order = issues.slice().sort((a, b) =>
      (a.weightThem / a.weightYou) - (b.weightThem / b.weightYou));

    let guard = 0;
    while (Nego.theirUtility(nego, offer) > target && guard++ < 400) {
      let moved = false;
      for (const i of order) {
        const goal = playerOffer ? playerOffer[i.id] : 100;
        if (offer[i.id] < Math.min(goal, i.redline)) {
          const step = p.concede === 'erratic' ? nego.rng.range(2, 12) : 4;
          offer[i.id] = Math.min(offer[i.id] + step, Math.min(goal, i.redline));
          moved = true;
          if (Nego.theirUtility(nego, offer) <= target) break;
        }
      }
      if (!moved) break;
    }

    // Reciprocity: idealists and institutionalists match player movement.
    if ((p.concede === 'reciprocal' || p.concede === 'balanced') && nego.lastPlayerConcession > 0) {
      order.forEach((i) => {
        offer[i.id] = Math.min(i.redline, offer[i.id] + nego.lastPlayerConcession * 0.4);
      });
    }
    if (p.concede === 'erratic' && nego.rng.chance(0.3)) {
      const i = nego.rng.pick(issues);
      offer[i.id] = Math.max(0, offer[i.id] - nego.rng.range(5, 20));
    }
    issues.forEach((i) => { offer[i.id] = S.clamp(Math.round(offer[i.id]), 0, 100); });
    return offer;
  };

  Nego.targetUtility = function (nego) {
    const p = Nego.PERSONALITIES[nego.personality];
    const r = Nego.reservation(nego);
    const opening = S.clamp(r + 0.30, 0, 0.97);
    const progress = S.clamp(nego.round / Math.max(1, nego.maxRounds), 0, 1);
    const curve = p.concede === 'boulware' ? Math.pow(progress, 2.4) :
      p.concede === 'steady' ? progress :
        p.concede === 'integrative' ? Math.pow(progress, 1.4) : Math.pow(progress, 1.1);
    return S.clamp(opening - (opening - r) * curve, r, 0.98);
  };

  /* ================================================= LEVERAGE ACTIONS */
  Nego.ACTIONS = [
    {
      id: 'intel', name: 'Table Intelligence',
      desc: 'Reveal what our services know about their instructions and their real constraints.',
      can: (st) => st.intel.strength > 35,
      cost: (st) => 'Burns a source · Intel −4',
      run: (st, nego) => {
        st.intel.strength -= 4;
        nego.softening += 0.05 + (st.intel.strength / 1000);
        nego.revealLevel = Math.min(2, nego.revealLevel + 1);
        return 'Our delegation set a folder on the table and said nothing. Their principal read two pages and asked for a recess.';
      }
    },
    {
      id: 'threat', name: 'Threaten Escalation',
      desc: 'Make the alternative to agreement explicitly worse for them.',
      can: (st) => st.military.power > 5,
      cost: () => 'World tension +4 · Relations −6 · May backfire',
      run: (st, nego) => {
        const n = S.dip(st, nego.nationId);
        st.world.tension += 4;
        if (n) n.relation -= 6;
        const credible = nego.leverageOurs > 52;
        if (credible) {
          nego.softening += 0.09; nego.trust -= 8;
          return 'The threat landed. Their delegation stopped taking notes and started taking it seriously.';
        }
        nego.softening -= 0.05; nego.trust -= 14; nego.patience -= 1;
        if (n) n.grievance = (n.grievance || 0) + 8;
        return 'The threat did not land. They know what we can actually do, and they let the silence say so.';
      }
    },
    {
      id: 'sweeten', name: 'Offer a Side Payment',
      desc: 'Money, credit lines or a quiet favour outside the formal text.',
      can: (st) => st.economy.reserves > st.economy.gdp * 0.005,
      cost: (st) => 'Costs ' + S.money(st.economy.gdp * 0.012) + ' from reserves',
      run: (st, nego) => {
        st.economy.reserves -= st.economy.gdp * 0.012;
        nego.softening += 0.075; nego.trust += 5;
        return 'A separate letter, not for publication, was initialled at the side table.';
      }
    },
    {
      id: 'public', name: 'Go Public',
      desc: 'Take the position to the world\'s press and put their government on the defensive.',
      can: (st) => st.national.softPower > 25,
      cost: () => 'Approval ±, prestige at risk, hardens their position if it fails',
      run: (st, nego) => {
        const good = st.national.softPower > 50 && st.national.prestige > 45;
        if (good) {
          nego.softening += 0.06; st.society.approval += 2;
          nego.patience -= 1;
          return 'The story ran everywhere. Their capital woke up to editorials asking why they are being unreasonable.';
        }
        nego.softening -= 0.04; nego.trust -= 10; st.society.approval -= 1;
        return 'The story ran and nobody picked it up. Their negotiator thanked us for the free publicity.';
      }
    },
    {
      id: 'walkthreat', name: 'Signal Willingness to Walk',
      desc: 'Instruct the delegation to book flights home, loudly.',
      can: () => true,
      cost: () => 'Their patience −2 · High risk of collapse',
      run: (st, nego) => {
        nego.patience -= 2;
        if (nego.leverageOurs > 55) {
          nego.softening += 0.10;
          return 'Our team began packing. Within the hour their principal requested an unscheduled meeting.';
        }
        nego.softening -= 0.03;
        return 'Our team began packing. They wished us a safe journey and ordered coffee.';
      }
    },
    {
      id: 'concede', name: 'Make a Goodwill Gesture',
      desc: 'Move first on a secondary issue to unstick the room.',
      can: () => true,
      cost: () => 'Gives ground on your lowest-priority issue',
      run: (st, nego) => {
        const i = nego.issues.slice().sort((a, b) => a.weightYou - b.weightYou)[0];
        nego.offer[i.id] = Math.max(0, nego.offer[i.id] - 18);
        nego.trust += 10; nego.softening += 0.03;
        return 'We moved on ' + i.label.toLowerCase() + ' without being asked. The temperature in the room dropped a degree.';
      }
    }
  ];

  /* ============================================================== OPEN */
  Nego.open = function (st, kind, nationId, ctx) {
    const n = S.dip(st, nationId);
    const personality = n ? n.personality : 'strategic';
    const p = Nego.PERSONALITIES[personality];
    const nego = {
      id: S.uid('nego'), kind: kind, nationId: nationId, ctx: ctx || {},
      personality: personality,
      issues: Nego.buildIssues(st, kind, n, ctx),
      round: 0, maxRounds: p.patience + 2, patience: p.patience,
      softening: 0, trust: n ? S.clamp(50 + n.relation * 0.35, 5, 95) : 50,
      revealLevel: 0, lastPlayerConcession: 0,
      transcript: [], status: 'open', rng: st.rng,
      usedActions: []
    };
    Nego.computeLeverage(st, nego);
    nego.theirOffer = {};
    nego.issues.forEach((i) => { nego.theirOffer[i.id] = Math.max(0, Math.round(100 - i.redline - 10)); });
    nego.offer = {};
    nego.issues.forEach((i) => { nego.offer[i.id] = 72; });
    nego.transcript.push({ who: 'sys', text: Nego.openingLine(st, nego) });
    nego.transcript.push({ who: 'them', text: Nego.theirStatement(st, nego, 'open') });
    st.negotiation = nego;
    return nego;
  };

  Nego.title = function (st, nego) {
    const n = S.dip(st, nego.nationId);
    const who = n ? n.name : 'the counterparty';
    return ({
      peace: 'Peace Talks — ' + who, trade: 'Trade Negotiation — ' + who,
      alliance: 'Alliance Talks — ' + who, ultimatum: 'Crisis Talks — ' + who,
      arms: 'Arms Control — ' + who, resource: 'Energy Contract — ' + who
    })[nego.kind] || ('Negotiation — ' + who);
  };

  Nego.openingLine = function (st, nego) {
    const n = S.dip(st, nego.nationId);
    const place = st.rng.pick(['a neutral capital', 'the old customs house', 'a lakeside hotel',
      'the foreign ministry annexe', 'a converted monastery', 'an airport hotel nobody chose']);
    return 'Talks convened in ' + place + '. ' + (n ? n.name : 'The delegation') +
      ' is represented by a delegation with ' +
      (nego.leverageTheirs > 58 ? 'visibly little urgency' : nego.leverageTheirs < 42 ?
        'instructions to come home with something' : 'a narrow mandate') + '.';
  };

  /* --------------------------------------------------- generated speech */
  Nego.theirStatement = function (st, nego, phase, offer) {
    const n = S.dip(st, nego.nationId);
    const p = Nego.PERSONALITIES[nego.personality];
    const rng = st.rng;
    // Which issue is furthest from their position?
    let worst = null, worstGap = -1;
    nego.issues.forEach((i) => {
      const gap = ((offer ? offer[i.id] : nego.offer[i.id]) - (100 - i.redline)) * i.weightThem;
      if (gap > worstGap) { worstGap = gap; worst = i; }
    });
    const lev = nego.leverageTheirs;

    if (phase === 'open') {
      const tone = {
        blunt: 'We will save everyone time. Our requirements are not a starting position.',
        procedural: 'We are here in good faith and within a mandate. Let us begin with the text.',
        measured: 'We have studied your situation carefully. We think there is an agreement here, at a price.',
        even: 'We are not aligned with anyone in this room. Convince us on the merits.',
        careful: 'Our instructions are cautious. We would rather leave with nothing than with a bad text.',
        commercial: 'Let us treat this as what it is — a transaction. What are you actually buying?',
        sly: 'Circumstances have been kind to us lately. We are happy to wait for them to be kinder.',
        heated: 'You will forgive us if we do not pretend this is a normal negotiation.',
        earnest: 'There is a settlement here that both our peoples could live with. Let us find it.'
      }[p.tone];
      return tone;
    }
    if (phase === 'accept') {
      return rng.pick([
        'We can live with this. Our principals will initial the text tonight.',
        'Agreed. We will need a week for ratification, but the substance is settled.',
        'This is acceptable. It is not what we wanted, which is usually the sign of a real agreement.',
        'Done. Let us both go home and describe this as a victory.'
      ]);
    }
    if (phase === 'collapse') {
      return rng.pick([
        'There is nothing further to discuss. Our delegation is leaving tonight.',
        'You have wasted our time and, more importantly, our patience. We are done.',
        'We will inform our government that talks failed and that the fault is yours.',
        'This process is over. What happens next is no longer a negotiation.'
      ]);
    }
    // Counter-offer commentary.
    const parts = [];
    if (worst && worstGap > 0) {
      parts.push(rng.pick([
        'Your position on ' + worst.label.toLowerCase() + ' is not something we can carry home.',
        'We cannot move further on ' + worst.label.toLowerCase() + '. That is a mandate limit, not a tactic.',
        'Strike ' + worst.label.toLowerCase() + ' from your expectations and we can make progress.',
        'On ' + worst.label.toLowerCase() + ', you are asking us to do something our own parliament would not survive.'
      ]));
    }
    if (lev > 62) {
      parts.push(rng.pick([
        'We are not the party under time pressure here.',
        'Our position improves with every week this takes. Yours does not.',
        'We have alternatives. We have read the reports on yours.'
      ]));
    } else if (lev < 40) {
      parts.push(rng.pick([
        'We would rather not test what happens if this fails.',
        'There is a version of this we can accept. Help us find it quickly.',
        'Our instructions have become more flexible since we arrived.'
      ]));
    }
    if (nego.revealLevel > 0 && rng.chance(0.5)) {
      parts.push('You appear to be unusually well briefed. We will adjust accordingly.');
    }
    if (st.wars.some((w) => w.enemyId === nego.nationId && w.score < -20) && rng.chance(0.6)) {
      parts.push('Every day this continues, the map improves for us.');
    }
    if (!parts.length) parts.push('Here is our revised text. We have moved where we can.');
    return parts.join(' ');
  };

  /* ------------------------------------------------------ player action */
  Nego.submit = function (st, nego) {
    if (nego.status !== 'open') return;
    // Track concession size for reciprocal personalities.
    if (nego.prevOffer) {
      let conceded = 0;
      nego.issues.forEach((i) => { conceded += Math.max(0, nego.prevOffer[i.id] - nego.offer[i.id]); });
      nego.lastPlayerConcession = conceded / nego.issues.length;
    }
    nego.prevOffer = Object.assign({}, nego.offer);
    nego.round++;
    Nego.computeLeverage(st, nego);

    nego.transcript.push({ who: 'you', text: Nego.describeOffer(nego, nego.offer) });

    const chance = Nego.acceptChance(nego, nego.offer);
    if (st.rng.chance(chance)) {
      nego.status = 'accepted';
      nego.transcript.push({ who: 'them', text: Nego.theirStatement(st, nego, 'accept') });
      return 'accepted';
    }

    nego.patience -= 1;
    const p = Nego.PERSONALITIES[nego.personality];
    const insulting = Nego.theirUtility(nego, nego.offer) < Nego.reservation(nego) - 0.3;
    if (insulting && st.rng.chance(p.walk)) nego.patience -= 1;

    if (nego.patience <= 0 || nego.round >= nego.maxRounds) {
      nego.status = 'collapsed';
      nego.transcript.push({ who: 'them', text: Nego.theirStatement(st, nego, 'collapse') });
      return 'collapsed';
    }

    nego.theirOffer = Nego.counterOffer(nego, nego.offer);
    nego.transcript.push({ who: 'them', text: Nego.theirStatement(st, nego, 'counter', nego.offer) });
    nego.transcript.push({ who: 'sys', text: 'They tabled a revised text.' });
    return 'continue';
  };

  Nego.describeOffer = function (nego, offer) {
    const bits = nego.issues.map((i) => i.label + ': ' + i.fmt(offer[i.id]));
    return 'Our text: ' + bits.join(' · ');
  };

  Nego.acceptTheirs = function (st, nego) {
    nego.offer = Object.assign({}, nego.theirOffer);
    nego.status = 'accepted';
    nego.transcript.push({ who: 'you', text: 'We accept your text as tabled.' });
    nego.transcript.push({ who: 'them', text: 'Then we are finished. Signatures in the morning.' });
    return 'accepted';
  };

  /* --------------------------------------------------------- settlement */
  Nego.conclude = function (st, nego) {
    const n = S.dip(st, nego.nationId);
    if (nego.status === 'accepted') {
      nego.issues.forEach((i) => { try { i.apply(st, nego.offer[i.id], n); } catch (e) { /* ignore */ } });
      const yourU = Nego.yourUtility(nego, nego.offer);
      if (n) {
        n.relation += 14 + (yourU < 0.4 ? 8 : 0);
        n.grievance = Math.max(0, (n.grievance || 0) - 20);
        n.cooldown = 6;
      }
      if (yourU > 0.62) { st.national.diplomaticWins++; st.national.prestige += 3; st.society.approval += 2; }
      else if (yourU < 0.38) { st.national.diplomaticLosses++; st.national.concessions++; st.society.approval -= 3; }

      switch (nego.kind) {
        case 'peace': {
          const war = st.wars.find((w) => w.id === nego.ctx.war);
          if (war) S.Mil.endWar(st, war, yourU > 0.6 ? 'victory' : yourU < 0.4 ? 'defeat' : 'settlement');
          break;
        }
        case 'trade': S.Dip.signTreaty(st, nego.nationId, 'trade'); break;
        case 'alliance': S.Dip.signTreaty(st, nego.nationId, 'defense'); break;
        case 'arms': S.Dip.signTreaty(st, nego.nationId, 'arms'); st.world.tension -= 6; break;
        case 'resource': S.Dip.signTreaty(st, nego.nationId, 'energy'); break;
        case 'ultimatum':
          if (yourU > 0.55) { st.national.prestige += 5; st.society.approval += 3; }
          break;
        default: break;
      }
      S.News.push(st, 'nego_success', { nation: n ? n.name : 'a foreign power', kind: nego.kind, severity: 'major' });
      S.game.event('Agreement reached with ' + (n ? n.name : 'the counterparty') + '.', yourU > 0.5 ? 'good' : '');
    } else if (nego.status === 'collapsed' || nego.status === 'walked') {
      if (n) {
        n.relation -= 12; n.grievance = (n.grievance || 0) + 12; n.cooldown = 4;
      }
      st.national.diplomaticLosses++;
      st.world.tension += 4;
      S.News.push(st, 'nego_fail', { nation: n ? n.name : 'a foreign power', severity: 'major' });
      S.game.event('Talks with ' + (n ? n.name : 'the counterparty') + ' collapsed without agreement.', 'bad');
      if (nego.kind === 'ultimatum' && n && n.milPower > st.military.power * 0.9 && st.rng.chance(0.45)) {
        S.Mil.startWar(st, n.id, { aggressor: false, intensity: 65 });
      }
      if (nego.kind === 'peace') {
        const war = st.wars.find((w) => w.id === nego.ctx.war);
        if (war) { war.peaceOffered = false; war.intensity = Math.min(100, war.intensity + 10); }
      }
    }
    st.negotiation = null;
  };

  /* Used when a war ends via a decision rather than the talks screen. */
  Nego.applyTerms = function (st, terms) {
    if (!terms) return;
    if (terms.prestige) st.national.prestige += terms.prestige;
    if (terms.reparations) st.economy.reserves += terms.reparations;
    if (terms.approval) st.society.approval += terms.approval;
  };

})(window.S);

/* STRATEGIAN — initiatives.
   Everything here is something you do rather than something you answer.
   One-off actions resolve immediately; programmes run for years, cost money
   every one of them, and deliver their payoff at the end.                */
(function (S) {
  'use strict';

  const Act = S.Actions = {};

  /* ======================================================== PROGRAMMES */
  Act.startProgramme = function (st, spec) {
    st.programmes = st.programmes || [];
    if (st.programmes.some((p) => p.key === spec.key)) return null;
    const p = {
      id: S.uid('prog'), key: spec.key, name: spec.name, dept: spec.dept,
      desc: spec.desc || '', years: spec.years, elapsed: 0,
      costPct: spec.costPct, perYear: spec.perYear || {}, onComplete: spec.key,
      covert: !!spec.covert,
      started: S.dateLabel(st.date)
    };
    st.programmes.push(p);
    // Covert programmes do not get announced in the press.
    if (!spec.covert) {
      S.News.custom(st, spec.headline || (spec.name + ' Begins'), 'good',
        S.round(spec.costPct, 2) + '% of output a year for ' + spec.years + ' years');
    }
    return p;
  };

  // Completion payoffs, keyed by programme. Kept separate so a programme
  // survives a save/load round trip without carrying functions.
  Act.COMPLETION = {
    hospitals: (st) => { st.quality.health += 10; st.society.approval += 5; return 'The last of the new hospitals has opened. Waiting lists are measurably shorter.'; },
    vaccination: (st) => { st.quality.health += 6; st.pop.growth += 0.05; return 'The immunisation campaign has reached national coverage.'; },
    literacy: (st) => { st.quality.education += 9; st.economy.productivity += 3; return 'The literacy campaign has closed with attainment sharply higher.'; },
    universities: (st) => { st.quality.science += 10; st.quality.education += 4; return 'The new university campuses have graduated their first cohort.'; },
    scholarships: (st) => { st.diplomacy.nations.forEach((n) => { n.affinity += 9; }); st.national.softPower += 6; return 'A decade of foreign graduates now hold posts in ministries abroad.'; },
    arts: (st) => { st.quality.culture += 10; st.national.softPower += 8; return 'Our films, music and broadcasting now reach a permanent foreign audience.'; },
    nationalinfra: (st) => { st.quality.infra += 12; st.economy.productivity += 3; return 'The national infrastructure programme is complete and in service.'; },
    gridharden: (st) => { st.quality.energy += 12; st.flags.gridHardened = true; return 'The grid has been hardened. Outages are now rare.'; },
    rail: (st) => { st.quality.infra += 10; st.national.prestige += 6; st.factions.forEach((f) => { if (f.id === 'provinces') f.loyalty += 12; }); return 'The rail spine is open end to end. Journey times between the major cities have fallen by more than half.'; },
    ports: (st) => { st.economy.exports *= 1.06; st.military.logistics += 8; st.quality.infra += 5; return 'The expanded port is handling volumes the old one could not.'; },
    housing: (st) => { st.society.inequality -= 5; st.society.approval += 6; st.quality.infra += 4; return 'The housing programme has delivered. Rents in the cities have stopped climbing.'; },
    policereform: (st) => { st.quality.security += 10; st.society.crime -= 8; st.society.latent -= 6; return 'Police reform is complete. Complaints are down and clearance rates are up.'; },
    cyber: (st) => { st.intel.strength += 10; st.flags.cyberCapable = true; return 'The offensive cyber programme has reached initial operating capability.'; },
    watersan: (st) => { st.quality.health += 8; st.quality.infra += 4; return 'Clean water and sanitation now reach the districts that had neither.'; },
    ruralclinics: (st) => { st.quality.health += 7; st.factions.forEach((f) => { if (f.id === 'provinces') f.loyalty += 8; }); return 'The rural clinic network is staffed and open.'; },
    shadowexports: (st) => {
      const take = st.economy.gdp * 0.012;
      st.economy.reserves += take;
      return 'The network has been wound down on schedule. ' + S.money(take) + ' in restricted trade cleared through intermediaries, none of it on the public accounts.';
    },
    blackpropaganda: (st) => {
      st.policy.interior.propaganda = S.clamp(st.policy.interior.propaganda + 12, 0, 100);
      st.society.approval += 3;
      return 'The directorate has embedded its placement network across print, broadcast and online outlets.';
    },
    darkmoney: (st) => {
      st.diplomacy.nations.forEach((n) => { if (!n.absorbedBy) n.affinity += 6; });
      st.national.diplomaticWins++;
      return 'The accounts have run their course. A layer of editors, officials and party treasurers abroad now owes us their position.';
    }
  };

  Act.programmeTick = function (st, dt) {
    st.programmes = st.programmes || [];
    let cost = 0;
    for (let i = st.programmes.length - 1; i >= 0; i--) {
      const p = st.programmes[i];
      cost += (p.costPct / 100) * st.economy.gdp;
      p.elapsed += dt;
      // Steady delivery along the way, so progress is visible before the end.
      for (const path in p.perYear) S.addPath(st, path, p.perYear[path] * dt);
      if (p.elapsed >= p.years) {
        st.programmes.splice(i, 1);
        const fn = Act.COMPLETION[p.key];
        const text = fn ? fn(st) : (p.name + ' is complete.');
        S.game.event(text, 'good');
        if (!p.covert) S.News.custom(st, p.name + ' Completed', 'good');
      }
    }
    st.economy.programmeSpending = cost;
  };

  Act.cancelProgramme = function (st, id) {
    const i = st.programmes.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = st.programmes[i];
    st.programmes.splice(i, 1);
    if (p.covert) {
      S.game.event(p.name + ' has been quietly dismantled. The money already spent is gone.', '');
      return;
    }
    st.society.approval -= 3;
    st.national.prestige -= 1;
    S.game.event(p.name + ' has been cancelled. The money already spent is gone.', 'bad');
    S.News.custom(st, p.name + ' Cancelled Mid-Delivery', 'bad');
  };

  /* ========================================================== HELPERS */
  /* Operations have real price tags that do not scale linearly with the
     economy: a nuclear test costs what a nuclear test costs. `cost.money`
     is an absolute figure (billions, at a mid-sized economy) scaled gently
     by economic weight; `cost.moneyPct` scales with GDP. When both are
     present the charge is the smaller — %GDP for small economies, the
     absolute figure as a cap for large ones. */
  Act.opScale = function (st) {
    return S.clamp(Math.pow(st.economy.gdp / 2000, 0.35), 0.25, 4);
  };
  Act.opCost = function (st, a) {
    if (!a.cost) return 0;
    const pct = a.cost.moneyPct ? (a.cost.moneyPct / 100) * st.economy.gdp : null;
    const abs = a.cost.money != null ? a.cost.money * Act.opScale(st) : null;
    if (pct != null && abs != null) return Math.min(pct, abs);
    return pct != null ? pct : (abs != null ? abs : 0);
  };

  function pay(st, amount) {
    const fromReserves = Math.min(st.economy.reserves, amount);
    st.economy.reserves -= fromReserves;
    st.economy.debt += amount - fromReserves;
    return amount;
  }
  Act.pay = pay;

  const prog = (key, name, dept, years, costPct, desc, perYear, headline) =>
    ({ key, name, dept, years, costPct, desc, perYear, headline });

  /* ======================================================= THE LIBRARY */
  Act.LIB = [

    /* ------------------------------------------------------------ WAR */
    {
      id: 'mobilise', dept: 'war', name: 'Mobilise the Reserves',
      desc: 'Call up reserve formations and bring the standing force to war establishment.',
      cost: { moneyPct: 0.55, approval: -3, unrest: 2 }, cooldown: 400,
      requires: (st) => st.military.readiness < 88,
      run: (st) => {
        st.military.readiness = S.clamp(st.military.readiness + 20, 0, 100);
        st.military.manpower *= 1.30;
        st.world.tension += 4;
        st.factions.forEach((f) => { if (f.id === 'military') f.loyalty += 5; });
        return 'Reserve formations have been called up. Readiness and manpower are up; the civilian economy is short the same people.';
      }
    },
    {
      id: 'standdown', dept: 'war', name: 'Stand Down to Peacetime Posture',
      desc: 'Release the reserves, cut the operational tempo, and reduce the defence line.',
      cost: { approval: 2 }, cooldown: 400,
      requires: (st) => !st.wars.length && st.military.readiness > 45,
      unavailable: () => 'Not while there is fighting.',
      run: (st) => {
        st.military.readiness = Math.max(30, st.military.readiness - 14);
        st.military.morale += 5; st.military.equipment += 3;
        st.world.tension -= 3;
        st.budget.alloc.defense = Math.max(0.5, st.budget.alloc.defense * 0.93);
        return 'The force has stood down. Units are refitting and the defence budget line has been reduced.';
      }
    },
    {
      id: 'exercise', dept: 'war', name: 'Stage a Major Exercise',
      desc: 'A large joint exercise. Raises readiness and reassures allies; rivals read it as signalling.',
      cost: { moneyPct: 0.22, money: 1.5 }, cooldown: 500,
      run: (st) => {
        st.military.readiness = S.clamp(st.military.readiness + 9, 0, 100);
        st.military.morale += 5; st.military.logistics += 3;
        st.world.tension += 5;
        st.diplomacy.nations.forEach((n) => {
          if (n.allyOfUs) n.relation += 4;
          else if (n.relation < -20) { n.threatPerception += 8; n.relation -= 3; }
        });
        S.News.custom(st, 'Largest Military Exercise in Years Begins', '');
        return 'Three corps manoeuvred for two weeks. Readiness and logistics have improved; hostile capitals have protested.';
      }
    },
    {
      id: 'procure', dept: 'war', name: 'Emergency Procurement',
      desc: 'Buy equipment off the shelf at premium prices rather than waiting for the standard programme.',
      cost: { moneyPct: 1.10 }, cooldown: 700,
      requires: (st) => st.military.equipment < 85,
      run: (st) => {
        st.military.equipment = S.clamp(st.military.equipment + 12, 0, 100);
        st.economy.businessConfidence += 2;
        return 'Deliveries begin immediately at above-market prices. Equipment levels are rising faster than training can absorb them.';
      }
    },
    {
      id: 'veterans', dept: 'war', name: 'Veterans\' Settlement',
      desc: 'Pensions, healthcare and housing for former service personnel.',
      cost: { moneyPct: 0.35, approval: 4 }, cooldown: 1200,
      run: (st) => {
        st.policy.mil.veteranCare = S.clamp(st.policy.mil.veteranCare + 22, 0, 100);
        st.military.morale += 8;
        st.factions.forEach((f) => {
          if (f.id === 'military') f.loyalty += 12;
          if (f.id === 'nationalists') f.loyalty += 6;
        });
        return 'The settlement is law. Veteran support has risen sharply and the officer corps has registered it.';
      }
    },
    {
      id: 'peacekeepers', dept: 'war', name: 'Deploy Peacekeepers',
      desc: 'Commit forces to an international stabilisation mission. Builds prestige; carries casualty risk.',
      cost: { moneyPct: 0.30, money: 1.8 }, cooldown: 800,
      requires: (st) => st.military.readiness > 40 && !st.wars.length,
      unavailable: () => 'Requires a rested force and no war of our own.',
      run: (st) => {
        st.national.prestige += 7; st.national.softPower += 5;
        st.world.tension -= 4;
        st.military.readiness -= 6; st.military.veterancy += 6;
        st.diplomacy.nations.forEach((n) => { n.relation += 3; });
        if (st.rng.chance(0.30)) {
          const dead = st.rng.int(20, 140);
          st.society.approval -= 4;
          S.News.custom(st, 'Peacekeepers Killed in Ambush', 'bad', S.num(dead) + ' of our soldiers dead');
          return 'The deployment continues, but we have taken casualties and support at home has fallen.';
        }
        return 'Our contingent has deployed under the international flag. The mission is stable and the diplomatic credit is real.';
      }
    },
    {
      id: 'nucleartest', dept: 'war', name: 'Conduct a Nuclear Test',
      desc: 'An underground test to confirm and demonstrate the deterrent. Triggers condemnation and sanctions risk.',
      cost: { money: 0.35 }, cooldown: 1800, danger: true,
      requires: (st) => st.policy.mil.nuclearPosture !== 'renounced' && st.quality.science > 40,
      unavailable: () => 'Requires a nuclear posture and a scientific base.',
      run: (st) => {
        st.military.nuclear = S.clamp(st.military.nuclear + 14, 0, 100);
        st.national.prestige += 8;
        st.world.tension += 20;
        st.factions.forEach((f) => { if (f.id === 'nationalists') f.loyalty += 10; if (f.id === 'intelligentsia') f.loyalty -= 8; });
        st.diplomacy.nations.forEach((n) => {
          n.relation -= 14; n.threatPerception += 15;
          if (n.power > 55 && st.rng.chance(0.5)) n.sanctioningUs = true;
        });
        S.News.custom(st, 'Nuclear Test Confirmed; Capitals Condemn', 'bad');
        S.Aftermath.schedule(st, 'sanctions_bite', {}, st.rng.int(400, 800));
        return 'Seismic stations worldwide registered the test within minutes. Several governments are drafting sanctions.';
      }
    },
    {
      id: 'armsdeal', dept: 'war', name: 'Arms Export Package', target: 'nation',
      desc: 'Sell weapons to a foreign government. Immediate income; a long-term entanglement.',
      cost: {}, cooldown: 500,
      requires: (st) => st.military.equipment > 40,
      unavailable: () => 'Our equipment is not competitive on the export market.',
      run: (st, n) => {
        const take = st.economy.gdp * 0.010 * (n.gdp / 3000 + 0.4);
        st.economy.reserves += take;
        n.relation += 14; n.milPower *= 1.03;
        st.world.tension += 3;
        st.economy.businessConfidence += 3;
        return 'The contract with ' + n.name + ' is signed: ' + S.money(take) + ' now, plus a long-term dependency on our spare parts and training.';
      }
    },
    {
      id: 'milaid', dept: 'war', name: 'Military Assistance Package', target: 'nation',
      desc: 'Equip and train a partner\'s forces at our expense.',
      cost: { moneyPct: 0.30, money: 4 }, cooldown: 500,
      run: (st, n) => {
        n.relation += 20; n.warSupport = (n.warSupport || 1) + 0.25;
        n.milPower *= 1.05;
        st.world.tension += 4;
        st.diplomacy.nations.forEach((o) => { if (o.relation < -30 && o.id !== n.id) o.relation -= 4; });
        return 'Trainers and equipment are on their way to ' + n.name + '. Their rivals have registered it.';
      }
    },
    {
      id: 'declarewar', dept: 'war', name: 'Declare War', target: 'nation',
      desc: 'Open hostilities against a chosen state. Requires a ready force; the consequences are permanent.',
      cost: {}, cooldown: 200, danger: true, confirm: true,
      requires: (st) => st.military.readiness > 30,
      unavailable: () => 'The force is not ready to fight anyone.',
      targetFilter: (st, n) => !n.atWar,
      run: (st, n) => {
        S.Mil.startWar(st, n.id, { aggressor: true, intensity: 60, homeSupport: 45 + st.society.cohesion * 0.3 });
        st.national.aggressionScore += 25;
        st.diplomacy.nations.forEach((o) => { if (o.id !== n.id) o.relation -= 12; });
        st.factions.forEach((f) => {
          if (f.id === 'nationalists') f.loyalty += 8;
          if (f.id === 'intelligentsia' || f.id === 'reformers') f.loyalty -= 10;
        });
        return 'We are at war with ' + n.name + '. Foreign governments are re-evaluating their positions toward us.';
      }
    },

    /* -------------------------------------------------------- FOREIGN */
    {
      id: 'denounce', dept: 'foreign', name: 'Denounce a Government', target: 'nation',
      desc: 'Condemn their government publicly and by name. Plays well with their critics; damages relations with them.',
      cost: {}, cooldown: 240,
      run: (st, n) => {
        n.relation -= 18; n.grievance = (n.grievance || 0) + 10;
        st.world.tension += 3;
        st.society.approval += 2;
        st.factions.forEach((f) => { if (f.id === 'nationalists') f.loyalty += 5; });
        // Denouncing an authoritarian government plays well with liberal states.
        const gap = S.Dip.ideologyGap(st, n);
        if (gap > 45) {
          st.national.softPower += 4;
          st.diplomacy.nations.forEach((o) => { if (o.id !== n.id && S.Dip.ideologyGap(st, o) < 25) o.relation += 4; });
        } else { st.national.softPower -= 2; }
        S.News.custom(st, 'Government Condemns ' + n.name + ' in Unusually Direct Terms', '');
        return 'The statement named ' + n.name + ' directly. Their ambassador has been recalled for consultations.';
      }
    },
    {
      id: 'statevisit', dept: 'foreign', name: 'State Visit', target: 'nation',
      desc: 'Full honours and three days of substantive meetings.',
      cost: { money: 0.04 }, cooldown: 300,
      run: (st, n) => {
        n.relation += 15; n.affinity += 4; n.grievance = Math.max(0, (n.grievance || 0) - 8);
        st.national.prestige += 2;
        return 'The visit to ' + n.name + ' concluded with agreements on trade facilitation and consular access. Relations have improved.';
      }
    },
    {
      id: 'conference', dept: 'foreign', name: 'Convene an International Conference',
      desc: 'Host the major powers on a standing dispute. Lowers world tension; requires the standing to convene them.',
      cost: { money: 0.35 }, cooldown: 900,
      requires: (st) => st.national.prestige > 35,
      unavailable: () => 'Our standing is too low to convene the powers.',
      run: (st) => {
        const drop = 6 + st.national.prestige * 0.10;
        st.world.tension -= drop;
        st.national.prestige += 6; st.national.softPower += 5;
        st.national.diplomaticWins++;
        st.diplomacy.nations.forEach((n) => { n.relation += 5; n.grievance = Math.max(0, (n.grievance || 0) - 6); });
        S.News.custom(st, 'Powers Gather in Our Capital for Landmark Conference', 'good');
        return 'The conference closed with an agreed communiqué. World tension is down ' + S.round(drop, 0) + ' points.';
      }
    },
    {
      id: 'expel', dept: 'foreign', name: 'Expel Their Diplomats', target: 'nation',
      desc: 'Declare their mission persona non grata. A step short of severing relations.',
      cost: {}, cooldown: 300,
      run: (st, n) => {
        n.relation -= 14; n.grievance = (n.grievance || 0) + 12;
        st.intel.strength -= 3; st.world.tension += 4;
        st.society.approval += 2;
        return 'Their diplomats have been expelled. Their intelligence station here is closed — and so is the channel we monitored through it.';
      }
    },
    {
      id: 'aidsurge', dept: 'foreign', name: 'Humanitarian Airlift', target: 'nation',
      desc: 'Emergency relief, delivered visibly and fast.',
      cost: { moneyPct: 0.10, money: 0.6 }, cooldown: 400,
      run: (st, n) => {
        n.relation += 16; n.affinity += 10;
        st.national.softPower += 7; st.national.prestige += 3;
        st.diplomacy.nations.forEach((o) => { o.affinity += 2; });
        S.News.custom(st, 'Our Aircraft First to Land with Relief Supplies', 'good');
        return 'Our transports landed first with relief supplies. Regional goodwill has measurably improved.';
      }
    },

    /* --------------------------------------------------------- HEALTH */
    {
      id: 'publichealth', dept: 'social', name: 'Public Health Campaign',
      desc: 'Screening, prevention and mass public messaging.',
      cost: { moneyPct: 0.08, money: 0.9 }, cooldown: 500,
      run: (st) => {
        st.quality.health += 4; st.society.approval += 3; st.pop.growth += 0.02;
        return 'Screening uptake has risen and early diagnoses are up.';
      }
    },
    {
      id: 'pandemicprep', dept: 'social', name: 'Pandemic Preparedness Stockpile',
      desc: 'Stockpile ventilators, antivirals and protective equipment, and write national surge plans.',
      cost: { moneyPct: 0.14, money: 2.5 }, cooldown: 2000,
      requires: (st) => !st.flags.pandemicPrepared,
      unavailable: () => 'Already stockpiled.',
      run: (st) => {
        st.flags.pandemicPrepared = true;
        st.quality.health += 3;
        return 'The stockpile is built and surge plans are in place. The next epidemic will meet a prepared system.';
      }
    },
    {
      id: 'vaccination', dept: 'social', name: 'National Immunisation Campaign', programme: true,
      desc: 'Two years of universal childhood and adult immunisation.',
      cost: { moneyPct: 0.30 }, cooldown: 2000,
      requires: (st) => !st.programmes.some((p) => p.key === 'vaccination'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('vaccination', 'National Immunisation Campaign', 'social', 2, 0.30,
          'Universal immunisation coverage.', { 'quality.health': 1.5 }, 'National Immunisation Campaign Launched'));
        return 'The campaign is under way. Coverage figures will be reported quarterly.';
      }
    },
    {
      id: 'hospitals', dept: 'social', name: 'Hospital Construction Programme', programme: true,
      desc: 'Five years of building and staffing new hospitals.',
      cost: { moneyPct: 0.85 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'hospitals'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('hospitals', 'Hospital Construction Programme', 'social', 5, 0.85,
          'New hospitals, staffed and opened.', { 'quality.health': 1.2, 'society.approval': 0.5 },
          'Hospital Building Programme Announced'));
        return 'Ground has been broken on the first sites. The first openings are three years out.';
      }
    },
    {
      id: 'ruralclinics', dept: 'social', name: 'Rural Clinic Network', programme: true,
      desc: 'Primary care in districts that have never had it. Low cost per head, large effect.',
      cost: { moneyPct: 0.35 }, cooldown: 2600,
      requires: (st) => st.pop.urban < 78 && !st.programmes.some((p) => p.key === 'ruralclinics'),
      unavailable: (st) => st.pop.urban >= 78 ? 'The country is already urbanised.' : 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('ruralclinics', 'Rural Clinic Network', 'social', 4, 0.35,
          'Primary care in underserved districts.', { 'quality.health': 1.0 }, 'Rural Clinic Network Begins'));
        return 'The first clinics are being sited in the least-served districts.';
      }
    },
    {
      id: 'literacy', dept: 'social', name: 'National Literacy Campaign', programme: true,
      desc: 'Four years of adult and childhood literacy work at scale.',
      cost: { moneyPct: 0.40 }, cooldown: 2600,
      requires: (st) => st.quality.education < 80 && !st.programmes.some((p) => p.key === 'literacy'),
      unavailable: (st) => st.quality.education >= 80 ? 'Attainment is already high.' : 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('literacy', 'National Literacy Campaign', 'social', 4, 0.40,
          'Adult and childhood literacy at scale.', { 'quality.education': 1.2 }, 'National Literacy Campaign Launched'));
        return 'Teacher recruitment has begun. Measurable gains will take years to appear.';
      }
    },
    {
      id: 'universities', dept: 'social', name: 'University Expansion', programme: true,
      desc: 'Six years of new campuses, laboratories and research chairs.',
      cost: { moneyPct: 0.55 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'universities'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('universities', 'University Expansion Programme', 'social', 6, 0.55,
          'New campuses, laboratories and chairs.', { 'quality.science': 1.0, 'quality.education': 0.4 },
          'Government Funds Largest University Expansion in Decades'));
        return 'Site works have begun on four campuses.';
      }
    },
    {
      id: 'scholarships', dept: 'social', name: 'International Scholarship Programme', programme: true,
      desc: 'Fund foreign students to study here. Influence compounds as alumni advance abroad.',
      cost: { moneyPct: 0.22 }, cooldown: 2600,
      requires: (st) => st.quality.education > 45 && !st.programmes.some((p) => p.key === 'scholarships'),
      unavailable: () => 'Our universities do not yet attract foreign students.',
      run: (st) => {
        Act.startProgramme(st, prog('scholarships', 'International Scholarship Programme', 'social', 5, 0.22,
          'Foreign students, educated here.', { 'national.softPower': 1.2 }, 'Thousands of Foreign Scholarships Announced'));
        return 'The first intake arrives in September.';
      }
    },
    {
      id: 'arts', dept: 'social', name: 'Arts & Broadcasting Push', programme: true,
      desc: 'Film funds, orchestras, foreign-language broadcasting and an export office.',
      cost: { moneyPct: 0.30 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'arts'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('arts', 'National Arts & Broadcasting Push', 'social', 4, 0.30,
          'Film, music and broadcasting, funded to export.', { 'quality.culture': 1.4, 'national.softPower': 0.8 },
          'State Launches Cultural Export Push'));
        return 'The first co-productions and foreign-language broadcasts have been commissioned.';
      }
    },
    {
      id: 'pensions', dept: 'social', name: 'Raise Pensions and Transfers',
      desc: 'An immediate and permanent uplift to pensions and transfer payments.',
      cost: { approval: 7 }, cooldown: 700,
      run: (st) => {
        st.budget.alloc.welfare += 0.9;
        st.quality.welfareQ += 4; st.society.inequality -= 2;
        st.factions.forEach((f) => { if (f.id === 'labour') f.loyalty += 9; if (f.id === 'business') f.loyalty -= 5; });
        return 'The uplift lands in payments next month. It is now a permanent line in the budget.';
      }
    },

    /* -------------------------------------------- INFRASTRUCTURE / ENERGY */
    {
      id: 'nationalinfra', dept: 'infra', name: 'National Infrastructure Programme', programme: true,
      desc: 'Six years of roads, bridges, water and power.',
      cost: { moneyPct: 1.10 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'nationalinfra'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('nationalinfra', 'National Infrastructure Programme', 'infra', 6, 1.10,
          'Roads, bridges, water and power.', { 'quality.infra': 1.5, 'economy.shock': 0.10 },
          'Government Commits to Six-Year National Infrastructure Programme'));
        return 'Contracts are being let in every province. Construction begins this quarter.';
      }
    },
    {
      id: 'gridharden', dept: 'infra', name: 'Harden the Grid', programme: true,
      desc: 'Three years of redundancy, storage and physical security on the power network.',
      cost: { moneyPct: 0.45 }, cooldown: 2600,
      requires: (st) => !st.flags.gridHardened && !st.programmes.some((p) => p.key === 'gridharden'),
      unavailable: () => 'The grid is already hardened.',
      run: (st) => {
        Act.startProgramme(st, prog('gridharden', 'Grid Hardening Programme', 'infra', 3, 0.45,
          'Redundancy, storage and security on the network.', { 'quality.energy': 1.6 },
          'Grid Hardening Programme Approved'));
        return 'Substations are being rebuilt one region at a time. There will be planned outages during the work.';
      }
    },
    {
      id: 'rail', dept: 'infra', name: 'High-Speed Rail Spine', programme: true,
      desc: 'An eight-year high-speed corridor connecting the major cities. Very expensive; large permanent gains.',
      cost: { moneyPct: 1.20 }, cooldown: 3000,
      requires: (st) => S.Econ.gdpPerCapita(st) > 6000 && !st.programmes.some((p) => p.key === 'rail'),
      unavailable: () => 'Beyond what this economy can carry.',
      run: (st) => {
        Act.startProgramme(st, prog('rail', 'High-Speed Rail Spine', 'infra', 8, 1.20,
          'A national high-speed corridor.', { 'quality.infra': 0.8, 'national.prestige': 0.5 },
          'High-Speed Rail Spine Approved After Years of Argument'));
        S.Aftermath.schedule(st, 'rail_overrun', {}, st.rng.int(900, 1600));
        return 'The route is fixed and compulsory purchases have begun. So have the legal challenges.';
      }
    },
    {
      id: 'ports', dept: 'infra', name: 'Port & Logistics Expansion', programme: true,
      desc: 'Four years of deepwater berths, container handling and the roads to reach them.',
      cost: { moneyPct: 0.60 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'ports'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('ports', 'Port & Logistics Expansion', 'infra', 4, 0.60,
          'Deepwater capacity and the roads to it.', { 'military.logistics': 1.2, 'quality.infra': 0.5 },
          'Major Port Expansion Approved'));
        return 'Dredgers are on station. Exporters are already contracting against the new capacity.';
      }
    },
    {
      id: 'housing', dept: 'infra', name: 'Mass Housing Programme', programme: true,
      desc: 'Five years of public housebuilding at a scale large enough to move rents.',
      cost: { moneyPct: 0.80 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'housing'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('housing', 'Mass Housing Programme', 'infra', 5, 0.80,
          'Public housebuilding at scale.', { 'society.inequality': -0.5, 'quality.infra': 0.6 },
          'Largest Public Housebuilding Programme in a Generation'));
        return 'The first estates are out to tender. Nothing will be occupied for two years.';
      }
    },
    {
      id: 'watersan', dept: 'infra', name: 'Water & Sanitation Programme', programme: true,
      desc: 'Extend clean water and sewerage to unserved districts. The largest public-health return per unit spent.',
      cost: { moneyPct: 0.40 }, cooldown: 2600,
      requires: (st) => st.quality.infra < 70 && !st.programmes.some((p) => p.key === 'watersan'),
      unavailable: () => 'Coverage is already near-universal.',
      run: (st) => {
        Act.startProgramme(st, prog('watersan', 'Water & Sanitation Programme', 'infra', 4, 0.40,
          'Clean water and sewerage where there is none.', { 'quality.health': 0.9, 'quality.infra': 0.7 },
          'National Water and Sanitation Programme Begins'));
        return 'Trenching has started in the worst-served districts. Waterborne disease should fall within two years.';
      }
    },
    {
      id: 'emergencyrepair', dept: 'infra', name: 'Emergency Repair Blitz',
      desc: 'Clear the worst of the maintenance backlog immediately, at premium cost.',
      cost: { moneyPct: 0.45, money: 6 }, cooldown: 500,
      requires: (st) => st.quality.infra < 80,
      run: (st) => {
        st.quality.infra = S.clamp(st.quality.infra + 7, 0, 100);
        st.economy.shock += 0.4;
        st.factions.forEach((f) => { if (f.id === 'provinces') f.loyalty += 6; });
        return 'Crews are working double shifts. The worst-rated bridges, lines and plants are being repaired first.';
      }
    },

    /* ------------------------------------------------------- INTERIOR */
    {
      id: 'anticorruptionsweep', dept: 'interior', name: 'Anti-Corruption Sweep',
      desc: 'Arrests, audits and dismissals across the ministries and the provinces.',
      cost: { moneyPct: 0.06, money: 0.4 }, cooldown: 900,
      requires: (st) => st.society.corruption > 20,
      run: (st) => {
        st.society.corruption = Math.max(3, st.society.corruption - 9);
        st.quality.admin += 3; st.society.approval += 5;
        st.economy.businessConfidence -= 4;
        st.factions.forEach((f) => {
          if (f.id === 'reformers') f.loyalty += 12;
          if (f.id === 'business' || f.id === 'provinces') f.loyalty -= 8;
        });
        S.News.custom(st, 'Officials Arrested as Anti-Corruption Sweep Begins', '');
        if (st.rng.chance(0.25)) {
          st.society.scandal -= 6;
          return 'Eleven senior officials are in custody — and two of them are giving evidence about people close to you.';
        }
        return 'Eleven senior officials are in custody. Procurement across the ministries has slowed while cases are heard.';
      }
    },
    {
      id: 'policereform', dept: 'interior', name: 'Police Reform Programme', programme: true,
      desc: 'Three years of training, oversight and pay.',
      cost: { moneyPct: 0.35 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'policereform'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, prog('policereform', 'Police Reform Programme', 'interior', 3, 0.35,
          'Training, oversight and pay.', { 'quality.security': 1.2, 'society.crime': -0.8 },
          'Sweeping Police Reform Programme Announced'));
        return 'The oversight body has opened its first cases. The police federation has objected formally.';
      }
    },
    {
      id: 'amnesty', dept: 'interior', name: 'General Amnesty',
      desc: 'Release political prisoners and drop the outstanding cases.',
      cost: {}, cooldown: 1400, danger: true,
      requires: (st) => st.society.latent > 25,
      unavailable: () => 'There is nobody to release.',
      run: (st) => {
        st.society.latent = Math.max(0, st.society.latent - 20);
        st.society.unrest = Math.max(0, st.society.unrest - 10);
        st.society.freedom += 5; st.national.softPower += 6;
        st.quality.security -= 3;
        st.factions.forEach((f) => {
          if (f.id === 'reformers' || f.id === 'intelligentsia') f.loyalty += 10;
          if (f.id === 'military' || f.id === 'nationalists') f.loyalty -= 7;
        });
        S.News.custom(st, 'General Amnesty Declared; Prisoners Walk Free', 'good');
        S.Aftermath.schedule(st, 'amnesty_consequence', {}, st.rng.int(1400, 2400));
        return 'Political prisoners were released this morning. Some will re-enter opposition politics.';
      }
    },
    {
      id: 'emergency', dept: 'interior', name: 'Declare a State of Emergency',
      desc: 'Curfews, detention powers and suspended assembly. Suppresses unrest now; builds lasting resentment.',
      cost: {}, cooldown: 900, danger: true, confirm: true,
      run: (st) => {
        st.society.unrest = Math.max(0, st.society.unrest - 18);
        st.society.latent += 16;
        st.policy.interior.policing = S.clamp(st.policy.interior.policing + 20, 0, 100);
        st.policy.interior.civilLiberties = S.clamp(st.policy.interior.civilLiberties - 20, 0, 100);
        st.national.softPower -= 8;
        st.economy.businessConfidence -= 6;
        st.factions.forEach((f) => {
          if (f.id === 'military') f.loyalty += 5;
          if (f.id === 'reformers' || f.id === 'intelligentsia') f.loyalty -= 14;
        });
        S.News.custom(st, 'State of Emergency Declared Nationwide', 'bad');
        return 'The curfew took effect at midnight. Unrest has fallen; resentment has not.';
      }
    },

    /* ------------------------------------------------------- TREASURY */
    {
      id: 'stimulus', dept: 'treasury', name: 'Fiscal Stimulus Package',
      desc: 'A large one-off injection of public spending. Raises demand and confidence; adds to debt and inflation.',
      cost: { moneyPct: 1.60 }, cooldown: 900,
      run: (st) => {
        st.economy.shock += 1.8;
        st.economy.consumerConfidence += 8; st.economy.businessConfidence += 5;
        st.society.approval += 5;
        st.economy.inflation += 0.7;
        st.factions.forEach((f) => { if (f.id === 'labour') f.loyalty += 6; });
        S.News.custom(st, 'Government Announces Major Stimulus Package', 'good');
        return 'Disbursement begins next quarter across construction, transfers and procurement.';
      }
    },
    {
      id: 'consolidate', dept: 'treasury', name: 'Emergency Consolidation',
      desc: 'Cut every department by an eighth to restore market confidence.',
      cost: { approval: -9, unrest: 6 }, cooldown: 700,
      run: (st) => {
        for (const m in st.budget.alloc) st.budget.alloc[m] *= 0.875;
        st.economy.shock -= 1.0;
        st.economy.businessConfidence += 9;
        st.economy.reserveStatus += 4;
        st.factions.forEach((f) => {
          if (f.id === 'business') f.loyalty += 10;
          if (f.id === 'labour' || f.id === 'provinces') f.loyalty -= 9;
        });
        return 'Every department has been cut by an eighth. Borrowing costs are easing; public services will feel the reduction within months.';
      }
    },
    {
      id: 'debtbuyback', dept: 'treasury', name: 'Debt Buyback',
      desc: 'Retire debt with reserves while it is cheap.',
      cost: {}, cooldown: 500,
      requires: (st) => st.economy.reserves > st.economy.gdp * 0.03 && st.economy.debt > 0,
      unavailable: () => 'Not enough in reserve to make a difference.',
      run: (st) => {
        const amt = Math.min(st.economy.reserves * 0.6, st.economy.debt);
        st.economy.reserves -= amt; st.economy.debt -= amt;
        st.economy.reserveStatus -= 3;
        st.economy.businessConfidence += 4;
        return 'We have retired ' + S.money(amt) + ' of debt. The reserve cushion is thinner for it.';
      }
    },
    {
      id: 'swf', dept: 'treasury', name: 'Establish a Sovereign Wealth Fund',
      desc: 'Constitute a fund with an independent mandate to invest the surplus.',
      cost: {}, cooldown: 4000,
      requires: (st) => st.economy.swf == null && st.economy.deficit < 0,
      unavailable: (st) => st.economy.swf != null ? 'The fund already exists.' : 'Requires a budget surplus.',
      run: (st) => {
        st.economy.swf = st.economy.gdp * 0.02;
        st.economy.reserveStatus += 6;
        st.national.prestige += 3;
        return 'The fund is constituted with an independent board and a mandate written to be hard to change.';
      }
    },
    {
      id: 'cookbooks', dept: 'treasury', name: 'Adjust the Published Statistics', illegal: true,
      desc: 'Publish growth and inflation figures better than the truth. Confidence improves now; a credibility crisis follows if the working papers surface.',
      cost: {}, cooldown: 900,
      run: (st) => {
        st.economy.consumerConfidence += 6; st.economy.businessConfidence += 5;
        st.society.approval += 3;
        if (st.rng.chance(0.30)) S.Aftermath.schedule(st, 'covert_exposure', { op: 'cookbooks' }, st.rng.int(220, 720));
        return 'The statistical office has published the adjusted series. Confidence has improved; the working papers are locked away.';
      }
    },
    {
      id: 'shadowexports', dept: 'treasury', name: 'Shadow Export Network', programme: true, illegal: true,
      desc: 'A concealed trading network moving sanctioned goods through third countries. Steady income while it holds; a scandal if traced.',
      cost: { moneyPct: 0.05 }, cooldown: 2600,
      requires: (st) => st.diplomacy.nations.some((n) => !n.absorbedBy && n.sanctioningUs) &&
        !st.programmes.some((p) => p.key === 'shadowexports'),
      unavailable: (st) => st.programmes.some((p) => p.key === 'shadowexports') ? 'Already running.' : 'No sanctions to evade.',
      run: (st) => {
        Act.startProgramme(st, {
          key: 'shadowexports', name: 'Shadow Export Network', dept: 'treasury', years: 4, costPct: 0.05,
          desc: 'Restricted trade through intermediaries.', perYear: { 'economy.shock': 0.30 }, covert: true
        });
        if (st.rng.chance(0.40)) S.Aftermath.schedule(st, 'covert_exposure', { op: 'shadowexports' }, st.rng.int(400, 1400));
        return 'The front companies are registered and the first cargoes have cleared. Nothing links them to us on paper.';
      }
    },

    /* --------------------------------------------------- INTELLIGENCE */
    {
      id: 'cisweep', dept: 'intel', name: 'Counter-Intelligence Sweep',
      desc: 'Vet, re-vet and roll up whatever is found inside the service.',
      cost: { moneyPct: 0.05, money: 0.15 }, cooldown: 700,
      run: (st) => {
        if (st.rng.chance(0.45 + st.intel.strength / 400)) {
          st.intel.strength = S.clamp(st.intel.strength + 8, 0, 100);
          st.quality.security += 3;
          return 'The sweep found two foreign networks and closed both. Product reliability should improve within the year.';
        }
        st.intel.strength -= 2; st.quality.admin -= 1;
        return 'The sweep found nothing. Morale inside the service has suffered.';
      }
    },
    {
      id: 'covertop', dept: 'intel', name: 'Authorise a Covert Operation', target: 'nation',
      desc: 'A deniable operation to degrade a rival state from within. Exposure carries a serious diplomatic price.',
      cost: { moneyPct: 0.08, money: 0.3 }, cooldown: 600, danger: true,
      requires: (st) => st.intel.strength > 35,
      unavailable: () => 'The service is not capable of it.',
      run: (st, n) => {
        st.world.tension += 4;
        if (st.rng.chance(0.30 + st.intel.strength / 220)) {
          n.power = Math.max(6, n.power * 0.94);
          n.milPower *= 0.95;
          st.intel.strength += 4;
          S.News.custom(st, 'Unexplained Crisis Grips ' + n.name, '');
          return 'The operation succeeded without attribution. ' + n.name + '\'s capabilities are measurably degraded.';
        }
        n.relation -= 25; n.grievance = (n.grievance || 0) + 28;
        st.national.prestige -= 8; st.world.tension += 8;
        st.diplomacy.nations.forEach((o) => { o.relation -= 4; });
        S.News.custom(st, 'Our Operatives Exposed in ' + n.name, 'bad');
        return 'The operation was exposed. Our officers are in custody abroad and the denial is not believed.';
      }
    },
    {
      id: 'cyber', dept: 'intel', name: 'Offensive Cyber Programme', programme: true,
      desc: 'A three-year programme to build an offensive cyber capability.',
      cost: { moneyPct: 0.20 }, cooldown: 2600,
      requires: (st) => st.quality.science > 35 && !st.flags.cyberCapable && !st.programmes.some((p) => p.key === 'cyber'),
      unavailable: (st) => st.flags.cyberCapable ? 'The capability exists.' : 'Requires a stronger scientific base.',
      run: (st) => {
        Act.startProgramme(st, prog('cyber', 'Offensive Cyber Programme', 'intel', 3, 0.20,
          'A national offensive cyber capability.', { 'intel.strength': 1.2 }));
        return 'Recruitment from the universities has begun under classified contracts.';
      }
    },
    {
      id: 'blackpropaganda', dept: 'intel', name: 'Domestic Influence Directorate', programme: true, illegal: true,
      desc: 'A covert unit placing favourable coverage and discrediting critics in the domestic press. Effective, illegal, and damaging if uncovered.',
      cost: { moneyPct: 0.03 }, cooldown: 2600,
      requires: (st) => !st.programmes.some((p) => p.key === 'blackpropaganda'),
      unavailable: () => 'Already running.',
      run: (st) => {
        Act.startProgramme(st, {
          key: 'blackpropaganda', name: 'Domestic Influence Directorate', dept: 'intel', years: 3, costPct: 0.03,
          desc: 'Covert media placement and pressure.', perYear: { 'society.approval': 0.9, 'society.latent': 0.5 }, covert: true
        });
        if (st.rng.chance(0.35)) S.Aftermath.schedule(st, 'covert_exposure', { op: 'blackpropaganda' }, st.rng.int(350, 1100));
        return 'The directorate is operating out of an unmarked annex. Editors have begun taking its calls.';
      }
    },
    {
      id: 'darkmoney', dept: 'intel', name: 'Foreign Influence Accounts', programme: true, illegal: true,
      desc: 'Undeclared funding for friendly editors, officials and parties abroad. Builds influence steadily; a diplomatic scandal if traced.',
      cost: { moneyPct: 0.04 }, cooldown: 2600,
      requires: (st) => st.intel.strength > 30 && !st.programmes.some((p) => p.key === 'darkmoney'),
      unavailable: (st) => st.programmes.some((p) => p.key === 'darkmoney') ? 'Already running.' : 'The service cannot run it securely.',
      run: (st) => {
        Act.startProgramme(st, {
          key: 'darkmoney', name: 'Foreign Influence Accounts', dept: 'intel', years: 4, costPct: 0.04,
          desc: 'Undeclared influence funding abroad.', perYear: { 'national.softPower': 0.7 }, covert: true
        });
        if (st.rng.chance(0.35)) S.Aftermath.schedule(st, 'covert_exposure', { op: 'darkmoney' }, st.rng.int(400, 1300));
        return 'The accounts are open and the first disbursements have cleared through three intermediary jurisdictions.';
      }
    }
  ];

  Act.BY_ID = {};
  Act.LIB.forEach((a) => { Act.BY_ID[a.id] = a; });

  /* ------------------------------------------------------ availability */
  Act.forDept = function (st, dept) {
    return Act.LIB.filter((a) => a.dept === dept);
  };
  Act.status = function (st, a) {
    const cd = (st.actionCooldown || {})[a.id];
    if (cd && S.absDay(st.date) < cd) {
      return { ok: false, reason: 'Available again in ' + S.round(cd - S.absDay(st.date), 0) + ' days' };
    }
    if (a.requires && !a.requires(st)) {
      return { ok: false, reason: a.unavailable ? a.unavailable(st) : 'Not available now' };
    }
    const money = Act.opCost(st, a);
    if (money > 0 && st.economy.reserves + st.economy.gdp * 0.05 < money) {
      return { ok: false, reason: 'The Treasury cannot fund it' };
    }
    return { ok: true };
  };

  Act.costLabel = function (st, a) {
    const bits = [];
    const money = Act.opCost(st, a);
    if (money) bits.push(S.money(money) + (a.programme ? '/yr' : ''));
    if (a.cost && a.cost.approval) bits.push('Approval ' + S.signed(a.cost.approval, 0));
    if (a.cost && a.cost.unrest) bits.push('Unrest ' + S.signed(a.cost.unrest, 0));
    if (a.programme) bits.push('multi-year programme');
    return bits.length ? bits.join(' · ') : 'No direct cost';
  };

  /* ---------------------------------------------------------- execute */
  Act.run = function (st, a, target) {
    const s = Act.status(st, a);
    if (!s.ok) return null;
    st.actionCooldown = st.actionCooldown || {};
    st.actionCooldown[a.id] = S.absDay(st.date) + (a.cooldown || 365);

    if (a.cost) {
      if (!a.programme) {
        const amt = Act.opCost(st, a);
        if (amt) pay(st, amt);
      }
      if (a.cost.approval) st.society.approval += a.cost.approval;
      if (a.cost.unrest) st.society.unrest += a.cost.unrest;
    }
    let text = '';
    try { text = a.run(st, target) || ''; } catch (e) { console.warn(e); }

    S.game.clampState(st);
    st.log.unshift({
      date: S.dateLabel(st.date), title: a.name, choice: 'Initiative' + (target ? ' — ' + target.name : ''),
      cat: a.dept, initiative: true
    });
    if (st.log.length > 300) st.log.length = 300;
    S.game.event(text, 'good');
    return text;
  };

})(window.S);

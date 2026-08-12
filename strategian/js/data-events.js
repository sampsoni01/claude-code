/* STRATEGIAN — random events.
   These fire without warning. Most resolve themselves and simply move the
   numbers; some open a decision that lands in your inbox immediately.   */
(function (S) {
  'use strict';

  const E = S.Events = {};

  function ev(id, weight, fire) { return { id, weight, fire }; }
  const always = () => 6;

  E.LIB = [
    /* ------------------------------------------------------- economic */
    ev('commodity_find', (st) => st.economy.sectors.resources > 4 ? 5 : 2, (st) => {
      const size = st.rng.range(0.5, 2.4);
      st.economy.sectors.resources += size * 0.8;
      st.economy.shock += size * 0.5;
      st.national.prestige += 1;
      S.News.custom(st, 'Major Mineral Discovery in the Interior', 'good',
        'Survey teams confirm a deposit large enough to alter the national export profile.');
      return 'A significant resource deposit has been confirmed. The exploration licence auction begins next quarter.';
    }),
    ev('foreign_investment', (st) => st.economy.businessConfidence > 55 ? 7 : 2, (st) => {
      const amt = st.economy.gdp * st.rng.range(0.004, 0.016);
      st.economy.shock += 0.5; st.economy.reserves += amt * 0.4;
      st.economy.businessConfidence += 4;
      S.News.custom(st, 'Foreign Consortium Announces Major Plant Investment', 'good');
      return 'A foreign consortium has committed ' + S.money(amt) + ' to a new industrial facility.';
    }),
    ev('capital_flight', (st) => st.economy.businessConfidence < 35 || st.society.stability < 40 ? 8 : 1, (st) => {
      st.economy.reserves -= st.economy.gdp * st.rng.range(0.005, 0.02);
      st.economy.fx *= 0.97; st.economy.shock -= 0.6;
      S.News.custom(st, 'Capital Outflows Accelerate as Confidence Erodes', 'bad');
      return 'Net capital outflows have accelerated sharply. Foreign reserves are falling.';
    }),
    ev('bank_failure', (st) => (st.policy.monetary.rate > 12 || st.economy.growth < -1) ? 6 : 1, (st) => {
      st.economy.shock -= 1.4; st.economy.businessConfidence -= 12;
      st.economy.debt += st.economy.gdp * 0.012;
      S.game.pushDecision('bank_rescue', {});
      S.News.custom(st, 'Major Lender Fails; Depositors Queue at Branches', 'bad');
      return 'The country\'s third-largest lender has failed. Depositors are queueing to withdraw funds.';
    }),
    ev('tech_breakthrough', (st) => st.quality.science > 55 ? 6 : 1, (st) => {
      st.quality.science += 2.5; st.economy.productivity += 1.5; st.national.prestige += 3;
      S.News.push(st, 'tech', {});
      return 'National laboratories have announced a breakthrough with commercial applications.';
    }),
    ev('harvest_failure', (st) => 4 + st.world.climate * 0.06, (st) => {
      st.world.grain *= 1.12; st.economy.inflation += 1.2; st.society.unrest += 3;
      st.economy.shock -= 0.5;
      S.News.custom(st, 'Harvest Falls Well Below Forecast', 'bad', 'Food price pressure expected through the winter.');
      return 'The harvest has failed across three provinces. Food prices are rising.';
    }),
    ev('bumper_harvest', () => 4, (st) => {
      st.economy.inflation -= 0.8; st.society.approval += 2; st.economy.shock += 0.3;
      S.News.custom(st, 'Record Harvest Eases Food Prices', 'good');
      return 'An exceptional harvest has eased food prices ahead of winter.';
    }),
    ev('brain_drain', (st) => (st.quality.education > 55 && (st.economy.unemployment > 9 || st.society.freedom < 35)) ? 7 : 1, (st) => {
      st.economy.productivity -= 1.2; st.quality.science -= 1.5; st.pop.total *= 0.999;
      S.News.custom(st, 'Emigration of Graduates Reaches Record Levels', 'bad');
      return 'Graduate emigration has reached record levels. Universities and research institutes report staff losses.';
    }),
    ev('market_mania', (st) => st.economy.businessConfidence > 62 ? 5 : 1, (st) => {
      st.economy.marketIndex *= 1.14;
      st.flags.bubble = (st.flags.bubble || 0) + 1;
      S.News.push(st, 'market_rally', {});
      return 'Equity prices have risen far ahead of earnings. Analysts warn of a speculative bubble.';
    }),
    ev('bubble_burst', (st) => (st.flags.bubble || 0) > 1 ? 9 : 0, (st) => {
      st.economy.marketIndex *= 0.72; st.economy.businessConfidence -= 14;
      st.economy.shock -= 1.6; st.flags.bubble = 0;
      S.News.push(st, 'market_crash', { v: 28 });
      return 'The stock market has fallen sharply. Several institutions are reported to be in difficulty.';
    }),

    /* --------------------------------------------------------- social */
    ev('scandal_minister', () => 6, (st) => {
      const kind = st.rng.pick(['undeclared property holdings', 'improper contract awards to a relative',
        'irregular expense claims', 'an undisclosed relationship with a subordinate',
        'unreported foreign accounts']);
      st.society.scandal -= st.rng.range(3, 9);
      st.society.corruption += 1.5;
      S.News.custom(st, 'Cabinet Minister Faces Questions Over ' + S.titleCase(kind.split(' ').slice(0, 3).join(' ')), 'bad');
      return 'A cabinet minister is under investigation over ' + kind + '. The press holds supporting documents.';
    }),
    ev('sporting_triumph', () => 5, (st) => {
      st.society.approval += 2.5; st.society.cohesion += 3; st.national.softPower += 2;
      S.News.custom(st, 'National Team Wins the Championship', 'good', 'Large public celebrations reported in major cities.');
      return 'The national team has won the championship. Public celebrations are underway nationwide.';
    }),
    ev('cultural_export', (st) => st.quality.culture > 50 ? 6 : 2, (st) => {
      st.national.softPower += 3; st.quality.culture += 1;
      st.diplomacy.nations.forEach((n) => { n.affinity += 1.2; });
      S.News.push(st, 'culture', {});
      return 'Our cultural exports have found an unexpectedly large foreign audience.';
    }),
    ev('religious_revival', (st) => S.Soc.factionLoyalty(st, 'clergy') > 55 ? 5 : 2, (st) => {
      st.society.cohesion += 3; st.policy.social.traditionalism = S.clamp(st.policy.social.traditionalism + 5, 0, 100);
      st.factions.forEach((f) => { if (f.id === 'clergy') f.power += 3; if (f.id === 'reformers') f.loyalty -= 3; });
      return 'A religious revival is drawing large crowds. The political influence of the clergy is growing.';
    }),
    ev('youth_movement', (st) => st.pop.youthShare > 17 && st.society.freedom > 30 ? 6 : 2, (st) => {
      st.factions.forEach((f) => { if (f.id === 'reformers') f.power += 4; });
      st.society.unrest += 3;
      S.News.custom(st, 'Youth Movement Draws Crowds in Every Major City', '');
      return 'A youth protest movement is drawing large crowds in the major cities. It has no formal leadership and has issued no demands.';
    }),
    ev('epidemic_local', () => 4, (st) => {
      st.quality.health -= 2; st.society.approval -= 2; st.economy.shock -= 0.3;
      S.News.custom(st, 'Outbreak Strains Regional Hospitals', 'bad');
      return 'A localised outbreak has overwhelmed hospitals in two provinces.';
    }),
    ev('infrastructure_failure', (st) => st.quality.infra < 45 ? 8 : 2, (st) => {
      st.quality.infra -= 2; st.society.approval -= 3; st.economy.shock -= 0.4;
      S.News.push(st, 'ambient_bad', {});
      return st.rng.pick(['A bridge has collapsed on the main northern route.',
        'The grid failed across the second city for eleven hours.',
        'A dam has been declared unsafe and the valley evacuated.']);
    }),
    ev('crime_wave', (st) => st.society.crime > 55 ? 7 : 2, (st) => {
      st.society.crime += 4; st.society.approval -= 3; st.society.unrest += 2;
      S.News.custom(st, 'Violent Crime Surges in Major Cities', 'bad');
      return 'Organised crime activity has risen sharply in the major cities. Public concern is growing.';
    }),
    ev('national_hero', () => 4, (st) => {
      st.society.cohesion += 3; st.national.softPower += 2; st.society.approval += 2;
      S.News.custom(st, st.rng.pick(['Our Scientist Wins the International Prize',
        'Explorer Completes Historic Crossing', 'Author Wins the World\'s Foremost Literary Award']), 'good');
      return 'A citizen has won a major international honour. Public morale has risen.';
    }),

    /* ------------------------------------------------------- political */
    ev('defection', (st) => st.society.approval < 42 ? 7 : 2, (st) => {
      st.society.approval -= 2;
      const f = st.rng.pick(st.factions);
      f.loyalty -= 6;
      S.News.custom(st, 'Senior Figures Defect from the Governing Bloc', 'bad');
      return 'Several senior figures have left the governing coalition, taking their networks with them.';
    }),
    ev('opposition_unites', (st) => st.society.approval < 45 ? 6 : 2, (st) => {
      st.society.unrest += 4;
      st.factions.forEach((f) => { if (f.id === 'reformers') f.power += 4; });
      S.News.custom(st, 'Opposition Parties Announce Joint Platform', '');
      return 'Opposition parties have ended their infighting and announced a joint platform. They now present a united challenge to the government.';
    }),
    ev('regional_autonomy', (st) => S.Soc.factionLoyalty(st, 'provinces') < 40 ? 8 : 2, (st) => {
      st.society.cohesion -= 4; st.society.unrest += 4;
      S.game.pushDecision('regional_demands', {});
      S.News.custom(st, 'Province Votes for Greater Autonomy', 'bad');
      return 'A provincial assembly has voted to demand expanded autonomy powers.';
    }),
    ev('purge_rumour', (st) => S.Soc.repression(st) > 55 ? 6 : 1, (st) => {
      st.society.latent += 4; st.quality.admin -= 1.5;
      st.factions.forEach((f) => { f.loyalty -= 2; });
      return 'Rumours of an imminent purge are circulating in the ministries. Officials are deferring decisions and administration has slowed.';
    }),
    ev('leader_illness', () => 2, (st) => {
      st.society.stability -= 4;
      st.factions.forEach((f) => { if (f.id === 'military' || f.id === 'business') f.power += 2; });
      S.News.custom(st, 'Leader Cancels Engagements; Officials Decline to Comment', '');
      return 'Your health has become a subject of foreign intelligence assessments. Officials have begun discussing succession.';
    }),

    /* ------------------------------------------------------- external */
    ev('foreign_coup', () => 5, (st) => {
      const n = st.rng.pick(st.diplomacy.nations);
      const swing = st.rng.range(-30, 30);
      n.relation = S.clamp(n.relation + swing, -100, 100);
      n.ideology = st.rng.pick(['managed', 'authoritarian', 'democratic', 'populist', 'party']);
      st.world.tension += 3;
      S.News.custom(st, 'Government Falls in ' + n.name, '');
      return 'The government of ' + n.name + ' has fallen. The new administration has ' +
        (swing > 0 ? 'signalled closer relations with us.' : 'signalled cooler relations with us.');
    }),
    ev('oil_shock', () => 4, (st) => {
      st.world.oil *= st.rng.range(1.18, 1.45);
      st.economy.inflation += 1.5;
      S.News.push(st, 'oil_spike', { v: S.round(st.world.oil, 0) });
      return 'An energy price shock has hit world markets. Fuel and transport costs are rising across the economy.';
    }),
    ev('oil_glut', () => 4, (st) => {
      st.world.oil *= st.rng.range(0.68, 0.85);
      if (st.economy.sectors.resources > 12) { st.economy.shock -= 1.2; st.economy.reserves -= st.economy.gdp * 0.01; }
      else { st.economy.inflation -= 1.0; st.economy.shock += 0.5; }
      S.News.push(st, 'oil_fall', { v: S.round(st.world.oil, 0) });
      return 'World energy prices have collapsed. Resource exporters face revenue losses; energy importers gain from lower costs.';
    }),
    ev('spy_scandal', (st) => st.intel.strength > 30 ? 5 : 2, (st) => {
      const n = st.rng.pick(st.diplomacy.nations);
      n.relation -= 12; n.grievance = (n.grievance || 0) + 10;
      st.intel.strength -= 3; st.national.prestige -= 2;
      S.News.custom(st, 'Espionage Row Erupts with ' + n.name, 'bad');
      return 'An intelligence operation in ' + n.name + ' has been exposed. Both governments are expelling diplomats.';
    }),
    ev('terror_attack', (st) => (st.society.unrest > 45 || st.wars.length) ? 7 : 2, (st) => {
      const dead = st.rng.int(18, 210);
      st.society.approval += 3; st.society.cohesion += 5; st.society.unrest += 3;
      st.quality.security -= 2;
      S.Aftermath.addScar(st, {
        kind: 'terror', name: 'The Capital Bombing',
        desc: S.num(dead) + ' dead. Security policy was permanently tightened in response.',
        severity: 45, years: 4, deaths: dead,
        growth: -0.2, approval: 0, unrest: +2, qualityDrag: { security: -6 }, tag: 'attack'
      });
      S.game.pushDecision('terror_response', { dead: dead });
      S.News.custom(st, 'Attack in the Capital Leaves ' + S.num(dead) + ' Dead', 'bad');
      return 'A bombing in the capital has killed ' + S.num(dead) + '. Public demand for a government response is intense.';
    }),
    ev('diplomatic_windfall', (st) => st.national.prestige > 50 ? 5 : 2, (st) => {
      const n = st.rng.pick(st.diplomacy.nations);
      n.relation += 16; n.affinity += 5;
      st.national.diplomaticWins++;
      S.News.custom(st, 'Breakthrough in Relations with ' + n.name, 'good');
      return 'Relations with ' + n.name + ' have improved sharply after years of stalemate.';
    }),
    ev('alliance_strain', (st) => st.diplomacy.nations.some((n) => n.allyOfUs) ? 5 : 0, (st) => {
      const n = st.rng.pick(st.diplomacy.nations.filter((x) => x.allyOfUs));
      if (!n) return null;
      n.relation -= 12;
      S.News.custom(st, 'Public Rift Opens with Ally ' + n.name, 'bad');
      return 'A public disagreement with ' + n.name + ' has strained the alliance.';
    }),
    ev('insurgency_spark', (st) => (st.society.unrest > 55 && !st.wars.some((w) => w.type === 'insurgency')) ? 8 : 0, (st) => {
      S.Mil.startInsurgency(st, st.rng.pick(['The Highland Insurgency', 'The Delta Rising', 'The Frontier Rebellion', 'The Southern Front']));
      st.society.stability -= 8;
      S.News.custom(st, 'Armed Insurgency Declared in the Provinces', 'bad');
      return 'An armed insurgent movement has seized three district capitals.';
    }),
    ev('peace_movement', (st) => st.wars.length ? 7 : 0, (st) => {
      st.wars.forEach((w) => { w.homeSupport -= 8; });
      st.society.unrest += 3;
      S.News.custom(st, 'Mass Anti-War Demonstration Fills the Capital', '');
      return 'A mass anti-war demonstration has filled the capital. Organisers say further demonstrations are planned.';
    }),
    ev('war_atrocity', (st) => st.wars.length ? 5 : 0, (st) => {
      const w = st.rng.pick(st.wars);
      st.national.prestige -= 6; st.national.softPower -= 5;
      st.diplomacy.nations.forEach((n) => { n.relation -= 4; });
      w.homeSupport -= 5;
      S.game.pushDecision('atrocity_response', { war: w.id });
      S.News.custom(st, 'Allegations of Atrocity Emerge from the Front', 'bad');
      return 'Footage from the front appears to show our forces committing an atrocity. The ministry has offered no explanation.';
    }),
    ev('unexpected_windfall', () => 3, (st) => {
      const amt = st.economy.gdp * st.rng.range(0.004, 0.012);
      st.economy.reserves += amt;
      return 'The treasury has received ' + S.money(amt) + ' from ' + st.rng.pick([
        'a legal settlement concluded in our favour',
        'a sovereign fund position closed at a profit',
        'a long-disputed asset returned by a foreign court']) + '.';
    }),
    ev('quiet_month', () => 10, (st) => {
      S.News.ambient(st);
      return null;
    })
  ];

  /* Additional decisions referenced by events but not in the main library */
  const extra = [
    {
      id: 'bank_rescue', cat: 'economy', dynamic: true, title: 'A Bank Has Failed',
      from: 'Central Bank', urgency: 'urgent', deadline: 3,
      brief: (st) => `<p>The failed lender has an estimated capital shortfall of ${S.money(st.economy.gdp * 0.02)}. Two other institutions hold similar exposures. The interbank market has stopped functioning.</p>
        <p>A decision is required before markets open.</p>`,
      advisors: () => [
        { who: 'Bank Governor', role: 'Monetary', said: 'If this lender is not supported, the two exposed institutions are projected to fail within days.' },
        { who: 'Political Adviser', role: 'Office', said: 'A public bailout of the banking sector will be deeply unpopular and will cost the government support.' }
      ],
      options: [
        { label: 'Full public bailout', detail: 'Guarantee all deposits and recapitalise the bank with public funds.',
          effects: { 'economy.debt': 0, 'society.approval': -9, 'economy.businessConfidence': +8, 'society.unrest': +5 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.03; },
          factions: { business: +12, labour: -14, reformers: -8 }, headline: 'State Bails Out Failed Lender' },
        { label: 'Nationalise the bank', detail: 'Take the bank into public ownership. Shareholders lose their equity; deposits are protected.',
          effects: { 'policy.econ.stateOwnership': +6, 'society.approval': +3, 'economy.businessConfidence': -5 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.018; },
          factions: { labour: +9, business: -8, nationalists: +5 }, headline: 'Failed Bank Taken Into Public Ownership' },
        { label: 'Guarantee deposits only, let it fail', detail: 'Guarantee deposits; wind up the institution.',
          effects: { 'economy.shock': -1.2, 'economy.businessConfidence': -10, 'society.approval': +2 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.008; },
          factions: { business: -6, labour: +4, reformers: +7 } },
        { label: 'Let it fail entirely', detail: 'No state intervention. Depositors and creditors take losses.',
          effects: { 'economy.shock': -2.6, 'economy.businessConfidence': -18, 'society.approval': -6, 'society.unrest': +8 },
          factions: { business: -14, reformers: +9 }, headline: 'Government Refuses Rescue; Depositors Face Losses' }
      ]
    },
    {
      id: 'terror_response', cat: 'crisis', dynamic: true, title: 'Response to the Attack',
      from: 'Ministry of the Interior', urgency: 'urgent', deadline: 4,
      brief: () => `<p>Casualties are still being counted. Public demand for a strong response is high.</p>
        <p>The measures adopted now will shape security policy for years.</p>`,
      options: [
        { label: 'Police operation within the law', detail: 'Investigate and prosecute under existing law.',
          effects: { 'quality.security': +2, 'society.approval': -2, 'budget.alloc.interior': +0.2 },
          factions: { intelligentsia: +8, reformers: +7, nationalists: -8 } },
        { label: 'Emergency security powers', detail: 'Detention without charge, expanded stop powers.',
          effects: { 'policy.interior.surveillance': +14, 'policy.interior.civilLiberties': -12, 'society.approval': +5, 'society.latent': +8, 'quality.security': +3 },
          factions: { nationalists: +9, military: +5, reformers: -11 }, headline: 'Emergency Security Powers Enacted' },
        { label: 'Strike the sponsor abroad', detail: 'Military action against those we believe responsible.',
          effects: { 'world.tension': +10, 'society.approval': +7, 'national.aggressionScore': +12, 'military.readiness': -4 },
          fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation < -20)[0]; if (n) { n.relation -= 20; n.grievance = (n.grievance || 0) + 25; } },
          factions: { military: +9, nationalists: +14, intelligentsia: -8 },
          risk: { p: 0.2, text: 'We struck the wrong people', fn: (st) => { st.national.prestige -= 10; st.national.softPower -= 8; st.society.approval -= 6; } },
          headline: 'Retaliatory Strikes Launched Abroad' },
        { label: 'Address the grievance', detail: 'State publicly that force alone will not end the threat; open a political track.',
          effects: { 'society.approval': -6, 'society.unrest': -4, 'society.latent': -6, 'national.softPower': +4 },
          factions: { nationalists: -14, intelligentsia: +10, reformers: +8 } }
      ]
    },
    {
      id: 'regional_demands', cat: 'civic', dynamic: true, title: 'The Provinces Are Demanding Terms',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 14,
      brief: (st) => `<p>A bloc of provincial governments has presented joint demands: fiscal transfers, language rights, control of resource royalties and a veto on national infrastructure decisions.</p>
        <p>Their loyalty is measured at ${S.round(S.Soc.factionLoyalty(st, 'provinces'), 0)}/100. Cohesion stands at ${S.round(st.society.cohesion, 0)}.</p>`,
      options: [
        { label: 'Concede substantially', detail: 'Devolve substantial fiscal and legislative powers.',
          effects: { 'policy.social.devolution': +22, 'society.cohesion': -3, 'society.unrest': -6, 'quality.admin': -2 },
          factions: { provinces: +18, nationalists: -10 }, headline: 'Government Concedes Sweeping Regional Powers' },
        { label: 'Negotiate a limited package', detail: 'Limited fiscal transfers; no veto on national decisions.',
          effects: { 'policy.social.devolution': +8, 'society.unrest': -2 },
          factions: { provinces: +7 } },
        { label: 'Refuse and reassert central authority', detail: 'Reject all demands; no devolution.',
          effects: { 'society.cohesion': +4, 'society.unrest': +8, 'policy.social.devolution': -10 },
          factions: { provinces: -16, nationalists: +10 },
          risk: { p: 0.25, text: 'Secession movement', fn: (st) => { st.society.unrest += 12; st.society.cohesion -= 8; } } },
        { label: 'Arrest the provincial leadership', detail: 'Detain the leaders and suspend the provincial assemblies.',
          requires: (st) => S.Soc.repression(st) > 45,
          effects: { 'society.unrest': +16, 'society.latent': +18, 'society.cohesion': -8, 'national.softPower': -10 },
          factions: { provinces: -30, nationalists: +8, reformers: -14 },
          risk: { p: 0.35, text: 'Armed resistance', fn: (st) => { S.Mil.startInsurgency(st, 'The Provincial Revolt'); } },
          headline: 'Provincial Leaders Detained; Regional Assemblies Suspended' }
      ]
    },
    {
      id: 'atrocity_response', cat: 'military', dynamic: true, title: 'Allegations from the Front',
      from: 'Ministry of Defence', urgency: 'pressing', deadline: 8,
      brief: () => `<p>Analysts assess the footage as credible. It appears to show a unit of our forces committing serious violations against civilians.</p>
        <p>The response will affect foreign relations and the morale of troops still in the field.</p>`,
      options: [
        { label: 'Court-martial those responsible', detail: 'Prosecute those responsible publicly under military law.',
          effects: { 'national.softPower': +6, 'national.prestige': +3, 'military.morale': -7, 'society.approval': -3 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { n.relation += 3; }); },
          factions: { military: -10, intelligentsia: +11, nationalists: -8 }, headline: 'Soldiers Court-Martialled Over Front-Line Allegations' },
        { label: 'Internal inquiry, no publicity', detail: 'Investigate internally with no public disclosure.',
          effects: { 'national.softPower': -3, 'military.morale': -2 },
          factions: { military: +3 } },
        { label: 'Deny everything', detail: 'Issue official denials and declare the footage fabricated.',
          effects: { 'national.softPower': -9, 'national.prestige': -5, 'military.morale': +4, 'policy.interior.propaganda': +8 },
          factions: { military: +8, nationalists: +9, intelligentsia: -12 },
          risk: { p: 0.4, text: 'More footage emerges', fn: (st) => { st.national.softPower -= 8; st.society.approval -= 6; st.diplomacy.nations.forEach((n) => { n.relation -= 6; }); } } }
      ]
    }
  ];

  extra.forEach((d) => { S.Decisions.LIB.push(d); S.Decisions.BY_ID[d.id] = d; });

  void always;
})(window.S);

/* STRATEGIAN — fifth decision volume: war settlements and covert fallout.
   All of these are dynamic — they are fired by the simulation (a war won,
   a foreign annexation, an exposed operation), never drawn by the roster. */
(function (S) {
  'use strict';

  const D = S.Decisions;

  const warOf = (st, ctx) => st.wars.find((w) => w.id === ctx.war);
  const enemyOf = (st, ctx) => {
    const w = warOf(st, ctx);
    return w && w.enemyId ? S.dip(st, w.enemyId) : null;
  };

  const LIB5 = [

    /* ================================================== VICTORY TERMS */
    {
      id: 'victory_terms', cat: 'military', dynamic: true, title: 'Terms for the Defeated',
      from: 'Ministry of Defence', urgency: 'urgent', deadline: 12, onIgnore: 2,
      brief: (st, ctx) => {
        const w = warOf(st, ctx), n = enemyOf(st, ctx);
        if (!w || !n) return '<p>The war has already been concluded through other channels.</p>';
        return `<p>${n.name}'s front has collapsed. Their government has asked for terms, and what we dictate now will shape the region for decades.</p>
          <p>Our losses stand at <b>${S.headcount(w.casualties / 1e6)}</b>; theirs at <b>${S.headcount(w.enemyCasualties / 1e6)}</b>. War exhaustion at home is ${S.round(w.exhaustion, 0)}/100.</p>
          <p>Annexation absorbs their territory, population and economy — and their resentment. A client government keeps them nominally sovereign under our direction. A punitive treaty extracts reparations and disarmament. A moderate settlement trades spoils for stability.</p>`;
      },
      advisors: (st, ctx) => {
        const n = enemyOf(st, ctx);
        return [
          { who: 'Chief of the General Staff', role: 'Military', said: 'Occupation of ' + (n ? n.name : 'their territory') + ' will tie down a third of the force indefinitely. A client government gives us most of the value at a fraction of the garrison.' },
          { who: 'Foreign Minister', role: 'Diplomatic', said: 'Every capital is watching what we take. The harder the terms, the faster the coalitions form against us.' }
        ];
      },
      options: [
        {
          label: 'Annex them outright', detail: 'Absorb their territory, population and economy into the state. Permanent gain; permanent occupation burden and international alarm.',
          effects: { 'society.approval': +6 },
          fn: (st, ctx) => { const w = warOf(st, ctx); if (w) S.Mil.endWar(st, w, 'victory', null, { mode: 'annex' }); },
          factions: { nationalists: +16, military: +8, intelligentsia: -10, reformers: -8 },
          headline: 'Total Victory: Defeated Nation Annexed'
        },
        {
          label: 'Install a client government', detail: 'They keep their flag; we choose the government. One-off indemnity, a standing ally, moderate international alarm.',
          effects: { 'national.prestige': +5 },
          fn: (st, ctx) => { const w = warOf(st, ctx); if (w) S.Mil.endWar(st, w, 'victory', null, { mode: 'client' }); },
          factions: { military: +6, nationalists: +6 }
        },
        {
          label: 'Impose a punitive treaty', detail: 'Reparations, disarmament and ceded assets. They stay sovereign, weakened and resentful.',
          effects: { 'national.prestige': +4 },
          fn: (st, ctx) => { const w = warOf(st, ctx); if (w) S.Mil.endWar(st, w, 'victory', null, { mode: 'punitive' }); },
          factions: { nationalists: +8, business: +4 }
        },
        {
          label: 'Offer a moderate settlement', detail: 'Minimal reparations and a rapid normalisation of relations. Trades the spoils for regional stability and standing.',
          effects: { 'society.approval': -3 },
          fn: (st, ctx) => { const w = warOf(st, ctx); if (w) S.Mil.endWar(st, w, 'victory', null, { mode: 'magnanimous' }); },
          factions: { nationalists: -10, military: -5, intelligentsia: +9, reformers: +7 },
          headline: 'Victors Offer Moderate Terms'
        }
      ]
    },

    /* ============================================== WAR DIRECTIVE */
    {
      id: 'war_directive', cat: 'military', dynamic: true, title: 'Operational Directive Required',
      from: 'General Staff', urgency: 'pressing', deadline: 8, onIgnore: 2,
      brief: (st, ctx) => {
        const w = warOf(st, ctx);
        if (!w) return '<p>The operation has already concluded.</p>';
        const n = enemyOf(st, ctx);
        const pos = w.score > 20 ? 'We hold the initiative.' : w.score < -20 ? 'The enemy holds the initiative.' : 'The front is roughly static.';
        return `<p>The staff have submitted plans for the next phase of ${w.name}${n ? ' against ' + n.name : ''} and need a directive: attack, hold, or conserve the force.</p>
          <p>${pos} Front assessment: <b>${S.signed(w.score, 0)}</b>. Our losses to date: <b>${S.headcount(w.casualties / 1e6)}</b>. War exhaustion: ${S.round(w.exhaustion, 0)}/100. Home support: ${S.round(w.homeSupport, 0)}%.</p>`;
      },
      advisors: (st, ctx) => {
        const w = warOf(st, ctx);
        return [
          { who: 'Chief of Operations', role: 'Military', said: w && w.score > 0 ? 'The enemy is off balance. A general offensive now could be decisive; the price is paid in casualties either way.' : 'Attacking from a position of weakness multiplies losses. I advise consolidation before any offensive.' },
          { who: 'Political Adviser', role: 'Office', said: 'Casualty announcements move home support more than territory does. A failed offensive is the most expensive thing a government can buy.' }
        ];
      },
      options: [
        {
          label: 'General offensive', detail: 'Commit the reserves and attack along the front. Largest possible gain; heaviest losses if it stalls.',
          effects: {},
          fn: (st, ctx) => {
            const w = warOf(st, ctx); if (!w) return;
            w.posture = 'full'; w.intensity = S.clamp(w.intensity + 20, 15, 100);
            w.score = S.clamp(w.score + st.rng.range(4, 14), -100, 100);
            w.exhaustion = S.clamp(w.exhaustion + 5, 0, 100);
          },
          risk: {
            p: 0.30, text: 'The offensive stalls with heavy losses',
            fn: (st, ctx) => {
              const w = warOf(st, ctx); if (!w) return;
              w.score = S.clamp(w.score - 12, -100, 100);
              w.casualties += st.rng.int(2000, 12000);
              st.military.morale -= 6; w.homeSupport -= 6;
            }
          },
          factions: { military: +5, nationalists: +6 }
        },
        {
          label: 'Limited offensive', detail: 'Local attacks on favourable sectors. Modest gains at controlled cost.',
          effects: {},
          fn: (st, ctx) => {
            const w = warOf(st, ctx); if (!w) return;
            w.posture = 'limited';
            w.score = S.clamp(w.score + st.rng.range(1, 6), -100, 100);
          }
        },
        {
          label: 'Defensive consolidation', detail: 'Hold the line, rotate units and rebuild. Cedes the initiative; restores the force.',
          effects: {},
          fn: (st, ctx) => {
            const w = warOf(st, ctx); if (!w) return;
            w.posture = 'defend'; w.intensity = S.clamp(w.intensity - 12, 15, 100);
            w.exhaustion = S.clamp(w.exhaustion - 7, 0, 100);
            st.military.morale += 3; st.military.readiness = S.clamp(st.military.readiness + 3, 0, 100);
          },
          factions: { military: +2 }
        },
        {
          label: 'Open a channel for terms', detail: 'Keep fighting defensively while our envoys test whether a settlement is available.',
          effects: {},
          opensNegotiation: (st, ctx) => { const w = warOf(st, ctx); return w && w.enemyId ? { kind: 'peace', nation: w.enemyId, ctx: { war: w.id } } : null; },
          fn: (st, ctx) => { const w = warOf(st, ctx); if (w) w.posture = 'defend'; },
          factions: { nationalists: -6, intelligentsia: +5 }
        }
      ]
    },

    /* ==================================== FOREIGN WAR: OUR RESPONSE */
    {
      id: 'foreign_war_settlement', cat: 'foreign', dynamic: true, title: 'A State Has Been Erased',
      from: 'Foreign Ministry', urgency: 'pressing', deadline: 10, onIgnore: 1,
      brief: (st, ctx) => {
        const w = S.dip(st, ctx.winner), l = S.dip(st, ctx.loser);
        if (!w || !l) return '<p>The situation has been overtaken by events.</p>';
        return `<p>${w.name} has annexed ${l.name} after its military collapse. Foreign ministries worldwide are deciding whether to recognise the annexation, and our position is being asked for by name.</p>
          <p>${w.name}'s power index now stands at <b>${S.round(w.power, 0)}</b>. Our relations with them are ${S.round(w.relation, 0)}.</p>`;
      },
      advisors: (st, ctx) => {
        const w = S.dip(st, ctx.winner);
        return [
          { who: 'Foreign Minister', role: 'Diplomatic', said: 'Recognition costs us standing with every small state that fears the same fate. Refusal costs us ' + (w ? w.name : 'the victor') + '.' },
          { who: 'Chief of the General Staff', role: 'Military', said: 'A power that absorbs its neighbours and pays no price will do it again. The question is whether we want to be the price.' }
        ];
      },
      options: [
        {
          label: 'Recognise the annexation', detail: 'Accept the new map. Preserves relations with the victor; smaller states draw conclusions about us.',
          effects: { 'national.softPower': -5, 'world.tension': -3 },
          fn: (st, ctx) => { const w = S.dip(st, ctx.winner); if (w) { w.relation += 12; w.grievance = Math.max(0, (w.grievance || 0) - 6); } },
          factions: { business: +4, intelligentsia: -6 }
        },
        {
          label: 'Condemn, but take no action', detail: 'A formal protest without consequences. Costs little; achieves little.',
          effects: { 'national.prestige': +2 },
          fn: (st, ctx) => { const w = S.dip(st, ctx.winner); if (w) w.relation -= 8; }
        },
        {
          label: 'Refuse recognition and impose sanctions', detail: 'Embargo the victor. Draws a line under conquest; damages trade and relations.',
          effects: { 'world.tension': +6, 'economy.businessConfidence': -3, 'national.prestige': +5 },
          fn: (st, ctx) => {
            const w = S.dip(st, ctx.winner); if (!w) return;
            w.relation -= 25; w.tradeStatus = 'embargo'; w.grievance = (w.grievance || 0) + 15;
          },
          factions: { nationalists: +5, reformers: +6, business: -6 },
          headline: 'Sanctions Imposed Over Annexation'
        },
        {
          label: 'Convene a coalition of the alarmed', detail: 'Organise the states that fear they are next. Raises our standing; hardens the victor against us.',
          requires: (st) => st.national.prestige > 40,
          effects: { 'national.prestige': +7, 'national.softPower': +5, 'world.tension': +3 },
          fn: (st, ctx) => {
            const w = S.dip(st, ctx.winner); if (!w) return;
            w.relation -= 18; w.threatPerception += 10;
            st.diplomacy.nations.forEach((o) => {
              if (!o.absorbedBy && o.id !== w.id && o.power < w.power) o.relation += 7;
            });
            st.national.diplomaticWins++;
          },
          factions: { nationalists: +4, military: +4 },
          headline: 'We Convene Coalition Against Annexation'
        }
      ]
    },

    /* ======================================= COVERT PROGRAMME EXPOSED */
    {
      id: 'covert_exposure', cat: 'crisis', dynamic: true, title: 'An Operation Has Surfaced',
      from: 'Intelligence Directorate', urgency: 'urgent', deadline: 6, onIgnore: 0,
      brief: (st, ctx) => {
        const what = {
          cookbooks: 'that the published growth and inflation series were adjusted on instruction from this office',
          shadowexports: 'a network of front companies moving sanctioned goods on our behalf through third countries',
          blackpropaganda: 'a covert directorate placing favourable coverage and pressuring editors in the domestic press',
          darkmoney: 'undeclared payments from our services to editors, officials and parties abroad'
        }[ctx.op] || 'an undeclared operation run on instruction from this office';
        return `<p>A document set has reached the press. It describes ${what}, with names, dates and account numbers.</p>
          <p>The first stories run within days. Foreign desks have already begun asking for comment.</p>`;
      },
      advisors: () => [
        { who: 'Director of Intelligence', role: 'Intelligence', said: 'Deny, and the next tranche of documents decides whether the denial holds. Assume there is a next tranche.' },
        { who: 'Political Adviser', role: 'Office', said: 'Prosecuting our own people buys credibility at the price of loyalty inside the services. Nobody signs up for the next operation.' }
      ],
      options: [
        {
          label: 'Deny everything', detail: 'Reject the documents as fabrication. Holds if nothing further surfaces.',
          effects: { 'national.softPower': -4 },
          fn: (st, ctx) => {
            if (ctx.op === 'darkmoney' || ctx.op === 'shadowexports') st.diplomacy.nations.forEach((n) => { if (!n.absorbedBy) n.relation -= 4; });
          },
          risk: {
            p: 0.4, text: 'Further documents contradict the denial',
            fn: (st) => { st.society.approval -= 8; st.society.scandal += 12; st.national.softPower -= 6; }
          }
        },
        {
          label: 'Shut it down and prosecute', detail: 'Close the operation, charge those who ran it, publish a review. Costly inside the services; credible outside them.',
          effects: { 'society.approval': +2, 'society.corruption': -2, 'national.softPower': +3 },
          fn: (st, ctx) => {
            const p = (st.programmes || []).find((x) => x.key === ctx.op);
            if (p) S.Actions.cancelProgramme(st, p.id);
            st.intel.strength -= 4;
          },
          factions: { reformers: +8, intelligentsia: +6, military: -5 },
          headline: 'Government Shuts Down Exposed Operation, Orders Prosecutions'
        },
        {
          label: 'Acknowledge it and defend it', detail: 'Confirm the operation and state that it served the national interest. Ends the drip of revelations; the world takes note.',
          effects: { 'society.approval': +1, 'national.softPower': -8, 'world.tension': +4 },
          fn: (st, ctx) => {
            if (ctx.op === 'darkmoney' || ctx.op === 'shadowexports') st.diplomacy.nations.forEach((n) => { if (!n.absorbedBy) n.relation -= 7; });
          },
          factions: { nationalists: +8, reformers: -8 },
          headline: 'Government Confirms Covert Operation, Offers No Apology'
        }
      ]
    },

    /* ==================================== OCCUPATION RESISTANCE */
    {
      id: 'occupation_resistance', cat: 'military', dynamic: true, title: 'Resistance in the Annexed Territory',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 12, onIgnore: 1,
      brief: (st, ctx) => {
        const n = S.dip(st, ctx.nation);
        const name = n ? n.name : 'the annexed territory';
        return `<p>Organised resistance has emerged in ${name}: attacks on garrisons, sabotage of administration, and a population that does not co-operate with the census.</p>
          <p>The garrison commander reports the territory cannot be governed on the current footing. Three courses have been prepared.</p>`;
      },
      advisors: () => [
        { who: 'Garrison Commander', role: 'Military', said: 'I can suppress it with more force and wider detention powers. I cannot make them loyal, and I will need the troops indefinitely.' },
        { who: 'Interior Minister', role: 'Civil', said: 'Autonomy within the state costs us pride and buys us administration. Withdrawal costs us the territory and buys us out of the whole problem.' }
      ],
      options: [
        {
          label: 'Suppress it with force', detail: 'Expanded detention, curfews and punitive operations. Restores control; deepens the grievance.',
          effects: { 'society.latent': +8, 'national.softPower': -6, 'military.readiness': -4 },
          risk: {
            p: 0.30, text: 'The resistance becomes a full insurgency',
            fn: (st, ctx) => {
              const n = S.dip(st, ctx.nation);
              S.Mil.startInsurgency(st, 'Insurgency in ' + (n ? n.name : 'the Annexed Territory'));
            }
          },
          factions: { military: +5, nationalists: +6, intelligentsia: -8 }
        },
        {
          label: 'Grant autonomy within the state', detail: 'Local assembly, language rights and fiscal autonomy under our sovereignty. Reduces resistance; concedes the point that they are different.',
          effects: { 'society.unrest': -5, 'society.latent': -6, 'national.softPower': +4, 'quality.admin': -2 },
          factions: { nationalists: -9, reformers: +7, provinces: +5 }
        },
        {
          label: 'Withdraw and restore their state', detail: 'Give the territory back as a heavily bound client. Ends the occupation and its costs; the annexation is written off.',
          effects: { 'society.approval': -7, 'national.prestige': -8, 'world.tension': -8, 'society.unrest': -4 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation); if (!n || !n.absorbedBy) return;
            n.absorbedBy = null; n.clientOf = 'player';
            n.gdp *= 8; n.power = 18; n.milPower = 2;
            n.relation = -20; n.affinity += 5; n.grievance = 20;
            st.diplomacy.nations.forEach((o) => { if (!o.absorbedBy && o.id !== n.id) o.relation += 6; });
          },
          factions: { nationalists: -16, military: -8, intelligentsia: +8, reformers: +8 },
          headline: 'Occupation Ends: Annexed State Restored'
        }
      ]
    }
  ];

  LIB5.forEach((d) => { D.LIB.push(d); D.BY_ID[d.id] = d; });

})(window.S);

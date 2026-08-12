/* STRATEGIAN — fourth decision volume: consequences.
   Nothing here arrives in a vacuum. Every entry is gated on something you
   already did — a ruling, a policy setting, a war, a programme — and says
   so in the brief. Entries marked `dynamic` are never rostered; they are
   scheduled by the option that caused them.                              */
(function (S) {
  'use strict';

  const D = S.Decisions;
  const F = D.flavour;
  const ruled = D.ruled, chose = D.chose, ago = D.ago;

  const LIB = [

    /* --------------------------------- follow-ups scheduled by an option */
    {
      id: 'arbitration_ruling', cat: 'economy', dynamic: true, title: 'The Tribunal Has Ruled',
      from: 'Attorney General', urgency: 'pressing', deadline: 16,
      brief: (st) => `<p>The international tribunal has ruled on the expropriation we carried out ${ago(st, 'nationalisation')}. It has found against us and assessed damages at ${S.money(st.economy.gdp * 0.022)}.</p>
        <p>Payment is a large outlay from reserves. Non-payment exposes our assets abroad to enforcement and seizure.</p>`,
      advisors: () => [
        { who: 'Attorney General', role: 'Justice', said: 'The award is enforceable in forty jurisdictions. Non-payment invites seizure of state assets abroad, beginning with aircraft. I advise settling.' },
        { who: 'Nationalist Caucus', role: 'Legislature', said: 'A foreign tribunal has no authority over decisions taken on our own territory. We should refuse to recognise the award.' }
      ],
      options: [
        { label: 'Pay the award in full', detail: 'Pay from reserves; restores standing with investors and creditors.',
          effects: { 'economy.businessConfidence': +8, 'economy.reserveStatus': +4, 'society.approval': -5 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.022; },
          factions: { business: +10, nationalists: -12 } },
        { label: 'Negotiate a payment schedule', detail: 'Pay in instalments over ten years; the liability is added to debt.',
          effects: { 'economy.businessConfidence': +3 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.022; }, factions: { business: +4 } },
        { label: 'Refuse to recognise the ruling', detail: 'Do not pay. Assets abroad become liable to seizure; investor confidence falls.',
          effects: { 'economy.businessConfidence': -14, 'economy.reserveStatus': -8, 'society.approval': +5, 'national.prestige': -5 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.ideology === 'liberal') n.relation -= 8; }); },
          factions: { nationalists: +14, business: -16 },
          headline: 'Government Rejects Tribunal Award' }
      ]
    },
    {
      id: 'soe_performance', cat: 'economy', dynamic: true, title: 'The Nationalised Complex, Four Years On',
      from: 'Ministry of Industry', urgency: 'routine', deadline: 24,
      brief: (st, ctx) => {
        const good = st.quality.admin > 55 && st.society.corruption < 45;
        ctx.good = ctx.good == null ? good : ctx.good;
        return `<p>The complex we took into public ownership ${ago(st, 'nationalisation')} has completed four years under state management.</p>
          <p>${ctx.good ? 'Output is up, the workforce has grown, and the complex pays a dividend to the treasury.'
            : 'Output is down by a third, the maintenance backlog is large, and no dividend has been paid since the transfer.'}</p>`;
      },
      options: [
        { label: 'Reinvest and expand it', detail: 'Commit further capital under continued state management.',
          effects: { 'policy.econ.stateOwnership': +6, 'budget.alloc.infra': +0.2 },
          fn: (st, ctx) => { if (ctx.good) { st.economy.reserves += st.economy.gdp * 0.004; st.society.approval += 3; } else { st.economy.reserves -= st.economy.gdp * 0.006; st.economy.shock -= 0.3; } },
          factions: { labour: +9, business: -7 } },
        { label: 'Bring in private management under state ownership', detail: 'Contract private managers while the state retains ownership.',
          effects: { 'economy.businessConfidence': +5, 'quality.admin': +2, 'economy.shock': +0.2 },
          factions: { business: +7, labour: -5 } },
        { label: 'Sell it back', detail: 'Return the complex to private ownership and recover the sale proceeds.',
          effects: { 'policy.econ.stateOwnership': -8, 'society.approval': -4, 'economy.businessConfidence': +8 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.008; },
          factions: { business: +12, labour: -12, nationalists: -10 } }
      ]
    },
    {
      id: 'ally_calls_it_in', cat: 'military', dynamic: true, title: 'The Alliance Is Invoked',
      from: 'Foreign Ministry', urgency: 'urgent', deadline: 6,
      brief: (st, ctx) => {
        const ally = st.diplomacy.nations.filter((n) => n.allyOfUs)[0];
        ctx.nation = ctx.nation || (ally ? ally.id : null);
        const n = ctx.nation ? S.dip(st, ctx.nation) : null;
        return `<p>${n ? n.name : 'Our ally'} has been attacked and has invoked the defence pact we signed. The treaty obliges us to enter the war on their side.</p>
          <p>Our force index is ${S.round(st.military.power, 1)}; readiness ${S.round(st.military.readiness, 0)}.</p>`;
      },
      advisors: () => [
        { who: 'Chief of Staff', role: 'Defence', said: 'Deployment is feasible. It means full war: sustained casualties, equipment losses and a long commitment.' },
        { who: 'Foreign Minister', role: 'Diplomacy', said: 'If we do not honour this pact, every other treaty we hold loses credibility at once. I advise deploying.' }
      ],
      options: [
        { label: 'Honour it in full and deploy', detail: 'Enter the war alongside the ally, as the treaty requires.',
          effects: { 'national.prestige': +10, 'society.approval': -6, 'world.tension': +10 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation);
            if (n) { n.relation = 100; n.warSupport = 1.5; }
            const foe = st.diplomacy.nations.slice().sort((a, b) => a.relation - b.relation)[0];
            if (foe && !foe.atWar) S.Mil.startWar(st, foe.id, { aggressor: false, intensity: 60, homeSupport: 52 });
            st.diplomacy.nations.forEach((o) => { if (o.allyOfUs) o.relation += 15; });
          },
          factions: { military: +10, nationalists: +6, labour: -8 } },
        { label: 'Send materiel, not troops', detail: 'Supply equipment and funds without deploying forces. The ally will regard the pact as unfulfilled.',
          effects: { 'national.prestige': -2, 'world.tension': +5 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 15; n.warSupport = 0.6; } st.economy.reserves -= st.economy.gdp * 0.008; st.military.equipment -= 5; },
          factions: { military: +3, business: -3 } },
        { label: 'Refuse and withdraw from the pact', detail: 'Decline to fight and leave the treaty. Standing with all partners falls.',
          effects: { 'national.prestige': -16, 'national.softPower': -12, 'society.approval': +3 },
          fn: (st, ctx) => { if (ctx.nation) S.Dip.breakTreaty(st, ctx.nation, 'defense'); st.diplomacy.nations.forEach((o) => { o.relation -= 12; }); },
          factions: { nationalists: +8, military: -14, intelligentsia: -8 },
          headline: 'Government Refuses to Honour Defence Pact' }
      ]
    },
    {
      id: 'purge_backlash', cat: 'civic', dynamic: true, title: 'The Convictions Are Being Overturned',
      from: 'Attorney General', urgency: 'routine', deadline: 20,
      brief: (st) => `<p>The appeal court has begun quashing convictions from the anti-corruption campaign of ${ago(st, 'corruption_purge')}. It finds that evidence in several cases was improperly assembled.</p>
        <p>Corruption currently stands at ${S.round(st.society.corruption, 0)}/100, lower than before the campaign.</p>`,
      options: [
        { label: 'Accept the judgments and compensate', detail: 'Recognise the rulings and compensate those acquitted.',
          effects: { 'quality.admin': +4, 'society.approval': -4, 'society.freedom': +4 },
          factions: { reformers: +8, intelligentsia: +9, business: +5 } },
        { label: 'Retry them properly', detail: 'Bring new prosecutions on properly gathered evidence.',
          effects: { 'quality.admin': +2, 'society.corruption': -2, 'budget.alloc.interior': +0.1 },
          factions: { reformers: +5, business: -4 } },
        { label: 'Legislate to overturn the appeals', detail: 'Pass retrospective legislation restoring the convictions.',
          effects: { 'society.freedom': -10, 'quality.admin': -5, 'society.latent': +10, 'national.softPower': -6 },
          factions: { reformers: -14, intelligentsia: -14, nationalists: +5 } }
      ]
    },
    {
      id: 'base_incident', cat: 'diplomacy', dynamic: true, title: 'An Incident at the Foreign Base',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 10,
      brief: (st, ctx) => {
        const n = ctx.nation ? S.dip(st, ctx.nation) : null;
        return `<p>Two servicemen from the ${n ? n.adj : 'foreign'} base killed a local woman with a vehicle and have been flown home under the status of forces agreement we signed ${ago(st, 'foreign_base_request')}.</p>
          <p>Protest crowds have gathered at the base gates for three consecutive nights.</p>`;
      },
      options: [
        { label: 'Demand jurisdiction and renegotiate the agreement', detail: 'Seek jurisdiction for our courts and revised terms. Relations with the basing power decline.',
          effects: { 'society.approval': +6, 'national.prestige': +3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 14; },
          factions: { nationalists: +12, reformers: +6 } },
        { label: 'Accept the agreement as written', detail: 'Apply the agreement as signed. Public anger and unrest continue.',
          effects: { 'society.approval': -8, 'society.unrest': +8, 'society.latent': +8 },
          factions: { nationalists: -14, military: +3 } },
        { label: 'Close the base', detail: 'Terminate the basing arrangement, forgoing its payments and the alliance.',
          effects: { 'society.approval': +9, 'national.prestige': -3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 30; n.allyOfUs = false; } st.economy.reserves -= st.economy.gdp * 0.008; },
          factions: { nationalists: +16, military: -8, business: -6 }, headline: 'Foreign Base Ordered Closed' }
      ]
    },
    {
      id: 'rail_overrun', cat: 'economy', dynamic: true, title: 'The Rail Programme Is Over Budget',
      from: 'National Audit Office', urgency: 'pressing', deadline: 18,
      brief: (st) => `<p>The audit office reports the high-speed rail programme at nearly double its authorised cost and four years behind schedule. Construction covers half the route; no section is in service.</p>
        <p>The overrun is now the most frequently cited criticism of the government.</p>`,
      options: [
        { label: 'Fund it to completion', detail: 'Authorise the additional funds and complete the full route.',
          effects: { 'society.approval': -6 },
          fn: (st) => { const p = (st.programmes || []).find((x) => x.key === 'rail'); if (p) { p.costPct *= 1.5; } else { st.economy.debt += st.economy.gdp * 0.02; } },
          factions: { business: +6, provinces: +10, reformers: -8 } },
        { label: 'Descope it to the profitable section', detail: 'Complete only the viable section and cancel the remainder.',
          effects: { 'society.approval': +2, 'national.prestige': -3 },
          fn: (st) => { const p = (st.programmes || []).find((x) => x.key === 'rail'); if (p) { p.years = Math.max(1, p.years - 3); p.costPct *= 0.6; } },
          factions: { provinces: -8, business: +3 } },
        { label: 'Cancel it', detail: 'Halt the programme and write off spending to date.',
          effects: { 'society.approval': -3, 'national.prestige': -6, 'economy.shock': -0.4 },
          fn: (st) => { const p = (st.programmes || []).find((x) => x.key === 'rail'); if (p) S.Actions.cancelProgramme(st, p.id); },
          factions: { provinces: -16, business: -6, reformers: +7 } }
      ]
    },
    {
      id: 'amnesty_consequence', cat: 'civic', dynamic: true, title: 'One of Them Is Running for Office',
      from: 'Office of the Leader', urgency: 'routine', deadline: 22,
      brief: (st) => `<p>A man released under the amnesty ${ago(st, 'amnesty')} has since built the largest opposition movement in the country and intends to stand for office.</p>
        <p>He has committed no crime since his release. Approval stands at ${S.round(st.society.approval, 0)}%.</p>`,
      options: [
        { label: 'Let him stand', detail: 'Permit the candidacy under the terms of the amnesty.',
          effects: { 'society.freedom': +6, 'national.softPower': +6, 'society.approval': -3, 'society.legitimacy': +5 },
          factions: { reformers: +12, intelligentsia: +10, nationalists: -6 } },
        { label: 'Bar him on a technicality', detail: 'Disqualify him on registration grounds. Likely to provoke protests.',
          effects: { 'society.freedom': -8, 'society.latent': +12, 'national.softPower': -6 },
          factions: { reformers: -16, intelligentsia: -12 },
          risk: { p: 0.35, text: 'Mass demonstrations', fn: (st) => { st.society.unrest += 14; } } },
        { label: 'Re-arrest him', detail: 'Revoke the amnesty in his case and detain him.',
          requires: (st) => S.Soc.repression(st) > 45,
          effects: { 'society.freedom': -14, 'society.latent': +18, 'society.unrest': +10, 'national.softPower': -12 },
          factions: { reformers: -22, intelligentsia: -18, military: +4 } },
        { label: 'Offer him a ministry', detail: 'Bring him into the cabinet and tie him to government policy.',
          effects: { 'society.approval': +5, 'society.legitimacy': +4, 'society.cohesion': +3 },
          factions: { reformers: +10, nationalists: -8, military: -4 } }
      ]
    },
    {
      id: 'demobilisation', cat: 'military', dynamic: true, title: 'What to Do With the Army',
      from: 'Ministry of Defence', urgency: 'routine', deadline: 22,
      brief: (st) => `<p>The war has ended and the army remains at wartime strength. Demobilisation would release large numbers of trained men into a labour market with ${S.round(st.economy.unemployment, 1)}% unemployment.</p>
        <p>Mishandled demobilisations have historically produced unrest and organised crime.</p>`,
      options: [
        { label: 'Phased demobilisation with retraining', detail: 'Discharge in stages with funded retraining. Slower and costlier; lower risk.',
          effects: { 'budget.alloc.defense': -0.5, 'budget.alloc.education': +0.3, 'economy.unemployment': +0.4, 'society.unrest': -3 },
          factions: { military: +5, labour: +7 } },
        { label: 'Keep the force under arms', detail: 'Retain current strength. Defence costs stay high; unemployment does not rise.',
          effects: { 'budget.alloc.defense': +0.3, 'military.readiness': +4, 'economy.shock': -0.3 },
          factions: { military: +10, nationalists: +7, business: -6 } },
        { label: 'Immediate mass discharge', detail: 'Discharge at once. Lowest immediate cost; unemployment and crime rise.',
          effects: { 'budget.alloc.defense': -0.9, 'economy.unemployment': +1.4, 'society.unrest': +10, 'society.crime': +6 },
          factions: { military: -14, labour: -8, business: +6 },
          risk: { p: 0.3, text: 'Armed veterans turn to organised crime', fn: (st) => { st.society.crime += 8; st.quality.security -= 4; } } },
        { label: 'Convert them into a labour corps', detail: 'Transfer units to work on the infrastructure programme.',
          effects: { 'budget.alloc.defense': -0.3, 'budget.alloc.infra': +0.3, 'quality.infra': +3, 'economy.unemployment': -0.2 },
          factions: { military: +4, provinces: +8, labour: +4 } }
      ]
    },
    {
      id: 'imf_review', cat: 'budget', dynamic: true, title: 'The Programme Review',
      from: 'Ministry of Finance', urgency: 'pressing', deadline: 14,
      brief: (st) => `<p>The lenders have arrived to review the programme we entered ${ago(st, 'debt_wall')}. Several conditions remain unmet and the next tranche depends on meeting them.</p>
        <p>Debt stands at ${S.round(st.economy.debtGdp, 0)}% of output; the deficit at ${S.round((st.economy.deficit / st.economy.gdp) * 100, 1)}%.</p>`,
      options: [
        { label: 'Meet the conditions', detail: 'Implement the required cuts and receive the tranche.',
          effects: { 'society.approval': -8, 'society.unrest': +8, 'economy.reserveStatus': +8, 'economy.businessConfidence': +7 },
          fn: (st) => { for (const m in st.budget.alloc) st.budget.alloc[m] *= 0.92; st.economy.reserves += st.economy.gdp * 0.03; st.policy.econ.subsidies = Math.max(0, st.policy.econ.subsidies - 12); },
          factions: { business: +9, labour: -14, nationalists: -8 } },
        { label: 'Negotiate a slower path', detail: 'Seek extended deadlines; smaller cuts now and a smaller tranche.',
          effects: { 'society.approval': -3, 'economy.reserveStatus': +3 },
          fn: (st) => { for (const m in st.budget.alloc) st.budget.alloc[m] *= 0.97; st.economy.reserves += st.economy.gdp * 0.015; },
          factions: { labour: -5, business: +4 } },
        { label: 'Leave the programme', detail: 'Exit the programme. No further tranches; borrowing costs rise.',
          effects: { 'economy.reserveStatus': -10, 'society.approval': +7, 'national.prestige': +3 },
          fn: (st) => { st.flags.imfProgramme = false; st.economy.avgDebtRate += 1.5; },
          factions: { nationalists: +14, labour: +8, business: -12 },
          headline: 'Government Walks Out of Lending Programme' }
      ]
    },
    {
      id: 'harvest_result', cat: 'economy', dynamic: true, title: 'The First Harvest After the Reform',
      from: 'Ministry of Agriculture', urgency: 'routine', deadline: 22,
      brief: (st, ctx) => {
        const good = st.quality.admin > 50;
        ctx.good = ctx.good == null ? good : ctx.good;
        return `<p>The first full harvest since the land settlement of ${ago(st, 'land_reform')} is in.</p>
          <p>${ctx.good ? 'Output held steady and smallholder incomes rose sharply.'
            : 'Output fell by a fifth. The new holdings are too small to mechanise and incomplete titles restrict access to credit.'}</p>`;
      },
      options: [
        { label: 'Extend credit and extension services', detail: 'Fund rural credit and agronomy support for the new smallholders.',
          effects: { 'budget.alloc.infra': +0.2, 'economy.shock': +0.3, 'society.inequality': -2 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.004; }, factions: { provinces: +9, labour: +6 } },
        { label: 'Encourage co-operatives', detail: 'Support co-operatives that pool machinery across small holdings.',
          effects: { 'economy.shock': +0.2, 'economy.productivity': +1 }, factions: { labour: +7, business: -3 } },
        { label: 'Allow consolidation to reverse it', detail: 'Permit sale and consolidation of the redistributed plots.',
          effects: { 'society.inequality': +4, 'economy.shock': +0.4, 'society.approval': -4 },
          factions: { business: +9, labour: -10, provinces: -8 } }
      ]
    },
    {
      id: 'sanctions_bite', cat: 'economy', dynamic: true, title: 'The Sanctions Have Started to Hurt',
      from: 'Ministry of Finance', urgency: 'pressing', deadline: 16,
      brief: (st) => `<p>The measures imposed after the nuclear test are now fully in force. Sanctions pressure stands at ${S.round(st.economy.sanctionPressure, 0)}/100, the currency is at ${S.round(st.economy.fx, 0)}, and three of our banks have lost correspondent relationships.</p>
        <p>The pressure will continue while the weapons programme stands.</p>`,
      options: [
        { label: 'Hold the posture and endure', detail: 'Keep the arsenal and absorb the economic cost.',
          effects: { 'society.approval': -4, 'economy.shock': -0.5, 'society.cohesion': +5 },
          factions: { nationalists: +12, military: +8, business: -10 } },
        { label: 'Open talks on verification', detail: 'Offer inspections in exchange for partial sanctions relief.',
          effects: { 'world.tension': -6, 'national.prestige': +3 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.sanctioningUs && st.rng.chance(0.5)) { n.sanctioningUs = false; n.relation += 10; } }); },
          factions: { business: +8, intelligentsia: +6, nationalists: -10 } },
        { label: 'Renounce the programme entirely', detail: 'Abandon the weapons programme; sanctions are lifted.',
          effects: { 'national.prestige': -8, 'world.tension': -12 },
          fn: (st) => { st.policy.mil.nuclearPosture = 'renounced'; st.diplomacy.nations.forEach((n) => { n.sanctioningUs = false; n.relation += 16; }); },
          factions: { nationalists: -20, military: -12, business: +14 },
          headline: 'Nuclear Programme Abandoned in Exchange for Sanctions Relief' }
      ]
    },
    {
      id: 'carbon_border_tax', cat: 'diplomacy', dynamic: true, title: 'A Border Tax on Our Exports',
      from: 'Ministry of Trade', urgency: 'pressing', deadline: 18,
      brief: (st) => `<p>The signatories to the emissions treaty we refused have imposed a carbon border adjustment. Our exports now face a levy calculated on the emissions we declined to cap.</p>
        <p>Exports run at ${S.money(st.economy.exports)}. The levy is worth roughly a tenth of that.</p>`,
      options: [
        { label: 'Sign the treaty after all', detail: 'Reverse the decision and remove the levy.',
          effects: { 'policy.energy.transition': +18, 'national.prestige': -4, 'economy.shock': +0.4, 'national.softPower': +4 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.ideology === 'liberal') n.relation += 10; }); },
          factions: { business: +6, intelligentsia: +8, nationalists: -12 } },
        { label: 'Retaliate with our own tariffs', detail: 'Impose counter-tariffs. Trade volumes fall on both sides.',
          effects: { 'policy.trade.tariff': +8, 'economy.shock': -0.6, 'world.tension': +5, 'society.approval': +3 },
          factions: { nationalists: +12, business: -9 } },
        { label: 'Decarbonise the export sectors only', detail: 'Fund emissions cuts in the taxed sectors to reduce the levy.',
          effects: { 'budget.alloc.energy': +0.4, 'policy.energy.transition': +10, 'economy.shock': -0.2 },
          factions: { business: +5, intelligentsia: +4 } },
        { label: 'Absorb it', detail: 'Accept the levy without policy change. Export margins fall.',
          effects: { 'economy.shock': -0.8, 'economy.businessConfidence': -8 },
          factions: { nationalists: +5, business: -8 } }
      ]
    },
    {
      id: 'pension_reckoning', cat: 'budget', dynamic: true, title: 'The Bill Has Arrived',
      from: 'Government Actuary', urgency: 'urgent', deadline: 12,
      brief: (st) => `<p>The pension question has now been deferred twice. The fund's assets no longer cover the coming year's obligations and the shortfall must be met from general revenue this quarter.</p>
        <p>All remaining options carry substantial cost; the earlier deferrals removed the cheaper ones.</p>`,
      options: [
        { label: 'Emergency cut to the pension in payment', detail: 'Reduce what is already being paid.',
          effects: { 'society.approval': -14, 'society.unrest': +12, 'budget.alloc.welfare': -1.5 },
          factions: { labour: -18, clergy: -8, business: +10 },
          headline: 'Pensions Cut in Payment for the First Time' },
        { label: 'Fund it from borrowing', detail: 'Borrow to cover the shortfall; debt rises by about 4.5% of output.',
          effects: { 'economy.reserveStatus': -5, 'society.approval': -2 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.045; }, factions: { business: -8, labour: +5 } },
        { label: 'A dedicated pension levy', detail: 'Introduce an earmarked income levy to fund pensions.',
          effects: { 'policy.tax.income': +5, 'society.approval': -8, 'economy.shock': -0.4 },
          factions: { labour: -6, business: -8, reformers: +4 } }
      ]
    },
    {
      id: 'inquiry_vindicated', cat: 'civic', dynamic: true, title: 'The Report We Rejected Was Right',
      from: 'Office of the Leader', urgency: 'pressing', deadline: 14,
      brief: (st) => `<p>A second failure of the kind the inquiry warned against has occurred. The report we rejected ${ago(st, 'disaster_inquiry')} is now receiving extensive critical press coverage.</p>`,
      options: [
        { label: 'Accept the original findings in full', detail: 'Adopt the recommendations now and begin remediation.',
          effects: { 'society.approval': -4, 'quality.admin': +5, 'society.legitimacy': +3 },
          fn: (st) => { const s = (st.scars || []).find((x) => x.deaths); if (s) s.severity *= 0.9; },
          factions: { reformers: +8, intelligentsia: +7 } },
        { label: 'Dismiss the ministers who advised rejection', detail: 'Remove those ministers. The findings themselves remain unaddressed.',
          effects: { 'society.approval': +3, 'quality.admin': -3, 'society.corruption': +1 },
          factions: { reformers: -4, business: -3 } },
        { label: 'Say nothing at all', detail: 'Issue no response and wait for coverage to subside.',
          effects: { 'society.approval': -7, 'society.latent': +8, 'society.legitimacy': -5 },
          factions: { reformers: -10, intelligentsia: -9 } }
      ]
    },

    /* ------------------------- gated on state, not scheduled by an option */
    {
      id: 'press_delegation', cat: 'diplomacy', title: 'A Delegation About the Press',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 20,
      weight: (st) => (st.policy.interior.pressFreedom < 35 && st.national.softPower > 25 ? 13 : 0),
      brief: (st) => `<p>A visiting delegation of foreign parliamentarians has raised press freedom during trade talks. Press freedom stands at ${st.policy.interior.pressFreedom}/100 and journalists are currently detained.</p>
        <p>The delegation has a prepared report, has been briefed by our editors, and will hold a press conference on Thursday.</p>`,
      options: [
        { label: 'Release the detained journalists', detail: 'Free the detained journalists before the press conference.',
          effects: { 'policy.interior.pressFreedom': +12, 'national.softPower': +8, 'society.latent': -6 },
          factions: { intelligentsia: +12, reformers: +9, nationalists: -7 } },
        { label: 'Offer hospitality only', detail: 'Provide official visits and meetings; make no policy change.',
          effects: { 'national.softPower': +2 }, factions: {} },
        { label: 'Expel the delegation', detail: 'Declare the matter internal and expel them. Relations with liberal states fall.',
          effects: { 'national.softPower': -10, 'world.tension': +3, 'society.approval': +3 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.ideology === 'liberal') n.relation -= 10; }); },
          factions: { nationalists: +12, intelligentsia: -12 }, headline: 'Foreign Delegation Expelled Over Press Criticism' }
      ]
    },
    {
      id: 'surveillance_scandal', cat: 'civic', title: 'Misuse of Surveillance Powers',
      from: 'Cabinet Secretary', urgency: 'pressing', deadline: 12,
      weight: (st) => (st.policy.interior.surveillance > 65 ? 15 : 0),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Surveillance powers standing at ${st.policy.interior.surveillance}/100 have been used against opposition politicians, two judges and a delegation from ${f.union}. The authorisations were signed by officials of this government.</p>`;
      },
      options: [
        { label: 'Full disclosure and an independent regulator', detail: 'Publish the authorisations and transfer oversight to an independent regulator.',
          effects: { 'policy.interior.surveillance': -18, 'society.freedom': +8, 'quality.admin': +4, 'society.approval': -4, 'intel.strength': -5 },
          factions: { reformers: +14, intelligentsia: +12, military: -8 } },
        { label: 'Discipline the officials who signed', detail: 'Sanction the signing officials and retain the powers with minor limits.',
          effects: { 'policy.interior.surveillance': -6, 'quality.admin': +2, 'society.latent': +3 },
          factions: { reformers: +4, intelligentsia: +3 } },
        { label: 'Deny it', detail: 'Deny the reports and keep the authorisations classified.',
          effects: { 'society.latent': +14, 'policy.interior.pressFreedom': -6, 'national.softPower': -6 },
          factions: { reformers: -14, intelligentsia: -14 },
          risk: { p: 0.45, text: 'The signed authorisations are published', fn: (st) => { st.society.approval -= 12; st.society.scandal -= 8; st.society.unrest += 8; } } }
      ]
    },
    {
      id: 'war_profiteering', cat: 'military', title: 'Wartime Procurement Abuses',
      from: 'National Audit Office', urgency: 'pressing', deadline: 14,
      weight: (st) => (st.wars.length && st.society.corruption > 30 ? 15 : 0),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Wartime procurement has run without competition for two years. ${f.firm} has been paid four times the pre-war rate for rations; the contracts were signed by ${f.official}.</p>
          <p>The pricing is known to troops at the front and is damaging morale.</p>`;
      },
      options: [
        { label: 'Prosecute, mid-war', detail: 'Arrest and charge now. Supply is disrupted in the short term.',
          effects: { 'society.corruption': -6, 'military.morale': +8, 'society.approval': +6, 'military.logistics': -5 },
          factions: { military: +10, reformers: +10, business: -12 } },
        { label: 'Renegotiate the contracts quietly', detail: 'Reprice the contracts privately and recover part of the money. No prosecutions.',
          effects: { 'society.corruption': -2, 'economy.reserves': 0 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.003; }, factions: { military: +3, business: -4 } },
        { label: 'Leave it until the war ends', detail: 'Defer action until the war ends. Supply is protected; morale falls.',
          effects: { 'society.corruption': +5, 'military.morale': -6, 'society.latent': +6 },
          factions: { military: -9, reformers: -10, business: +8 } }
      ]
    },
    {
      id: 'refugee_second_generation', cat: 'social', title: 'The Children of the Camps',
      from: 'Ministry of the Interior', urgency: 'routine', deadline: 24,
      weight: (st) => (ruled(st, 'refugee_flow') && D.yearsSince(st, 'refugee_flow') > 6 ? 14 : 0),
      brief: (st) => `<p>The refugees we admitted ${ago(st, 'refugee_flow')} now have children born and raised here who hold no citizenship of any state.</p>
        <p>Cohesion stands at ${S.round(st.society.cohesion, 0)}/100.</p>`,
      options: [
        { label: 'Citizenship by birth for all of them', detail: 'Legislate citizenship for every child born here.',
          effects: { 'society.cohesion': +5, 'national.softPower': +6, 'economy.shock': +0.3, 'society.approval': -3 },
          factions: { reformers: +11, intelligentsia: +9, nationalists: -13 } },
        { label: 'Citizenship on conditions', detail: 'Language, residence, a test and a fee.',
          effects: { 'society.cohesion': +2, 'quality.admin': -1 }, factions: { nationalists: -3, reformers: +3 } },
        { label: 'Leave them stateless', detail: 'Make no provision; the children inherit their parents\' status.',
          effects: { 'society.cohesion': -6, 'society.unrest': +6, 'national.softPower': -8, 'society.inequality': +3 },
          factions: { nationalists: +9, reformers: -14, intelligentsia: -12 } }
      ]
    },
    {
      id: 'veteran_movement', cat: 'civic', title: 'The Veterans Have Organised',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 16,
      weight: (st) => ((st.national.warsWon || 0) + (st.national.warsLost || 0) > 0 && st.policy.mil.veteranCare < 45 ? 15 : 0),
      brief: (st) => `<p>Veterans of the war have formed a movement and marched on the capital to demand better support. Personnel and veteran support stands at ${st.policy.mil.veteranCare}/100.</p>
        <p>The movement is organised and disciplined; many members are armed and trained.</p>`,
      options: [
        { label: 'Meet their demands in full', detail: 'Pensions, healthcare, housing, immediately.',
          effects: { 'policy.mil.veteranCare': +25, 'budget.alloc.welfare': +0.5, 'society.unrest': -8, 'military.morale': +8 },
          factions: { military: +14, nationalists: +8, business: -5 } },
        { label: 'Partial settlement', detail: 'Concede part of the demands, intended to divide the leadership.',
          effects: { 'policy.mil.veteranCare': +10, 'society.unrest': -3 }, factions: { military: +5 } },
        { label: 'Disperse them', detail: 'Order police to clear the march. Serious risk to army loyalty.',
          effects: { 'society.unrest': +14, 'society.latent': +16, 'military.morale': -14, 'society.approval': -8 },
          factions: { military: -20, nationalists: -14 },
          risk: { p: 0.35, text: 'Soldiers refuse the order', fn: (st) => { st.risk.coup += 18; st.factions.forEach((f) => { if (f.id === 'military') f.loyalty -= 10; }); } },
          headline: 'Police Disperse Veterans\' March' }
      ]
    },
    {
      id: 'programme_pride', cat: 'social', title: 'The Programme Has Become Popular',
      from: 'Office of the Leader', urgency: 'routine', deadline: 24,
      weight: (st) => ((st.programmes || []).length >= 2 ? 11 : 0),
      brief: (st) => {
        const p = st.programmes[0];
        return `<p>${p ? p.name : 'The national programme'} has become widely popular and receives regular favourable coverage.</p>
          <p>The support can be used to expand the work or converted into political standing.</p>`;
      },
      options: [
        { label: 'Accelerate it', detail: 'More money, faster delivery.',
          effects: { 'society.approval': +6, 'national.prestige': +3 },
          fn: (st) => { const p = st.programmes[0]; if (p) { p.years = Math.max(1, p.years - 1); p.costPct *= 1.35; } },
          factions: { labour: +7, provinces: +6, business: -3 } },
        { label: 'Launch a second one on the strength of it', detail: 'Start a water and sanitation programme while support is high.',
          effects: { 'society.approval': +4 },
          fn: (st) => { S.Actions.startProgramme(st, { key: 'watersan', name: 'Water & Sanitation Programme', dept: 'infra', years: 4, costPct: 0.4, desc: 'Clean water and sewerage where there is none.', perYear: { 'quality.health': 0.9, 'quality.infra': 0.7 } }); },
          factions: { provinces: +8, labour: +6 } },
        { label: 'Put your name on it', detail: 'Rename the programme after the leader; the credit becomes personal.',
          effects: { 'society.approval': +8, 'society.legitimacy': +3, 'policy.interior.propaganda': +8, 'national.softPower': -3 },
          factions: { nationalists: +6, reformers: -7, intelligentsia: -5 } }
      ]
    },
    {
      id: 'scar_anniversary_politics', cat: 'civic', title: 'The Anniversary Has Become Political',
      from: 'Office of the Leader', urgency: 'routine', deadline: 18,
      weight: (st) => ((st.scars || []).some((s) => s.deaths > 0 && s.severity > 25) ? 13 : 0),
      brief: (st) => {
        const s = (st.scars || []).filter((x) => x.deaths > 0).sort((a, b) => b.severity - a.severity)[0];
        return `<p>The commemoration of ${s ? s.name : 'the disaster'} is being organised by the bereaved families, who have invited the opposition and not the government.</p>
          <p>${s ? S.num(s.deaths) + ' people died' : 'A great many died'}, and ${s ? S.round(s.severity, 0) : 'much'} per cent of the damage remains unrepaired.</p>`;
      },
      options: [
        { label: 'Attend anyway', detail: 'Attend the ceremony despite the likely hostile reception.',
          effects: { 'society.approval': +4, 'society.cohesion': +4, 'society.legitimacy': +4 },
          factions: { reformers: +6, provinces: +8 } },
        { label: 'Announce a compensation fund at the ceremony', detail: 'Attend and announce a funded compensation scheme.',
          effects: { 'society.approval': +7, 'society.cohesion': +3 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.004; const s = (st.scars || [])[0]; if (s) s.severity *= 0.9; },
          factions: { provinces: +11, labour: +6 } },
        { label: 'Hold a rival official ceremony', detail: 'Stage a separate state ceremony at the same time. Deepens division.',
          effects: { 'society.cohesion': -5, 'society.approval': -4, 'policy.interior.propaganda': +6 },
          factions: { nationalists: +5, provinces: -10, reformers: -8 } },
        { label: 'Stay away', detail: 'Send a wreath and a junior minister.',
          effects: { 'society.approval': -6, 'society.latent': +5 }, factions: { provinces: -12 } }
      ]
    },
    {
      id: 'coalition_partner', cat: 'civic', title: 'The Coalition Is Fracturing',
      from: 'Chief Whip', urgency: 'pressing', deadline: 12,
      weight: (st) => (S.govMods(st).elections && st.society.approval < 48 ? 14 : 0),
      brief: (st) => `<p>The smaller party in the coalition has told the press it is reviewing its position. Approval stands at ${S.round(st.society.approval, 0)}% and the partner is responding to the polls.</p>
        <p>Without them the government has no majority and cannot pass a budget.</p>`,
      options: [
        { label: 'Concede their policy demands', detail: 'Adopt their welfare and education spending demands.',
          effects: { 'society.approval': -3, 'society.stability': +6 },
          fn: (st) => { st.budget.alloc.welfare += 0.3; st.budget.alloc.education += 0.2; }, factions: { labour: +6, business: -4 } },
        { label: 'Give them the ministries they want', detail: 'Reallocate the requested cabinet posts. Administrative quality falls.',
          effects: { 'quality.admin': -3, 'society.stability': +5, 'society.corruption': +2 }, factions: { reformers: -5 } },
        { label: 'Refuse concessions', detail: 'Offer nothing and continue as a minority if they withdraw.',
          effects: { 'society.stability': -6, 'society.approval': +2 },
          risk: { p: 0.4, text: 'The coalition collapses', fn: (st) => { st.society.stability -= 10; st.society.approval -= 5; if (S.govMods(st).elections) S.game.pushDecision('election_approaching', {}); } },
          factions: { nationalists: +5 } },
        { label: 'Call an early election', detail: 'Hold the election now, at a time of our choosing.',
          effects: { 'society.stability': -4 },
          fn: (st) => { S.Soc.runElection(st); }, factions: { reformers: +3 } }
      ]
    }
  ];

  LIB.forEach((d) => { D.LIB.push(d); D.BY_ID[d.id] = d; });
  void chose;
})(window.S);

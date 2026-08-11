/* STRATEGIAN — third decision volume: general matters.
   Written lean deliberately. A brief, three or four routes, and enough
   specifics drawn from the world that no two arrivals read the same.    */
(function (S) {
  'use strict';

  const D = S.Decisions;
  const V = D.variant, F = D.flavour;
  const dem = (st) => ['liberal', 'managed'].indexOf(st.nation.governmentId) >= 0;
  const aut = (st) => ['junta', 'personalist', 'party', 'theocratic'].indexOf(st.nation.governmentId) >= 0;

  const LIB = [

    /* ============================================================ ECONOMY */
    {
      id: 'central_bank_digital', cat: 'economy', title: 'A Digital Currency',
      from: 'Central Bank', urgency: 'routine', deadline: 26, weight: (st) => (st.quality.science > 40 ? 11 : 4),
      brief: (st) => `<p>The Bank proposes a state digital currency: instant settlement, no cash, and a complete record of every transaction in the country.</p>
        <p>The efficiency case is real. So is the other thing.</p>`,
      options: [
        { label: 'Issue it, with full traceability', detail: 'Every payment visible to the state.',
          effects: { 'economy.informal': -10, 'policy.interior.surveillance': +14, 'society.latent': +8, 'quality.admin': +4, 'economy.reserveStatus': +3 },
          factions: { reformers: -10, intelligentsia: -8, business: -4 }, headline: 'State Digital Currency Announced' },
        { label: 'Issue it with privacy guarantees', detail: 'Cash-like below a threshold.',
          effects: { 'economy.informal': -4, 'quality.admin': +3, 'economy.businessConfidence': +3 },
          factions: { reformers: +5, business: +4 } },
        { label: 'Leave money alone', detail: 'Notes and coins have served.', effects: {}, factions: { clergy: +3, reformers: -3 } }
      ]
    },
    {
      id: 'shipping_insurance', cat: 'economy', title: 'Underwriters Have Withdrawn',
      from: 'Ministry of Trade', urgency: 'pressing', deadline: 12,
      weight: (st) => (st.world.tension > 45 || st.economy.sanctionPressure > 20 ? 13 : 4),
      brief: (st) => `<p>Marine insurers have withdrawn cover for cargo moving to or from our ports. Nothing is formally banned; the market has simply decided we are not worth the risk.</p>
        <p>Exports run at ${S.money(st.economy.exports)} a year and most of that moves by sea.</p>`,
      options: [
        { label: 'State reinsurance for our own trade', detail: 'The treasury carries the risk the market will not.',
          effects: { 'economy.shock': +0.5, 'economy.reserves': 0 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.006; }, factions: { business: +10 } },
        { label: 'Reflag through a friendly registry', detail: 'A legal fiction everyone will see through.',
          effects: { 'economy.shock': +0.2, 'national.prestige': -2 },
          fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation > 20)[0]; if (n) n.relation += 6; }, factions: { business: +5 } },
        { label: 'Absorb it and reroute overland', detail: 'Slower, dearer, sovereign.',
          effects: { 'economy.shock': -0.7, 'economy.inflation': +0.6 }, factions: { nationalists: +5, business: -6 } }
      ]
    },
    {
      id: 'sovereign_fund_mandate', cat: 'budget', title: 'What the Fund Is For',
      from: 'Sovereign Wealth Fund', urgency: 'routine', deadline: 28,
      weight: (st) => (st.economy.swf != null ? 12 : 0),
      brief: (st) => `<p>The fund now holds ${S.money(st.economy.swf || 0)}. Its mandate is due for renewal and everyone in government has a use for it.</p>`,
      options: [
        { label: 'Invest abroad for returns', detail: 'A fund for the generation after next.',
          effects: { 'economy.reserveStatus': +6, 'society.approval': -3 },
          fn: (st) => { st.economy.swf = (st.economy.swf || 0) * 1.02; }, factions: { business: +8, labour: -5 } },
        { label: 'Invest at home in infrastructure', detail: 'Spend it where people can see it.',
          effects: { 'budget.alloc.infra': +0.5, 'quality.infra': +3, 'society.approval': +5, 'economy.reserveStatus': -4 },
          fn: (st) => { st.economy.swf = Math.max(0, (st.economy.swf || 0) * 0.85); }, factions: { provinces: +10, labour: +6 } },
        { label: 'Use it to plug the deficit', detail: 'It is money and we are short of money.',
          effects: { 'economy.reserveStatus': -8, 'society.approval': +2 },
          fn: (st) => { const take = (st.economy.swf || 0) * 0.3; st.economy.swf -= take; st.economy.reserves += take; },
          factions: { reformers: -9, business: -6 } },
        { label: 'Distribute a citizens\' dividend', detail: 'A cheque to every household, annually.',
          effects: { 'society.approval': +10, 'society.inequality': -3, 'economy.inflation': +0.5, 'economy.reserveStatus': -5 },
          factions: { labour: +12, business: -4 }, headline: 'Citizens\' Dividend Announced from the National Fund' }
      ]
    },
    {
      id: 'gig_economy', cat: 'economy', title: 'Work Without Employment',
      from: 'Ministry of Labour', urgency: 'routine', deadline: 25, weight: () => 10,
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A fifth of the workforce in ${f.city} now works through platforms that classify them as contractors. They have no sick pay, no pension and no employer.</p>
          <p>It is flexible, it is cheap, and it is quietly removing the tax base.</p>`;
      },
      options: [
        { label: 'Classify platform workers as employees', detail: 'Full rights, full contributions.',
          effects: { 'economy.informal': -6, 'policy.econ.laborProtection': +12, 'economy.unemployment': +0.5, 'society.inequality': -3 },
          factions: { labour: +13, business: -11 }, headline: 'Platform Workers Granted Full Employment Rights' },
        { label: 'A third category with partial rights', detail: 'Neither one thing nor the other, deliberately.',
          effects: { 'policy.econ.laborProtection': +4, 'economy.informal': -3 }, factions: { labour: +4, business: -3 } },
        { label: 'Leave it to the courts', detail: 'Let litigation decide over a decade.',
          effects: { 'quality.admin': -1 }, factions: { business: +6, labour: -7 } }
      ]
    },
    {
      id: 'industrial_accident', cat: 'crisis', title: 'The Plant Has Exploded',
      from: 'Ministry of Industry', urgency: 'urgent', deadline: 5, weight: (st) => (st.economy.sectors.industry > 18 ? 11 : 5),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        const dead = Math.round(st.rng.range(20, 240));
        ctx.dead = ctx.dead || dead;
        return `<p>A ${f.industry} plant belonging to ${f.firm} has exploded in ${f.region}. <b>${S.num(ctx.dead)}</b> workers are dead and the inspection file shows three unactioned warnings.</p>`;
      },
      options: [
        { label: 'Prosecute the company and tighten inspection', detail: 'Criminal charges, and a real inspectorate.',
          effects: { 'policy.econ.regulation': +10, 'society.approval': +5, 'economy.businessConfidence': -8, 'quality.admin': +3 },
          factions: { labour: +12, business: -12 }, headline: 'Company Charged Over Fatal Plant Explosion' },
        { label: 'Compensate the families and move on', detail: 'Money, quietly, without admission.',
          effects: { 'society.approval': -2, 'economy.reserves': 0 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.001; }, factions: { business: +5, labour: -6 } },
        { label: 'Blame the workers', detail: 'Procedural non-compliance at operator level.',
          effects: { 'society.approval': -8, 'society.latent': +8, 'economy.businessConfidence': +3 },
          factions: { labour: -16, business: +8 },
          risk: { p: 0.4, text: 'The warnings leak', fn: (st) => { st.society.approval -= 8; st.society.scandal -= 6; } } }
      ]
    },
    {
      id: 'tourism_boom', cat: 'economy', title: 'Too Many Visitors',
      from: 'Ministry of Culture', urgency: 'routine', deadline: 26, weight: (st) => (st.national.softPower > 40 ? 9 : 3),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Visitor numbers to ${f.city} have tripled in five years. The revenue is real and so is the fact that residents can no longer afford to live there.</p>`;
      },
      options: [
        { label: 'Cap visitors and tax the rest', detail: 'Fewer, paying more.',
          effects: { 'economy.shock': -0.2, 'society.approval': +4, 'economy.reserves': 0 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.002; }, factions: { provinces: +7, business: -5 } },
        { label: 'Build capacity and let it grow', detail: 'More hotels, more flights, more everything.',
          effects: { 'economy.shock': +0.6, 'quality.infra': -1, 'society.inequality': +2 },
          factions: { business: +9, labour: +3, provinces: -5 } },
        { label: 'Direct visitors to other regions', detail: 'Spread the money and the damage.',
          effects: { 'budget.alloc.infra': +0.2, 'society.inequality': -1 }, factions: { provinces: +9 } }
      ]
    },
    {
      id: 'competition_case', cat: 'economy', title: 'A Monopoly Case',
      from: 'Competition Authority', urgency: 'routine', deadline: 24, weight: () => 10,
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>The authority has found that ${f.firm} controls three-quarters of the ${f.industry} market and has been pricing accordingly. It recommends a break-up.</p>
          <p>The firm employs a great many people and funds a great many things.</p>`;
      },
      options: [
        { label: 'Break it up', detail: 'Split it and accept the fight.',
          effects: { 'economy.businessConfidence': -6, 'economy.shock': +0.4, 'society.approval': +5, 'policy.econ.regulation': +5 },
          factions: { reformers: +10, business: -12, labour: +5 }, headline: 'Competition Authority Orders Break-Up' },
        { label: 'Fine it and impose conditions', detail: 'Money and undertakings, no surgery.',
          effects: { 'economy.reserves': 0, 'society.approval': +2 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.002; }, factions: { reformers: +4, business: -3 } },
        { label: 'Overrule the authority', detail: 'National champions need scale.',
          effects: { 'society.corruption': +3, 'quality.admin': -3, 'economy.businessConfidence': +6 },
          factions: { business: +11, reformers: -12 } }
      ]
    },

    /* ============================================================= SOCIAL */
    {
      id: 'school_curriculum_science', cat: 'social', title: 'What the Schools Teach',
      from: 'Ministry of Education', urgency: 'routine', deadline: 26, weight: () => 10,
      brief: (st) => `<p>The curriculum board has proposed a revision to the science and history syllabus. Traditional authority has objected in detail and in public.</p>
        <p>Traditionalism in law stands at ${S.round(st.policy.social.traditionalism, 0)}/100.</p>`,
      options: [
        { label: 'Adopt the board\'s syllabus in full', detail: 'Teach the evidence.',
          effects: { 'quality.education': +3, 'quality.science': +3, 'policy.social.traditionalism': -8 },
          factions: { intelligentsia: +11, clergy: -13 } },
        { label: 'A compromise text', detail: 'Both accounts, side by side, satisfying nobody.',
          effects: { 'quality.education': +1 }, factions: { intelligentsia: -3, clergy: -3 } },
        { label: 'Defer to traditional authority', detail: 'The old syllabus, reaffirmed.',
          effects: { 'quality.science': -3, 'society.cohesion': +5, 'policy.social.traditionalism': +8 },
          factions: { clergy: +13, intelligentsia: -12 } }
      ]
    },
    {
      id: 'birth_rate', cat: 'social', title: 'Nobody Is Having Children',
      from: 'Office for Statistics', urgency: 'routine', deadline: 28,
      weight: (st) => (st.pop.growth < 0.8 ? 14 : 4),
      brief: (st) => `<p>The fertility rate has fallen to a level that halves the population in three generations. Population growth is ${S.signedPct(st.pop.growth, 2)} a year.</p>
        <p>Every country that has tried to reverse this has failed. Several have spent a fortune failing.</p>`,
      options: [
        { label: 'Large family payments and childcare', detail: 'Money and time, the two things parents lack.',
          effects: { 'policy.social.familyPolicy': +25, 'budget.alloc.welfare': +0.7, 'society.approval': +5 },
          factions: { labour: +8, clergy: +7, business: -4 } },
        { label: 'Immigration instead', detail: 'Solve it with people who already exist.',
          effects: { 'policy.interior.immigration': +18, 'society.cohesion': -6, 'economy.shock': +0.5 },
          factions: { business: +9, nationalists: -14, intelligentsia: +5 } },
        { label: 'Restrict abortion and contraception', detail: 'Coercive, and historically ineffective.',
          requires: (st) => st.policy.social.traditionalism > 45,
          effects: { 'society.freedom': -10, 'society.latent': +12, 'national.softPower': -8, 'policy.social.traditionalism': +12 },
          factions: { clergy: +14, reformers: -18, intelligentsia: -14 } },
        { label: 'Plan for a smaller country', detail: 'Automate, and accept the shape of things.',
          effects: { 'budget.alloc.research': +0.3, 'economy.productivity': +1 },
          factions: { intelligentsia: +6, nationalists: -8 } }
      ]
    },
    {
      id: 'obesity_health', cat: 'social', title: 'The Public Health Bill',
      from: 'Chief Medical Officer', urgency: 'routine', deadline: 24, weight: (st) => (st.quality.health > 40 ? 9 : 4),
      brief: () => `<p>Diet-related disease now consumes a large share of the health budget. The proposal is a tax on sugar, restrictions on advertising, and reformulation targets.</p>`,
      options: [
        { label: 'The full package', detail: 'Tax, advertising ban, mandatory targets.',
          effects: { 'quality.health': +4, 'economy.reserves': 0, 'society.approval': -3, 'policy.econ.regulation': +5 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.002; }, factions: { business: -9, intelligentsia: +7 } },
        { label: 'Voluntary reformulation', detail: 'Ask nicely and publish a league table.',
          effects: { 'quality.health': +1 }, factions: { business: +4 } },
        { label: 'Nothing', detail: 'People may eat what they like.',
          effects: { 'quality.health': -1, 'society.approval': +2 }, factions: { business: +6, intelligentsia: -5 } }
      ]
    },
    {
      id: 'disability_rights', cat: 'social', title: 'The Access Bill',
      from: 'Ministry of Justice', urgency: 'routine', deadline: 26, weight: () => 9,
      brief: () => `<p>A bill would require every public building, transport service and employer to make reasonable adjustments, enforceable in court. It is overdue, popular in principle and expensive in practice.</p>`,
      options: [
        { label: 'Pass it with a funded transition', detail: 'Full rights, with money to comply.',
          effects: { 'budget.alloc.infra': +0.25, 'society.approval': +5, 'quality.welfareQ': +4, 'national.softPower': +3 },
          factions: { reformers: +10, labour: +7, business: -5 } },
        { label: 'Pass it unfunded', detail: 'The duty without the means.',
          effects: { 'society.approval': +2, 'economy.businessConfidence': -5 }, factions: { reformers: +5, business: -8 } },
        { label: 'Public sector only', detail: 'Lead by example and leave firms alone.',
          effects: { 'budget.alloc.infra': +0.1, 'quality.welfareQ': +1 }, factions: { business: +4, reformers: -2 } }
      ]
    },
    {
      id: 'national_holiday', cat: 'social', title: 'A New National Day',
      from: 'Office of the Leader', urgency: 'routine', deadline: 30, weight: () => 7,
      brief: (st) => `<p>A proposal to establish a new national day. Which event it commemorates is the whole of the argument, and every option offends somebody.</p>
        <p>Cohesion stands at ${S.round(st.society.cohesion, 0)}/100.</p>`,
      options: [
        { label: 'Commemorate the founding', detail: 'Flags, parades, continuity.',
          effects: { 'society.cohesion': +6, 'national.prestige': +1 }, factions: { nationalists: +9, clergy: +4, reformers: -4 } },
        { label: 'Commemorate a past injustice', detail: 'A day of reckoning rather than celebration.',
          effects: { 'society.cohesion': -2, 'national.softPower': +5, 'society.freedom': +2 },
          factions: { reformers: +11, intelligentsia: +8, nationalists: -11 } },
        { label: 'Commemorate the workers', detail: 'Labour, and everyone who does it.',
          effects: { 'society.cohesion': +3 }, factions: { labour: +11, business: -4 } },
        { label: 'Decline to create one', detail: 'The calendar is full.', effects: {}, factions: {} }
      ]
    },
    {
      id: 'religious_dispute', cat: 'social', title: 'A Dispute Over a Holy Site',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 12,
      weight: (st) => (S.Soc.factionLoyalty(st, 'clergy') > 40 ? 11 : 5),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Two communities in ${f.region} both claim a site that has been holy to both for longer than the state has existed. There have been three nights of confrontation.</p>`;
      },
      options: [
        { label: 'Impose shared access under state control', detail: 'The state holds the keys.',
          effects: { 'society.unrest': -5, 'society.cohesion': +3, 'quality.security': +2 },
          factions: { clergy: -5, reformers: +6 } },
        { label: 'Rule for the majority community', detail: 'Decisive, and remembered by the other.',
          effects: { 'society.cohesion': +5, 'society.unrest': +8, 'society.latent': +10 },
          factions: { clergy: +10, nationalists: +8, reformers: -10 },
          risk: { p: 0.3, text: 'Sectarian violence', fn: (st) => { st.society.unrest += 12; st.society.cohesion -= 8; } } },
        { label: 'Close the site entirely', detail: 'Nobody gets it.',
          effects: { 'society.unrest': +4, 'society.cohesion': -3 }, factions: { clergy: -9 } },
        { label: 'Local mediation, no state position', detail: 'Let them settle it and be blamed for the delay.',
          effects: { 'society.unrest': +2 }, factions: { provinces: +5, nationalists: -4 } }
      ]
    },

    /* ============================================================== CIVIC */
    {
      id: 'prison_overcrowding', cat: 'civic', title: 'The Prisons Are Full',
      from: 'Ministry of Justice', urgency: 'pressing', deadline: 18,
      weight: (st) => (st.policy.interior.policing > 50 || st.society.crime > 50 ? 13 : 6),
      brief: (st) => `<p>The prison estate is at a hundred and forty per cent of capacity. There have been two riots this year and the inspectorate has used the word inhumane.</p>
        <p>Policing stands at ${st.policy.interior.policing}/100 and crime at ${S.round(st.society.crime, 0)}/100.</p>`,
      options: [
        { label: 'Build more prisons', detail: 'Capacity to match the sentencing.',
          effects: { 'budget.alloc.interior': +0.5, 'quality.security': +3, 'society.unrest': -2 },
          factions: { nationalists: +6, reformers: -5 } },
        { label: 'Sentencing reform and community orders', detail: 'Fewer people inside, for shorter.',
          effects: { 'society.crime': +2, 'budget.alloc.interior': -0.2, 'society.freedom': +4, 'quality.security': -2 },
          factions: { reformers: +11, intelligentsia: +7, nationalists: -9 } },
        { label: 'Early release of non-violent prisoners', detail: 'Immediate relief, immediate headlines.',
          effects: { 'society.crime': +4, 'society.approval': -5, 'society.unrest': -3 },
          factions: { reformers: +7, nationalists: -10 },
          risk: { p: 0.3, text: 'A released prisoner reoffends notoriously', fn: (st) => { st.society.approval -= 7; st.society.crime += 3; } } },
        { label: 'Private prison contracts', detail: 'Somebody else\'s capital, somebody else\'s problem.',
          effects: { 'budget.alloc.interior': +0.15, 'quality.security': +1, 'society.corruption': +2 },
          factions: { business: +8, labour: -6, reformers: -6 } }
      ]
    },
    {
      id: 'protest_law', cat: 'civic', title: 'The Public Order Bill',
      from: 'Ministry of the Interior', urgency: 'routine', deadline: 22,
      weight: (st) => (st.society.unrest > 35 ? 13 : 6),
      brief: (st) => `<p>A bill would require notice for any gathering, allow pre-emptive bans, and create an offence of serious disruption. Unrest stands at ${S.round(st.society.unrest, 0)}.</p>`,
      options: [
        { label: 'Pass it in full', detail: 'Order, defined broadly.',
          effects: { 'policy.interior.civilLiberties': -14, 'society.unrest': -6, 'society.latent': +12, 'national.softPower': -5 },
          factions: { nationalists: +8, military: +4, reformers: -15, intelligentsia: -12 }, headline: 'Sweeping Public Order Bill Becomes Law' },
        { label: 'Pass a narrowed version', detail: 'Notice requirements only.',
          effects: { 'policy.interior.civilLiberties': -4, 'society.unrest': -2, 'society.latent': +3 }, factions: { reformers: -4 } },
        { label: 'Drop the bill', detail: 'Police the existing law properly instead.',
          effects: { 'society.freedom': +4, 'quality.security': -1 }, factions: { reformers: +9, intelligentsia: +7, nationalists: -6 } }
      ]
    },
    {
      id: 'succession_question', cat: 'civic', title: 'The Question of Succession',
      from: 'Office of the Leader', urgency: 'routine', deadline: 30,
      weight: (st) => (aut(st) ? 13 : 3),
      brief: (st) => `<p>There is no agreed mechanism for what happens after you. Everyone in the room has noticed, including the people you would rather had not.</p>
        <p>Stability stands at ${S.round(st.society.stability, 0)} and the risk board puts coup pressure at ${S.round(st.risk.coup, 0)}.</p>`,
      options: [
        { label: 'Name a successor publicly', detail: 'Resolve it, and create a rival.',
          effects: { 'society.stability': +7, 'society.legitimacy': +4 },
          fn: (st) => { st.flags.successorNamed = true; },
          factions: { military: +5, business: +6, nationalists: -3 } },
        { label: 'Establish a formal mechanism', detail: 'A rule rather than a person.',
          effects: { 'society.stability': +9, 'quality.admin': +4, 'society.legitimacy': +6 },
          factions: { reformers: +10, intelligentsia: +8, military: -3 } },
        { label: 'Leave it deliberately unresolved', detail: 'Ambiguity keeps everyone loyal and nobody safe.',
          effects: { 'society.stability': -4 },
          fn: (st) => { st.risk.coup += 5; }, factions: { military: -6, business: -5 } }
      ]
    },
    {
      id: 'archive_release', cat: 'civic', title: 'The Files Are Due for Release',
      from: 'National Archives', urgency: 'routine', deadline: 26, weight: () => 9,
      brief: (st) => `<p>A tranche of state papers from thirty years ago falls due for release. They cover an episode the state has never formally admitted to.</p>
        <p>Press freedom stands at ${st.policy.interior.pressFreedom}/100.</p>`,
      options: [
        { label: 'Release them in full', detail: 'Everything, unredacted, on the day.',
          effects: { 'society.freedom': +5, 'national.softPower': +6, 'quality.admin': +3, 'society.approval': -3 },
          factions: { intelligentsia: +12, reformers: +10, military: -8 },
          risk: { p: 0.3, text: 'The files implicate people still serving', fn: (st) => { st.society.scandal -= 6; st.factions.forEach((f) => { if (f.id === 'military') f.loyalty -= 6; }); } } },
        { label: 'Release with redactions', detail: 'The story, minus the names.',
          effects: { 'society.freedom': +2, 'national.softPower': +2 }, factions: { intelligentsia: +4 } },
        { label: 'Extend the embargo by thirty years', detail: 'Someone else\'s problem, twice over.',
          effects: { 'policy.interior.pressFreedom': -4, 'society.latent': +5 },
          factions: { intelligentsia: -11, military: +7, reformers: -8 } }
      ]
    },
    {
      id: 'devolution_referendum', cat: 'civic', title: 'A Region Demands a Referendum',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 20,
      weight: (st) => (S.Soc.factionLoyalty(st, 'provinces') < 45 ? 14 : 4),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>${S.titleCase(f.region)} has voted in its own assembly to hold a referendum on independence. It has no legal power to do so and intends to anyway.</p>
          <p>Cohesion stands at ${S.round(st.society.cohesion, 0)}; provincial loyalty at ${S.round(S.Soc.factionLoyalty(st, 'provinces'), 0)}.</p>`;
      },
      options: [
        { label: 'Grant a binding referendum', detail: 'Let them decide, and live with it.',
          effects: { 'society.freedom': +6, 'national.softPower': +6, 'society.cohesion': -5 },
          fn: (st) => {
            const stay = S.Soc.factionLoyalty(st, 'provinces') + st.society.cohesion + (st.economy.growth * 5);
            if (stay > 110) { st.society.cohesion += 12; st.society.stability += 5; S.game.event('The region voted to remain. The question is settled for a generation.', 'good'); }
            else { st.pop.total *= 0.92; st.economy.gdp *= 0.9; st.economy.gdpReal *= 0.9; st.national.prestige -= 10; S.game.event('The region voted to leave. The state is smaller this morning.', 'bad'); }
          },
          factions: { provinces: +14, reformers: +10, nationalists: -16 } },
        { label: 'Offer maximum devolution instead', detail: 'Everything short of the flag.',
          effects: { 'policy.social.devolution': +25, 'society.cohesion': -2, 'society.unrest': -5, 'quality.admin': -2 },
          factions: { provinces: +16, nationalists: -8 } },
        { label: 'Rule it unlawful and prosecute the organisers', detail: 'The constitution, enforced.',
          effects: { 'society.unrest': +12, 'society.latent': +14, 'society.cohesion': +2, 'national.softPower': -7 },
          factions: { provinces: -22, nationalists: +12, reformers: -12 },
          risk: { p: 0.3, text: 'Mass civil disobedience', fn: (st) => { st.society.unrest += 12; st.society.stability -= 6; } } },
        { label: 'Ignore it', detail: 'A referendum with no legal effect is a large opinion poll.',
          effects: { 'society.unrest': +4, 'society.cohesion': -3 }, factions: { provinces: -8 } }
      ]
    },

    /* =========================================================== EXTERNAL */
    {
      id: 'un_vote', cat: 'diplomacy', title: 'A Vote at the International Body',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 16, weight: () => 12,
      brief: (st, ctx) => {
        const a = st.diplomacy.nations.slice().sort((x, y) => y.power - x.power)[0];
        const b = st.diplomacy.nations.slice().sort((x, y) => y.power - x.power)[1];
        ctx.a = ctx.a || a.id; ctx.b = ctx.b || b.id;
        return `<p>A resolution condemning ${b.name}'s conduct comes to a vote next week. ${a.name} has asked for our support and has been explicit that it is watching.</p>
          <p>Relations: ${a.name} ${S.round(a.relation, 0)}, ${b.name} ${S.round(b.relation, 0)}.</p>`;
      },
      options: [
        { label: 'Vote with the sponsor', detail: 'Pick the side that asked first.',
          effects: { 'national.prestige': +2 },
          fn: (st, ctx) => { const a = S.dip(st, ctx.a), b = S.dip(st, ctx.b); if (a) a.relation += 12; if (b) b.relation -= 12; }, factions: {} },
        { label: 'Vote against', detail: 'Side with the accused and be remembered for it.',
          effects: { 'national.softPower': -4 },
          fn: (st, ctx) => { const a = S.dip(st, ctx.a), b = S.dip(st, ctx.b); if (a) a.relation -= 14; if (b) b.relation += 16; }, factions: { nationalists: +5 } },
        { label: 'Abstain', detail: 'The coward\'s option, and frequently the right one.',
          effects: { 'national.prestige': -1 },
          fn: (st, ctx) => { const a = S.dip(st, ctx.a), b = S.dip(st, ctx.b); if (a) a.relation -= 4; if (b) b.relation += 4; }, factions: {} },
        { label: 'Sell the vote', detail: 'Find out what it is worth to both of them.',
          effects: { 'national.prestige': -4 },
          fn: (st, ctx) => {
            st.economy.reserves += st.economy.gdp * 0.004;
            const a = S.dip(st, ctx.a); if (a) a.relation += 6;
            if (st.rng.chance(0.3)) { st.national.softPower -= 6; S.News.custom(st, 'Our Vote Was Bought, Says Leaked Cable', 'bad'); }
          },
          factions: { business: +5, intelligentsia: -6 } }
      ]
    },
    {
      id: 'migrant_labour', cat: 'diplomacy', title: 'Our Workers Abroad',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 22,
      weight: (st) => (S.Econ.gdpPerCapita(st) < 15000 ? 13 : 5),
      brief: (st, ctx) => {
        const n = st.rng.weighted(st.diplomacy.nations, (x) => x.gdp);
        ctx.nation = ctx.nation || (n ? n.id : st.diplomacy.nations[0].id);
        const nn = S.dip(st, ctx.nation);
        return `<p>A great many of our citizens work in ${nn.name}. Their remittances are a meaningful share of household income here, and their treatment there has become a scandal at home.</p>`;
      },
      options: [
        { label: 'Negotiate a labour agreement', detail: 'Minimum standards, enforceable, in writing.',
          effects: { 'national.prestige': +4, 'economy.shock': +0.2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation += 8; }, factions: { labour: +9 } },
        { label: 'Ban recruitment until conditions improve', detail: 'Cut off the supply and the remittances with it.',
          effects: { 'economy.shock': -0.6, 'society.approval': +4 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 14; }, factions: { labour: +12, nationalists: +8, business: -6 } },
        { label: 'Say nothing', detail: 'The money matters more than the dignity.',
          effects: { 'society.approval': -4, 'national.softPower': -3 }, factions: { labour: -10, business: +5 } }
      ]
    },
    {
      id: 'fishing_dispute', cat: 'diplomacy', title: 'Their Fleet Is in Our Waters',
      from: 'Ministry of Trade', urgency: 'pressing', deadline: 14, weight: () => 10,
      brief: (st, ctx) => {
        const n = st.rng.pick(st.diplomacy.nations);
        ctx.nation = ctx.nation || n.id;
        return `<p>A distant-water fleet flying ${S.dip(st, ctx.nation).name}'s flag has been working inside our economic zone for a month. Our coastguard has three serviceable vessels.</p>`;
      },
      options: [
        { label: 'Seize and impound', detail: 'Board them and make an example.',
          effects: { 'society.approval': +5, 'world.tension': +5, 'national.aggressionScore': +5 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 14; n.grievance = (n.grievance || 0) + 10; } },
          factions: { nationalists: +10, military: +4 } },
        { label: 'Sell them a licence', detail: 'If they are fishing anyway, charge for it.',
          effects: { 'economy.reserves': 0, 'society.approval': -3 },
          fn: (st, ctx) => { st.economy.reserves += st.economy.gdp * 0.002; const n = S.dip(st, ctx.nation); if (n) n.relation += 8; },
          factions: { business: +6, nationalists: -8 } },
        { label: 'Fund a proper coastguard', detail: 'Solve it permanently and slowly.',
          effects: { 'budget.alloc.defense': +0.2, 'quality.security': +2 }, factions: { military: +6, provinces: +5 } }
      ]
    },
    {
      id: 'diaspora_congress', cat: 'diplomacy', title: 'The Diaspora Wants a Say',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 26, weight: () => 8,
      brief: () => `<p>A congress of our nationals abroad has asked for voting rights, consular representation and a formal channel to government. They are wealthy, organised and often more nationalist than anyone at home.</p>`,
      options: [
        { label: 'Grant them representation and the vote', detail: 'Citizens are citizens.',
          effects: { 'national.softPower': +5, 'society.cohesion': +3, 'economy.shock': +0.3 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { n.affinity += 3; }); },
          factions: { nationalists: +9, reformers: +3, labour: -4 } },
        { label: 'Consular services only', detail: 'Help, without a vote.',
          effects: { 'national.softPower': +2 }, factions: { nationalists: +3 } },
        { label: 'Refuse', detail: 'They left.',
          effects: { 'national.softPower': -3 }, factions: { nationalists: -8, labour: +5 } }
      ]
    },
    {
      id: 'intelligence_partner', cat: 'intel', title: 'An Offer of Liaison',
      from: 'Director of Intelligence', urgency: 'routine', deadline: 22, weight: () => 10,
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => b.power - a.power)[st.rng.int(0, 2)];
        ctx.nation = ctx.nation || n.id;
        return `<p>${S.dip(st, ctx.nation).name}'s service has proposed a full liaison relationship: shared product, shared targets, and their equipment on our soil.</p>
          <p>Our collection is rated ${S.round(st.intel.strength, 0)}/100. Theirs is better.</p>`;
      },
      options: [
        { label: 'Accept the full relationship', detail: 'Their product, their access, their priorities.',
          effects: { 'intel.strength': +12, 'national.concessions': +1 },
          fn: (st, ctx) => { S.Dip.signTreaty(st, ctx.nation, 'intel'); const n = S.dip(st, ctx.nation); if (n) n.relation += 15; },
          factions: { military: +6, nationalists: -9, reformers: -4 } },
        { label: 'Limited, reciprocal exchange', detail: 'Named targets only, both ways.',
          effects: { 'intel.strength': +5 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation += 7; }, factions: {} },
        { label: 'Decline', detail: 'Our secrets stay ours, such as they are.',
          effects: { 'intel.strength': -1 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 6; }, factions: { nationalists: +7 } }
      ]
    },
    {
      id: 'sanctions_evasion', cat: 'intel', title: 'A Sanctions-Busting Network',
      from: 'Customs Intelligence', urgency: 'routine', deadline: 20, weight: () => 9,
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Customs have mapped a network moving restricted goods through ${f.region} on our documentation. It is worth a great deal to the people running it, some of whom are known to this government.</p>`;
      },
      options: [
        { label: 'Roll it up publicly', detail: 'Arrests, seizures, and a message to the world.',
          effects: { 'society.corruption': -4, 'national.prestige': +4, 'economy.shock': -0.2 },
          fn: (st) => { st.diplomacy.nations.forEach((n) => { if (n.ideology === 'liberal') n.relation += 5; }); },
          factions: { reformers: +9, business: -6 } },
        { label: 'Quietly shut it down', detail: 'No arrests, no publicity, no more network.',
          effects: { 'society.corruption': -2 }, factions: { business: -2 } },
        { label: 'Take a cut', detail: 'It is going to happen anyway.',
          effects: { 'economy.reserves': 0, 'society.corruption': +6 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.004; },
          factions: { reformers: -12, business: +5 },
          risk: { p: 0.35, text: 'Exposed by a foreign service', fn: (st) => { st.national.prestige -= 8; st.diplomacy.nations.forEach((n) => { n.relation -= 6; }); } } }
      ]
    },

    /* =========================================================== MILITARY */
    {
      id: 'officer_purge', cat: 'military', title: 'A List of Names',
      from: 'Counter-Intelligence', urgency: 'pressing', deadline: 12,
      weight: (st) => (S.Soc.militaryLoyalty(st) < 50 ? 14 : 4),
      brief: (st) => `<p>Counter-intelligence has produced a list of officers it considers unreliable. Some of the evidence is compelling. Some of it is that they were overheard complaining.</p>
        <p>General staff loyalty stands at ${S.round(S.Soc.militaryLoyalty(st), 0)}/100; coup risk at ${S.round(st.risk.coup, 0)}.</p>`,
      options: [
        { label: 'Retire them quietly with full pensions', detail: 'Remove them without humiliating them.',
          effects: { 'military.readiness': -4, 'society.stability': +3 },
          fn: (st) => { st.risk.coup = Math.max(0, st.risk.coup - 12); st.factions.forEach((f) => { if (f.id === 'military') f.loyalty += 3; }); },
          factions: {} },
        { label: 'Arrest them', detail: 'Charges, courts martial, an example.',
          effects: { 'military.readiness': -10, 'military.morale': -10, 'society.latent': +8 },
          fn: (st) => { st.risk.coup = Math.max(0, st.risk.coup - 20); },
          factions: { military: -14 },
          risk: { p: 0.25, text: 'The arrests trigger what they were meant to prevent', fn: (st) => { st.risk.coup += 30; st.factions.forEach((f) => { if (f.id === 'military') f.loyalty -= 12; }); } } },
        { label: 'Promote them somewhere harmless', detail: 'An honour, a title, and no troops.',
          effects: { 'quality.admin': -2 },
          fn: (st) => { st.risk.coup = Math.max(0, st.risk.coup - 6); st.factions.forEach((f) => { if (f.id === 'military') f.loyalty += 5; }); },
          factions: {} },
        { label: 'Ignore the list', detail: 'Counter-intelligence always has a list.',
          effects: { 'military.morale': +4 }, factions: { military: +6 } }
      ]
    },
    {
      id: 'drone_incursion', cat: 'military', title: 'Unidentified Aircraft',
      from: 'Air Defence Command', urgency: 'urgent', deadline: 4, weight: (st) => (st.world.tension > 30 ? 12 : 6),
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => a.relation - b.relation)[0];
        ctx.nation = ctx.nation || n.id;
        return `<p>Unmanned aircraft have crossed our airspace four times this month. They are almost certainly ${S.dip(st, ctx.nation).adj} and they are almost certainly mapping our air defences.</p>`;
      },
      options: [
        { label: 'Shoot the next one down', detail: 'Establish the rule with a missile.',
          effects: { 'world.tension': +8, 'society.approval': +5, 'military.readiness': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 12; n.threatPerception += 8; } },
          factions: { military: +8, nationalists: +10 },
          risk: { p: 0.2, text: 'It was a civilian aircraft', fn: (st) => { st.national.prestige -= 10; st.society.approval -= 8; S.News.custom(st, 'Downed Aircraft Was Civilian, Investigation Finds', 'bad'); } } },
        { label: 'Jam them and say nothing', detail: 'Deny the data, avoid the incident.',
          effects: { 'intel.strength': +2, 'military.tech': +1 }, factions: { military: +4 } },
        { label: 'Protest publicly', detail: 'Photographs, a summons, and a statement.',
          effects: { 'world.tension': +3, 'society.approval': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 6; }, factions: { nationalists: +4 } },
        { label: 'Invest in air defence', detail: 'Solve the capability rather than the incident.',
          effects: { 'budget.alloc.defense': +0.3, 'military.equipment': +3 }, factions: { military: +7 } }
      ]
    },
    {
      id: 'private_military', cat: 'military', title: 'A Private Military Company',
      from: 'Ministry of Defence', urgency: 'routine', deadline: 24, weight: (st) => (st.wars.length ? 13 : 7),
      brief: () => `<p>A proposal to license a private military company: deniable, deployable, and answerable to a contract rather than a chain of command.</p>
        <p>Every state that has done this has found it useful right up until it wasn't.</p>`,
      options: [
        { label: 'License and use it', detail: 'Deniability, for a price.',
          effects: { 'military.power': 0, 'world.tension': +4, 'national.softPower': -5 },
          fn: (st) => { st.flags.pmc = true; st.military.manpower *= 1.06; },
          factions: { military: -4, business: +8, nationalists: +5 },
          risk: { p: 0.3, text: 'The company acts on its own account', fn: (st) => { st.risk.coup += 8; st.national.prestige -= 6; } } },
        { label: 'License it for logistics only', detail: 'Contractors who do not carry rifles.',
          effects: { 'military.logistics': +5, 'budget.alloc.defense': -0.1 }, factions: { business: +5 } },
        { label: 'Ban them outright', detail: 'The state keeps its monopoly.',
          effects: { 'quality.admin': +2, 'national.softPower': +3 }, factions: { military: +7, business: -5 } }
      ]
    },
    {
      id: 'conscript_scandal', cat: 'military', title: 'A Conscript Has Died in Training',
      from: 'Ministry of Defence', urgency: 'pressing', deadline: 10,
      weight: (st) => (st.policy.mil.conscription > 25 ? 13 : 0),
      brief: (st) => `<p>An eighteen-year-old conscript died during training. The unit's account and the pathologist's report are not compatible, and his mother has been on television twice.</p>
        <p>Conscription stands at ${st.policy.mil.conscription}/100.</p>`,
      options: [
        { label: 'Court-martial the chain of command', detail: 'All the way up.',
          effects: { 'society.approval': +5, 'military.morale': -6, 'quality.admin': +2 },
          factions: { military: -10, labour: +8, reformers: +8 } },
        { label: 'Reform training standards', detail: 'Independent oversight of every unit.',
          effects: { 'policy.mil.veteranCare': +10, 'military.readiness': -3, 'society.approval': +3 },
          factions: { military: -3, labour: +6 } },
        { label: 'Suspend conscription pending review', detail: 'Stop the intake while it is investigated.',
          effects: { 'policy.mil.conscription': -20, 'military.manpower': 0, 'society.approval': +6 },
          factions: { military: -8, labour: +10, nationalists: -8 } },
        { label: 'Close ranks', detail: 'The army investigates itself and finds nothing.',
          effects: { 'society.approval': -6, 'society.latent': +8, 'military.morale': +3 },
          factions: { military: +9, labour: -12 },
          risk: { p: 0.4, text: 'The pathologist goes public', fn: (st) => { st.society.approval -= 9; st.society.scandal -= 6; } } }
      ]
    },

    /* ============================================================ ENERGY */
    {
      id: 'blackout', cat: 'crisis', title: 'The Lights Have Gone Out',
      from: 'Grid Operator', urgency: 'urgent', deadline: 5,
      weight: (st) => (st.quality.energy < 60 && !st.flags.gridHardened ? 14 : 4),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A cascading failure has taken out power to ${f.region} and half of ${f.city} for eleven hours and counting. Hospitals are on generators; two have run out of fuel.</p>
          <p>Energy system quality stands at ${S.round(st.quality.energy, 0)}/100.</p>`;
      },
      options: [
        { label: 'Emergency generation contracts at any price', detail: 'Restore power tonight, argue about cost later.',
          effects: { 'quality.energy': +2, 'society.approval': +3 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.004; }, factions: { provinces: +8, business: +4 } },
        { label: 'Rolling blackouts until it is fixed', detail: 'Share the darkness fairly.',
          effects: { 'society.approval': -6, 'society.unrest': +6, 'economy.shock': -0.6 },
          factions: { provinces: -8, business: -7 } },
        { label: 'Nationalise the grid operator', detail: 'Somebody has to be accountable and it will be them.',
          effects: { 'policy.econ.stateOwnership': +6, 'society.approval': +6, 'economy.businessConfidence': -7 },
          factions: { labour: +10, business: -12, nationalists: +5 }, headline: 'Grid Operator Taken Into Public Ownership' },
        { label: 'Blame the operator and fine it', detail: 'A penalty, a press conference, no structural change.',
          effects: { 'society.approval': +1, 'quality.energy': -1 }, factions: { business: -4 } }
      ]
    },
    {
      id: 'mining_licence', cat: 'economy', title: 'A Very Large Mine',
      from: 'Ministry of Industry', urgency: 'routine', deadline: 26, weight: (st) => (st.economy.sectors.resources > 3 ? 12 : 5),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A consortium wants to open the largest mine in the country's history in ${f.region}. It would be worth a great deal, employ ten thousand people, and destroy a river system.</p>`;
      },
      options: [
        { label: 'Approve it', detail: 'The money is real and immediate.',
          effects: { 'economy.shock': +0.8, 'economy.reserves': 0, 'world.climate': +1, 'society.unrest': +4, 'national.softPower': -3 },
          fn: (st) => { st.economy.sectors.resources += 2; st.economy.reserves += st.economy.gdp * 0.006; },
          factions: { business: +11, labour: +7, intelligentsia: -9, provinces: +5 } },
        { label: 'Approve with strict conditions', detail: 'Bond, monitoring and a restoration duty.',
          effects: { 'economy.shock': +0.4, 'policy.econ.regulation': +4 },
          fn: (st) => { st.economy.sectors.resources += 1; }, factions: { business: +4, intelligentsia: -2 } },
        { label: 'Refuse', detail: 'Some things are worth more intact.',
          effects: { 'national.softPower': +4, 'economy.businessConfidence': -6 },
          factions: { intelligentsia: +10, business: -10, labour: -6, provinces: -6 } }
      ]
    },
    {
      id: 'climate_migration', cat: 'social', title: 'The Coast Is Going',
      from: 'Ministry of Infrastructure', urgency: 'routine', deadline: 26,
      weight: (st) => (st.world.climate > 45 ? 14 : 4),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Sea defences in ${f.region} are no longer adequate and cannot be made adequate at any reasonable cost. Climate stress stands at ${S.round(st.world.climate, 0)}/100.</p>
          <p>The ministry has used the phrase managed retreat, which means telling a hundred thousand people their towns have no future.</p>`;
      },
      options: [
        { label: 'Build the defences anyway', detail: 'Hold the line as long as money can.',
          effects: { 'budget.alloc.infra': +0.6, 'quality.infra': +2, 'society.approval': +4 },
          factions: { provinces: +12, reformers: -4 } },
        { label: 'Managed retreat with full compensation', detail: 'Move them, pay them, and be honest.',
          effects: { 'society.approval': -5, 'society.unrest': +5, 'budget.alloc.welfare': +0.3, 'quality.admin': +3 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.008; },
          factions: { provinces: -10, intelligentsia: +9, reformers: +8 } },
        { label: 'Say nothing and let it happen', detail: 'The sea will decide the timetable.',
          effects: { 'society.approval': +2 },
          fn: (st) => { S.Aftermath.schedule(st, 'natural_disaster', {}, st.rng.int(700, 1600)); },
          factions: { provinces: -6, intelligentsia: -8 } }
      ]
    }
  ];

  LIB.forEach((d) => { D.LIB.push(d); D.BY_ID[d.id] = d; });
  void dem;
})(window.S);

/* STRATEGIAN — second decision volume.
   The rotating pool has to be large enough that a decades-long game does not
   deal the whole deck in its first year. These are all non-dynamic: they are
   drawn by the roster, not fired by an event.                             */
(function (S) {
  'use strict';

  const D = S.Decisions;
  const V = D.variant, F = D.flavour;
  const authoritarian = (st) => ['junta', 'personalist', 'party', 'theocratic'].indexOf(st.nation.governmentId) >= 0;
  const democratic = (st) => ['liberal', 'managed'].indexOf(st.nation.governmentId) >= 0;

  const LIB2 = [

    /* ------------------------------------------------------------ FISCAL */
    {
      id: 'pension_crisis', cat: 'budget', title: 'The Pension Arithmetic',
      from: 'Government Actuary', urgency: 'routine', deadline: 26,
      weight: (st) => (st.pop.workingAge < 64 ? 16 : 7),
      brief: (st, ctx) => V(st, ctx, 'frame', [
        `<p>The Government Actuary's fifty-year projection finds the scheme unsustainable. On current rules, pension spending rises by a further ${S.round(st.rng.range(2, 5), 1)}% of output within two decades.</p>`,
        `<p>The pension fund's trustees have notified us in writing that they can no longer certify the scheme as sustainable. The letter has also been released to the press.</p>`
      ]) + `<p>The working-age share of the population is ${S.round(st.pop.workingAge, 0)}% and falling. Welfare spending stands at ${S.round(st.budget.alloc.welfare, 2)}% of output.</p>`,
      advisors: () => [
        { who: 'Government Actuary', role: 'Treasury', said: 'Each year of delay increases the size of the adjustment eventually required. Early action is the lower-cost option.' },
        { who: 'Chief Whip', role: 'Legislature', said: 'Pensioners vote at the highest rate of any group. Any reduction carries a serious electoral cost.' }
      ],
      options: [
        { label: 'Raise the retirement age', detail: 'By three years, phased over a decade.',
          effects: { 'society.approval': -8, 'budget.alloc.welfare': -1.2, 'society.unrest': +6, 'economy.shock': +0.4 },
          factions: { labour: -12, business: +9 }, headline: 'Retirement Age to Rise by Three Years' },
        { label: 'Means-test the state pension', detail: 'Restrict payment to lower-income pensioners.',
          effects: { 'society.approval': -5, 'budget.alloc.welfare': -0.7, 'society.inequality': -2 },
          factions: { labour: -6, business: +5, reformers: +4 } },
        { label: 'Raise contributions instead', detail: 'Increase payroll contributions from current workers.',
          effects: { 'policy.tax.income': +3, 'society.approval': -4, 'economy.shock': -0.3 },
          factions: { labour: -4, business: -6 } },
        { label: 'Defer reform', detail: 'No change now; the required adjustment grows and passes to a future government.',
          effects: { 'society.approval': +2 },
          fn: (st) => { st.flags.pensionDeferred = (st.flags.pensionDeferred || 0) + 1; },
          then: { id: 'pension_reckoning', days: 2100 },
          factions: { reformers: -7, labour: +4 } }
      ]
    },
    {
      id: 'rating_watch', cat: 'budget', title: 'Placed on Negative Watch',
      from: 'Debt Management Office', urgency: 'pressing', deadline: 14,
      weight: (st) => (st.economy.creditScore < 60 ? 20 : 4),
      brief: (st) => `<p>A rating agency has placed us on negative watch, citing the deficit at ${S.round((st.economy.deficit / st.economy.gdp) * 100, 1)}% of output and debt at ${S.round(st.economy.debtGdp, 0)}%. We are currently rated ${st.economy.creditRating}.</p>
        <p>A downgrade would add roughly ${S.money(st.economy.debt * 0.006)} a year to debt-service costs and would oblige some institutional funds to sell our debt.</p>`,
      advisors: () => [
        { who: 'Debt Manager', role: 'Treasury', said: 'The agency has published the criteria it wants met. They are specific and attainable.' },
        { who: 'Political Adviser', role: 'Office', said: 'Disputing the agency\'s legitimacy will not change its assessment or our borrowing costs.' }
      ],
      options: [
        { label: 'Announce a credible consolidation path', detail: 'A published, dated plan to close the deficit.',
          effects: { 'economy.reserveStatus': +5, 'economy.businessConfidence': +8, 'society.approval': -4 },
          fn: (st) => { for (const m in st.budget.alloc) st.budget.alloc[m] *= 0.955; },
          factions: { business: +10, labour: -7 } },
        { label: 'Court the agencies privately', detail: 'Provide briefings and fiscal projections to the agency.',
          effects: { 'economy.reserveStatus': +2 },
          risk: { p: 0.45, text: 'Downgraded anyway', fn: (st) => { st.economy.creditScore -= 6; st.economy.avgDebtRate += 0.5; } } },
        { label: 'Attack them publicly', detail: 'Publicly dispute the agency\'s assessment and authority.',
          effects: { 'society.approval': +4, 'economy.businessConfidence': -9, 'economy.reserveStatus': -5 },
          factions: { nationalists: +9, business: -10 }, headline: 'Government Denounces Rating Agencies as Unaccountable' },
        { label: 'Do nothing and take the downgrade', detail: 'Accept higher borrowing costs; leave spending unchanged.',
          effects: { 'economy.creditScore': -6 },
          fn: (st) => { st.economy.avgDebtRate += 0.6; }, factions: { labour: +5, business: -6 } }
      ]
    },
    {
      id: 'minimum_wage', cat: 'economy', title: 'The Wage Floor',
      from: 'Ministry of Labour', urgency: 'routine', deadline: 24,
      weight: (st) => (st.society.inequality > 45 ? 14 : 8),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return V(st, ctx, 'frame', [
          `<p>The low pay commission has recommended a substantial rise in the statutory minimum. Inequality stands at ${S.round(st.society.inequality, 0)}/100.</p>`,
          `<p>${f.union} has made a higher statutory minimum its principal demand. A survey this week put public support at 68 per cent.</p>`
        ]) + `<p>Employers in ${f.industry} state that a rise would reduce employment.</p>`;
      },
      options: [
        { label: 'A large rise', detail: 'Well above inflation, in one step.',
          effects: { 'society.inequality': -5, 'society.approval': +7, 'economy.unemployment': +0.8, 'economy.businessConfidence': -8, 'economy.inflation': +0.5 },
          factions: { labour: +14, business: -12 }, headline: 'Minimum Wage Raised Sharply' },
        { label: 'A modest rise, indexed thereafter', detail: 'A small increase now, with automatic indexation thereafter.',
          effects: { 'society.inequality': -2, 'society.approval': +3, 'economy.inflation': +0.2 },
          factions: { labour: +6, business: -3 } },
        { label: 'Freeze it', detail: 'No increase; avoids employment effects at the low-wage margin.',
          effects: { 'society.inequality': +2, 'society.approval': -4, 'economy.businessConfidence': +5 },
          factions: { business: +8, labour: -10 } }
      ]
    },
    {
      id: 'state_champion', cat: 'economy', title: 'The National Carrier Is Losing Money',
      from: 'Ministry of Industry', urgency: 'routine', deadline: 22,
      weight: (st) => (st.policy.econ.stateOwnership > 25 ? 13 : 5),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>The state ${V(st, ctx, 'kind', ['airline', 'railway', 'steel combine', 'shipping line'])} has lost money for nine consecutive years and needs another ${S.money(st.economy.gdp * 0.004)} to make payroll.</p>
          <p>It is a major employer in ${f.region} and has never recorded a profit.</p>`;
      },
      advisors: () => [
        { who: 'Industry Minister', role: 'Cabinet', said: 'The enterprise is not commercially viable. It functions as an employment programme.' },
        { who: 'Regional Governors', role: 'Provinces', said: 'Closure would remove the region\'s principal employer. No replacement industry exists.' }
      ],
      options: [
        { label: 'Recapitalise it again', detail: 'Provide the requested funding; further losses are likely.',
          effects: { 'economy.debt': 0, 'society.approval': -2 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.004; },
          factions: { labour: +7, provinces: +8, business: -6, reformers: -6 } },
        { label: 'Privatise it', detail: 'Sell the enterprise to private owners.',
          effects: { 'policy.econ.stateOwnership': -8, 'economy.businessConfidence': +8, 'society.approval': -5, 'economy.reserves': 0 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.006; },
          factions: { business: +12, labour: -13, provinces: -9 }, headline: 'State Carrier to Be Sold' },
        { label: 'Restructure and shrink it', detail: 'Halve routes and staff; retain state ownership.',
          effects: { 'society.approval': -3, 'economy.shock': -0.2, 'quality.infra': -1 },
          factions: { labour: -7, business: +4, provinces: -5 } },
        { label: 'Wind it up entirely', detail: 'Close the enterprise; accept the resulting unemployment.',
          effects: { 'policy.econ.stateOwnership': -6, 'economy.unemployment': +0.6, 'society.approval': -8, 'society.unrest': +6 },
          factions: { labour: -16, provinces: -14, business: +10 } }
      ]
    },
    {
      id: 'land_reform', cat: 'economy', title: 'The Land Question',
      from: 'Ministry of Agriculture', urgency: 'routine', deadline: 28,
      weight: (st) => (st.economy.sectors.agri > 8 && st.society.inequality > 45 ? 15 : 3),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Five per cent of the population owns most of the arable land in ${f.region}. The tenants who farm it hold no legal title.</p>
          <p>Inequality stands at ${S.round(st.society.inequality, 0)}/100 and the agricultural sector is ${S.round(st.economy.sectors.agri, 1)}% of output.</p>`;
      },
      options: [
        { label: 'Expropriate and redistribute', detail: 'Break up the estates; compensate owners at assessed value.',
          effects: { 'society.inequality': -8, 'society.approval': +6, 'economy.businessConfidence': -14, 'economy.shock': -0.8, 'society.unrest': +5 },
          factions: { labour: +14, provinces: +8, business: -16, clergy: -6 },
          risk: { p: 0.35, text: 'Output collapses on the redistributed land', fn: (st) => { st.economy.shock -= 1.2; st.world.grain *= 1.06; } },
          then: { id: 'harvest_result', days: 500 },
          headline: 'Land Expropriation Begins in the Provinces' },
        { label: 'Title the tenants where they farm', detail: 'Grant tenants legal title to the land they farm; no seizure.',
          effects: { 'society.inequality': -4, 'economy.shock': +0.5, 'economy.informal': -3, 'society.approval': +4 },
          then: { id: 'harvest_result', days: 500 },
          factions: { labour: +8, provinces: +7, business: -3, reformers: +8 } },
        { label: 'Market-led reform with state credit', detail: 'Provide state loans for tenants to purchase land.',
          effects: { 'society.inequality': -2, 'economy.debt': 0, 'economy.shock': +0.3 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.006; },
          factions: { business: +5, labour: +4 } },
        { label: 'Leave the settlement alone', detail: 'No change to current land ownership.',
          effects: { 'society.unrest': +4 }, factions: { business: +7, clergy: +4, labour: -8 } }
      ]
    },

    /* ------------------------------------------------------------ SOCIAL */
    {
      id: 'university_unrest', cat: 'social', title: 'Campus Occupations',
      from: 'Ministry of the Interior', urgency: 'pressing', deadline: 12,
      weight: (st) => (st.quality.education > 45 && st.pop.youthShare > 13 ? 14 : 5),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return V(st, ctx, 'frame', [
          `<p>Students have occupied ${f.university} and four other campuses. The stated grievance is fees; graduate employment prospects are also cited.</p>`,
          `<p>A demonstration at ${f.university} was dispersed with excessive force. Footage of the incident has prompted protests at campuses nationwide.</p>`
        ]) + `<p>Youth are ${S.round(st.pop.youthShare, 0)}% of the population and unemployment is ${S.round(st.economy.unemployment, 1)}%.</p>`;
      },
      options: [
        { label: 'Meet the student leaders', detail: 'Negotiate publicly and offer substantive concessions.',
          effects: { 'society.unrest': -8, 'budget.alloc.education': +0.3, 'society.approval': +2 },
          factions: { intelligentsia: +10, reformers: +9, nationalists: -5 } },
        { label: 'Clear the campuses', detail: 'End the occupations by police action, with arrests.',
          effects: { 'society.unrest': +8, 'society.latent': +12, 'policy.interior.policing': +8, 'national.softPower': -5 },
          factions: { intelligentsia: -16, reformers: -14, nationalists: +7 },
          risk: { p: 0.3, text: 'A student is killed', fn: (st) => { st.society.unrest += 14; st.society.approval -= 8; S.News.custom(st, 'Student Dies as Police Clear Campus', 'bad'); } },
          headline: 'Police Clear University Occupations' },
        { label: 'Wait them out', detail: 'Take no action; the academic term ends in six weeks.',
          effects: { 'society.unrest': +2, 'society.approval': -2 }, factions: { intelligentsia: -3 } },
        { label: 'Expand student funding', detail: 'Address the fee grievance directly with increased funding.',
          effects: { 'budget.alloc.education': +0.6, 'society.unrest': -10, 'society.approval': +4, 'quality.education': +2 },
          factions: { intelligentsia: +12, reformers: +8, business: -4 } }
      ]
    },
    {
      id: 'language_policy', cat: 'social', title: 'The Language of the State',
      from: 'Ministry of Culture', urgency: 'routine', deadline: 26,
      weight: (st) => (st.society.cohesion < 60 ? 12 : 6),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A bill would make the majority language the sole language of administration, courts and schooling. In ${f.region} it is not what most people speak at home.</p>
          <p>National cohesion stands at ${S.round(st.society.cohesion, 0)}/100.</p>`;
      },
      options: [
        { label: 'One official language', detail: 'Make the majority language the sole official language.',
          effects: { 'society.cohesion': +8, 'society.unrest': +8, 'national.softPower': -4 },
          factions: { nationalists: +14, provinces: -16, intelligentsia: -8 },
          risk: { p: 0.25, text: 'Regional boycott', fn: (st) => { st.society.unrest += 8; st.society.cohesion -= 5; } },
          headline: 'Single Official Language Written Into Law' },
        { label: 'Official bilingualism', detail: 'Two official languages in all state functions, at additional administrative cost.',
          effects: { 'society.cohesion': +3, 'budget.alloc.admin': +0.2, 'quality.admin': -1 },
          factions: { provinces: +12, nationalists: -9, intelligentsia: +5 } },
        { label: 'Regional language rights', detail: 'Official status for regional languages within their regions.',
          effects: { 'policy.social.devolution': +10, 'society.cohesion': -2, 'society.unrest': -4 },
          factions: { provinces: +14, nationalists: -7 } },
        { label: 'Shelve the bill', detail: 'Withdraw the bill; no change to current practice.', effects: {}, factions: { nationalists: -4, provinces: -3 } }
      ]
    },
    {
      id: 'drug_policy', cat: 'social', title: 'The Drug Question',
      from: 'Ministry of Justice', urgency: 'routine', deadline: 25,
      weight: (st) => (st.society.crime > 45 ? 13 : 7),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Prisons hold large numbers of people convicted of possession, the trade in ${f.city} remains under organised criminal control, and crime stands at ${S.round(st.society.crime, 0)}/100.</p>
          <p>Public opinion is sharply divided among the available approaches.</p>`;
      },
      options: [
        { label: 'Decriminalise possession, treat addiction', detail: 'Treat addiction as a public-health matter; end possession prosecutions.',
          effects: { 'society.crime': -6, 'quality.health': +2, 'budget.alloc.health': +0.2, 'society.cohesion': -3 },
          factions: { reformers: +12, intelligentsia: +8, clergy: -12, nationalists: -6 },
          headline: 'Possession Decriminalised in Sweeping Reform' },
        { label: 'Legalise and tax supply', detail: 'Move supply into a regulated, taxed market.',
          effects: { 'society.crime': -9, 'economy.reserves': 0, 'society.cohesion': -5, 'policy.tax.vat': +1 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.003; },
          factions: { reformers: +10, business: +6, clergy: -16 } },
        { label: 'A hard enforcement campaign', detail: 'Increase policing and lengthen sentences.',
          effects: { 'policy.interior.policing': +12, 'society.crime': -3, 'budget.alloc.interior': +0.3, 'society.latent': +5 },
          factions: { clergy: +9, nationalists: +8, reformers: -10 } },
        { label: 'Leave the law as it is', detail: 'Maintain current law and enforcement practice.',
          effects: {}, factions: { reformers: -4 } }
      ]
    },
    {
      id: 'sports_bid', cat: 'social', title: 'A Bid to Host the Games',
      from: 'Ministry of Culture', urgency: 'routine', deadline: 30,
      weight: (st) => (st.national.prestige > 35 ? 9 : 3),
      brief: (st) => `<p>The federation has invited a bid to host the world championship. Estimated cost is roughly ${S.money(st.economy.gdp * 0.012)} over six years, with a large international audience.</p>
        <p>Previous hosts have exceeded their budgets; some retained useful infrastructure.</p>`,
      advisors: () => [
        { who: 'Culture Minister', role: 'Cabinet', said: 'Hosting would deliver substantial international visibility relative to its cost.' },
        { who: 'Treasury', role: 'Finance', said: 'The cost estimate is understated. Every previous host has overrun its budget.' }
      ],
      options: [
        { label: 'Bid, and build properly', detail: 'New stadiums and transport infrastructure.',
          effects: { 'national.prestige': +8, 'national.softPower': +7, 'quality.infra': +3, 'society.approval': +4 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.012; },
          factions: { business: +8, nationalists: +8, labour: +4, reformers: -5 },
          risk: { p: 0.35, text: 'Cost overruns and a corruption inquiry', fn: (st) => { st.economy.debt += st.economy.gdp * 0.008; st.society.corruption += 3; st.society.scandal -= 4; } },
          headline: 'Nation Wins Right to Host the World Championship' },
        { label: 'Bid on a modest budget', detail: 'Existing venues, temporary seating, no monuments.',
          effects: { 'national.prestige': +4, 'national.softPower': +3, 'society.approval': +2 },
          fn: (st) => { st.economy.debt += st.economy.gdp * 0.004; }, factions: { reformers: +4 } },
        { label: 'Decline', detail: 'Do not bid; retain the funds for other priorities.',
          effects: { 'national.prestige': -2, 'society.approval': -2 }, factions: { nationalists: -7, reformers: +5 } }
      ]
    },
    {
      id: 'child_poverty', cat: 'social', title: 'The Child Poverty Figures',
      from: 'Office for Statistics', urgency: 'routine', deadline: 24,
      weight: (st) => (st.society.inequality > 42 ? 14 : 6),
      brief: (st) => `<p>The statistics office has published its annual figures. One fifth of children live in households experiencing food insecurity, and the figure has risen for three consecutive years.</p>
        <p>Inequality stands at ${S.round(st.society.inequality, 0)}/100; welfare provision at ${S.round(st.quality.welfareQ, 0)}/100.</p>`,
      options: [
        { label: 'A universal child payment', detail: 'A payment to every family with children, without means-testing.',
          effects: { 'budget.alloc.welfare': +0.8, 'society.inequality': -5, 'society.approval': +7, 'quality.welfareQ': +5 },
          factions: { labour: +12, clergy: +5, business: -5 }, headline: 'Universal Child Payment Introduced' },
        { label: 'Targeted support and free school meals', detail: 'Lower cost, aimed at low-income households; take-up is typically incomplete.',
          effects: { 'budget.alloc.welfare': +0.35, 'budget.alloc.education': +0.15, 'society.inequality': -3, 'quality.health': +2, 'society.approval': +4 },
          factions: { labour: +7, reformers: +5 } },
        { label: 'Dispute the methodology', detail: 'Publicly challenge the statistical measure; no policy change.',
          effects: { 'society.approval': -4, 'quality.admin': -2, 'society.latent': +4 },
          factions: { intelligentsia: -10, labour: -8, business: +3 } }
      ]
    },

    /* ------------------------------------------------------------- CIVIC */
    {
      id: 'judicial_appointments', cat: 'civic', title: 'Three Seats on the Constitutional Court',
      from: 'Ministry of Justice', urgency: 'routine', deadline: 26,
      weight: () => 12,
      brief: (st) => `<p>Three of the nine seats fall vacant this year. The court has struck down two government measures this term.</p>
        <p>Freedom stands at ${S.round(st.society.freedom, 0)}/100 and administrative capacity at ${S.round(st.quality.admin, 0)}/100.</p>`,
      advisors: (st) => [
        { who: 'Attorney General', role: 'Justice', said: 'Appointments made for political reliability would compromise the court\'s independence and the standing of its rulings.' },
        { who: 'Political Adviser', role: 'Office', said: democratic(st) ? 'Governments that have altered courts for advantage suffered lasting reputational damage.' : 'The appointment mechanism is available and no institution can block its use.' }
      ],
      options: [
        { label: 'Appoint on merit from the shortlist', detail: 'Let the judicial commission choose.',
          effects: { 'quality.admin': +4, 'society.freedom': +4, 'national.softPower': +3, 'society.corruption': -2 },
          factions: { intelligentsia: +10, reformers: +10, nationalists: -4 } },
        { label: 'Appoint sympathetic jurists', detail: 'Qualified candidates expected to rule favourably.',
          effects: { 'society.freedom': -5, 'society.latent': +6, 'quality.admin': -2 },
          factions: { reformers: -10, intelligentsia: -9, nationalists: +5 } },
        { label: 'Expand the court and fill it', detail: 'Enlarge the court to fifteen seats and appoint the six new members.',
          requires: (st) => !democratic(st) || st.society.approval > 55,
          effects: { 'society.freedom': -12, 'society.latent': +14, 'national.softPower': -8, 'quality.admin': -4 },
          factions: { reformers: -20, intelligentsia: -18, military: +3 },
          headline: 'Government Expands Constitutional Court and Fills the New Seats' },
        { label: 'Leave the seats vacant', detail: 'A six-member court will hear fewer cases.',
          effects: { 'quality.admin': -3, 'society.freedom': -2 }, factions: { reformers: -6 } }
      ]
    },
    {
      id: 'police_incident', cat: 'civic', title: 'A Death in Custody',
      from: 'Ministry of the Interior', urgency: 'urgent', deadline: 6,
      weight: (st) => (st.policy.interior.policing > 45 ? 13 : 6),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A man died in a police station in ${f.city} on Tuesday. The initial police statement attributed the death to prior illness; custody footage now public contradicts that account.</p>
          <p>Crowds have gathered outside the station for two nights. Unrest stands at ${S.round(st.society.unrest, 0)}.</p>`;
      },
      options: [
        { label: 'Suspend and prosecute the officers', detail: 'Immediate suspension and charges, ahead of any inquiry.',
          effects: { 'society.unrest': -8, 'society.approval': +4, 'quality.security': -2, 'society.freedom': +3 },
          factions: { reformers: +12, intelligentsia: +8, military: -4 },
          headline: 'Officers Charged Over Death in Custody' },
        { label: 'An independent inquiry', detail: 'A full judicial process; expected duration around eighteen months.',
          effects: { 'society.unrest': -3, 'quality.admin': +3 }, factions: { reformers: +5, intelligentsia: +4 } },
        { label: 'Back the officers', detail: 'State full public support for the officers involved.',
          effects: { 'society.unrest': +10, 'society.latent': +10, 'society.approval': -5 },
          factions: { military: +6, nationalists: +7, reformers: -16 },
          risk: { p: 0.35, text: 'Riots in three cities', fn: (st) => { st.society.unrest += 12; st.economy.shock -= 0.5; } } },
        { label: 'Suppress the footage', detail: 'Obtain an injunction against further broadcast.',
          requires: (st) => st.policy.interior.pressFreedom < 60,
          effects: { 'policy.interior.pressFreedom': -8, 'society.latent': +14, 'society.unrest': +5 },
          factions: { reformers: -18, intelligentsia: -14 },
          risk: { p: 0.5, text: 'It leaks anyway, worse', fn: (st) => { st.society.approval -= 8; st.society.unrest += 10; } } }
      ]
    },
    {
      id: 'electoral_reform', cat: 'civic', title: 'How the Country Votes',
      from: 'Electoral Commission', urgency: 'routine', deadline: 28,
      weight: (st) => (S.govMods(st).elections ? 12 : 2),
      brief: (st) => `<p>The commission has recommended replacing the voting system. The current system converts pluralities of votes into legislative majorities, to the benefit of the governing party.</p>
        <p>Approval stands at ${S.round(st.society.approval, 0)}%.</p>`,
      options: [
        { label: 'Adopt proportional representation', detail: 'More proportional outcomes; likely to reduce the governing party\'s seat share.',
          effects: { 'society.freedom': +6, 'national.softPower': +5, 'society.legitimacy': +6, 'society.stability': -3 },
          factions: { reformers: +16, intelligentsia: +10, nationalists: -6 },
          headline: 'Proportional Representation Adopted' },
        { label: 'Modest reform of the boundaries', detail: 'Update constituency boundaries; no structural change.',
          effects: { 'society.legitimacy': +2 }, factions: { reformers: +3 } },
        { label: 'Redraw the boundaries to your advantage', detail: 'Lawful boundary changes favouring the governing party.',
          effects: { 'society.latent': +10, 'society.legitimacy': -8, 'national.softPower': -5 },
          factions: { reformers: -14, intelligentsia: -10 },
          risk: { p: 0.3, text: 'The commission publishes its objection', fn: (st) => { st.society.approval -= 6; st.society.scandal -= 4; } } },
        { label: 'Reject the report', detail: 'Retain the current voting system.',
          effects: {}, factions: { reformers: -7 } }
      ]
    },
    {
      id: 'whistleblower', cat: 'civic', title: 'A Leak of State Documents',
      from: 'Cabinet Secretary', urgency: 'pressing', deadline: 10,
      weight: (st) => (st.policy.interior.surveillance > 40 ? 12 : 7),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A junior official has taken several thousand documents to a newspaper. They cover surveillance practice, procurement at ${f.firm}, and a programme this office has never publicly acknowledged.</p>
          <p>The official is twenty-nine, remains in the country, and has stated she will not leave.</p>`;
      },
      advisors: () => [
        { who: 'Attorney General', role: 'Justice', said: 'The available charges carry sentences of up to thirty years. The decision to bring them is discretionary.' },
        { who: 'Intelligence Chief', role: 'Services', said: 'The operational damage is significant. The published material is accurate.' }
      ],
      options: [
        { label: 'Prosecute to the full extent', detail: 'Bring the maximum available charges as a deterrent.',
          effects: { 'policy.interior.pressFreedom': -8, 'society.latent': +12, 'national.softPower': -8, 'intel.strength': +3 },
          factions: { military: +6, intelligentsia: -16, reformers: -16 },
          headline: 'Whistleblower Charged Under Secrets Act' },
        { label: 'Prosecute, then commute', detail: 'Secure a conviction, then commute the sentence.',
          effects: { 'society.latent': +4, 'national.softPower': -2 }, factions: { intelligentsia: -5, military: +2 } },
        { label: 'Grant immunity and reform the programme', detail: 'No prosecution; review and reform the disclosed programme.',
          effects: { 'society.freedom': +7, 'national.softPower': +7, 'policy.interior.surveillance': -12, 'intel.strength': -5, 'quality.admin': +3 },
          factions: { reformers: +16, intelligentsia: +14, military: -12 } },
        { label: 'Discredit her', detail: 'Brief the press against her personally rather than address the documents.',
          effects: { 'society.approval': +2, 'society.corruption': +2, 'national.softPower': -6 },
          factions: { intelligentsia: -12, reformers: -10 },
          risk: { p: 0.4, text: 'The briefing operation is exposed', fn: (st) => { st.society.scandal -= 9; st.society.approval -= 7; } } }
      ]
    },
    {
      id: 'civil_service_reform', cat: 'civic', title: 'The Civil Service',
      from: 'Cabinet Secretary', urgency: 'routine', deadline: 28,
      weight: (st) => (st.quality.admin < 65 ? 15 : 7),
      brief: (st) => `<p>Administrative capacity is measured at ${S.round(st.quality.admin, 0)}/100 and corruption at ${S.round(st.society.corruption, 0)}/100. Half of senior appointments were made through patronage.</p>
        <p>Implementation capacity constrains every other policy decision.</p>`,
      options: [
        { label: 'Competitive entry and protected tenure', detail: 'Merit-based recruitment with protected tenure; effects accrue over years.',
          effects: { 'quality.admin': +8, 'society.corruption': -5, 'budget.alloc.admin': +0.25, 'policy.interior.anticorruption': +10 },
          factions: { reformers: +12, intelligentsia: +8, provinces: -8 },
          headline: 'Civil Service Opened to Competitive Entry' },
        { label: 'Pay them properly', detail: 'Raise salaries to attract and retain qualified officials.',
          effects: { 'budget.alloc.admin': +0.4, 'quality.admin': +5, 'society.corruption': -4 },
          factions: { business: -3, labour: +4 } },
        { label: 'Political appointments throughout', detail: 'Fill senior posts with political appointees.',
          effects: { 'quality.admin': -7, 'society.corruption': +6, 'society.latent': +4 },
          factions: { reformers: -12, provinces: +8, intelligentsia: -8 } },
        { label: 'Cut the headcount', detail: 'Reduce staff numbers to lower administrative cost.',
          effects: { 'budget.alloc.admin': -0.4, 'quality.admin': -4, 'economy.businessConfidence': +4 },
          factions: { business: +8, labour: -8 } }
      ]
    },

    /* ---------------------------------------------------------- EXTERNAL */
    {
      id: 'alliance_burden', cat: 'diplomacy', title: 'An Ally Wants More',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 20,
      weight: (st) => (st.diplomacy.nations.some((n) => n.allyOfUs) ? 14 : 0),
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.filter((x) => x.allyOfUs)[0] || st.diplomacy.nations[0];
        ctx.nation = ctx.nation || n.id;
        return `<p>${n.name} has publicly stated that our defence spending is inadequate. We currently spend ${S.round(st.budget.alloc.defense, 2)}% of output, below the alliance target.</p>
          <p>A continued shortfall places the alliance guarantee at risk.</p>`;
      },
      options: [
        { label: 'Raise defence spending to meet the target', detail: 'Meet the alliance target and retain the guarantee.',
          effects: { 'budget.alloc.defense': +0.7, 'society.approval': -3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation += 16; },
          factions: { military: +12, nationalists: +5, labour: -6 } },
        { label: 'Offer capability instead of percentages', detail: 'A smaller increase, directed at capabilities the alliance lacks.',
          effects: { 'budget.alloc.defense': +0.25, 'military.tech': +3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation += 8; },
          factions: { military: +5, business: +3 } },
        { label: 'Tell them publicly to mind their own affairs', detail: 'Publicly reject the criticism on sovereignty grounds.',
          effects: { 'society.approval': +5, 'national.prestige': -2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 18; n.warSupport = 0.6; } },
          factions: { nationalists: +12, military: -6 } },
        { label: 'Quietly ignore it', detail: 'Acknowledge the target without changing spending.',
          effects: {}, fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 6; }, factions: {} }
      ]
    },
    {
      id: 'foreign_base_request', cat: 'diplomacy', title: 'They Want a Base',
      from: 'Ministry of Defence', urgency: 'pressing', deadline: 18,
      weight: (st) => 10,
      brief: (st, ctx) => {
        const n = st.rng.weighted(st.diplomacy.nations, (x) => x.power);
        ctx.nation = ctx.nation || (n ? n.id : st.diplomacy.nations[0].id);
        const nn = S.dip(st, ctx.nation);
        const f = F(st, ctx);
        return `<p>${nn.name} has asked to establish a permanent military facility at ${f.region.replace('the ', 'our ')}. They are offering money, equipment and a security guarantee.</p>
          <p>A permanent foreign military presence would be domestically contentious and difficult to reverse.</p>`;
      },
      options: [
        { label: 'Grant it on generous terms', detail: 'Accept the payment, equipment and security guarantee.',
          effects: { 'national.prestige': -3, 'society.approval': -5, 'world.tension': +5, 'national.concessions': +1 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation += 25; n.allyOfUs = true; } st.economy.reserves += st.economy.gdp * 0.012; st.military.equipment += 4; },
          factions: { nationalists: -16, military: +6, business: +5 },
          then: { id: 'base_incident', days: 1000, chance: 0.7 },
          headline: 'Foreign Military Base Agreed' },
        { label: 'Grant limited access rights only', detail: 'Port visits and overflight. No garrison.',
          effects: { 'world.tension': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation += 10; st.economy.reserves += st.economy.gdp * 0.004; },
          factions: { nationalists: -5, military: +3 } },
        { label: 'Refuse', detail: 'Decline the request; no foreign forces on national territory.',
          effects: { 'national.prestige': +3, 'society.approval': +4 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 12; },
          factions: { nationalists: +12, military: -3 } },
        { label: 'Auction it to their rival', detail: 'Offer the facility to their rival at a higher price.',
          effects: { 'world.tension': +8, 'national.prestige': -2 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation);
            const rival = st.diplomacy.nations.filter((x) => x.id !== ctx.nation && x.power > 50)[0];
            if (n) n.relation -= 20;
            if (rival) { rival.relation += 20; st.economy.reserves += st.economy.gdp * 0.02; }
          },
          factions: { business: +8, nationalists: -6 },
          risk: { p: 0.3, text: 'Both withdraw in disgust', fn: (st) => { st.national.prestige -= 8; st.diplomacy.nations.forEach((x) => { if (x.power > 50) x.relation -= 10; }); } } }
      ]
    },
    {
      id: 'arms_race', cat: 'military', title: 'A Rival Announces a Buildup',
      from: 'Strategic Directorate', urgency: 'routine', deadline: 22,
      weight: (st) => (st.world.tension > 35 ? 14 : 6),
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => a.relation - b.relation)[0];
        ctx.nation = ctx.nation || n.id;
        return `<p>${n.name} has announced a decade-long rearmament programme. Their military index is ${S.round(n.milPower, 1)} against our ${S.round(st.military.power, 1)}; world tension stands at ${S.round(st.world.tension, 0)}.</p>
          <p>Matching the programme is costly; declining to match it would leave a lasting capability gap.</p>`;
      },
      options: [
        { label: 'Match them', detail: 'A comparable rearmament programme, fully funded.',
          effects: { 'budget.alloc.defense': +0.9, 'world.tension': +8, 'society.approval': -3 },
          factions: { military: +12, nationalists: +10, labour: -7, business: -4 } },
        { label: 'Offset asymmetrically', detail: 'Invest in lower-cost systems designed to counter their platforms.',
          effects: { 'budget.alloc.defense': +0.3, 'policy.mil.rndShare': +12, 'military.tech': +4, 'world.tension': +3 },
          factions: { military: +5, intelligentsia: +4 } },
        { label: 'Propose arms control talks', detail: 'Seek a negotiated cap on both programmes.',
          effects: { 'world.tension': -5, 'national.prestige': +4 },
          opensNegotiation: (st, ctx) => ({ kind: 'arms', nation: ctx.nation, ctx: {} }),
          factions: { intelligentsia: +8, nationalists: -8, military: -5 } },
        { label: 'Do nothing', detail: 'No response; their programme may prove fiscally unsustainable.',
          effects: { 'economy.shock': +0.2 },
          factions: { military: -8, nationalists: -9, business: +5 } }
      ]
    },
    {
      id: 'hostage_crisis', cat: 'diplomacy', title: 'Our Nationals Have Been Taken',
      from: 'Foreign Ministry', urgency: 'urgent', deadline: 5,
      weight: (st) => (st.world.tension > 30 ? 10 : 4),
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => a.relation - b.relation)[0];
        ctx.nation = ctx.nation || n.id;
        const count = st.rng.int(4, 40);
        ctx.count = ctx.count || count;
        return `<p>${S.num(ctx.count)} of our citizens are being held. The group holding them has informal links to the government of ${n.name}.</p>
          <p>The families have made public appeals. Intelligence capability is rated ${S.round(st.intel.strength, 0)}.</p>`;
      },
      options: [
        { label: 'Negotiate quietly', detail: 'Open a channel through an intermediary; a payment is likely.',
          effects: { 'society.approval': -2 },
          fn: (st, ctx) => {
            st.economy.reserves -= st.economy.gdp * 0.002;
            if (st.rng.chance(0.75)) { st.society.approval += 6; S.game.event('The hostages have been released. The terms have not been disclosed.', 'good'); }
            else { st.society.approval -= 8; S.game.event('The talks failed and the hostages remain held.', 'bad'); }
          },
          factions: { nationalists: -6, intelligentsia: +5 } },
        { label: 'Mount a rescue', detail: 'A special-forces operation to free the hostages.',
          effects: { 'world.tension': +7, 'military.readiness': -3 },
          fn: (st, ctx) => {
            const p = 0.35 + st.intel.strength / 220 + st.military.quality / 400;
            if (st.rng.chance(p)) { st.society.approval += 12; st.national.prestige += 6; st.military.morale += 6; S.game.event('The rescue succeeded. All hostages were recovered alive.', 'good'); S.News.custom(st, 'Hostages Freed in Night Raid', 'good'); }
            else { st.society.approval -= 14; st.national.prestige -= 8; st.military.morale -= 8; S.game.event('The rescue failed. Most of the hostages and four of our soldiers were killed.', 'bad'); S.News.custom(st, 'Rescue Attempt Ends in Disaster', 'bad'); }
          },
          factions: { military: +8, nationalists: +10 } },
        { label: 'Public ultimatum', detail: 'Demand release by a stated deadline, with a stated consequence.',
          effects: { 'world.tension': +9, 'society.approval': +4 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 15; n.grievance = (n.grievance || 0) + 12; } },
          factions: { nationalists: +12, intelligentsia: -6 } },
        { label: 'State publicly that we do not negotiate', detail: 'Maintain the no-negotiation doctrine; the hostages remain held.',
          effects: { 'society.approval': -7, 'national.prestige': +2, 'society.cohesion': -3 },
          factions: { military: +5, nationalists: +3, labour: -8 } },
        { label: 'Pay in full through intermediaries', detail: 'A ransom routed through third parties, off the public accounts. Reliable, and deniable while it stays secret.', illegal: true,
          effects: {},
          fn: (st, ctx) => {
            st.economy.reserves -= st.economy.gdp * 0.003;
            st.society.approval += 7;
            S.game.event('The hostages have been released unharmed. Officially, no ransom was paid.', 'good');
          },
          risk: { p: 0.30, text: 'The payment becomes public', fn: (st) => { st.society.approval -= 9; st.national.prestige -= 6; st.society.scandal += 8; st.world.tension += 3; } },
          factions: { nationalists: -4 } }
      ]
    },
    {
      id: 'defector', cat: 'intel', title: 'A Defector Has Walked In',
      from: 'Director of Intelligence', urgency: 'pressing', deadline: 9,
      weight: (st) => (st.intel.strength > 30 ? 11 : 4),
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => a.relation - b.relation)[0];
        ctx.nation = ctx.nation || n.id;
        return `<p>A senior officer of ${n.name}'s service entered our embassy on Sunday and requested asylum. He has brought classified material and has asked for substantial terms in return.</p>
          <p>Our service, rated ${S.round(st.intel.strength, 0)}, cannot yet determine whether he is genuine or a plant; its assessment is divided.</p>`;
      },
      options: [
        { label: 'Accept and debrief him fully', detail: 'Grant his terms and conduct a full debrief.',
          effects: { 'world.tension': +5 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation);
            if (st.rng.chance(0.6 + st.intel.strength / 400)) {
              st.intel.strength += 12; if (n) { n.relation -= 20; n.power *= 0.97; }
              S.game.event('The material is genuine. We now have access to their communications.', 'good');
            } else {
              st.intel.strength -= 10; if (n) n.relation -= 8;
              S.game.event('He was a plant. The material he supplied was disinformation.', 'bad');
            }
          },
          factions: { military: +4, intelligentsia: -2 } },
        { label: 'Accept, but treat everything as suspect', detail: 'Grant asylum; treat all supplied material as unverified.',
          effects: { 'intel.strength': +4, 'world.tension': +3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 12; },
          factions: {} },
        { label: 'Hand him back', detail: 'Return him and accept the diplomatic benefit.',
          effects: { 'national.softPower': -8, 'intel.strength': -3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation += 22; n.grievance = 0; } },
          factions: { intelligentsia: -12, reformers: -10, military: -5 },
          headline: 'Defector Returned; Rights Groups Condemn Decision' },
        { label: 'Pass him to an ally', detail: 'Transfer him to an allied service and share the intelligence.',
          effects: { 'intel.strength': +3, 'world.tension': +2 },
          fn: (st, ctx) => {
            const ally = st.diplomacy.nations.filter((x) => x.relation > 35)[0];
            if (ally) { ally.relation += 12; S.Dip.signTreaty(st, ally.id, 'intel'); }
            const n = S.dip(st, ctx.nation); if (n) n.relation -= 10;
          },
          factions: {} }
      ]
    },
    {
      id: 'border_dispute', cat: 'diplomacy', title: 'A Revived Border Claim',
      from: 'Foreign Ministry', urgency: 'routine', deadline: 24,
      weight: () => 11,
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => a.relation - b.relation)[st.rng.int(0, 2)] || st.diplomacy.nations[0];
        ctx.nation = ctx.nation || n.id;
        const f = F(st, ctx);
        return `<p>${n.name} has revived a claim to a strip of ${f.region}. The treaty that settled the boundary is ambiguous and the original surveys conflict.</p>
          <p>The territory has little economic value; the dispute carries political weight in both states.</p>`;
      },
      options: [
        { label: 'Refer it to international arbitration', detail: 'A binding ruling; the process takes years and the outcome is uncertain.',
          effects: { 'national.prestige': +5, 'national.softPower': +5, 'world.tension': -4 },
          fn: (st, ctx) => {
            const n = S.dip(st, ctx.nation); if (n) n.relation += 8;
            if (st.rng.chance(0.5)) { st.national.prestige += 3; S.game.event('The tribunal found substantially in our favour.', 'good'); }
            else { st.national.concessions += 1; S.game.event('The tribunal found against us. We will comply with the ruling.', 'bad'); }
          },
          factions: { intelligentsia: +8, nationalists: -8 } },
        { label: 'Negotiate a settlement directly', detail: 'Seek a negotiated division of the territory.',
          effects: { 'world.tension': -3 },
          opensNegotiation: (st, ctx) => ({ kind: 'ultimatum', nation: ctx.nation, ctx: {} }),
          factions: { nationalists: -4 } },
        { label: 'Fortify the line', detail: 'Deploy troops and fortifications along the disputed boundary.',
          effects: { 'world.tension': +8, 'military.readiness': -2, 'society.approval': +3, 'national.aggressionScore': +6 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 14; n.threatPerception += 10; } },
          factions: { military: +8, nationalists: +12 } },
        { label: 'Concede the strip', detail: 'Cede the territory to end the dispute.',
          effects: { 'national.prestige': -6, 'national.concessions': +1, 'world.tension': -8, 'society.approval': -5 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation += 25; n.grievance = 0; } },
          factions: { nationalists: -18, intelligentsia: +5 } }
      ]
    },
    {
      id: 'space_programme', cat: 'economy', title: 'A National Space Programme',
      from: 'Ministry of Science', urgency: 'routine', deadline: 30,
      weight: (st) => (st.quality.science > 50 ? 10 : 2),
      brief: (st) => `<p>The academy proposes an independent launch capability: domestically built satellites launched on domestic rockets. Science stands at ${S.round(st.quality.science, 0)}/100.</p>
        <p>The cost is substantial; most states that built the capability report lasting scientific and military benefits.</p>`,
      options: [
        { label: 'Fund a full programme', detail: 'Launch vehicles and a spaceport, over roughly a decade.',
          effects: { 'budget.alloc.research': +0.7, 'quality.science': +5, 'national.prestige': +8, 'military.tech': +4 },
          factions: { intelligentsia: +10, military: +8, nationalists: +9, labour: -4 },
          headline: 'Nation Announces Independent Launch Programme' },
        { label: 'Satellites only, launched by others', detail: 'Build satellites domestically; purchase launches abroad.',
          effects: { 'budget.alloc.research': +0.25, 'quality.science': +2, 'intel.strength': +5 },
          factions: { intelligentsia: +5, military: +4 } },
        { label: 'Join a foreign programme as a junior partner', detail: 'Lower cost, with continued dependence on the partner state.',
          effects: { 'quality.science': +2, 'national.prestige': +1 },
          fn: (st) => { const n = st.diplomacy.nations.filter((x) => x.relation > 25)[0]; if (n) n.relation += 10; },
          factions: { nationalists: -6, business: +4 } },
        { label: 'Decline', detail: 'No programme; retain the funds for other priorities.', effects: {}, factions: { intelligentsia: -6, nationalists: -5, labour: +4 } }
      ]
    },

    /* ------------------------------------------------ ENERGY & ENVIRONMENT */
    {
      id: 'water_dispute', cat: 'diplomacy', title: 'They Are Damming the River',
      from: 'Ministry of Energy', urgency: 'pressing', deadline: 16,
      weight: (st) => (st.economy.sectors.agri > 5 ? 12 : 5),
      brief: (st, ctx) => {
        const n = st.rng.pick(st.diplomacy.nations);
        ctx.nation = ctx.nation || n.id;
        const f = F(st, ctx);
        return `<p>${S.dip(st, ctx.nation).name} has begun filling a dam upstream. Flow into ${f.region} will fall by a third, and the farms there are ${S.round(st.economy.sectors.agri, 1)}% of national output between them.</p>
          <p>No treaty governs the river's flow.</p>`;
      },
      options: [
        { label: 'Negotiate a water-sharing treaty', detail: 'Negotiate a binding allocation of flow; slow, but durable.',
          effects: { 'national.prestige': +4, 'world.tension': -3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation += 10; },
          factions: { intelligentsia: +6, provinces: +5 } },
        { label: 'Take it to the international bodies', detail: 'Refer the dispute to international institutions.',
          effects: { 'national.softPower': +4, 'world.tension': +2 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 8; },
          factions: { nationalists: +4 } },
        { label: 'Threaten force', detail: 'State that the dam is a legitimate military target.',
          effects: { 'world.tension': +14, 'national.aggressionScore': +14, 'society.approval': +4 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) { n.relation -= 25; n.grievance = (n.grievance || 0) + 20; } },
          factions: { military: +8, nationalists: +14, intelligentsia: -10 },
          risk: { p: 0.2, text: 'They mobilise in response', fn: (st) => { st.world.tension += 10; } } },
        { label: 'Invest in irrigation and storage at home', detail: 'Build domestic irrigation and storage capacity to offset the loss.',
          effects: { 'budget.alloc.infra': +0.4, 'quality.infra': +2, 'economy.shock': -0.2 },
          factions: { provinces: +9, business: +3 } }
      ]
    },
    {
      id: 'emissions_treaty', cat: 'diplomacy', title: 'A Binding Emissions Treaty',
      from: 'Ministry of Energy', urgency: 'routine', deadline: 26,
      weight: (st) => (st.world.climate > 35 ? 13 : 7),
      brief: (st) => `<p>A binding treaty is on the table: dated targets, independent verification, and enforceable penalties. Climate stress stands at ${S.round(st.world.climate, 0)}/100 and rising.</p>
        <p>Signing imposes costs on domestic industry; declining to sign carries diplomatic costs.</p>`,
      options: [
        { label: 'Sign and legislate the targets', detail: 'Write the treaty targets into domestic law.',
          effects: { 'policy.energy.transition': +20, 'national.softPower': +8, 'national.prestige': +5, 'economy.businessConfidence': -6, 'economy.shock': -0.3 },
          fn: (st) => { st.world.climate -= 3; st.diplomacy.nations.forEach((n) => { n.relation += 5; }); },
          factions: { intelligentsia: +10, reformers: +9, business: -9 },
          headline: 'Nation Signs Binding Emissions Treaty' },
        { label: 'Sign with exemptions for heavy industry', detail: 'Sign, with carve-outs that remove most of the cost to industry.',
          effects: { 'policy.energy.transition': +8, 'national.softPower': +3 },
          factions: { business: -2, intelligentsia: +3 } },
        { label: 'Refuse to sign', detail: 'Decline the treaty; accept the diplomatic consequences.',
          effects: { 'national.softPower': -7, 'economy.businessConfidence': +4 },
          fn: (st) => { st.world.climate += 1; st.diplomacy.nations.forEach((n) => { if (n.ideology === 'liberal') n.relation -= 8; }); },
          then: { id: 'carbon_border_tax', days: 800, chance: 0.75 },
          factions: { business: +9, nationalists: +8, intelligentsia: -10 } }
      ]
    },
    {
      id: 'reactor_incident', cat: 'crisis', title: 'An Incident at the Reactor',
      from: 'Nuclear Safety Authority', urgency: 'urgent', deadline: 4,
      weight: (st) => (st.quality.energy > 40 && st.policy.energy.transition > 20 ? 8 : 2),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>A cooling failure at the ${f.region.replace('the ', '')} station has been contained. The authority assesses that a recurrence might not be. A small radioactive release has already occurred.</p>
          <p>Public disclosure is likely regardless of government action.</p>`;
      },
      options: [
        { label: 'Full disclosure and an immediate shutdown', detail: 'Publish the findings and close the station.',
          effects: { 'quality.energy': -6, 'society.approval': +3, 'economy.shock': -0.5, 'quality.admin': +3 },
          fn: (st) => { S.Aftermath.addScar(st, { kind: 'reactor', name: 'The Reactor Incident', desc: 'A contained cooling failure, fully disclosed.', severity: 40, years: 4, growth: -0.2, unrest: +2, qualityDrag: { energy: -10 }, tag: 'disaster' }); },
          factions: { intelligentsia: +10, reformers: +9, business: -6 },
          headline: 'Reactor Shut Down After Cooling Failure; Full Disclosure Promised' },
        { label: 'Disclose, keep it running under review', detail: 'Publish the findings; keep the station operating under enhanced monitoring.',
          effects: { 'quality.energy': -2, 'society.unrest': +5, 'society.approval': -2 },
          risk: { p: 0.25, text: 'A second failure', fn: (st) => { st.quality.energy -= 8; st.society.approval -= 10; st.pop.total *= 0.9995; S.News.custom(st, 'Second Reactor Failure; Evacuation Ordered', 'bad'); } },
          factions: { business: +5, intelligentsia: -5 } },
        { label: 'Classify the incident', detail: 'Withhold the incident from the public.',
          effects: { 'policy.interior.pressFreedom': -6, 'society.latent': +8 },
          factions: { intelligentsia: -12, reformers: -12, business: +4 },
          risk: { p: 0.55, text: 'It emerges, with the cover-up attached', fn: (st) => { st.society.approval -= 12; st.society.unrest += 10; st.national.softPower -= 6; S.News.custom(st, 'Reactor Cover-Up Exposed', 'bad'); } } }
      ]
    },
    {
      id: 'brain_gain', cat: 'social', title: 'A Chance to Import Talent',
      from: 'Ministry of the Interior', urgency: 'routine', deadline: 24,
      weight: (st) => (st.quality.science > 35 ? 10 : 4),
      brief: (st, ctx) => {
        const n = st.diplomacy.nations.slice().sort((a, b) => b.power - a.power)[st.rng.int(0, 3)];
        ctx.nation = ctx.nation || n.id;
        return `<p>Political conditions in ${S.dip(st, ctx.nation).name} have made a great many of their scientists, engineers and doctors willing to leave. Several other governments are already recruiting.</p>
          <p>Immigration openness stands at ${st.policy.interior.immigration}/100; our science base at ${S.round(st.quality.science, 0)}/100.</p>`;
      },
      options: [
        { label: 'An aggressive recruitment programme', detail: 'Expedited visas, salary support, laboratory funding and family provision.',
          effects: { 'policy.interior.immigration': +12, 'quality.science': +6, 'economy.productivity': +2, 'society.cohesion': -3, 'budget.alloc.research': +0.3 },
          fn: (st, ctx) => { const n = S.dip(st, ctx.nation); if (n) n.relation -= 10; },
          factions: { intelligentsia: +12, business: +8, nationalists: -12 },
          headline: 'Nation Opens Doors to Foreign Scientists' },
        { label: 'A quiet, selective programme', detail: 'Recruit selectively, without public announcement.',
          effects: { 'quality.science': +3, 'policy.interior.immigration': +4 },
          factions: { intelligentsia: +6, nationalists: -4 } },
        { label: 'Decline to compete', detail: 'No recruitment programme; increase domestic training instead.',
          effects: { 'budget.alloc.education': +0.2 },
          factions: { nationalists: +7, intelligentsia: -6 } }
      ]
    },
    {
      id: 'famine_relief', cat: 'crisis', title: 'Hunger in the Provinces',
      from: 'Ministry of Agriculture', urgency: 'pressing', deadline: 10,
      weight: (st) => (st.world.grain > 125 || st.economy.sectors.agri > 15 ? 13 : 3),
      brief: (st, ctx) => {
        const f = F(st, ctx);
        return `<p>Two failed harvests and a grain price at ${S.round(st.world.grain, 0)} have left ${f.region} unable to feed itself. District officers report famine conditions.</p>
          <p>Reserves stand at ${S.money(st.economy.reserves)}.</p>`;
      },
      options: [
        { label: 'Emergency imports and free distribution', detail: 'Purchase grain on the world market and distribute it without charge.',
          effects: { 'society.approval': +7, 'economy.inflation': +0.5 },
          fn: (st) => { st.economy.reserves -= st.economy.gdp * 0.014; },
          factions: { provinces: +14, labour: +8, business: -4 },
          headline: 'Emergency Grain Distribution Begins' },
        { label: 'Price controls and rationing', detail: 'Fix grain prices and introduce rationing.',
          effects: { 'society.approval': +2, 'society.unrest': +4, 'economy.shock': -0.4 },
          fn: (st) => { st.policy.econ.priceControls = true; },
          factions: { labour: +6, business: -9 } },
        { label: 'Appeal for international food aid', detail: 'Request assistance from other governments and aid bodies.',
          effects: { 'national.prestige': -5, 'society.approval': +2 },
          fn: (st) => { st.economy.reserves += st.economy.gdp * 0.005; st.diplomacy.nations.forEach((n) => { if (n.relation > 10) n.relation += 4; }); },
          factions: { nationalists: -9, provinces: +8 } },
        { label: 'Let the market clear', detail: 'No intervention; rely on prices to attract supply.',
          effects: { 'society.approval': -10, 'society.unrest': +12, 'economy.businessConfidence': +4 },
          fn: (st) => { S.Aftermath.addScar(st, { kind: 'famine', name: 'The Famine', desc: 'The state declined to intervene during a food crisis.', severity: 60, years: 6, deaths: Math.round(st.pop.total * 380), growth: -0.5, approval: -3, unrest: +5, qualityDrag: { health: -8 }, tag: 'disaster' }); },
          factions: { provinces: -20, labour: -14, business: +8 } }
      ]
    }
  ];

  LIB2.forEach((d) => { D.LIB.push(d); D.BY_ID[d.id] = d; });

  void authoritarian;
})(window.S);

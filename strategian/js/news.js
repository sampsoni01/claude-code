/* STRATEGIAN — the press.
   The same fact is reported differently depending on who owns the paper,
   how free the press is, and how the government is doing.               */
(function (S) {
  'use strict';

  const News = S.News = {};

  /* Which outlets exist and how loud they are, given press freedom. */
  News.activeOutlets = function (st) {
    const pf = st.policy.interior.pressFreedom;
    return S.OUTLETS.filter((o) => {
      if (o.bias === 'dissident') return pf < 45 && st.society.unrest > 22;
      if (o.bias === 'state') return true;
      if (o.bias === 'foreign') return true;
      return pf > 18 || o.bias === 'business';
    });
  };

  News.pickOutlet = function (st, tone) {
    const list = News.activeOutlets(st);
    const pf = st.policy.interior.pressFreedom;
    return st.rng.weighted(list, (o) => {
      let w = 1;
      if (o.bias === 'state') w = 1 + (100 - pf) / 45;
      if (o.bias === 'dissident') w = 0.5;
      if (o.bias === 'foreign') w = 0.7;
      if (tone === 'bad' && o.bias === 'state') w *= 0.35;
      if (tone === 'good' && o.bias === 'dissident') w *= 0.3;
      return w;
    }) || list[0];
  };

  /* ------------------------------------------------------- spin engine */
  // Adjectives and framings applied to a neutral headline by outlet bias.
  News.spin = function (st, outlet, headline, tone) {
    const approve = st.society.approval;
    const leader = st.nation.leaderTitle + ' ' + st.nation.leader;
    if (!headline) return headline;
    switch (outlet.bias) {
      case 'state':
        if (tone === 'bad') return headline.replace(/^/, 'Despite Foreign Interference: ');
        return headline + ' — ' + leader + ' Hailed';
      case 'dissident':
        return headline + ' — And Nobody Will Say Who Decided';
      case 'foreign':
        return headline + ' (' + st.nation.name + ')';
      case 'left':
        if (tone === 'bad') return headline + ' — Working Families Pay Again';
        return headline;
      case 'right':
        if (tone === 'bad') return headline + ' — Weakness Invites More';
        return headline;
      case 'business':
        return headline;
      default:
        if (approve < 35 && tone === 'bad') return headline + ' — Pressure Mounts';
        return headline;
    }
  };

  /* --------------------------------------------------------- templates */
  News.T = {
    war_start: (d) => ['State of War Declared with ' + d.nation, 'Hostilities Begin as Talks Collapse', 'Reservists Called Up; Borders Sealed'],
    war_victory: (d) => ['Victory: ' + d.nation + ' Accepts Our Terms', 'The War Is Over — On Our Terms', 'Troops to Return as Settlement Signed'],
    war_defeat: (d) => ['Terms Accepted After Military Reverses', 'Defeat: Government Signs Under Duress', 'The Line Could Not Be Held'],
    war_peace: (d) => ['Negotiated Settlement Ends the War with ' + d.nation, 'Ceasefire Holds as Text Is Initialled'],
    civil_war: () => ['Civil War: Armed Factions Declare Against the State', 'Provinces in Open Revolt', 'The Army Divides'],
    coup_failed: () => ['Coup Attempt Crushed Before Dawn', 'Officers Arrested; Purge Begins', 'Tanks Withdraw from the Capital'],
    nuclear: (d) => ['NUCLEAR WEAPONS USED', 'Cities Destroyed in Exchange with ' + d.nation, 'The Unthinkable Has Happened'],
    default: () => ['Sovereign Default: State Suspends Debt Payments', 'Creditors Locked Out as Treasury Runs Dry'],
    currency: () => ['The Peg Breaks: Currency Falls Sharply', 'Central Bank Abandons the Defence'],
    sanctions_on_us: (d) => [d.nation + ' Imposes Sanctions', 'Trade Curbs Announced by ' + d.nation],
    treaty: (d) => [d.kind + ' Signed with ' + d.nation, 'Accord Reached with ' + d.nation],
    nego_success: (d) => ['Agreement Reached with ' + d.nation, 'Delegations Sign After Long Talks'],
    nego_fail: (d) => ['Talks with ' + d.nation + ' Collapse', 'Delegations Leave Without Agreement'],
    election_won: (d) => ['Government Returned with ' + d.pct + '%', 'Mandate Renewed at the Ballot Box'],
    election_stolen: () => ['Result Declared; Observers Walk Out', 'Opposition Rejects the Count'],
    foreign_war: (d) => ['War Breaks Out Between ' + d.a + ' and ' + d.b, d.a + ' and ' + d.b + ' Exchange Fire'],
    inflation_high: (d) => ['Inflation Reaches ' + d.v + '%', 'Prices Climb Again as Wages Lag', 'Cost of Living Dominates Politics'],
    inflation_ok: (d) => ['Inflation Falls to ' + d.v + '%', 'Price Pressures Ease'],
    unemployment_high: (d) => ['Unemployment Hits ' + d.v + '%', 'Job Losses Spread Beyond Industry'],
    unemployment_low: (d) => ['Unemployment Down to ' + d.v + '%', 'Labour Market Tightens'],
    market_crash: (d) => ['Markets Fall ' + d.v + '% in Session', 'Sell-Off Wipes Out Months of Gains'],
    market_rally: (d) => ['Markets Rally to New Highs', 'Investors Return as Confidence Improves'],
    growth_recession: () => ['Economy Enters Recession', 'Second Quarter of Contraction Confirmed'],
    growth_boom: (d) => ['Economy Grows ' + d.v + '%', 'Growth Beats Every Forecast'],
    unrest_high: () => ['Mass Protests in Major Cities', 'Demonstrations Enter a Second Week', 'Police Clash with Crowds'],
    unrest_calm: () => ['Streets Quiet as Talks Begin', 'Protest Movement Loses Momentum'],
    approval_low: (d) => ['Approval Falls to ' + d.v + '%', 'Government Popularity at Record Low'],
    approval_high: (d) => ['Approval Climbs to ' + d.v + '%', 'Public Mood Turns'],
    corruption: () => ['Corruption Scandal Reaches the Ministries', 'Officials Arrested in Procurement Inquiry'],
    oil_spike: (d) => ['Oil Price Jumps to ' + d.v, 'Energy Costs Surge Worldwide'],
    oil_fall: (d) => ['Oil Slides to ' + d.v, 'Energy Prices Retreat'],
    culture: () => ['Our Films Sweep the International Awards', 'Foreign Enrolment at Our Universities Hits a Record',
      'Global Audiences Adopt Our Music', 'Our Language Overtakes Rivals in Schools Abroad'],
    tech: () => ['National Laboratories Announce a Breakthrough', 'Patent Filings Reach a Record'],
    ambient_good: () => ['Infrastructure Programme Opens Ahead of Schedule', 'Hospital Waiting Times Fall',
      'Exports Reach a Record', 'School Results Improve for a Third Year', 'Crime Falls to a Ten-Year Low'],
    ambient_bad: () => ['Power Cuts Hit Second City for Third Night', 'Hospital Backlogs Grow',
      'Bridge Closure Exposes Maintenance Backlog', 'Teachers Vote to Strike', 'Emigration Reaches a Record'],
    ambient_neutral: () => ['Census Returns Published', 'Central Bank Minutes Reveal a Split',
      'Foreign Minister Begins Regional Tour', 'Budget Committee Opens Hearings',
      'Weather Service Warns of a Difficult Season']
  };

  News.push = function (st, key, data) {
    data = data || {};
    const tmpl = News.T[key];
    let base;
    if (typeof tmpl === 'function') base = st.rng.pick(tmpl(data));
    else base = data.text || 'Government Announcement';
    const tone = data.tone || (['war_defeat', 'civil_war', 'nuclear', 'default', 'currency', 'sanctions_on_us',
      'nego_fail', 'inflation_high', 'unemployment_high', 'market_crash', 'growth_recession',
      'unrest_high', 'approval_low', 'corruption', 'ambient_bad', 'election_stolen', 'war_start']
      .indexOf(key) >= 0 ? 'bad' : ['war_victory', 'treaty', 'nego_success', 'election_won', 'inflation_ok',
        'unemployment_low', 'market_rally', 'growth_boom', 'unrest_calm', 'approval_high', 'culture',
        'tech', 'ambient_good', 'war_peace'].indexOf(key) >= 0 ? 'good' : '');

    const outlet = News.pickOutlet(st, tone);
    const headline = News.spin(st, outlet, base, tone);
    const item = {
      id: S.uid('hl'),
      outlet: outlet.name, outletColor: outlet.color, bias: outlet.bias,
      text: headline, sub: data.sub || '', tone: tone,
      severity: data.severity || 'normal',
      date: S.dateLabel(st.date), day: S.absDay(st.date)
    };
    st.headlines.unshift(item);
    if (st.headlines.length > 260) st.headlines.length = 260;
    if (S.UI && S.UI.onNews) S.UI.onNews(item);
    return item;
  };

  /* Free-form headline used by decision outcomes. */
  News.custom = function (st, text, tone, sub) {
    const outlet = News.pickOutlet(st, tone);
    const item = {
      id: S.uid('hl'), outlet: outlet.name, outletColor: outlet.color, bias: outlet.bias,
      text: News.spin(st, outlet, text, tone), sub: sub || '', tone: tone || '',
      severity: 'normal', date: S.dateLabel(st.date), day: S.absDay(st.date)
    };
    st.headlines.unshift(item);
    if (st.headlines.length > 260) st.headlines.length = 260;
    if (S.UI && S.UI.onNews) S.UI.onNews(item);
    return item;
  };

  /* ------------------------------------------------- threshold watcher */
  News.watch = function (st) {
    const e = st.economy, w = st.news;
    const check = (key, value, band, fn) => {
      const prev = w[key];
      if (prev == null) { w[key] = value; return; }
      if (Math.abs(value - prev) >= band) { fn(value, prev); w[key] = value; }
    };

    check('inflation', S.round(e.inflation, 1), 2.6, (v, p) => {
      News.push(st, v > p ? 'inflation_high' : 'inflation_ok', { v: S.round(v, 1) });
    });
    check('unemployment', S.round(e.unemployment, 1), 1.6, (v, p) => {
      News.push(st, v > p ? 'unemployment_high' : 'unemployment_low', { v: S.round(v, 1) });
    });
    check('approval', S.round(st.society.approval, 0), 10, (v, p) => {
      News.push(st, v < p ? 'approval_low' : 'approval_high', { v: S.round(v, 0) });
    });
    check('market', S.round(e.marketIndex, 0), Math.max(12, e.marketIndex * 0.11), (v, p) => {
      News.push(st, v < p ? 'market_crash' : 'market_rally', { v: S.round(Math.abs((v - p) / p) * 100, 1) });
    });
    check('oil', S.round(st.world.oil, 0), 22, (v, p) => {
      News.push(st, v > p ? 'oil_spike' : 'oil_fall', { v: S.round(v, 0) });
    });
    check('unrest', S.round(st.society.unrest, 0), 14, (v, p) => {
      News.push(st, v > p ? 'unrest_high' : 'unrest_calm', {});
    });
    if (e.growth < -0.4 && !w.recession) { w.recession = true; News.push(st, 'growth_recession', {}); }
    if (e.growth > 1.0 && w.recession) { w.recession = false; }
    if (e.growth > 5.5 && !w.boom) { w.boom = true; News.push(st, 'growth_boom', { v: S.round(e.growth, 1) }); }
    if (e.growth < 4 && w.boom) w.boom = false;
  };

  /* Ambient colour: the ordinary business of a country. */
  News.ambient = function (st) {
    const good = st.society.approval * 0.4 + st.quality.infra * 0.3 + st.quality.health * 0.3;
    const roll = st.rng();
    if (st.national.softPower > 62 && roll < 0.14) return News.push(st, 'culture', {});
    if (st.quality.science > 68 && roll < 0.20) return News.push(st, 'tech', {});
    if (st.society.corruption > 58 && roll < 0.28) return News.push(st, 'corruption', {});
    if (roll < 0.30 + (good - 50) / 200) return News.push(st, 'ambient_good', {});
    if (roll < 0.62 - (good - 50) / 200) return News.push(st, 'ambient_bad', {});
    return News.push(st, 'ambient_neutral', {});
  };

})(window.S);

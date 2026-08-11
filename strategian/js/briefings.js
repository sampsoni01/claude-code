/* STRATEGIAN — the papers that land on your desk each morning.
   Accuracy scales with your intelligence service; a weak service reports
   confidently and wrongly, which is worse than reporting nothing.       */
(function (S) {
  'use strict';

  const B = S.Brief = {};

  B.confidenceWord = function (acc) {
    if (acc > 0.85) return 'HIGH CONFIDENCE';
    if (acc > 0.65) return 'MODERATE CONFIDENCE';
    if (acc > 0.45) return 'LOW CONFIDENCE';
    return 'FRAGMENTARY — TREAT WITH CAUTION';
  };

  /* ------------------------------------------------- intelligence brief */
  B.intelligence = function (st) {
    const acc = st.intel.accuracy;
    const threats = S.Dip.assessThreats(st);
    const rng = st.rng;
    const sections = [];

    sections.push({
      h: 'Assessment of Principal Threats',
      body: threats.slice(0, 4).map((t) => {
        const n = S.dip(st, t.id);
        const verb = t.score > 70 ? 'assesses hostile intent as active' :
          t.score > 45 ? 'assesses hostile intent as probable' :
            t.score > 25 ? 'assesses limited hostile intent' : 'assesses no immediate hostile intent';
        return '<b>' + n.name + '</b> — ' + verb + '. Force ratio ' + S.round(t.ratio, 2) +
          ':1 in ' + (t.ratio > 1 ? 'our' : 'their') + ' favour' +
          (n.nuclear ? '; nuclear-armed' : '') + '. Posture: ' + n.stance + '.';
      })
    });

    // Foreign intentions — noisy, and sometimes flatly wrong.
    const intentions = [];
    st.diplomacy.nations.slice().sort((a, b) => b.power - a.power).slice(0, 5).forEach((n) => {
      const truth = n.relation < -40 ? 'preparing coercive options against us' :
        n.relation < -10 ? 'seeking to constrain our freedom of action' :
          n.relation > 50 ? 'seeking deeper alignment with us' :
            'pursuing its own regional priorities';
      const wrong = rng.chance(1 - acc);
      const reported = wrong ? rng.pick([
        'preparing coercive options against us', 'seeking deeper alignment with us',
        'internally paralysed and unable to act', 'pursuing its own regional priorities'
      ]) : truth;
      intentions.push('<b>' + n.name + '</b> is ' + reported + '.' +
        (wrong && acc < 0.5 ? ' <span class="c-mute">(single source, uncorroborated)</span>' : ''));
    });
    sections.push({ h: 'Foreign Intentions', body: intentions });

    // Internal picture.
    const internal = [];
    const rep = S.Soc.repression(st);
    internal.push('Domestic dissent index: <b>' + S.round(S.Dip.observed(st, st.society.unrest, 10), 0) +
      '</b>. Latent resentment assessed at <b>' + S.round(S.Dip.observed(st, st.society.latent, 12), 0) + '</b>.');
    if (st.society.latent > 55) internal.push('<span class="c-bad">Warning:</span> resentment is running well ahead of visible unrest. Control measures are suppressing symptoms, not causes.');
    if (rep > 65) internal.push('Informant networks report increasing self-censorship. Reporting quality from the interior is degrading as a result.');
    const worst = st.factions.slice().sort((a, b) => (a.loyalty - a.power * 0.3) - (b.loyalty - b.power * 0.3))[0];
    internal.push('Least reliable constituency: <b>' + (S.FACTIONS.find((f) => f.id === worst.id) || {}).name +
      '</b> (loyalty ' + S.round(S.Dip.observed(st, worst.loyalty, 8), 0) + ', influence ' + S.round(worst.power, 0) + ').');
    if (st.risk.coup > 30) internal.push('<span class="c-bad">Counter-intelligence flags unusual contact between senior officers and civilian figures outside the government.</span>');
    sections.push({ h: 'Internal Security', body: internal });

    // Collection capability.
    const cap = [];
    cap.push('Collection capability rated <b>' + S.round(st.intel.strength, 0) + '/100</b>; product reliability ' +
      B.confidenceWord(acc) + '.');
    if (st.intel.strength < 40) cap.push('We are effectively blind on ' +
      st.diplomacy.nations.filter((n) => n.power > 55).map((n) => n.name).slice(0, 2).join(' and ') + '.');
    const sharing = st.diplomacy.nations.filter((n) => n.treaties.indexOf('intel') >= 0);
    if (sharing.length) cap.push('Liaison product received from ' + sharing.map((n) => n.name).join(', ') + '.');
    sections.push({ h: 'Collection Posture', body: cap });

    return {
      title: 'DAILY INTELLIGENCE SUMMARY',
      classification: st.intel.strength > 60 ? 'TOP SECRET — LIMITED DISTRIBUTION' : 'SECRET',
      date: S.dateLong(st.date),
      confidence: B.confidenceWord(acc),
      sections: sections
    };
  };

  /* ----------------------------------------------------- military brief */
  B.military = function (st) {
    const m = st.military;
    const rank = S.Mil.worldRank(st);
    const myRank = rank.findIndex((x) => x.self) + 1;
    const sections = [];

    sections.push({
      h: 'Force Status',
      body: [
        'Establishment <b>' + S.headcount(m.manpower) + '</b> under arms. Readiness <b>' +
        S.round(m.readiness, 0) + '</b>, equipment <b>' + S.round(m.equipment, 0) + '</b>, technology <b>' +
        S.round(m.tech, 0) + '</b>, logistics <b>' + S.round(m.logistics, 0) + '</b>.',
        'Combat effectiveness index <b>' + S.round(m.quality, 0) + '/100</b>. Global power ranking: <b>' +
        S.ordinal(myRank) + '</b> of ' + rank.length + '.',
        'Doctrine: <b>' + S.Mil.DOCTRINES[st.policy.mil.doctrine].name + '</b>. Nuclear posture: <b>' +
        S.Mil.NUCLEAR_POSTURES[st.policy.mil.nuclearPosture].name + '</b>' +
        (m.nuclear > 1 ? ' (arsenal index ' + S.round(m.nuclear, 0) + ')' : '') + '.',
        m.readiness < 40 ? '<span class="c-bad">Readiness is below the level at which I can guarantee a response to a short-notice contingency.</span>' :
          m.readiness > 75 ? 'Readiness is sufficient for short-notice operations across the full range of contingencies.' :
            'Readiness is adequate for defensive contingencies; expeditionary tasks would require mobilisation.'
      ]
    });

    if (st.wars.length) {
      st.wars.forEach((w) => {
        const n = w.enemyId ? S.dip(st, w.enemyId) : null;
        const post = S.Mil.POSTURES[w.posture];
        const body = [
          'Current posture: <b>' + post.name + '</b>. Operational tempo ' + S.round(w.intensity, 0) + '/100.',
          'Position: <b>' + (w.score > 25 ? 'advantageous' : w.score < -25 ? 'unfavourable' : 'contested') +
          '</b> (score ' + S.signed(w.score, 0) + ').',
          'Our losses to date: <b>' + S.headcount(w.casualties / 1e6) + '</b>' +
          (w.enemyCasualties ? '; assessed enemy losses ' + S.headcount(w.enemyCasualties / 1e6) : '') + '.',
          'Force exhaustion <b>' + S.round(w.exhaustion, 0) + '</b>; assessed enemy exhaustion <b>' +
          S.round(S.Dip.observed(st, w.enemyExhaustion, 14), 0) + '</b>.',
          'Home front support: <b>' + S.round(w.homeSupport, 0) + '%</b>' +
          (w.homeSupport < 35 ? ' <span class="c-bad">— politically unsustainable</span>' : '') + '.',
          'Cost to the treasury: <b>' + S.money(w.annualCost) + '</b> per year.'
        ];
        if (n && n.nuclear) body.push('<span class="c-warn">The adversary is nuclear-armed. Escalation management must govern every operational decision.</span>');
        body.push('<b>Recommendation:</b> ' + B.warRecommendation(st, w));
        sections.push({ h: w.name, body: body, war: w });
      });
    } else {
      sections.push({
        h: 'Operations', body: ['No active operations. Forces are in routine training and readiness cycles.']
      });
    }

    const proc = [];
    const bmRatio = st.budget.alloc.defense / S.Econ.BENCHMARK.defense;
    proc.push('Defence expenditure <b>' + S.round(st.budget.alloc.defense, 2) + '% of output</b> (' +
      S.money(m.spendAbs) + '), ' + (bmRatio > 1.3 ? 'well above' : bmRatio > 0.9 ? 'around' : 'below') +
      ' the level required to sustain current force structure.');
    proc.push('R&D share of the defence budget: <b>' + st.policy.mil.rndShare + '%</b>. Veteran and personnel support: <b>' +
      st.policy.mil.veteranCare + '/100</b>.');
    if (m.equipment < 45) proc.push('<span class="c-bad">Equipment obsolescence is now the binding constraint on effectiveness.</span>');
    if (S.Soc.militaryLoyalty(st) < 40) proc.push('<span class="c-bad">Officer morale and confidence in the civilian leadership are notably poor.</span>');
    sections.push({ h: 'Procurement and Sustainment', body: proc });

    const comp = rank.slice(0, 6).map((r) =>
      (r.self ? '<b class="c-gold">' + r.name + ' (us)</b>' : r.name) + ' — index ' + S.round(r.power, 1));
    sections.push({ h: 'Comparative Force Ratings', body: comp });

    return {
      title: 'CHIEF OF THE GENERAL STAFF — SITUATION BRIEF',
      classification: 'SECRET — UK EYES EQUIVALENT',
      date: S.dateLong(st.date),
      sections: sections
    };
  };

  B.warRecommendation = function (st, w) {
    if (w.score > 55) return 'The position is strong enough to seek terms from a position of advantage. I would not push for total victory; the marginal gain is small and the marginal risk is not.';
    if (w.score < -45) return 'I recommend disengagement to defensible lines and immediate political contact. The military options remaining are all expensive and none of them are good.';
    if (w.homeSupport < 35) return 'The force can continue. The country cannot. That is a political judgement but I am obliged to report it.';
    if (w.exhaustion > 65) return 'Formations require rotation and refit. I recommend reducing tempo for one operational cycle regardless of the political optics.';
    if (st.military.readiness < 40) return 'Readiness has fallen below sustainable levels. Either reinforce the budget or reduce the tempo.';
    return 'Maintain current posture. The position is contested and neither side has yet found a decisive advantage.';
  };

  /* ---------------------------------------------------- economic report */
  B.economic = function (st) {
    const e = st.economy;
    const sections = [];
    sections.push({
      h: 'Headline Indicators',
      body: [
        'Output <b>' + S.money(e.gdp) + '</b>, growing at <b>' + S.round(e.growth, 1) + '%</b> against estimated potential of ' + S.round(e.potential, 1) + '%.',
        'Inflation <b>' + S.round(e.inflation, 1) + '%</b>; policy rate <b>' + S.round(st.policy.monetary.rate, 1) + '%</b>; ten-year yield <b>' + S.round(e.bondYield, 1) + '%</b>.',
        'Unemployment <b>' + S.round(e.unemployment, 1) + '%</b>. Informal sector <b>' + S.round(e.informal, 0) + '%</b> of activity.',
        'Public debt <b>' + S.round(e.debtGdp, 0) + '%</b> of output; deficit <b>' + S.round((e.deficit / e.gdp) * 100, 1) + '%</b>. Rating <b>' + e.creditRating + '</b>.'
      ]
    });
    sections.push({
      h: 'External Position',
      body: [
        'Exports <b>' + S.money(e.exports) + '</b>, imports <b>' + S.money(e.imports) + '</b>, balance <b>' + S.money(e.tradeBalance) + '</b>.',
        'Currency at <b>' + S.round(e.fx, 1) + '</b> (launch = 100). Reserves <b>' + S.money(e.reserves) + '</b> — ' + S.round(e.reserveMonths, 1) + ' months of imports.',
        e.sanctionPressure > 10 ? '<span class="c-bad">Sanctions pressure index ' + S.round(e.sanctionPressure, 0) + '. Market access constrained.</span>' :
          'No material sanctions burden.'
      ]
    });
    const risks = [];
    if (e.debtGdp > 100) risks.push('Debt sustainability is the dominant medium-term risk.');
    if (e.inflation > 10) risks.push('Inflation is above the level at which expectations de-anchor.');
    if (e.reserveMonths < 3) risks.push('Reserve cover is below the prudential minimum.');
    if (e.unemployment > 12) risks.push('Labour market slack is generating political risk.');
    if (st.flags.bubble) risks.push('Asset valuations appear stretched relative to earnings.');
    if (e.growth < 0) risks.push('The economy is contracting.');
    if (!risks.length) risks.push('No systemic risks flagged this quarter.');
    sections.push({ h: 'Risk Register', body: risks });
    return {
      title: 'TREASURY QUARTERLY ASSESSMENT',
      classification: 'OFFICIAL',
      date: S.dateLong(st.date),
      sections: sections
    };
  };

})(window.S);

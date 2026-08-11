/* STRATEGIAN — aftermath.
   Catastrophes are supposed to outlive the headline. A scar is a wound the
   country is still carrying: it drags on growth, on the mood and on the
   quality of whatever it damaged, it gets written about on its anniversary,
   and it schedules the decisions that follow from it — the reconstruction
   money, the inquiry, the memorial — months or years later.              */
(function (S) {
  'use strict';

  const A = S.Aftermath = {};

  /* ---------------------------------------------------------- creation */
  // spec: { id, name, desc, severity 0-100, years, growth, approval, unrest,
  //         qualityDrag: {infra: -8}, tag, deaths }
  A.addScar = function (st, spec) {
    st.scars = st.scars || [];
    const existing = st.scars.find((s) => s.kind === spec.kind);
    if (existing) {
      // A second blow of the same kind compounds rather than replacing.
      existing.severity = S.clamp(existing.severity + spec.severity * 0.6, 0, 130);
      existing.years = Math.max(existing.years, spec.years);
      existing.recurrences = (existing.recurrences || 1) + 1;
      return existing;
    }
    const scar = {
      id: S.uid('scar'), kind: spec.kind || spec.name,
      name: spec.name, desc: spec.desc || '',
      severity: spec.severity, peak: spec.severity, years: spec.years || 4,
      growth: spec.growth || 0, approval: spec.approval || 0, unrest: spec.unrest || 0,
      qualityDrag: spec.qualityDrag || {},
      deaths: spec.deaths || 0,
      startDay: S.absDay(st.date), startLabel: S.dateLabel(st.date),
      startYear: st.date.year, lastAnniversary: st.date.year,
      tag: spec.tag || 'disaster'
    };
    st.scars.push(scar);
    if (scar.deaths) {
      st.national.totalDeaths = (st.national.totalDeaths || 0) + scar.deaths;
      st.pop.total = Math.max(0.05, st.pop.total - scar.deaths / 1e6);
    }
    return scar;
  };

  /* ------------------------------------------------- ongoing influences */
  /* Scars are meant to be a persistent weight, not an accumulating spiral.
     Each channel is capped so that a run of bad luck stays survivable and
     the country's own condition decides whether it breaks.               */
  A.growthDrag = function (st) {
    let d = 0;
    (st.scars || []).forEach((s) => { d += s.growth * (s.severity / 100); });
    return S.clamp(d, -1.8, 0);
  };
  A.approvalOffset = function (st) {
    let d = 0;
    (st.scars || []).forEach((s) => { d += s.approval * (s.severity / 100); });
    return S.clamp(d, -9, 0);
  };
  A.unrestOffset = function (st) {
    let d = 0;
    (st.scars || []).forEach((s) => { d += s.unrest * (s.severity / 100); });
    return S.clamp(d, 0, 11);
  };
  // Subtracted from a quality stock's funding target, so the thing that was
  // broken stays visibly broken until the scar fades.
  A.qualityDrag = function (st, key) {
    let d = 0;
    (st.scars || []).forEach((s) => {
      if (s.qualityDrag[key]) d += s.qualityDrag[key] * (s.severity / 100);
    });
    return S.clamp(d, -26, 0);
  };

  /* ------------------------------------------------------------- clock */
  A.tick = function (st, dt) {
    st.scars = st.scars || [];
    for (let i = st.scars.length - 1; i >= 0; i--) {
      const s = st.scars[i];
      // Recovery is faster where the state is capable and solvent.
      const capacity = 0.6 + (st.quality.admin / 100) * 0.5 +
        (st.economy.growth > 0 ? 0.2 : -0.2) - (st.economy.financingGap > 0 ? 0.25 : 0);
      s.severity -= (100 / Math.max(0.5, s.years)) * S.clamp(capacity, 0.25, 1.6) * dt;
      if (s.severity <= 3) {
        st.scars.splice(i, 1);
        S.game.event('The country has largely put ' + s.name + ' behind it.', 'good');
        continue;
      }
      // An anniversary is a fact of national life, not a modifier.
      if (st.date.year > s.lastAnniversary && st.date.dayOfYear >= 3 &&
        Math.abs(S.absDay(st.date) - s.startDay) % 365 < 1.5) {
        s.lastAnniversary = st.date.year;
        A.anniversary(st, s);
      }
    }
    A.runScheduled(st);
  };

  A.anniversary = function (st, s) {
    const years = st.date.year - s.startYear;
    if (years < 1) return;
    const ordinal = S.ordinal(years);
    const lines = s.deaths > 0 ? [
      ordinal + ' Anniversary of ' + s.name + ': The Names Are Read Again',
      'A Nation Pauses on the ' + ordinal + ' Anniversary of ' + s.name,
      ordinal + ' Anniversary: Families Still Waiting for Answers on ' + s.name
    ] : [
      ordinal + ' Anniversary of ' + s.name,
      'Recovery from ' + s.name + ' Still Incomplete After ' + years + ' Years'
    ];
    S.News.custom(st, st.rng.pick(lines), s.severity > 45 ? 'bad' : '',
      s.deaths > 0 ? S.people(s.deaths / 1e6) + ' dead · ' + S.round(s.severity, 0) + '/100 of the damage remains'
        : S.round(s.severity, 0) + '/100 of the damage remains');
    // Grief and anger both spike briefly.
    st.society.cohesion += 2;
    if (s.severity > 50) st.society.unrest += 2;
  };

  /* Occasional press recall, used by the ambient news generator. */
  A.recall = function (st) {
    const live = (st.scars || []).filter((s) => s.severity > 12);
    if (!live.length) return false;
    const s = st.rng.pick(live);
    const years = Math.max(1, st.date.year - s.startYear);
    const lines = [
      years + ' Years On, ' + s.name + ' Still Shapes the Budget',
      'Thousands Remain in Temporary Housing Since ' + s.name,
      'Auditors Question the Pace of Recovery from ' + s.name,
      'Region Hit by ' + s.name + ' Reports Continued Population Loss',
      'Survivors of ' + s.name + ' Petition for Compensation'
    ];
    S.News.custom(st, st.rng.pick(lines), 'bad');
    return true;
  };

  /* -------------------------------------------------- deferred matters */
  // Consequences that arrive on a delay: the reconstruction bill, the
  // inquiry that reports two years later, the veterans' settlement.
  A.schedule = function (st, decisionId, ctx, days) {
    st.scheduled = st.scheduled || [];
    st.scheduled.push({ day: S.absDay(st.date) + days, decisionId: decisionId, ctx: ctx || {} });
  };

  A.runScheduled = function (st) {
    if (!st.scheduled || !st.scheduled.length) return;
    const now = S.absDay(st.date);
    for (let i = st.scheduled.length - 1; i >= 0; i--) {
      if (st.scheduled[i].day <= now) {
        const item = st.scheduled[i];
        st.scheduled.splice(i, 1);
        S.game.pushDecision(item.decisionId, item.ctx);
      }
    }
  };

  /* ----------------------------------------- catastrophe rate limiting */
  // A once-in-a-generation event should feel like one. Nothing tagged
  // catastrophic can fire while the country is still absorbing the last.
  A.CATASTROPHE_GAP = 365 * 7;
  A.canCatastrophe = function (st) {
    const last = st.counters.lastCatastropheDay || 0;
    if (!last) return true;
    return (S.absDay(st.date) - last) >= A.CATASTROPHE_GAP;
  };
  A.markCatastrophe = function (st) {
    st.counters.lastCatastropheDay = S.absDay(st.date);
  };

  A.summary = function (st) {
    return (st.scars || []).slice().sort((a, b) => b.severity - a.severity);
  };

})(window.S);

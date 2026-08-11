/* STRATEGIAN — user interface */
(function (S) {
  'use strict';

  const UI = S.UI = {};
  const el = S.el, esc = S.esc;

  UI.view = 'situation';
  UI.railTab = 'news';
  UI.dirty = false;
  UI.pageRefresh = null;

  UI.VIEWS = [
    { id: 'situation', name: 'Situation Room', icon: '◈', group: 'Command' },
    { id: 'treasury', name: 'Treasury', icon: '⛁', group: 'Command' },
    { id: 'economy', name: 'Economy', icon: '⌾', group: 'Command' },
    { id: 'trade', name: 'Trade & Currency', icon: '⇄', group: 'Command' },
    { id: 'interior', name: 'Interior', icon: '⚖', group: 'Home' },
    { id: 'education', name: 'Education & Culture', icon: '❧', group: 'Home' },
    { id: 'energy', name: 'Energy & Environment', icon: '⚡', group: 'Home' },
    { id: 'war', name: 'War Room', icon: '⚔', group: 'External' },
    { id: 'intel', name: 'Intelligence', icon: '◉', group: 'External' },
    { id: 'foreign', name: 'Foreign Ministry', icon: '⚑', group: 'External' },
    { id: 'records', name: 'Records & Objectives', icon: '❋', group: 'Archive' }
  ];

  /* =============================================================== SHELL */
  UI.init = function () {
    const app = document.getElementById('app');
    S.clear(app);
    app.appendChild(el('div.topbar#topbar'));
    const grid = el('div.body-grid#bodyGrid', {}, [
      el('nav.nav#nav'),
      el('main.main#main'),
      el('aside.rail#rail')
    ]);
    app.appendChild(grid);
    app.appendChild(el('div.crawl#crawl', {}, el('div.inner#crawlInner')));
    if (!document.getElementById('toastWrap')) {
      document.body.appendChild(el('div.toast-wrap#toastWrap'));
    }
    UI.buildNav();
    UI.buildRail();
    UI.refreshTopbar();
    UI.render();
    UI.startLoop();
    UI.bindKeys();
  };

  UI.startLoop = function () {
    if (UI._loop) clearInterval(UI._loop);
    UI._loop = setInterval(() => {
      if (!UI.dirty) return;
      UI.dirty = false;
      UI.refreshTopbar();
      UI.refreshNavBadges();
      if (UI.pageRefresh) { try { UI.pageRefresh(); } catch (e) { console.warn(e); } }
      else UI.render();
      UI.renderRail();
      UI.updateCrawl();
    }, 420);
  };

  UI.onTick = function (force) {
    UI.dirty = true;
    if (force) { UI.dirty = false; UI.refreshTopbar(); UI.render(); UI.renderRail(); UI.refreshNavBadges(); }
  };
  UI.onNews = function () { UI.dirty = true; };
  UI.onEvent = function (text, tone) { if (tone === 'bad' || tone === 'good') UI.toast(text, tone); UI.dirty = true; };
  UI.onNewDecision = function (item) {
    UI.toast('New matter: ' + item.def.title, item.urgency === 'urgent' ? 'bad' : '');
    UI.dirty = true;
    if (item.urgency === 'urgent') UI.openDecision(item);
  };

  UI.bindKeys = function () {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const st = S.game.state;
      if (!st || st.ended) return;
      if (e.code === 'Space') { e.preventDefault(); S.game.togglePause(); }
      else if (e.key >= '1' && e.key <= '2') S.game.setSpeed(parseInt(e.key, 10));
      else if (e.key === 'i' || e.key === 'I') { if (st.inbox.length) UI.openDecision(st.inbox[0]); }
    });
  };

  /* ============================================================= TOPBAR */
  UI.refreshTopbar = function () {
    const st = S.game.state;
    const bar = document.getElementById('topbar');
    if (!bar || !st) return;
    const crestLetter = st.nation.name.replace(/^(The )/, '').charAt(0).toUpperCase();

    const chips = [
      { k: 'Approval', v: S.round(st.society.approval, 0) + '%', alarm: st.society.approval < 25, c: st.society.approval > 55 ? 'c-good' : st.society.approval < 32 ? 'c-bad' : '' },
      { k: 'Stability', v: S.round(st.society.stability, 0), alarm: st.society.stability < 30, c: st.society.stability > 60 ? 'c-good' : st.society.stability < 35 ? 'c-bad' : '' },
      { k: 'Growth', v: S.signedPct(st.economy.growth, 1), c: st.economy.growth > 1.5 ? 'c-good' : st.economy.growth < 0 ? 'c-bad' : '' },
      { k: 'Inflation', v: S.round(st.economy.inflation, 1) + '%', alarm: st.economy.inflation > 25, c: st.economy.inflation > 8 ? 'c-bad' : st.economy.inflation < 4 ? 'c-good' : '' },
      { k: 'Unemp.', v: S.round(st.economy.unemployment, 1) + '%', c: st.economy.unemployment > 11 ? 'c-bad' : '' },
      { k: 'Debt/GDP', v: S.round(st.economy.debtGdp, 0) + '%', alarm: st.economy.debtGdp > 160, c: st.economy.debtGdp > 110 ? 'c-bad' : '' },
      { k: 'Treasury', v: S.money(st.economy.reserves), c: st.economy.reserveMonths < 2 ? 'c-bad' : '' },
      { k: 'Prestige', v: S.round(st.national.prestige, 0), c: st.national.prestige > 65 ? 'c-good' : '' },
      { k: 'Unrest', v: S.round(st.society.unrest, 0), alarm: st.society.unrest > 65, c: st.society.unrest > 50 ? 'c-bad' : '' },
      { k: 'Tension', v: S.round(st.world.tension, 0), c: st.world.tension > 60 ? 'c-bad' : '' }
    ];

    bar.innerHTML =
      '<div class="brand"><div class="crest">' + esc(crestLetter) + '</div>' +
      '<div><div class="name">' + esc(st.nation.name) + '</div>' +
      '<div class="sub">' + esc(S.gov(st).name) + '</div></div></div>' +
      '<div class="clockbox"><div class="clock">' + esc(S.dateLabel(st.date)) + '</div>' +
      '<div class="speedctl">' +
      S.game.SPEED_NAMES.map((n, i) =>
        '<button data-speed="' + i + '" title="' + S.game.SPEED_TITLES[i] + '" class="' +
        (i === 0 ? 'pause ' : '') + (st.speed === i ? 'on' : '') + '">' + n + '</button>').join('') +
      '</div></div>' +
      '<div class="stat-strip">' + chips.map((c) =>
        '<div class="stat-chip' + (c.alarm ? ' alarm' : '') + '"><span class="k">' + c.k + '</span>' +
        '<span class="v ' + (c.c || '') + '">' + c.v + '</span></div>').join('') + '</div>' +
      '<div class="topbtns">' +
      '<button class="iconbtn" data-act="save" title="Save game">Save</button>' +
      '<button class="iconbtn" data-act="theme" title="Toggle theme">◐</button>' +
      '<button class="iconbtn" data-act="rail" title="Toggle side panel">▤</button>' +
      '<button class="iconbtn" data-act="menu">Menu</button></div>';

    bar.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.speed != null) S.game.setSpeed(parseInt(b.dataset.speed, 10));
      else if (b.dataset.act === 'save') S.game.saveNow();
      else if (b.dataset.act === 'theme') UI.toggleTheme();
      else if (b.dataset.act === 'rail') document.getElementById('bodyGrid').classList.toggle('rail-collapsed');
      else if (b.dataset.act === 'menu') UI.openMenu();
    };
  };

  UI.toggleTheme = function () {
    // With nothing stamped the page is following the OS, so resolve what the
    // viewer is actually looking at before flipping it.
    const stamped = document.documentElement.getAttribute('data-theme');
    const effective = stamped || (window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = effective === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (S.game.state) S.game.state.settings.theme = next;
    try { localStorage.setItem('strategian.theme', next); } catch (e) { /* ignore */ }
  };

  /* ================================================================ NAV */
  UI.buildNav = function () {
    const nav = document.getElementById('nav');
    S.clear(nav);
    let lastGroup = null;
    UI.VIEWS.forEach((v) => {
      if (v.group !== lastGroup) {
        lastGroup = v.group;
        nav.appendChild(el('div.nav-group.caps', {}, v.group));
      }
      const btn = el('button', { data: { view: v.id }, class: UI.view === v.id ? 'on' : '' }, [
        el('span.ic', {}, v.icon), el('span', {}, v.name), el('span.badge.hidden', { data: { badge: v.id } })
      ]);
      btn.onclick = () => UI.go(v.id);
      nav.appendChild(btn);
    });
    UI.refreshNavBadges();
  };

  UI.refreshNavBadges = function () {
    const st = S.game.state; if (!st) return;
    const counts = {};
    st.inbox.forEach((i) => {
      const map = { budget: 'treasury', economy: 'economy', military: 'war', diplomacy: 'foreign', civic: 'interior', social: 'education', intel: 'intel', crisis: 'situation' };
      const v = map[i.def.cat] || 'situation';
      counts[v] = (counts[v] || 0) + 1;
    });
    S.qsa('[data-badge]').forEach((b) => {
      const n = counts[b.dataset.badge] || 0;
      b.textContent = n;
      b.classList.toggle('hidden', n === 0);
    });
  };

  UI.go = function (view) {
    UI.view = view;
    UI.pageRefresh = null;
    S.qsa('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    UI.render();
  };

  /* =============================================================== RAIL */
  UI.buildRail = function () {
    const rail = document.getElementById('rail');
    S.clear(rail);
    const tabs = el('div.rail-tabs');
    [['news', 'Wire'], ['inbox', 'Desk'], ['log', 'Journal']].forEach(([id, label]) => {
      const b = el('button', { class: UI.railTab === id ? 'on' : '' }, label);
      b.onclick = () => { UI.railTab = id; S.qsa('.rail-tabs button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); UI.renderRail(); };
      tabs.appendChild(b);
    });
    rail.appendChild(tabs);
    rail.appendChild(el('div.rail-body#railBody'));
    UI.renderRail();
  };

  UI.renderRail = function () {
    const st = S.game.state;
    const body = document.getElementById('railBody');
    if (!body || !st) return;
    let h = '';
    if (UI.railTab === 'news') {
      if (!st.headlines.length) h = '<div class="empty">The wire is quiet.</div>';
      st.headlines.slice(0, 40).forEach((n) => {
        h += '<div class="headline ' + (n.severity === 'major' ? 'major ' : '') + esc(n.tone) + '">' +
          '<div class="outlet c-' + n.outletColor + '"><i class="dot"></i>' + esc(n.outlet) + ' · ' + esc(n.date) + '</div>' +
          '<div class="hl">' + esc(n.text) + '</div>' +
          (n.sub ? '<div class="sub">' + esc(n.sub) + '</div>' : '') + '</div>';
      });
    } else if (UI.railTab === 'inbox') {
      if (!st.inbox.length) h = '<div class="empty">Nothing awaiting your decision.</div>';
      st.inbox.forEach((i) => {
        h += '<div class="inbox-item ' + esc(i.urgency === 'urgent' ? 'urgent' : '') + '" data-inbox="' + i.uid + '">' +
          '<div class="t">' + esc(i.def.title) + '</div>' +
          '<div class="m"><span>' + esc(i.def.from || '') + '</span>' +
          '<span class="deadline">' + i.daysLeft + 'd</span></div></div>';
      });
    } else {
      if (!st.log.length) h = '<div class="empty">Nothing recorded yet.</div>';
      h += '<div class="tick-log">';
      st.log.slice(0, 60).forEach((l) => {
        h += '<div class="row"><span class="d">' + esc(l.date) + '</span><span>' +
          (l.event ? esc(l.event) : '<b>' + esc(l.title) + '</b> — ' + esc(l.choice) +
            (l.risk ? ' <span class="c-bad">(' + esc(l.risk) + ')</span>' : '')) + '</span></div>';
      });
      h += '</div>';
    }
    body.innerHTML = h;
    body.onclick = (e) => {
      const item = e.target.closest('[data-inbox]');
      if (!item) return;
      const found = st.inbox.find((i) => i.uid === item.dataset.inbox);
      if (found) UI.openDecision(found);
    };
  };

  UI.updateCrawl = function () {
    const st = S.game.state;
    const inner = document.getElementById('crawlInner');
    if (!inner || !st) return;
    if (UI._crawlDay === st.headlines.length) return;
    UI._crawlDay = st.headlines.length;
    inner.innerHTML = st.headlines.slice(0, 10).map((n) =>
      '<span><b>' + esc(n.outlet.toUpperCase()) + '</b>' + esc(n.text) + '</span>').join('');
  };

  UI.toast = function (text, tone) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const t = el('div.toast' + (tone ? '.' + tone : ''), {}, text.length > 130 ? text.slice(0, 128) + '…' : text);
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3600);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  };

  /* ============================================================ CONTROLS */
  function slider(opts) {
    const st = S.game.state;
    const wrap = el('div.field');
    const val = el('span.val');
    const head = el('div.field-h', {}, [el('label', {}, opts.label), val]);
    const input = el('input', {
      type: 'range', min: opts.min, max: opts.max, step: opts.step || 1,
      value: S.getPath(st, opts.path)
    });
    const fmt = opts.fmt || ((v) => S.round(v, opts.dp || 0) + (opts.unit || ''));
    val.textContent = fmt(parseFloat(input.value));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      S.setPath(st, opts.path, v);
      val.textContent = fmt(v);
      if (opts.onChange) opts.onChange(v);
      UI.dirty = true;
    });
    wrap.appendChild(head);
    wrap.appendChild(input);
    if (opts.desc) wrap.appendChild(el('div.desc', {}, opts.desc));
    return wrap;
  }
  UI.slider = slider;

  function budgetSlider(ministry) {
    const st = S.game.state;
    const m = S.MINISTRIES.find((x) => x.id === ministry);
    const bm = S.Econ.BENCHMARK[ministry];
    const wrap = el('div.field');
    const val = el('span.val');
    const head = el('div.field-h', {}, [el('label', {}, m.icon + '  ' + m.name), val]);
    const input = el('input', {
      type: 'range', min: 0, max: Math.max(12, bm * 3.2), step: 0.05, value: st.budget.alloc[ministry]
    });
    function label(v) {
      const abs = (v / 100) * st.economy.gdp;
      const ratio = v / bm;
      const word = ratio > 1.6 ? 'lavish' : ratio > 1.15 ? 'generous' : ratio > 0.85 ? 'adequate' : ratio > 0.5 ? 'thin' : 'starved';
      return S.round(v, 2) + '% · ' + S.money(abs) + ' · ' + word;
    }
    val.textContent = label(st.budget.alloc[ministry]);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      st.budget.alloc[ministry] = v;
      val.textContent = label(v);
      UI.dirty = true;
    });
    wrap.appendChild(head); wrap.appendChild(input);
    wrap.appendChild(el('div.desc', {}, m.desc + ' Benchmark: ' + bm + '% of GDP.'));
    return wrap;
  }

  function seg(opts) {
    const st = S.game.state;
    const wrap = el('div.field');
    wrap.appendChild(el('div.field-h', {}, [el('label', {}, opts.label)]));
    const box = el('div.seg');
    const desc = el('div.desc');
    function paint() {
      const cur = S.getPath(st, opts.path);
      S.qsa('button', box).forEach((b) => b.classList.toggle('on', b.dataset.v === String(cur)));
      const o = opts.options.find((x) => String(x.v) === String(cur));
      desc.textContent = o ? o.desc || '' : '';
    }
    opts.options.forEach((o) => {
      const b = el('button', { data: { v: o.v } }, o.name);
      b.onclick = () => {
        S.setPath(st, opts.path, o.v);
        paint();
        if (opts.onChange) opts.onChange(o.v);
        UI.dirty = true;
      };
      box.appendChild(b);
    });
    wrap.appendChild(box); wrap.appendChild(desc); paint();
    return wrap;
  }

  function card(title, hint, contentHtml, cls) {
    return '<div class="card ' + (cls || '') + '"><div class="card-h"><h3>' + esc(title) + '</h3>' +
      '<span class="spacer"></span>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>' +
      contentHtml + '</div>';
  }
  UI.card = card;

  function kpi(k, v, d, cls) {
    return '<div class="kpi"><span class="k">' + esc(k) + '</span><span class="v ' + (cls || '') + '">' + v + '</span>' +
      (d ? '<span class="d">' + d + '</span>' : '') + '</div>';
  }

  /* ========================================================= INITIATIVES */
  // Things you start, as opposed to things you answer. Every department that
  // has any gets this panel at the top of its screen.
  UI.initiatives = function (dept) {
    const st = S.game.state;
    const card = el('div.card.accent-gold');
    function paint() {
      const acts = S.Actions.forDept(st, dept);
      let h = '<div class="card-h"><h3>Initiatives</h3><span class="spacer"></span>' +
        '<span class="hint">actions you can take now</span></div>';
      if (!acts.length) { card.innerHTML = h + '<div class="empty">Nothing to launch from here.</div>'; return; }
      h += '<div class="options">';
      acts.forEach((a) => {
        const s = S.Actions.status(st, a);
        h += '<div class="option' + (s.ok ? '' : ' off') + '" data-run="' + a.id + '">' +
          '<div class="ol">' + esc(a.name) +
          (a.danger ? ' <span class="tag c-clay tiny">grave</span>' : '') +
          (a.programme ? ' <span class="tag c-steel tiny">programme</span>' : '') +
          (a.target ? ' <span class="tag c-plum tiny">pick a nation</span>' : '') + '</div>' +
          '<div class="od">' + esc(a.desc) + '</div>' +
          '<div class="oe"><span class="eff">' + esc(S.Actions.costLabel(st, a)) + '</span>' +
          (s.ok ? '' : '<span class="eff risk">' + esc(s.reason) + '</span>') + '</div></div>';
      });
      h += '</div>';
      card.innerHTML = h;
      S.qsa('[data-run]', card).forEach((d) => {
        d.onclick = () => {
          const a = S.Actions.BY_ID[d.dataset.run];
          if (!S.Actions.status(st, a).ok) return;
          UI.launchAction(a, paint);
        };
      });
    }
    paint();
    card._repaint = paint;
    return card;
  };

  UI.launchAction = function (a, after) {
    const st = S.game.state;
    if (a.target === 'nation') {
      const list = st.diplomacy.nations.filter((n) => !a.targetFilter || a.targetFilter(st, n));
      const body = '<div class="brief-text"><p>' + esc(a.desc) + '</p>' +
        '<p class="small dim">' + esc(S.Actions.costLabel(st, a)) + '</p></div>' +
        '<div class="caps" style="margin:14px 0 6px">Choose a target</div><div class="options">' +
        list.map((n) => '<div class="option" data-nat="' + n.id + '">' +
          '<div class="ol"><span class="flagdot c-' + n.color + '" style="background:currentColor"></span> ' + esc(n.name) + '</div>' +
          '<div class="od">' + esc(n.notes) + '</div>' +
          '<div class="oe"><span class="eff">Relations ' + S.round(n.relation, 0) + '</span>' +
          '<span class="eff">Power ' + S.round(n.power, 0) + '</span>' +
          '<span class="eff">Force ' + S.round(n.milPower, 1) + '</span>' +
          (n.allyOfUs ? '<span class="eff pos">Ally</span>' : '') +
          (n.atWar ? '<span class="eff neg">At war</span>' : '') + '</div></div>').join('') +
        '</div>';
      const modal = UI.showModal({
        eyebrow: 'Initiative', title: a.name, body: body,
        footer: [{ label: 'Cancel', cls: 'ghost', act: () => UI.closeModal() }]
      });
      S.qsa('[data-nat]', modal).forEach((d) => {
        d.onclick = () => {
          const n = S.dip(st, d.dataset.nat);
          if (a.confirm && !confirm(a.name + ' — ' + n.name + '. This cannot be undone. Proceed?')) return;
          UI.closeModal();
          const text = S.Actions.run(st, a, n);
          UI.actionResult(a, text, after);
        };
      });
      return;
    }
    if (a.confirm && !confirm(a.name + '. This cannot be undone. Proceed?')) return;
    const text = S.Actions.run(st, a, null);
    UI.actionResult(a, text, after);
  };

  UI.actionResult = function (a, text, after) {
    if (text == null) return;
    UI.showModal({
      eyebrow: 'Initiative', title: a.name,
      body: '<div class="brief-text"><p>' + esc(text) + '</p></div>',
      footer: [{ label: 'Close', cls: 'primary', act: () => { UI.closeModal(); if (after) after(); UI.onTick(true); } }]
    });
  };

  /* Long-running programmes, wherever they are being run from. */
  UI.programmesCard = function (dept) {
    const st = S.game.state;
    const card = el('div.card');
    function paint() {
      const list = (st.programmes || []).filter((p) => !dept || p.dept === dept);
      let h = '<div class="card-h"><h3>Programmes in Progress</h3><span class="spacer"></span>' +
        '<span class="hint">funded every year until they finish</span></div>';
      if (!list.length) {
        card.innerHTML = h + '<div class="empty">No programmes running here.</div>';
        return;
      }
      list.forEach((p) => {
        const pct = S.clamp((p.elapsed / p.years) * 100, 0, 100);
        h += '<div class="li" style="padding:9px 0;border-bottom:1px solid var(--line-soft)">' +
          '<div style="display:flex;gap:8px;align-items:baseline"><b style="font-size:13px">' + esc(p.name) + '</b>' +
          '<span class="spacer" style="flex:1"></span>' +
          '<span class="mono small dim">' + S.round(p.elapsed, 1) + ' / ' + p.years + ' yrs</span></div>' +
          S.meter(pct, { color: 'gold' }) +
          '<div class="small dim" style="margin-top:4px">' + esc(p.desc) + ' · ' +
          S.money((p.costPct / 100) * st.economy.gdp) + ' a year' +
          ' <button class="btn sm ghost" data-cancel="' + p.id + '" style="float:right;margin-top:-4px">Cancel</button></div></div>';
      });
      card.innerHTML = h;
      S.qsa('[data-cancel]', card).forEach((b) => {
        b.onclick = () => {
          if (!confirm('Cancel this programme? Everything spent so far is lost.')) return;
          S.Actions.cancelProgramme(st, b.dataset.cancel);
          paint(); UI.onTick(true);
        };
      });
    }
    paint();
    card._repaint = paint;
    return card;
  };

  UI.initiativeBlock = function (dept, withProgrammes) {
    const wrap = el('div.grid' + (withProgrammes ? '.g2' : ''), { style: { marginTop: '14px' } });
    wrap.appendChild(UI.initiatives(dept));
    if (withProgrammes) wrap.appendChild(UI.programmesCard(dept));
    return wrap;
  };

  /* What the country is still carrying. */
  UI.scarsHtml = function (st) {
    const scars = S.Aftermath.summary(st);
    if (!scars.length) return '<div class="empty">The country is not currently carrying anything.</div>';
    return scars.map((s) => {
      const years = Math.max(0, st.date.year - s.startYear);
      return '<div class="li" style="padding:9px 0;border-bottom:1px solid var(--line-soft)">' +
        '<div style="display:flex;gap:8px;align-items:baseline">' +
        '<b style="font-size:13px">' + esc(s.name) + '</b>' +
        '<span class="spacer" style="flex:1"></span>' +
        '<span class="tiny dim">' + esc(s.startLabel) + (years ? ' · ' + years + 'y ago' : '') + '</span></div>' +
        S.meter(s.severity, { invert: true }) +
        '<div class="small dim" style="margin-top:4px">' + esc(s.desc) + '</div>' +
        '<div class="oe" style="margin-top:5px">' +
        (s.deaths ? '<span class="eff neg">' + S.num(s.deaths) + ' dead</span>' : '') +
        (s.growth ? '<span class="eff neg">Growth ' + S.signed(s.growth * (s.severity / 100), 2) + '</span>' : '') +
        (s.unrest ? '<span class="eff neg">Unrest ' + S.signed(s.unrest * (s.severity / 100), 1) + '</span>' : '') +
        (s.approval ? '<span class="eff neg">Approval ' + S.signed(s.approval * (s.severity / 100), 1) + '</span>' : '') +
        Object.keys(s.qualityDrag || {}).map((k) => '<span class="eff neg">' + esc(S.Decisions.LABELS['quality.' + k] || k) +
          ' ' + S.signed(s.qualityDrag[k] * (s.severity / 100), 0) + '</span>').join('') +
        '</div></div>';
    }).join('');
  };

  function head(title, lede, extra) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' +
      (lede ? '<div class="lede">' + esc(lede) + '</div>' : '') + '</div>' +
      '<span class="spacer"></span>' + (extra || '') + '</div>';
  }

  /* ============================================================== RENDER */
  UI.render = function () {
    const main = document.getElementById('main');
    const st = S.game.state;
    if (!main || !st) return;
    main.scrollTop = UI._scroll && UI._lastView === UI.view ? main.scrollTop : 0;
    UI._lastView = UI.view;
    UI.pageRefresh = null;
    const fn = UI.PAGES[UI.view];
    if (fn) fn(main, st);
  };

  UI.PAGES = {};

  /* --------------------------------------------------- SITUATION ROOM -- */
  UI.PAGES.situation = function (main, st) {
    const h = st.history || {};
    const rank = S.Mil.worldRank(st);
    const myRank = rank.findIndex((x) => x.self) + 1;
    const threats = S.Dip.assessThreats(st).slice(0, 4);

    let html = head('Situation Room',
      'Everything that matters, on one page. ' + S.dateLong(st.date) + '.',
      '<div class="pill-row">' +
      '<span class="tag c-' + (st.society.stability > 60 ? 'sage' : st.society.stability > 35 ? 'gold' : 'clay') + '">Stability ' + S.round(st.society.stability, 0) + '</span>' +
      '<span class="tag c-' + (st.world.tension < 35 ? 'sage' : st.world.tension < 60 ? 'gold' : 'clay') + '">World tension ' + S.round(st.world.tension, 0) + '</span>' +
      (st.wars.length ? '<span class="tag solid c-clay">' + st.wars.length + ' active war' + (st.wars.length > 1 ? 's' : '') + '</span>' : '<span class="tag c-sage">At peace</span>') +
      '</div>');

    html += '<div class="grid g4" style="margin-bottom:14px">';
    html += '<div class="card tight">' + kpi('Output', S.money(st.economy.gdp),
      S.signedPct(st.economy.growth, 1) + ' real · potential ' + S.round(st.economy.potential, 1) + '%',
      st.economy.growth > 1.5 ? 'c-good' : st.economy.growth < 0 ? 'c-bad' : '') +
      S.sparkline(h.gdp || [], { w: 200, h: 34 }) + '</div>';
    html += '<div class="card tight">' + kpi('Public Approval', S.round(st.society.approval, 0) + '%',
      'Legitimacy ' + S.round(st.society.legitimacy, 0) + ' · ' + S.gov(st).name,
      st.society.approval > 55 ? 'c-good' : st.society.approval < 32 ? 'c-bad' : '') +
      S.sparkline(h.approval || [], { w: 200, h: 34 }) + '</div>';
    html += '<div class="card tight">' + kpi('Military Standing', S.ordinal(myRank) + ' of ' + rank.length,
      'Index ' + S.round(st.military.power, 1) + ' · quality ' + S.round(st.military.quality, 0)) +
      S.sparkline(h.milPower || [], { w: 200, h: 34 }) + '</div>';
    html += '<div class="card tight">' + kpi('Fiscal Position', S.round(st.economy.debtGdp, 0) + '% debt',
      'Deficit ' + S.round((st.economy.deficit / st.economy.gdp) * 100, 1) + '% · rating ' + st.economy.creditRating,
      st.economy.debtGdp > 110 ? 'c-bad' : '') +
      S.sparkline(h.debtGdp || [], { w: 200, h: 34, invert: true }) + '</div>';
    html += '</div>';

    html += '<div class="grid g-2-1">';

    // left column
    let left = '';
    if (st.wars.length) {
      let w = '';
      st.wars.forEach((war) => {
        const n = war.enemyId ? S.dip(st, war.enemyId) : null;
        const pos = war.score >= 0;
        w += '<div class="war-front"><div class="wh"><h4>' + esc(war.name) + '</h4>' +
          '<span class="tag c-' + (pos ? 'sage' : 'clay') + '">' + (pos ? 'Advantage' : 'Under pressure') + '</span>' +
          '<span class="spacer"></span><span class="small dim">' + esc(S.Mil.POSTURES[war.posture].name) + '</span></div>' +
          '<div class="warscore"><div class="fill c-' + (pos ? 'sage' : 'clay') + '" style="' +
          (pos ? 'left:50%;width:' + (war.score / 2) + '%' : 'left:' + (50 + war.score / 2) + '%;width:' + (-war.score / 2) + '%') +
          ';background:currentColor"></div><div class="mid"></div>' +
          '<div class="lbl">' + S.signed(war.score, 0) + '</div></div>' +
          '<div class="small dim" style="margin-top:6px">Home support ' + S.round(war.homeSupport, 0) + '% · ' +
          'our losses ' + S.people(war.casualties / 1e6) + ' · costing ' + S.money(war.annualCost) + '/yr' +
          (n ? ' · vs ' + esc(n.name) : '') + '</div></div>';
      });
      left += card('Active Operations', 'War Room for detail', w, 'accent-clay');
    }

    let riskHtml = '';
    [['Coup risk', st.risk.coup], ['Civil war risk', st.risk.civilWar], ['Economic collapse risk', st.risk.collapse],
    ['Latent resentment', st.society.latent], ['Street unrest', st.society.unrest]].forEach(([k, v]) => {
      riskHtml += S.barRow(k, v, 100, v > 60 ? 'crit' : v > 35 ? 'warn' : 'sage', S.round(v, 0));
    });
    left += card('Internal Risk Board', 'Higher is worse', riskHtml,
      (st.risk.coup > 45 || st.risk.civilWar > 45 || st.risk.collapse > 45) ? 'accent-clay' : '');

    if ((st.scars || []).length) {
      left += card('What the Country Is Still Carrying', 'lasting consequences of past events',
        UI.scarsHtml(st), 'accent-clay');
    }

    left += card('The Economy', 'Weekly series', S.lineChart([
      { label: 'Real growth %', values: h.growth || [], color: 'sage' },
      { label: 'Inflation %', values: h.inflation || [], color: 'clay' },
      { label: 'Unemployment %', values: h.unemployment || [], color: 'steel' }
    ], { h: 190, zero: true, legend: true }));

    let logHtml = '<div class="timeline">';
    st.log.slice(0, 9).forEach((l) => {
      logHtml += '<div class="ev ' + esc(l.tone || '') + '"><span class="when">' + esc(l.date) + '</span><br>' +
        (l.event ? esc(l.event) : '<b>' + esc(l.title) + '</b> → ' + esc(l.choice)) + '</div>';
    });
    logHtml += '</div>';
    left += card('Recent Record', '', st.log.length ? logHtml : '<div class="empty">Nothing yet.</div>');

    // right column
    let right = '';
    if (st.inbox.length) {
      let inb = '';
      st.inbox.forEach((i) => {
        inb += '<div class="inbox-item ' + (i.urgency === 'urgent' ? 'urgent' : '') + '" data-inbox="' + i.uid + '">' +
          '<div class="t">' + esc(i.def.title) + '</div><div class="m"><span>' + esc(i.def.from) + '</span>' +
          '<span class="spacer" style="flex:1"></span><span class="deadline">' + i.daysLeft + ' days</span></div></div>';
      });
      right += card('Awaiting Your Decision', st.inbox.length + ' item' + (st.inbox.length > 1 ? 's' : ''), inb, 'accent-gold');
    } else {
      right += card('Awaiting Your Decision', '', '<div class="empty">The desk is clear.</div>');
    }

    let th = '';
    threats.forEach((t) => {
      th += '<div class="li" style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line-soft)">' +
        '<span style="flex:1">' + esc(t.name) + (t.nuclear ? ' <span class="tag c-clay tiny">N</span>' : '') + '</span>' +
        '<span style="width:90px">' + S.meter(t.score, { invert: true }) + '</span>' +
        '<span class="mono small" style="width:32px;text-align:right">' + S.round(t.score, 0) + '</span></div>';
    });
    right += card('Threat Assessment', 'Intel ' + S.round(st.intel.strength, 0), th);

    let fac = '';
    st.factions.slice().sort((a, b) => (a.loyalty - b.loyalty)).slice(0, 5).forEach((f) => {
      const def = S.FACTIONS.find((x) => x.id === f.id);
      fac += S.barRow(def.short || def.name, f.loyalty, 100,
        f.loyalty > 55 ? 'sage' : f.loyalty > 35 ? 'gold' : 'clay',
        S.round(f.loyalty, 0) + ' / infl ' + S.round(f.power, 0));
    });
    right += card('Factional Standing', 'Least loyal first', fac);

    if ((st.programmes || []).length) {
      let pr = '';
      st.programmes.forEach((p) => {
        const pct = S.clamp((p.elapsed / p.years) * 100, 0, 100);
        pr += '<div style="padding:5px 0"><div class="small">' + esc(p.name) + '</div>' +
          S.meter(pct, { color: 'gold' }) +
          '<div class="tiny dim">' + S.round(p.elapsed, 1) + ' of ' + p.years + ' years · ' +
          S.money((p.costPct / 100) * st.economy.gdp) + '/yr</div></div>';
      });
      right += card('Programmes Running', st.programmes.length + ' in delivery', pr, 'accent-steel');
    }

    let vic = '';
    S.VICTORY.forEach((v) => {
      const p = (st.victoryProgress[v.id] || { pct: 0 }).pct;
      vic += '<div class="victory-track"><div class="vh"><span>' + v.icon + '  ' + esc(v.name) + '</span>' +
        '<span class="p">' + S.round(p, 0) + '%</span></div>' + S.meter(p, { color: 'gold' }) + '</div>';
    });
    right += card('Path to Victory', 'Records for detail', vic);

    html += '<div>' + left + '</div><div>' + right + '</div></div>';
    main.innerHTML = html;
    main.onclick = (e) => {
      const t = e.target.closest('[data-inbox]');
      if (t) { const f = st.inbox.find((i) => i.uid === t.dataset.inbox); if (f) UI.openDecision(f); }
    };
  };

  /* --------------------------------------------------------- TREASURY -- */
  UI.PAGES.treasury = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Treasury & Budget',
      'Set what the state spends and how it raises the money. Allocations are shares of national output, so they scale as the economy grows.'));

    const live = el('div#treasuryLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('treasury'));

    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });

    const spendCard = el('div.card');
    spendCard.innerHTML = '<div class="card-h"><h3>Departmental Allocations</h3><span class="spacer"></span>' +
      '<span class="hint">share of GDP</span></div>';
    S.MINISTRIES.forEach((m) => spendCard.appendChild(budgetSlider(m.id)));
    const quick = el('div.btn-row', { style: { marginTop: '10px' } });
    [['Austerity −10%', 0.9], ['Trim −5%', 0.95], ['Expand +5%', 1.05], ['Expand +10%', 1.1]].forEach(([label, mult]) => {
      const b = el('button.btn.sm.ghost', {}, label);
      b.onclick = () => { for (const k in st.budget.alloc) st.budget.alloc[k] = S.round(st.budget.alloc[k] * mult, 2); UI.render(); };
      quick.appendChild(b);
    });
    const reset = el('button.btn.sm.ghost', {}, 'Reset to benchmark');
    reset.onclick = () => { for (const k in S.Econ.BENCHMARK) st.budget.alloc[k] = S.Econ.BENCHMARK[k]; UI.render(); };
    quick.appendChild(reset);
    spendCard.appendChild(quick);

    const taxCard = el('div.card');
    taxCard.innerHTML = '<div class="card-h"><h3>Taxation</h3><span class="spacer"></span><span class="hint">headline rates</span></div>';
    taxCard.appendChild(slider({ label: 'Income & payroll tax', path: 'policy.tax.income', min: 0, max: 60, unit: '%', desc: 'The largest single revenue line in most states. Very high rates push activity into the informal economy.' }));
    taxCard.appendChild(slider({ label: 'Corporate tax', path: 'policy.tax.corporate', min: 0, max: 50, unit: '%', desc: 'Business loyalty and investment respond sharply to this number.' }));
    taxCard.appendChild(slider({ label: 'Consumption tax (VAT)', path: 'policy.tax.vat', min: 0, max: 30, unit: '%', desc: 'Efficient to collect, regressive in effect, felt in every shop.' }));
    taxCard.appendChild(slider({ label: 'Wealth & property tax', path: 'policy.tax.wealth', min: 0, max: 6, step: 0.1, dp: 1, unit: '%', desc: 'Reduces inequality directly. Capital notices immediately.' }));
    taxCard.appendChild(slider({ label: 'Anti-corruption enforcement', path: 'policy.interior.anticorruption', min: 0, max: 100, desc: 'Reduces leakage from every budget line — and makes enemies inside the state.' }));

    grid.appendChild(spendCard); grid.appendChild(taxCard);
    main.appendChild(grid);

    UI.pageRefresh = function () {
      const e = st.economy;
      const rb = e.revenueBreakdown || {};
      const totalAlloc = S.sum(S.MINISTRIES, (m) => st.budget.alloc[m.id]);
      let rows = '';
      const revNames = { income: 'Income & payroll', corporate: 'Corporate', vat: 'Consumption', wealth: 'Wealth & property', tariff: 'Customs duties', state: 'State enterprises', resource: 'Resource rents', other: 'Other receipts' };
      for (const k in revNames) {
        if (rb[k] == null) continue;
        rows += '<tr><td>' + revNames[k] + '</td><td class="num">' + S.money(rb[k]) + '</td>' +
          '<td class="num">' + S.round((rb[k] / e.gdp) * 100, 2) + '%</td></tr>';
      }
      let spendRows = '';
      S.MINISTRIES.forEach((m) => {
        const amt = (st.budget.alloc[m.id] / 100) * e.gdp;
        spendRows += '<tr><td>' + m.icon + ' ' + m.name + '</td><td class="num">' + S.money(amt) + '</td>' +
          '<td class="num">' + S.round(st.budget.alloc[m.id], 2) + '%</td></tr>';
      });
      spendRows += '<tr><td class="c-mute">Debt service</td><td class="num c-mute">' + S.money(e.debtService) + '</td><td class="num c-mute">' + S.round((e.debtService / e.gdp) * 100, 2) + '%</td></tr>';
      if (e.warSpending > 0) spendRows += '<tr><td class="c-bad">War expenditure</td><td class="num c-bad">' + S.money(e.warSpending) + '</td><td class="num c-bad">' + S.round((e.warSpending / e.gdp) * 100, 2) + '%</td></tr>';

      live.innerHTML =
        '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Revenue', S.money(e.revenue), S.round((e.revenue / e.gdp) * 100, 1) + '% of GDP') + '</div>' +
        '<div class="card tight">' + kpi('Spending', S.money(e.spending), S.round((e.spending / e.gdp) * 100, 1) + '% of GDP') + '</div>' +
        '<div class="card tight">' + kpi(e.deficit >= 0 ? 'Deficit' : 'Surplus', S.money(Math.abs(e.deficit)),
          S.round(Math.abs(e.deficit / e.gdp) * 100, 1) + '% of GDP', e.deficit > e.gdp * 0.05 ? 'c-bad' : e.deficit < 0 ? 'c-good' : '') + '</div>' +
        '<div class="card tight">' + kpi('Debt', S.money(e.debt), S.round(e.debtGdp, 0) + '% of GDP · ' + e.creditRating + ' @ ' + S.round(e.bondYield, 1) + '%',
          e.debtGdp > 110 ? 'c-bad' : '') + '</div>' +
        '</div>' +
        '<div class="grid g3">' +
        card('Where the Money Comes From', S.round((e.revenue / e.gdp) * 100, 1) + '% of GDP',
          '<table class="data"><thead><tr><th>Source</th><th class="num">Amount</th><th class="num">% GDP</th></tr></thead><tbody>' + rows + '</tbody></table>') +
        card('Where the Money Goes', S.round(totalAlloc, 1) + '% programme',
          '<table class="data"><thead><tr><th>Department</th><th class="num">Amount</th><th class="num">% GDP</th></tr></thead><tbody>' + spendRows + '</tbody></table>') +
        card('Debt Trajectory', 'weekly',
          S.lineChart([{ label: 'Debt % GDP', values: (st.history || {}).debtGdp || [], color: 'clay', fill: true }], { h: 150 }) +
          S.lineChart([{ label: 'Deficit % GDP', values: (st.history || {}).deficit || [], color: 'gold' }], { h: 120, zero: true }) +
          '<div class="small dim" style="margin-top:6px">Effective rate on the stock: ' + S.round(e.avgDebtRate, 2) + '%. Risk premium ' + S.round(e.riskPremium, 1) + 'pp above policy.</div>') +
        '</div>';
    };
    UI.pageRefresh();
  };

  /* ---------------------------------------------------------- ECONOMY -- */
  UI.PAGES.economy = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Economy & Markets',
      'Monetary policy, the structure of the economy and the state of the markets.'));
    const live = el('div#econLive');
    main.appendChild(live);

    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });

    const mon = el('div.card');
    mon.innerHTML = '<div class="card-h"><h3>Monetary Policy</h3><span class="spacer"></span><span class="hint">the central bank</span></div>';
    const cbWrap = el('div.field');
    cbWrap.appendChild(el('div.field-h', {}, [el('label', {}, 'Control of the central bank')]));
    const cbSeg = el('div.seg');
    const cbDesc = el('div.desc');
    function paintCb() {
      const directed = !!(st.flags.bankDirected || st.flags.bankCaptured);
      S.qsa('button', cbSeg).forEach((b) => b.classList.toggle('on', (b.dataset.v === 'directed') === directed));
      cbDesc.textContent = directed
        ? 'You set the rate yourself. Inflation expectations are no longer anchored — the market prices what you might do, not what a technocrat would.'
        : 'The Bank sets the rate by rule against inflation and the output gap. Stabilising, and out of your hands.';
      const rateInput = S.qs('#rateSlider', mon);
      if (rateInput) rateInput.disabled = !directed;
    }
    [['independent', 'Independent'], ['directed', 'Directed by you']].forEach(([v, name]) => {
      const b = el('button', { data: { v: v } }, name);
      b.onclick = () => {
        if (v === 'directed') {
          if (!st.flags.bankDirected && !confirm('Taking direct control of the central bank permanently damages inflation credibility. Proceed?')) return;
          st.flags.bankDirected = true;
        } else { st.flags.bankDirected = false; st.flags.bankCaptured = false; }
        paintCb(); UI.dirty = true;
      };
      cbSeg.appendChild(b);
    });
    cbWrap.appendChild(cbSeg); cbWrap.appendChild(cbDesc);
    mon.appendChild(cbWrap);

    const rateField = slider({
      label: 'Policy interest rate', path: 'policy.monetary.rate', min: 0, max: 35, step: 0.25, dp: 2, unit: '%',
      desc: 'Above inflation cools prices, strengthens the currency and slows growth. Below it does the reverse.'
    });
    S.qs('input', rateField).id = 'rateSlider';
    mon.appendChild(rateField);
    paintCb();
    mon.appendChild(slider({
      label: 'Monetary emission', path: 'policy.monetary.emission', min: 0, max: 100,
      fmt: (v) => (v < 40 ? 'Tightening' : v > 60 ? 'Expanding' : 'Neutral') + ' (' + v + ')',
      desc: 'How freely the central bank creates money. Sustained expansion is inflation with a delay.'
    }));
    mon.appendChild(seg({
      label: 'Exchange-rate regime', path: 'policy.monetary.regime', options: [
        { v: 'float', name: 'Free float', desc: 'The market sets the rate. Volatile, but it absorbs shocks for you.' },
        { v: 'managed', name: 'Managed float', desc: 'Intervene to smooth movements. Costs reserves in bad weather.' },
        { v: 'peg', name: 'Fixed peg', desc: 'Import price stability and credibility — until a speculative attack drains the reserves.' }
      ]
    }));
    mon.appendChild(slider({
      label: 'Capital controls', path: 'policy.monetary.capitalControls', min: 0, max: 100,
      desc: 'Restricting money leaving stabilises the currency and terrifies investors.'
    }));

    const str = el('div.card');
    str.innerHTML = '<div class="card-h"><h3>Economic Structure</h3><span class="spacer"></span><span class="hint">how the economy is organised</span></div>';
    str.appendChild(slider({ label: 'State ownership', path: 'policy.econ.stateOwnership', min: 0, max: 100, desc: 'Revenue and control, at a cost to productivity and business loyalty.' }));
    str.appendChild(slider({ label: 'Regulation', path: 'policy.econ.regulation', min: 0, max: 100, desc: 'Protects consumers, workers and the environment; slows the formation of new firms.' }));
    str.appendChild(slider({ label: 'Labour protection', path: 'policy.econ.laborProtection', min: 0, max: 100, desc: 'Job security for those in work, at the cost of structural unemployment for those outside it.' }));
    str.appendChild(slider({ label: 'Subsidies', path: 'policy.econ.subsidies', min: 0, max: 100, desc: 'Holds down prices and props up employment. Expensive, and politically almost impossible to reverse.' }));
    const pc = el('label.check');
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!st.policy.econ.priceControls;
    cb.onchange = () => { st.policy.econ.priceControls = cb.checked; UI.dirty = true; };
    pc.appendChild(cb); pc.appendChild(document.createTextNode('Price controls on essential goods (suppresses measured inflation, creates shortages)'));
    str.appendChild(pc);

    grid.appendChild(mon); grid.appendChild(str);
    main.appendChild(grid);

    const reportBtn = el('div.btn-row', { style: { marginTop: '14px' } });
    const rb = el('button.btn.primary', {}, 'Read the Treasury Quarterly Assessment');
    rb.onclick = () => UI.showBriefing(S.Brief.economic(st));
    reportBtn.appendChild(rb);
    main.appendChild(reportBtn);

    UI.pageRefresh = function () {
      const e = st.economy, h = st.history || {};
      // Keep the rate slider in step when the Bank is setting it.
      const rateInput = document.getElementById('rateSlider');
      if (rateInput && rateInput.disabled) {
        rateInput.value = st.policy.monetary.rate;
        const lbl = rateInput.parentNode.querySelector('.val');
        if (lbl) lbl.textContent = S.round(st.policy.monetary.rate, 2) + '%';
      }
      let sect = '';
      const secNames = { agri: 'Agriculture', industry: 'Industry', services: 'Services', resources: 'Resources & energy', tech: 'Technology' };
      for (const k in e.sectors) sect += S.barRow(secNames[k], e.sectors[k], 70, 'steel', S.round(e.sectors[k], 1) + '%');

      live.innerHTML =
        '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Real Growth', S.signedPct(e.growth, 1), 'Potential ' + S.round(e.potential, 1) + '%', e.growth > 1.5 ? 'c-good' : e.growth < 0 ? 'c-bad' : '') + S.sparkline(h.growth || [], { w: 200, h: 30 }) + '</div>' +
        '<div class="card tight">' + kpi('Inflation', S.round(e.inflation, 1) + '%', 'Target path ' + S.round(e.inflationTarget || 0, 1) + '%', e.inflation > 8 ? 'c-bad' : 'c-good') + S.sparkline(h.inflation || [], { w: 200, h: 30, invert: true }) + '</div>' +
        '<div class="card tight">' + kpi('Unemployment', S.round(e.unemployment, 1) + '%', 'Informal sector ' + S.round(e.informal, 0) + '%', e.unemployment > 10 ? 'c-bad' : '') + S.sparkline(h.unemployment || [], { w: 200, h: 30, invert: true }) + '</div>' +
        '<div class="card tight">' + kpi('Market Index', S.round(e.marketIndex, 0), 'Yield ' + S.round(e.bondYield, 2) + '% · ' + e.creditRating) + S.sparkline(h.market || [], { w: 200, h: 30 }) + '</div>' +
        '</div>' +
        '<div class="grid g3">' +
        card('Output and Prices', 'weekly series',
          S.lineChart([{ label: 'Real GDP', values: h.gdp || [], color: 'gold', fill: true }], { h: 150 })) +
        card('Sectoral Composition', S.round(S.Econ.gdpPerCapita(st), 0) + ' per head', sect +
          '<div class="small dim" style="margin-top:8px">Productivity index ' + S.round(e.productivity, 0) +
          ' · business confidence ' + S.round(e.businessConfidence, 0) + ' · consumer confidence ' + S.round(e.consumerConfidence, 0) + '</div>') +
        card('Markets', 'equities and rates',
          S.lineChart([{ label: 'Equity index', values: h.market || [], color: 'sage' }], { h: 150 }) +
          '<div class="small dim" style="margin-top:6px">Policy rate ' + S.round(st.policy.monetary.rate, 2) + '% · sovereign yield ' +
          S.round(e.bondYield, 2) + '% · risk premium ' + S.round(e.riskPremium, 1) + 'pp</div>') +
        '</div>';
    };
    UI.pageRefresh();
  };

  /* ------------------------------------------------------------ TRADE -- */
  UI.PAGES.trade = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Trade & Currency',
      'Tariffs, market access, the exchange rate, and who you are willing to do business with.'));
    const live = el('div#tradeLive');
    main.appendChild(live);

    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });
    const pol = el('div.card');
    pol.innerHTML = '<div class="card-h"><h3>Trade Policy</h3></div>';
    pol.appendChild(slider({ label: 'Average tariff', path: 'policy.trade.tariff', min: 0, max: 40, step: 0.5, dp: 1, unit: '%', desc: 'Protects domestic producers, raises revenue, raises prices, invites retaliation.' }));
    pol.appendChild(slider({ label: 'Non-tariff openness', path: 'policy.trade.openness', min: 0, max: 100, desc: 'Standards, licensing, procurement rules — the barriers nobody photographs.' }));
    pol.appendChild(slider({ label: 'Foreign aid', path: 'policy.foreign.aid', min: 0, max: 100, desc: 'Buys goodwill in poorer states, particularly effective at building affinity.' }));
    pol.appendChild(seg({
      label: 'Diplomatic stance', path: 'policy.foreign.stance', options: [
        { v: 'isolationist', name: 'Isolationist', desc: 'Stay out of everything. Others stop seeing you as a threat, and stop seeing you at all.' },
        { v: 'defensive', name: 'Defensive', desc: 'Engage where our interests are directly affected.' },
        { v: 'engaged', name: 'Engaged', desc: 'Active diplomacy across the board. Improves relations broadly.' },
        { v: 'interventionist', name: 'Interventionist', desc: 'Shape events abroad. Prestige and reach, at the price of resentment.' }
      ]
    }));

    const cur = el('div.card');
    cur.innerHTML = '<div class="card-h"><h3>The Currency</h3><span class="spacer"></span><span class="hint">' + esc(st.economy.currencyName) + '</span></div>';
    const nameRow = el('div.field');
    nameRow.appendChild(el('div.field-h', {}, [el('label', {}, 'Name and symbol')]));
    const rowBox = el('div', { style: { display: 'flex', gap: '8px' } });
    const nameIn = el('input', { type: 'text', value: st.economy.currencyName });
    const symIn = el('input', { type: 'text', value: st.economy.currencySymbol, style: { maxWidth: '70px' } });
    nameIn.oninput = () => { st.economy.currencyName = nameIn.value || 'Unit'; UI.dirty = true; };
    symIn.oninput = () => { st.economy.currencySymbol = symIn.value.slice(0, 3) || '¤'; UI.dirty = true; };
    rowBox.appendChild(nameIn); rowBox.appendChild(symIn);
    nameRow.appendChild(rowBox);
    nameRow.appendChild(el('div.desc', {}, 'Redenominating is cosmetic; what the currency is worth is decided by everything else on this screen.'));
    cur.appendChild(nameRow);
    cur.appendChild(el('div#fxReadout'));

    grid.appendChild(pol); grid.appendChild(cur);
    main.appendChild(grid);

    const partners = el('div.card', { style: { marginTop: '14px' } });
    main.appendChild(partners);

    UI.pageRefresh = function () {
      const e = st.economy, h = st.history || {};
      live.innerHTML =
        '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Exports', S.money(e.exports), S.round((e.exports / e.gdp) * 100, 1) + '% of GDP') + '</div>' +
        '<div class="card tight">' + kpi('Imports', S.money(e.imports), S.round((e.imports / e.gdp) * 100, 1) + '% of GDP') + '</div>' +
        '<div class="card tight">' + kpi('Trade Balance', S.money(e.tradeBalance), e.tradeBalance >= 0 ? 'Surplus' : 'Deficit', e.tradeBalance >= 0 ? 'c-good' : 'c-bad') + '</div>' +
        '<div class="card tight">' + kpi('Reserves', S.money(e.reserves), S.round(e.reserveMonths, 1) + ' months of imports', e.reserveMonths < 3 ? 'c-bad' : '') + '</div>' +
        '</div>';

      const fx = document.getElementById('fxReadout');
      if (fx) {
        fx.innerHTML = '<div class="kpi-row" style="margin:6px 0 8px">' +
          kpi('Exchange rate', S.round(e.fx, 1), 'launch = 100 · equilibrium ' + S.round(e.fxTarget || 100, 1),
            e.fx > 95 ? 'c-good' : e.fx < 70 ? 'c-bad' : '') + '</div>' +
          S.lineChart([{ label: 'Currency index', values: h.fx || [], color: 'gold' }], { h: 130 }) +
          (e.pegStrain > 5 ? '<div class="notice bad" style="margin-top:8px">The peg is under strain (' + S.round(e.pegStrain, 0) + '/100). Reserves are being consumed to hold it.</div>' : '') +
          '<div class="small dim" style="margin-top:6px">Reserve-currency status ' + S.round(e.reserveStatus, 0) +
          '/100 · sanctions pressure ' + S.round(e.sanctionPressure, 0) + ' · market access ' + S.round((e.marketAccess || 0) * 100, 0) + '%</div>';
      }

      let rows = '';
      st.diplomacy.nations.slice().sort((a, b) => b.tradeVolume - a.tradeVolume).forEach((n) => {
        rows += '<tr><td class="nat-row"><span class="flagdot c-' + n.color + '" style="background:currentColor"></span>' + esc(n.name) + '</td>' +
          '<td class="num">' + S.money(n.tradeVolume) + '</td>' +
          '<td>' + S.divergeBar(n.relation) + '</td>' +
          '<td class="num">' + S.round(n.relation, 0) + '</td>' +
          '<td><div class="seg" data-nat="' + n.id + '">' +
          ['preferred', 'normal', 'restricted', 'embargo'].map((s) =>
            '<button data-status="' + s + '" class="' + (n.tradeStatus === s ? 'on' : '') + '">' +
            s.charAt(0).toUpperCase() + s.slice(1) + '</button>').join('') +
          '</div></td></tr>';
      });
      partners.innerHTML = '<div class="card-h"><h3>Trading Partners</h3><span class="spacer"></span>' +
        '<span class="hint">preferential status improves relations and volumes; embargo cuts both</span></div>' +
        '<table class="data"><thead><tr><th>Partner</th><th class="num">Volume</th><th style="width:150px">Relations</th><th class="num"></th><th style="width:330px">Trade status</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
      partners.onclick = (ev) => {
        const b = ev.target.closest('button[data-status]');
        if (!b) return;
        const id = b.closest('[data-nat]').dataset.nat;
        const n = S.dip(st, id);
        if (!n || n.atWar) return;
        n.tradeStatus = b.dataset.status;
        if (b.dataset.status === 'embargo') { n.relation -= 15; n.grievance = (n.grievance || 0) + 10; S.News.custom(st, 'Trade Embargo Imposed on ' + n.name, ''); }
        if (b.dataset.status === 'preferred') n.relation += 6;
        UI.pageRefresh();
      };
    };
    UI.pageRefresh();
  };

  /* --------------------------------------------------------- INTERIOR -- */
  UI.PAGES.interior = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Interior & Society',
      'Policing, liberties, information — and the balance of power between the groups whose consent you govern with.'));
    const live = el('div#intLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('interior', true));

    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });
    const sec = el('div.card');
    sec.innerHTML = '<div class="card-h"><h3>Internal Security</h3><span class="spacer"></span><span class="hint" id="repRead"></span></div>';
    sec.appendChild(slider({ label: 'Policing', path: 'policy.interior.policing', min: 0, max: 100, desc: 'Reduces crime and suppresses disorder. Beyond a point it becomes the grievance.' }));
    sec.appendChild(slider({ label: 'Surveillance', path: 'policy.interior.surveillance', min: 0, max: 100, desc: 'Improves intelligence and pre-empts plots. Builds resentment that does not show up on any chart until it does.' }));
    sec.appendChild(slider({ label: 'Civil liberties', path: 'policy.interior.civilLiberties', min: 0, max: 100, desc: 'Assembly, association, due process. Educated populations react badly to their removal.' }));
    sec.appendChild(slider({ label: 'Press freedom', path: 'policy.interior.pressFreedom', min: 0, max: 100, desc: 'A free press reduces corruption and tells you things nobody else will. It also reports what you would rather it did not.' }));
    sec.appendChild(slider({ label: 'State messaging', path: 'policy.interior.propaganda', min: 0, max: 100, desc: 'Props up approval and cohesion. Effectiveness collapses where the press is genuinely free.' }));
    sec.appendChild(slider({ label: 'Immigration openness', path: 'policy.interior.immigration', min: 0, max: 100, desc: 'Population and labour supply against cohesion and the nationalist bloc.' }));

    const soc = el('div.card');
    soc.innerHTML = '<div class="card-h"><h3>Social Settlement</h3></div>';
    soc.appendChild(slider({ label: 'Traditionalism in law', path: 'policy.social.traditionalism', min: 0, max: 100, desc: 'Where the family, personal status and moral statutes sit. Traditional authority and reformers pull in opposite directions.' }));
    soc.appendChild(slider({ label: 'Devolution to regions', path: 'policy.social.devolution', min: 0, max: 100, desc: 'Buys provincial loyalty; costs administrative coherence.' }));
    soc.appendChild(slider({ label: 'Family and natal policy', path: 'policy.social.familyPolicy', min: 0, max: 100, desc: 'Raises birth rates over decades. Nothing here changes anything this term.' }));
    soc.appendChild(el('div#factionBox'));

    grid.appendChild(sec); grid.appendChild(soc);
    main.appendChild(grid);

    UI.pageRefresh = function () {
      const s = st.society;
      const rep = S.Soc.repression(st);
      const rr = document.getElementById('repRead');
      if (rr) rr.textContent = 'Repression index ' + S.round(rep, 0) + '/100';

      live.innerHTML = '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Unrest', S.round(s.unrest, 0), 'Latent resentment ' + S.round(s.latent, 0), s.unrest > 55 ? 'c-bad' : 'c-good') + '</div>' +
        '<div class="card tight">' + kpi('Legitimacy', S.round(s.legitimacy, 0), 'from ' + S.govMods(st).legitimacyFrom) + '</div>' +
        '<div class="card tight">' + kpi('Corruption', S.round(s.corruption, 0), 'Admin capacity ' + S.round(st.quality.admin, 0), s.corruption > 55 ? 'c-bad' : '') + '</div>' +
        '<div class="card tight">' + kpi('Freedom', S.round(s.freedom, 0), 'Inequality ' + S.round(s.inequality, 0)) + '</div>' +
        '</div>' +
        '<div class="grid g3">' +
        card('Social Indicators', '', [
          ['Public approval', s.approval, 'sage'], ['Stability', s.stability, 'sage'], ['National cohesion', s.cohesion, 'gold'],
          ['Inequality', s.inequality, 'clay'], ['Crime', s.crime, 'clay'], ['Security quality', st.quality.security, 'steel'],
          ['Welfare provision', st.quality.welfareQ, 'steel']
        ].map(([k, v, c]) => S.barRow(k, v, 100, c, S.round(v, 0))).join('')) +
        card('Unrest and Resentment', 'weekly',
          S.lineChart([
            { label: 'Unrest', values: (st.history || {}).unrest || [], color: 'clay' },
            { label: 'Stability', values: (st.history || {}).stability || [], color: 'sage' }
          ], { h: 160, legend: true, min: 0, max: 100 }) +
          (s.latent > 55 ? '<div class="notice bad" style="margin-top:8px">Resentment is far ahead of visible unrest. Control is holding the lid down, not solving anything.</div>' : '')) +
        card('Population', S.people(st.pop.total) + ' people',
          S.barRow('Urban share', st.pop.urban, 100, 'steel', S.round(st.pop.urban, 0) + '%') +
          S.barRow('Working age', st.pop.workingAge, 100, 'sage', S.round(st.pop.workingAge, 0) + '%') +
          S.barRow('Youth share', st.pop.youthShare, 35, 'gold', S.round(st.pop.youthShare, 0) + '%') +
          '<div class="small dim" style="margin-top:8px">Population growth ' + S.signedPct(st.pop.growth, 2) +
          ' a year. A large youth share with poor employment is the raw material of unrest.</div>') +
        '</div>';

      const fb = document.getElementById('factionBox');
      if (fb) {
        let f = '<div class="caps" style="margin:14px 0 6px">Factions</div>';
        st.factions.forEach((x) => {
          const def = S.FACTIONS.find((d) => d.id === x.id);
          f += '<div class="li" style="padding:6px 0;border-bottom:1px solid var(--line-soft)">' +
            '<div style="display:flex;gap:8px;align-items:center"><span style="flex:1;font-size:12.5px">' + esc(def.name) + '</span>' +
            '<span class="mono tiny dim">infl ' + S.round(x.power, 0) + '</span>' +
            '<span style="width:90px">' + S.meter(x.loyalty) + '</span>' +
            '<span class="mono small" style="width:26px;text-align:right">' + S.round(x.loyalty, 0) + '</span></div>' +
            '<div class="tiny dim" style="margin-top:2px">' + esc(def.desc) + '</div></div>';
        });
        fb.innerHTML = f;
      }
    };
    UI.pageRefresh();
  };

  /* -------------------------------------------------------- EDUCATION -- */
  UI.PAGES.education = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Education, Health & Culture',
      'The slow instruments. Nothing here pays back inside one term, and everything long-run depends on it.'));
    const live = el('div#eduLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('social', true));

    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });
    const b = el('div.card');
    b.innerHTML = '<div class="card-h"><h3>Human Capital Budgets</h3></div>';
    ['education', 'health', 'research', 'culture', 'welfare'].forEach((m) => b.appendChild(budgetSlider(m)));

    const p = el('div.card');
    p.innerHTML = '<div class="card-h"><h3>Education & Culture Policy</h3></div>';
    p.appendChild(slider({ label: 'University share of education spend', path: 'policy.social.eduUniversity', min: 0, max: 100, unit: '%', desc: 'Weighting toward higher education and research over basic schooling. Elite capability against broad attainment.' }));
    p.appendChild(el('div#softBox'));

    grid.appendChild(b); grid.appendChild(p);
    main.appendChild(grid);

    UI.pageRefresh = function () {
      const q = st.quality;
      live.innerHTML = '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Education', S.round(q.education, 0), S.rateWord(q.education, ['failing', 'weak', 'adequate', 'strong', 'world-class'])) + '</div>' +
        '<div class="card tight">' + kpi('Health', S.round(q.health, 0), S.rateWord(q.health, ['failing', 'weak', 'adequate', 'strong', 'world-class'])) + '</div>' +
        '<div class="card tight">' + kpi('Science', S.round(q.science, 0), S.rateWord(q.science, ['negligible', 'limited', 'competent', 'advanced', 'frontier'])) + '</div>' +
        '<div class="card tight">' + kpi('Culture', S.round(q.culture, 0), 'Soft power ' + S.round(st.national.softPower, 0)) + '</div>' +
        '</div>' +
        '<div class="grid g2">' +
        card('Service Quality', 'stocks move over years, not months', [
          ['Education', q.education], ['Health', q.health], ['Infrastructure', q.infra], ['Science & research', q.science],
          ['Culture', q.culture], ['Welfare provision', q.welfareQ], ['Energy system', q.energy], ['Administrative capacity', q.admin],
          ['Public security', q.security]
        ].map(([k, v]) => S.barRow(k, v, 100, v > 65 ? 'sage' : v > 40 ? 'gold' : 'clay', S.round(v, 0))).join('')) +
        card('Soft Power Reach', 'nations by cultural affinity',
          '<table class="data"><thead><tr><th>Nation</th><th style="width:130px">Affinity</th><th class="num">Score</th></tr></thead><tbody>' +
          st.diplomacy.nations.slice().sort((a, c) => c.affinity - a.affinity).map((n) =>
            '<tr><td>' + esc(n.name) + '</td><td>' + S.meter(n.affinity, { color: n.affinity >= 60 ? 'sage' : 'gold' }) + '</td>' +
            '<td class="num' + (n.affinity >= 60 ? ' c-good' : '') + '">' + S.round(n.affinity, 0) + '</td></tr>').join('') +
          '</tbody></table>' +
          '<div class="small dim" style="margin-top:8px">Cultural dominance requires eight nations at affinity 60 or above. Currently ' +
          st.diplomacy.nations.filter((n) => n.affinity >= 60).length + '.</div>') +
        '</div>';
      const sb = document.getElementById('softBox');
      if (sb) sb.innerHTML = '<div class="notice" style="margin-top:12px">Culture, education and prestige together drive the cultural victory. ' +
        'Broadcasting and exchange programmes appear as decisions when the culture budget is generous.</div>';
    };
    UI.pageRefresh();
  };

  /* ----------------------------------------------------------- ENERGY -- */
  UI.PAGES.energy = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Energy & Environment',
      'Where the power comes from, what it costs, and what it does to the weather your successors inherit.'));
    const live = el('div#enLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('infra', true));
    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });
    const c1 = el('div.card');
    c1.innerHTML = '<div class="card-h"><h3>Energy Policy</h3></div>';
    c1.appendChild(budgetSlider('energy'));
    c1.appendChild(budgetSlider('infra'));
    c1.appendChild(slider({ label: 'Transition to clean generation', path: 'policy.energy.transition', min: 0, max: 100, desc: 'Reduces climate stress globally and import dependence at home. Costs growth in the near term.' }));
    c1.appendChild(slider({ label: 'Strategic reserves', path: 'policy.energy.reserves', min: 0, max: 100, desc: 'Insurance against a shock. Expensive insurance.' }));
    const c2 = el('div.card#enRead');
    grid.appendChild(c1); grid.appendChild(c2);
    main.appendChild(grid);

    UI.pageRefresh = function () {
      const e = st.economy, w = st.world;
      live.innerHTML = '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Energy System', S.round(st.quality.energy, 0), 'Import dependence ' + S.round(e.energyImportDep, 0) + '%') + '</div>' +
        '<div class="card tight">' + kpi('World Oil Price', S.round(w.oil, 0), 'index, 100 = baseline', w.oil > 140 ? 'c-bad' : '') + '</div>' +
        '<div class="card tight">' + kpi('World Grain Price', S.round(w.grain, 0), 'index', w.grain > 140 ? 'c-bad' : '') + '</div>' +
        '<div class="card tight">' + kpi('Climate Stress', S.round(w.climate, 0), 'raises disaster frequency', w.climate > 55 ? 'c-bad' : '') + '</div>' +
        '</div>';
      const box = document.getElementById('enRead');
      if (box) box.innerHTML = '<div class="card-h"><h3>Commodity Exposure</h3></div>' +
        S.lineChart([{ label: 'Oil price index', values: (st.history || {}).oil || [], color: 'clay' }], { h: 160 }) +
        '<div class="small dim" style="margin-top:8px">Resource sector is ' + S.round(e.sectors.resources, 1) +
        '% of output. ' + (e.sectors.resources > 15
          ? 'A falling oil price is a fiscal emergency for us; a rising one is a windfall.'
          : 'We are a net energy importer: rising prices feed straight into inflation.') + '</div>' +
        '<div class="notice" style="margin-top:12px">Climate stress rises on its own and faster when the world burns more. It drives the frequency of disaster events worldwide.</div>';
    };
    UI.pageRefresh();
  };

  /* --------------------------------------------------------- WAR ROOM -- */
  UI.PAGES.war = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('War Room',
      'Force structure, doctrine, and the conduct of any war you happen to be fighting.'));
    const live = el('div#warLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('war'));

    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });
    const c1 = el('div.card');
    c1.innerHTML = '<div class="card-h"><h3>Force Policy</h3></div>';
    c1.appendChild(budgetSlider('defense'));
    c1.appendChild(seg({
      label: 'Doctrine', path: 'policy.mil.doctrine',
      options: Object.keys(S.Mil.DOCTRINES).map((k) => ({ v: k, name: S.Mil.DOCTRINES[k].name, desc: S.Mil.DOCTRINES[k].desc }))
    }));
    c1.appendChild(seg({
      label: 'Nuclear posture', path: 'policy.mil.nuclearPosture',
      options: Object.keys(S.Mil.NUCLEAR_POSTURES).map((k) => ({
        v: k, name: S.Mil.NUCLEAR_POSTURES[k].name,
        desc: 'Deterrent value ' + S.Mil.NUCLEAR_POSTURES[k].deter + ' · world tension ' + S.signed(S.Mil.NUCLEAR_POSTURES[k].tension, 0)
      }))
    }));
    c1.appendChild(slider({ label: 'Conscription', path: 'policy.mil.conscription', min: 0, max: 100, desc: 'Mass at the cost of quality, and of the productive years of a generation.' }));
    c1.appendChild(slider({ label: 'Readiness target', path: 'policy.mil.readinessTarget', min: 0, max: 100, desc: 'High readiness is expensive to hold and impossible to sustain without funding.' }));
    c1.appendChild(slider({ label: 'R&D share of defence budget', path: 'policy.mil.rndShare', min: 0, max: 60, unit: '%', desc: 'Trades present equipment numbers for future technological edge.' }));
    c1.appendChild(slider({ label: 'Personnel and veteran support', path: 'policy.mil.veteranCare', min: 0, max: 100, desc: 'Morale, retention, and the loyalty of the officer corps.' }));

    const c2 = el('div.card#warOps');
    grid.appendChild(c1); grid.appendChild(c2);
    main.appendChild(grid);

    const btns = el('div.btn-row', { style: { marginTop: '14px' } });
    const bb = el('button.btn.primary', {}, 'Read the Chief of Staff\'s Situation Brief');
    bb.onclick = () => UI.showBriefing(S.Brief.military(st));
    btns.appendChild(bb);
    main.appendChild(btns);

    const ranks = el('div.card', { style: { marginTop: '14px' } });
    main.appendChild(ranks);

    UI.pageRefresh = function () {
      const m = st.military;
      const rank = S.Mil.worldRank(st);
      live.innerHTML = '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Force Index', S.round(m.power, 1), S.ordinal(rank.findIndex((x) => x.self) + 1) + ' in the world') + '</div>' +
        '<div class="card tight">' + kpi('Readiness', S.round(m.readiness, 0), 'Morale ' + S.round(m.morale, 0), m.readiness < 40 ? 'c-bad' : '') + '</div>' +
        '<div class="card tight">' + kpi('Manpower', S.round(m.manpower * 1000, 0) + 'k', 'Equipment ' + S.round(m.equipment, 0) + ' · tech ' + S.round(m.tech, 0)) + '</div>' +
        '<div class="card tight">' + kpi('Defence Spend', S.money(m.spendAbs), S.round(st.budget.alloc.defense, 2) + '% of GDP') + '</div>' +
        '</div>';

      const ops = document.getElementById('warOps');
      if (ops) {
        let h = '<div class="card-h"><h3>Operations</h3></div>';
        if (!st.wars.length) {
          h += '<div class="empty">No active operations. The forces are training.</div>';
          h += '<div class="notice" style="margin-top:8px">War is started by events, ultimatums or your own decisions — see the Foreign Ministry to declare one deliberately.</div>';
        } else {
          st.wars.forEach((w) => {
            const n = w.enemyId ? S.dip(st, w.enemyId) : null;
            h += '<div class="war-front" data-war="' + w.id + '">' +
              '<div class="wh"><h4>' + esc(w.name) + '</h4><span class="spacer"></span>' +
              '<span class="tag c-' + (w.score > 20 ? 'sage' : w.score < -20 ? 'clay' : 'gold') + '">' + S.signed(w.score, 0) + '</span></div>' +
              '<div class="warscore"><div class="fill c-' + (w.score >= 0 ? 'sage' : 'clay') + '" style="' +
              (w.score >= 0 ? 'left:50%;width:' + (w.score / 2) + '%' : 'left:' + (50 + w.score / 2) + '%;width:' + (-w.score / 2) + '%') +
              ';background:currentColor"></div><div class="mid"></div></div>' +
              '<div class="caps" style="margin:10px 0 4px">Posture</div><div class="seg">' +
              Object.keys(S.Mil.POSTURES).map((k) =>
                '<button data-posture="' + k + '" class="' + (w.posture === k ? 'on' : '') + '">' + S.Mil.POSTURES[k].name + '</button>').join('') +
              '</div><div class="desc" style="margin-top:4px">' + esc(S.Mil.POSTURES[w.posture].desc) + '</div>' +
              '<div class="grid g2" style="margin-top:10px;gap:6px">' +
              '<div class="small dim">Home support <b class="' + (w.homeSupport < 35 ? 'c-bad' : '') + '">' + S.round(w.homeSupport, 0) + '%</b></div>' +
              '<div class="small dim">Exhaustion <b>' + S.round(w.exhaustion, 0) + '</b></div>' +
              '<div class="small dim">Our losses <b>' + S.people(w.casualties / 1e6) + '</b></div>' +
              '<div class="small dim">Enemy losses <b>' + S.people(w.enemyCasualties / 1e6) + '</b></div>' +
              '<div class="small dim">Cost <b>' + S.money(w.annualCost) + '</b>/yr</div>' +
              '<div class="small dim">Intensity <b>' + S.round(w.intensity, 0) + '</b></div>' +
              '</div>' +
              (n ? '<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-sue="' + w.id + '">Seek terms</button></div>' : '') +
              (w.events.length ? '<div class="caps" style="margin:12px 0 4px">Field reports</div>' +
                w.events.slice(0, 4).map((e2) => '<div class="small ' + (e2.tone === 'good' ? 'c-sage' : e2.tone === 'bad' ? 'c-clay' : 'dim') + '">' +
                  esc(e2.date) + ' — ' + esc(e2.text) + '</div>').join('') : '') +
              '</div>';
          });
        }
        ops.innerHTML = h;
        ops.onclick = (ev) => {
          const pb = ev.target.closest('button[data-posture]');
          if (pb) {
            const w = st.wars.find((x) => x.id === pb.closest('[data-war]').dataset.war);
            if (w) { w.posture = pb.dataset.posture; w.intensity = S.clamp(w.intensity + (pb.dataset.posture === 'full' ? 15 : pb.dataset.posture === 'withdraw' ? -25 : 0), 15, 100); UI.pageRefresh(); }
            return;
          }
          const sb = ev.target.closest('button[data-sue]');
          if (sb) {
            const w = st.wars.find((x) => x.id === sb.dataset.sue);
            if (w && w.enemyId) { S.Nego.open(st, 'peace', w.enemyId, { war: w.id }); S.game.setSpeed(0); UI.openNegotiation(); }
          }
        };
      }

      let rows = '';
      rank.forEach((r, i) => {
        rows += '<tr' + (r.self ? ' style="background:var(--panel-2)"' : '') + '><td class="num">' + (i + 1) + '</td>' +
          '<td>' + (r.self ? '<b class="c-gold">' + esc(r.name) + ' (us)</b>' : esc(r.name)) + '</td>' +
          '<td style="width:200px">' + S.meter((r.power / Math.max(1, rank[0].power)) * 100, { color: r.self ? 'gold' : 'steel' }) + '</td>' +
          '<td class="num">' + S.round(r.power, 1) + '</td></tr>';
      });
      ranks.innerHTML = '<div class="card-h"><h3>Comparative Force Ratings</h3><span class="spacer"></span>' +
        '<span class="hint">military dominance requires a lead of 20 over the second power</span></div>' +
        '<table class="data"><thead><tr><th class="num">#</th><th>Nation</th><th>Relative power</th><th class="num">Index</th></tr></thead><tbody>' + rows + '</tbody></table>';
    };
    UI.pageRefresh();
  };

  /* ------------------------------------------------------ INTELLIGENCE -- */
  UI.PAGES.intel = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Intelligence',
      'What we know, how confident we are, and how much of it is wrong.'));
    const live = el('div#intelLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('intel', true));
    const grid = el('div.grid.g2', { style: { marginTop: '14px' } });
    const c1 = el('div.card');
    c1.innerHTML = '<div class="card-h"><h3>Service Funding</h3></div>';
    c1.appendChild(budgetSlider('intel'));
    c1.appendChild(budgetSlider('interior'));
    c1.appendChild(el('div.notice', {}, 'Collection quality also depends on administrative capacity, surveillance powers and any intelligence-sharing treaties you hold.'));
    const c2 = el('div.card#intelRead');
    grid.appendChild(c1); grid.appendChild(c2);
    main.appendChild(grid);

    const btns = el('div.btn-row', { style: { marginTop: '14px' } });
    const bb = el('button.btn.primary', {}, 'Read the Daily Intelligence Summary');
    bb.onclick = () => UI.showBriefing(S.Brief.intelligence(st));
    btns.appendChild(bb);
    main.appendChild(btns);

    UI.pageRefresh = function () {
      live.innerHTML = '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Collection Capability', S.round(st.intel.strength, 0), S.rateWord(st.intel.strength, ['blind', 'poor', 'workmanlike', 'capable', 'formidable'])) + '</div>' +
        '<div class="card tight">' + kpi('Product Reliability', S.round(st.intel.accuracy * 100, 0) + '%', S.Brief.confidenceWord(st.intel.accuracy)) + '</div>' +
        '<div class="card tight">' + kpi('Counter-Intelligence', S.round(st.quality.security, 0), st.intel.compartmented ? 'Compartmented' : 'Standard handling') + '</div>' +
        '<div class="card tight">' + kpi('Coup Risk', S.round(st.risk.coup, 0), 'General staff loyalty ' + S.round(S.Soc.militaryLoyalty(st), 0), st.risk.coup > 40 ? 'c-bad' : '') + '</div>' +
        '</div>';
      const box = document.getElementById('intelRead');
      if (box) {
        const threats = S.Dip.assessThreats(st);
        box.innerHTML = '<div class="card-h"><h3>Threat Board</h3><span class="spacer"></span><span class="hint">estimates, not facts</span></div>' +
          '<table class="data"><thead><tr><th>Nation</th><th style="width:120px">Threat</th><th class="num">Score</th><th class="num">Force ratio</th><th>Posture</th></tr></thead><tbody>' +
          threats.map((t) => '<tr><td>' + esc(t.name) + (t.nuclear ? ' <span class="tag c-clay tiny">nuclear</span>' : '') + '</td>' +
            '<td>' + S.meter(t.score, { invert: true }) + '</td><td class="num">' + S.round(t.score, 0) + '</td>' +
            '<td class="num">' + S.round(t.ratio, 2) + '</td><td class="small dim">' + esc(t.stance) + '</td></tr>').join('') +
          '</tbody></table>' +
          (st.intel.accuracy < 0.5 ? '<div class="notice warn" style="margin-top:10px">At this level of capability, a meaningful share of the above is simply wrong. Fund the service or treat every line as a rumour.</div>' : '');
      }
    };
    UI.pageRefresh();
  };

  /* ----------------------------------------------------------- FOREIGN -- */
  UI.PAGES.foreign = function (main, st) {
    S.clear(main);
    main.insertAdjacentHTML('beforeend', head('Foreign Ministry',
      'Relations, treaties and the instruments of persuasion short of war.'));
    const live = el('div#forLive');
    main.appendChild(live);
    main.appendChild(UI.initiativeBlock('foreign'));
    const table = el('div.card', { style: { marginTop: '14px' } });
    main.appendChild(table);

    UI.pageRefresh = function () {
      live.innerHTML = '<div class="grid g4" style="margin-bottom:14px">' +
        '<div class="card tight">' + kpi('Prestige', S.round(st.national.prestige, 0), 'Soft power ' + S.round(st.national.softPower, 0)) + '</div>' +
        '<div class="card tight">' + kpi('World Tension', S.round(st.world.tension, 0), (st.world.globalWars || 0) + ' wars worldwide', st.world.tension > 60 ? 'c-bad' : 'c-good') + '</div>' +
        '<div class="card tight">' + kpi('Treaties in Force', st.diplomacy.treaties.length, 'World peace requires 10') + '</div>' +
        '<div class="card tight">' + kpi('Allies', st.diplomacy.nations.filter((n) => n.allyOfUs).length, 'Sanctions against us: ' + st.diplomacy.nations.filter((n) => n.sanctioningUs).length) + '</div>' +
        '</div>' +
        (st.negotiation ? '<div class="notice warn" style="margin-bottom:14px">A negotiation is in progress. <button class="btn sm" id="resumeNego">Return to the table</button></div>' : '');
      const rn = document.getElementById('resumeNego');
      if (rn) rn.onclick = () => UI.openNegotiation();

      let rows = '';
      st.diplomacy.nations.slice().sort((a, b) => b.relation - a.relation).forEach((n) => {
        const tr = n.treaties.map((t) => '<span class="tag c-steel tiny">' + esc(S.Dip.TREATIES[t].name.split(' ')[0]) + '</span>').join(' ');
        rows += '<tr data-nat="' + n.id + '"><td class="nat-row"><span class="flagdot c-' + n.color + '" style="background:currentColor"></span><b>' + esc(n.name) + '</b>' +
          (n.nuclear ? ' <span class="tag c-clay tiny">N</span>' : '') + (n.allyOfUs ? ' <span class="tag c-sage tiny">Ally</span>' : '') +
          (n.atWar ? ' <span class="tag solid c-clay tiny">At war</span>' : '') + (n.sanctioningUs ? ' <span class="tag c-clay tiny">Sanctions</span>' : '') +
          '<div class="tiny dim">' + esc(n.notes) + '</div></td>' +
          '<td class="num">' + S.round(n.power, 0) + '</td>' +
          '<td style="width:140px">' + S.divergeBar(n.relation) + '</td><td class="num">' + S.round(n.relation, 0) + '</td>' +
          '<td class="num">' + S.round(n.affinity, 0) + '</td>' +
          '<td class="small dim">' + esc(n.stance) + '</td>' +
          '<td>' + (tr || '<span class="c-mute tiny">none</span>') + '</td>' +
          '<td><button class="btn sm ghost" data-open="' + n.id + '">Options</button></td></tr>';
      });
      table.innerHTML = '<div class="card-h"><h3>Foreign Powers</h3><span class="spacer"></span>' +
        '<span class="hint">relations drive trade, alliances and the chance they act against you</span></div>' +
        '<table class="data"><thead><tr><th>Nation</th><th class="num">Power</th><th>Relations</th><th class="num"></th>' +
        '<th class="num">Affinity</th><th>Posture</th><th>Treaties</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      table.onclick = (ev) => {
        const b = ev.target.closest('button[data-open]');
        if (b) UI.nationOptions(S.dip(st, b.dataset.open));
      };
    };
    UI.pageRefresh();
  };

  UI.nationOptions = function (n) {
    const st = S.game.state;
    const acts = [];
    if (!n.atWar) {
      acts.push({ label: 'Propose a trade agreement', desc: 'Open formal negotiations on tariffs and market access.', can: n.treaties.indexOf('trade') < 0 && n.relation > -40, run: () => { S.Nego.open(st, 'trade', n.id, {}); UI.closeModal(); S.game.setSpeed(0); UI.openNegotiation(); } });
      acts.push({ label: 'Propose a defence pact', desc: 'Negotiate a mutual defence relationship.', can: n.treaties.indexOf('defense') < 0 && n.relation > 25, run: () => { S.Nego.open(st, 'alliance', n.id, {}); UI.closeModal(); S.game.setSpeed(0); UI.openNegotiation(); } });
      acts.push({ label: 'Propose arms control', desc: 'Negotiate ceilings and inspection. Lowers world tension.', can: (n.nuclear || st.military.nuclear > 20) && n.relation > -50, run: () => { S.Nego.open(st, 'arms', n.id, {}); UI.closeModal(); S.game.setSpeed(0); UI.openNegotiation(); } });
      acts.push({ label: 'Negotiate an energy contract', desc: 'Long-term supply or offtake at a negotiated price.', can: n.relation > -30, run: () => { S.Nego.open(st, 'resource', n.id, {}); UI.closeModal(); S.game.setSpeed(0); UI.openNegotiation(); } });
      acts.push({
        label: 'Sign a non-aggression pact', desc: 'A written promise not to attack one another.',
        can: n.treaties.indexOf('nonagg') < 0 && n.relation > -20,
        run: () => { S.Dip.signTreaty(st, n.id, 'nonagg'); UI.closeModal(); UI.pageRefresh(); }
      });
      acts.push({
        label: 'Sign a cultural accord', desc: 'Exchange programmes and media access. Builds affinity over time.',
        can: n.treaties.indexOf('culture') < 0 && n.relation > 0,
        run: () => { S.Dip.signTreaty(st, n.id, 'culture'); n.affinity += 8; UI.closeModal(); UI.pageRefresh(); }
      });
      acts.push({
        label: 'Propose intelligence sharing', desc: 'Improves the reliability of our product.',
        can: n.treaties.indexOf('intel') < 0 && n.relation > 40,
        run: () => { S.Dip.signTreaty(st, n.id, 'intel'); UI.closeModal(); UI.pageRefresh(); }
      });
      acts.push({
        label: 'Send a goodwill package', desc: 'Aid, credit and a state visit. Costs reserves, buys relations.',
        can: st.economy.reserves > st.economy.gdp * 0.006,
        run: () => { st.economy.reserves -= st.economy.gdp * 0.006; n.relation += 10; n.affinity += 3; S.game.event('A goodwill package was despatched to ' + n.name + '.', 'good'); UI.closeModal(); UI.pageRefresh(); }
      });
      acts.push({
        label: 'Impose sanctions', desc: 'Cut them off. Damages both economies and hardens their position.',
        can: n.tradeStatus !== 'embargo',
        run: () => { n.tradeStatus = 'embargo'; n.relation -= 25; n.grievance = (n.grievance || 0) + 20; st.world.tension += 4; S.News.custom(st, 'Sanctions Imposed on ' + n.name, ''); UI.closeModal(); UI.pageRefresh(); }
      });
      acts.push({
        label: 'Deliver an ultimatum', desc: 'Demand a change in their behaviour and open crisis talks.',
        can: st.military.power > n.milPower * 0.6,
        run: () => { st.national.aggressionScore += 10; S.Nego.open(st, 'ultimatum', n.id, { aggressor: true }); UI.closeModal(); S.game.setSpeed(0); UI.openNegotiation(); }
      });
      acts.push({
        label: 'Declare war', desc: 'The final instrument. There is no undo.', danger: true,
        can: n.relation < 10,
        run: () => {
          if (!confirm('Declare war on ' + n.name + '? This cannot be undone.')) return;
          S.Mil.startWar(st, n.id, { aggressor: true, intensity: 60, homeSupport: 55 });
          st.national.aggressionScore += 25;
          st.diplomacy.nations.forEach((o) => { if (o.id !== n.id) o.relation -= 12; });
          UI.closeModal(); UI.go('war');
        }
      });
    }
    if (n.treaties.length) {
      n.treaties.forEach((t) => {
        acts.push({
          label: 'Withdraw from the ' + S.Dip.TREATIES[t].name, desc: 'Tearing up a treaty is noticed by everyone, not only by them.',
          danger: true, can: true,
          run: () => { S.Dip.breakTreaty(st, n.id, t); UI.closeModal(); UI.pageRefresh(); }
        });
      });
    }

    const body = '<div class="brief-text"><p>' + esc(n.notes) + '</p>' +
      '<p class="small dim">Power ' + S.round(n.power, 0) + ' · military index ' + S.round(n.milPower, 1) +
      ' · GDP ' + S.money(n.gdp) + ' · ideology ' + esc(n.ideology) + ' · negotiating character ' + esc(n.personality) +
      ' · relations ' + S.round(n.relation, 0) + ' · affinity ' + S.round(n.affinity, 0) +
      ' · grievance ' + S.round(n.grievance || 0, 0) + '</p></div>' +
      '<div class="options">' + acts.filter((a) => a.can).map((a, i) =>
        '<div class="option" data-act="' + i + '"><div class="ol">' + esc(a.label) +
        (a.danger ? ' <span class="tag c-clay tiny">grave</span>' : '') + '</div>' +
        '<div class="od">' + esc(a.desc) + '</div></div>').join('') + '</div>';

    const modal = UI.showModal({
      eyebrow: 'Foreign Ministry', title: n.name, body: body,
      footer: [{ label: 'Close', cls: 'ghost', act: () => UI.closeModal() }]
    });
    const usable = acts.filter((a) => a.can);
    S.qsa('[data-act]', modal).forEach((d) => {
      d.onclick = () => usable[parseInt(d.dataset.act, 10)].run();
    });
  };

  /* ----------------------------------------------------------- RECORDS -- */
  UI.PAGES.records = function (main, st) {
    let html = head('Records & Objectives',
      'The route to victory, the record of your decisions, and the archive of what was printed about them.');

    html += '<div class="grid g3" style="margin-bottom:14px">';
    S.VICTORY.forEach((v) => {
      const p = st.victoryProgress[v.id] || { pct: 0, parts: [] };
      html += '<div class="card accent-gold"><div class="card-h"><h3>' + v.icon + '  ' + esc(v.name) + '</h3>' +
        '<span class="spacer"></span><span class="hint mono">' + S.round(p.pct, 0) + '%</span></div>' +
        S.meter(p.pct, { color: 'gold' }) +
        '<div class="small dim" style="margin:10px 0">' + esc(v.blurb) + '</div>' +
        (p.parts || []).map((x) => '<div class="assess-row"><span class="k">' + esc(x.k) + '</span>' +
          '<span class="v ' + (x.ok ? 'c-good' : '') + '">' + esc(x.v) + (x.ok ? ' ✓' : '') + '</span></div>').join('') +
        '</div>';
    });
    html += '</div>';

    html += '<div class="grid g2">';
    html += '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-h"><h3>National Memory</h3><span class="spacer"></span>' +
      '<span class="hint">events the country has not finished absorbing</span></div>' +
      UI.scarsHtml(st) +
      ((st.national.totalDeaths || 0) ? '<div class="notice bad" style="margin-top:12px">Total dead from disasters, attacks and war during this administration: <b>' +
        S.num(st.national.totalDeaths) + '</b>.</div>' : '') + '</div>';

    let dec = '';
    st.log.filter((l) => l.title).slice(0, 40).forEach((l) => {
      dec += '<div class="li" style="padding:8px 0;border-bottom:1px solid var(--line-soft)">' +
        '<div class="small"><b>' + esc(l.title) + '</b></div>' +
        '<div class="small dim">' + esc(l.date) + ' · ' + esc(l.cat) + ' → ' + esc(l.choice) +
        (l.risk ? ' <span class="c-bad">(' + esc(l.risk) + ')</span>' : '') + '</div></div>';
    });
    html += card('Decision Record', st.log.filter((l) => l.title).length + ' rulings', dec || '<div class="empty">No decisions yet.</div>');

    let arch = '';
    st.headlines.slice(0, 50).forEach((n) => {
      arch += '<div class="li" style="padding:6px 0;border-bottom:1px solid var(--line-soft)">' +
        '<div class="tiny c-' + n.outletColor + '">' + esc(n.outlet) + ' · ' + esc(n.date) + '</div>' +
        '<div class="small serif">' + esc(n.text) + '</div></div>';
    });
    html += card('Press Archive', st.headlines.length + ' items', arch || '<div class="empty">Nothing printed yet.</div>');
    html += '</div>';

    html += '<div class="card" style="margin-top:14px"><div class="card-h"><h3>The Administration</h3></div>' +
      '<div class="grid g4">' +
      kpi('In office since', String(st.startYear), S.round((S.absDay(st.date) - st.startYear * 365) / 365, 1) + ' years') +
      kpi('Wars won / lost', (st.national.warsWon || 0) + ' / ' + (st.national.warsLost || 0), 'Diplomatic wins ' + st.national.diplomaticWins + ' / losses ' + st.national.diplomaticLosses) +
      kpi('Government', S.gov(st).name, st.nation.leaderTitle + ' ' + st.nation.leader) +
      kpi('Last election', st.national.lastElection ? st.national.lastElection.year + ' — ' + st.national.lastElection.share + '%' : '—',
        S.govMods(st).elections ? 'Every ' + S.govMods(st).elections + ' years' : 'No elections') +
      '</div>' +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn" id="btnSave">Save</button>' +
      '<button class="btn ghost" id="btnExport">Export save file</button>' +
      '<button class="btn ghost" id="btnImport">Import save file</button>' +
      '<button class="btn danger" id="btnNew">Abandon and start over</button>' +
      '</div></div>';

    main.innerHTML = html;
    document.getElementById('btnSave').onclick = () => S.game.saveNow();
    document.getElementById('btnExport').onclick = () => S.game.exportSave();
    document.getElementById('btnNew').onclick = () => { if (confirm('Abandon this game and return to setup?')) { S.game.setSpeed(0); S.game.deleteSave(); UI.showSetup(); } };
    document.getElementById('btnImport').onclick = () => {
      const inp = el('input', { type: 'file', accept: '.json' });
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          try { S.game.deserialise(fr.result); UI.init(); UI.toast('Save loaded.'); }
          catch (e) { UI.toast('Could not read that save file.', 'bad'); }
        };
        fr.readAsText(f);
      };
      inp.click();
    };
  };

  /* ============================================================= MODALS */
  UI.showModal = function (opts) {
    UI.closeModal();
    const overlay = el('div.overlay#overlay');
    const modal = el('div.modal' + (opts.wide ? '.wide' : ''));
    modal.innerHTML =
      '<div class="modal-h">' + (opts.eyebrow ? '<div class="eyebrow"><span class="caps">' + esc(opts.eyebrow) + '</span>' +
        (opts.tags || '') + '</div>' : '') + '<h2>' + esc(opts.title) + '</h2>' +
      (opts.sub ? '<div class="small dim" style="margin-top:4px">' + opts.sub + '</div>' : '') + '</div>' +
      '<div class="modal-b">' + opts.body + '</div>' +
      '<div class="modal-f"></div>';
    const foot = S.qs('.modal-f', modal);
    (opts.footer || []).forEach((f) => {
      const b = el('button.btn' + (f.cls ? '.' + f.cls : ''), {}, f.label);
      b.onclick = f.act;
      if (f.id) b.id = f.id;
      foot.appendChild(b);
    });
    if (!opts.footer || !opts.footer.length) foot.style.display = 'none';
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && !opts.sticky) UI.closeModal(); });
    document.body.appendChild(overlay);
    return modal;
  };
  UI.closeModal = function () {
    const o = document.getElementById('overlay');
    if (o) o.parentNode.removeChild(o);
  };

  /* -------------------------------------------------- decision modal -- */
  UI.effectChips = function (option) {
    let chips = '';
    if (option.effects) {
      for (const path in option.effects) {
        const v = option.effects[path];
        if (!v) continue;
        const label = S.Decisions.LABELS[path] || path.split('.').pop();
        chips += '<span class="eff ' + (v > 0 ? 'pos' : 'neg') + '">' + esc(label) + ' ' + S.signed(v, Math.abs(v) < 1 ? 2 : 0) + '</span>';
      }
    }
    if (option.factions) {
      for (const f in option.factions) {
        const v = option.factions[f];
        chips += '<span class="eff ' + (v > 0 ? 'pos' : 'neg') + '">' + esc(S.Decisions.FACTION_LABEL[f] || f) + ' ' + S.signed(v, 0) + '</span>';
      }
    }
    if (option.risk) chips += '<span class="eff risk">' + S.round(option.risk.p * 100, 0) + '% risk: ' + esc(option.risk.text) + '</span>';
    if (option.opensNegotiation) chips += '<span class="eff">opens negotiations</span>';
    return chips;
  };

  UI.openDecision = function (item) {
    const st = S.game.state;
    if (st.ended) return;
    S.game.pauseForDecision();
    const def = item.def;
    const brief = typeof def.brief === 'function' ? def.brief(st, item.ctx) : (def.brief || '');
    const advisors = def.advisors ? def.advisors(st, item.ctx) : [];
    const opts = S.game.availableOptions(st, item);

    let body = '<div class="brief-text">' + brief + '</div>';
    if (advisors.length) {
      body += '<div class="advisors">' + advisors.map((a) =>
        '<div class="advisor"><div class="who"><b>' + esc(a.who) + '</b>' + esc(a.role || '') + '</div>' +
        '<div class="said">“' + esc(a.said) + '”</div></div>').join('') + '</div>';
    }
    body += '<div class="caps" style="margin:16px 0 6px">Your ruling</div><div class="options">';
    opts.forEach((o, i) => {
      body += '<div class="option" data-opt="' + i + '"><div class="ol">' + esc(o.label) + '</div>' +
        '<div class="od">' + esc(o.detail || '') + '</div>' +
        '<div class="oe">' + UI.effectChips(o) + '</div></div>';
    });
    body += '</div>';

    const tags = '<span class="tag c-' + (item.urgency === 'urgent' ? 'clay' : item.urgency === 'pressing' ? 'gold' : 'steel') + '">' +
      esc(item.urgency) + '</span><span class="deadline">' + item.daysLeft + ' days to decide</span>';

    const modal = UI.showModal({
      eyebrow: (def.from || 'Cabinet Office') + ' · ' + item.arrived,
      title: def.title, tags: tags, body: body, sticky: true,
      footer: [{ label: 'Defer the decision', cls: 'ghost', act: () => UI.closeModal() }]
    });

    S.qsa('[data-opt]', modal).forEach((d) => {
      d.onclick = () => {
        const o = opts[parseInt(d.dataset.opt, 10)];
        UI.closeModal();
        S.game.resolveDecision(item, o);
        UI.toast('Ruling recorded: ' + o.label);
        UI.onTick(true);
      };
    });
  };

  /* ------------------------------------------------------- briefings -- */
  UI.showBriefing = function (brief) {
    let body = '<div class="small dim" style="margin-bottom:12px">' +
      '<b class="c-clay">' + esc(brief.classification) + '</b> · ' + esc(brief.date) +
      (brief.confidence ? ' · ' + esc(brief.confidence) : '') + '</div>';
    brief.sections.forEach((s) => {
      body += '<div class="caps" style="margin:16px 0 6px">' + esc(s.h) + '</div>';
      body += '<div class="brief-text">' + s.body.map((b) => '<p>' + b + '</p>').join('') + '</div>';
    });
    UI.showModal({
      eyebrow: 'Briefing', title: brief.title, body: body, wide: true,
      footer: [{ label: 'Close', cls: 'ghost', act: () => UI.closeModal() }]
    });
  };

  /* ===================================================== NEGOTIATION UI */
  UI.openNegotiation = function () {
    const st = S.game.state;
    const nego = st.negotiation;
    if (!nego) return;
    S.game.setSpeed(0);
    UI.renderNegotiation();
  };

  UI.renderNegotiation = function () {
    const st = S.game.state;
    const nego = st.negotiation;
    if (!nego) { UI.closeModal(); return; }
    const n = S.dip(st, nego.nationId);
    S.Nego.computeLeverage(st, nego);
    const chance = S.Nego.acceptChance(nego, nego.offer);
    const yourU = S.Nego.yourUtility(nego, nego.offer);
    const theirU = S.Nego.theirUtility(nego, nego.offer);
    const viol = S.Nego.redlineViolations(nego, nego.offer);

    let issuesHtml = '';
    nego.issues.forEach((i) => {
      const v = nego.offer[i.id];
      const theirs = nego.theirOffer[i.id];
      const gap = v - theirs;
      const showRedline = nego.revealLevel > 0;
      issuesHtml += '<div class="nego-issue"><div class="ih"><b>' + esc(i.label) + '</b>' +
        '<span class="tag c-steel tiny">worth ' + S.round(i.weightYou, 0) + ' to us</span>' +
        (nego.revealLevel > 1 ? '<span class="tag c-clay tiny">worth ' + S.round(i.weightThem, 0) + ' to them</span>' : '') +
        '<span class="imp">gap ' + S.signed(gap, 0) + '</span></div>' +
        '<div class="small dim" style="margin-bottom:6px">' + esc(i.desc) + '</div>' +
        '<div class="nego-track" data-issue="' + i.id + '">' +
        '<div class="rail-line"></div>' +
        '<div class="theirs" style="left:calc(' + theirs + '% - 1.5px)" title="Their current position"></div>' +
        (showRedline ? '<div class="redline" style="left:calc(' + i.redline + '% - 1px)" title="Assessed red line"></div>' : '') +
        '<input type="range" min="0" max="100" value="' + v + '" data-slider="' + i.id + '">' +
        '</div>' +
        '<div class="nego-scale"><span>' + esc(i.fmt(0)) + '</span>' +
        '<span class="c-gold mono">' + esc(i.fmt(v)) + '</span>' +
        '<span>' + esc(i.fmt(100)) + '</span></div>' +
        '<div class="tiny dim">Their text: ' + esc(i.fmt(theirs)) + '</div></div>';
    });

    let levHtml = '';
    nego.leverageFactors.filter((f) => Math.abs(f.delta) > 0.6).slice(0, 8).forEach((f) => {
      levHtml += '<div class="assess-row"><span class="k">' + esc(f.label) + (f.note ? ' — <i>' + esc(f.note) + '</i>' : '') + '</span>' +
        '<span class="v ' + (f.delta > 0 ? 'c-good' : 'c-bad') + '">' + S.signed(f.delta, 1) + '</span></div>';
    });

    let transcript = '';
    nego.transcript.slice(-9).forEach((t) => {
      if (t.who === 'sys') transcript += '<div class="msg sys">' + esc(t.text) + '</div>';
      else transcript += '<div class="msg ' + t.who + '"><div class="sp">' +
        (t.who === 'them' ? esc(n ? n.name : 'Counterparty') : 'Our delegation') + '</div>' + esc(t.text) + '</div>';
    });

    const actions = S.Nego.ACTIONS.filter((a) => a.can(st) && nego.usedActions.indexOf(a.id) < 0);

    const body = '<div class="nego">' +
      '<div><div class="caps" style="margin-bottom:4px">The Text on the Table</div>' + issuesHtml +
      '<div class="caps" style="margin:16px 0 6px">Transcript</div><div class="transcript">' + transcript + '</div>' +
      '<div class="caps" style="margin:16px 0 6px">Instruments</div>' +
      '<div class="options">' + (actions.length ? actions.map((a, i) =>
        '<div class="option" data-nact="' + i + '"><div class="ol">' + esc(a.name) + '</div>' +
        '<div class="od">' + esc(a.desc) + '</div><div class="oe"><span class="eff risk">' + esc(a.cost(st)) + '</span></div></div>').join('')
        : '<div class="empty">Every instrument has been used.</div>') + '</div>' +
      '</div>' +
      '<div>' +
      '<div class="card tight"><div class="caps">Live Assessment</div>' +
      '<div class="small dim" style="margin:6px 0">Their negotiating character: <b>' + esc(nego.personality) + '</b></div>' +
      '<div class="assess-row"><span class="k">Our leverage</span><span class="v">' + S.round(nego.leverageOurs, 0) + '</span></div>' +
      S.meter(nego.leverageOurs, { color: nego.leverageOurs > 55 ? 'sage' : nego.leverageOurs < 45 ? 'clay' : 'gold' }) +
      '<div class="assess-row" style="margin-top:8px"><span class="k">Value of this text to us</span><span class="v">' + S.round(yourU * 100, 0) + '%</span></div>' +
      '<div class="assess-row"><span class="k">Value to them</span><span class="v">' + S.round(theirU * 100, 0) + '%</span></div>' +
      '<div class="assess-row"><span class="k">Their minimum</span><span class="v">' + S.round(S.Nego.reservation(nego) * 100, 0) + '%</span></div>' +
      '<div class="assess-row"><span class="k">Trust</span><span class="v">' + S.round(nego.trust, 0) + '</span></div>' +
      '<div class="assess-row"><span class="k">Rounds</span><span class="v">' + nego.round + ' / ' + nego.maxRounds + ' · patience ' + nego.patience + '</span></div>' +
      '<div class="caps" style="margin-top:10px">Probability they accept</div>' +
      '<div class="accept-gauge"><i style="width:' + S.round(chance * 100, 0) + '%"></i></div>' +
      '<div class="mono small">' + S.round(chance * 100, 0) + '%</div>' +
      (viol.length ? '<div class="notice bad" style="margin-top:10px">Crosses an assessed red line on: ' +
        viol.map((x) => esc(x.label)).join(', ') + '</div>' : '') +
      '</div>' +
      '<div class="card tight" style="margin-top:12px"><div class="caps">Balance of Leverage</div>' + levHtml + '</div>' +
      '</div></div>';

    const modal = UI.showModal({
      eyebrow: 'Negotiation · round ' + (nego.round + 1),
      title: S.Nego.title(st, nego), body: body, wide: true, sticky: true,
      footer: [
        { label: 'Accept their text', cls: 'ghost', id: 'negoAccept', act: () => { S.Nego.acceptTheirs(st, nego); UI.finishNegotiation(); } },
        { label: 'Walk away', cls: 'danger', act: () => { if (confirm('Leave the table without agreement?')) { nego.status = 'walked'; UI.finishNegotiation(); } } },
        { label: 'Table this offer', cls: 'primary', act: () => UI.submitNego() }
      ]
    });

    S.qsa('input[data-slider]', modal).forEach((inp) => {
      inp.addEventListener('input', () => {
        nego.offer[inp.dataset.slider] = parseInt(inp.value, 10);
        UI.renderNegotiationLive(modal);
      });
      inp.addEventListener('change', () => UI.renderNegotiation());
    });
    S.qsa('[data-nact]', modal).forEach((d) => {
      d.onclick = () => {
        const a = actions[parseInt(d.dataset.nact, 10)];
        nego.usedActions.push(a.id);
        const line = a.run(st, nego);
        nego.transcript.push({ who: 'sys', text: line });
        UI.renderNegotiation();
      };
    });
  };

  // Light-touch update while dragging so the gauges track the sliders.
  UI.renderNegotiationLive = function (modal) {
    const st = S.game.state, nego = st.negotiation;
    if (!nego) return;
    const chance = S.Nego.acceptChance(nego, nego.offer);
    const g = S.qs('.accept-gauge i', modal);
    if (g) g.style.width = S.round(chance * 100, 0) + '%';
    const m = S.qs('.accept-gauge + .mono', modal);
    if (m) m.textContent = S.round(chance * 100, 0) + '%';
    S.qsa('.nego-issue', modal).forEach((box) => {
      const inp = S.qs('input[data-slider]', box);
      if (!inp) return;
      const issue = nego.issues.find((i) => i.id === inp.dataset.slider);
      const v = parseInt(inp.value, 10);
      const label = S.qs('.nego-scale .c-gold', box);
      if (label) label.textContent = issue.fmt(v);
      const gap = S.qs('.ih .imp', box);
      if (gap) gap.textContent = 'gap ' + S.signed(v - nego.theirOffer[issue.id], 0);
    });
  };

  UI.submitNego = function () {
    const st = S.game.state, nego = st.negotiation;
    const res = S.Nego.submit(st, nego);
    if (res === 'accepted' || res === 'collapsed') UI.finishNegotiation();
    else UI.renderNegotiation();
  };

  UI.finishNegotiation = function () {
    const st = S.game.state, nego = st.negotiation;
    if (!nego) { UI.closeModal(); return; }
    const status = nego.status;
    const n = S.dip(st, nego.nationId);
    const yourU = S.Nego.yourUtility(nego, nego.offer);
    const summary = nego.issues.map((i) => '<div class="assess-row"><span class="k">' + esc(i.label) + '</span>' +
      '<span class="v">' + esc(i.fmt(nego.offer[i.id])) + '</span></div>').join('');
    S.Nego.conclude(st, nego);
    UI.closeModal();
    UI.showModal({
      eyebrow: 'Outcome',
      title: status === 'accepted' ? 'Agreement Signed' : 'Talks Ended Without Agreement',
      body: '<div class="brief-text"><p>' +
        (status === 'accepted'
          ? 'The text was initialled with ' + esc(n ? n.name : 'the counterparty') + '. Our delegation rates the outcome as ' +
          (yourU > 0.62 ? 'a clear success.' : yourU > 0.45 ? 'a workable compromise.' : 'a defeat dressed as a settlement.')
          : 'The delegations have gone home. Relations have suffered and the underlying dispute is unchanged.') +
        '</p></div>' + (status === 'accepted' ? '<div class="caps" style="margin:12px 0 6px">Agreed terms</div>' + summary : ''),
      footer: [{ label: 'Close', cls: 'primary', act: () => { UI.closeModal(); UI.onTick(true); } }]
    });
  };

  /* ================================================================ MENU */
  UI.openMenu = function () {
    const st = S.game.state;
    const body = '<div class="brief-text"><p><b>STRATEGIAN</b> — you are ' + esc(st.nation.leaderTitle + ' ' + st.nation.leader) +
      ' of ' + esc(st.nation.name) + ', governing as a ' + esc(S.gov(st).name.toLowerCase()) + '.</p>' +
      '<p class="small dim">Keys: <span class="help-key">Space</span> pause · <span class="help-key">1</span> normal · <span class="help-key">2</span> fast · <span class="help-key">I</span> open the next matter on your desk.</p></div>' +
      '<label class="check" style="margin-top:10px"><input type="checkbox" id="apChk"' + (st.settings.autoPause ? ' checked' : '') + '> Stop the clock when an urgent matter arrives</label>' +
      '<label class="check"><input type="checkbox" id="arChk"' + (st.settings.autoResume ? ' checked' : '') + '> Start it again once the matter is dealt with</label>';
    const modal = UI.showModal({
      eyebrow: 'Menu', title: 'Game', body: body,
      footer: [
        { label: 'Save', cls: '', act: () => { S.game.saveNow(); UI.closeModal(); } },
        { label: 'Export file', cls: 'ghost', act: () => S.game.exportSave() },
        { label: 'New game', cls: 'danger', act: () => { if (confirm('Abandon this game?')) { S.game.setSpeed(0); UI.closeModal(); UI.showSetup(); } } },
        { label: 'Close', cls: 'primary', act: () => UI.closeModal() }
      ]
    });
    S.qs('#apChk', modal).onchange = (e) => { st.settings.autoPause = e.target.checked; };
    S.qs('#arChk', modal).onchange = (e) => { st.settings.autoResume = e.target.checked; };
  };

  /* ============================================================ END GAME */
  UI.showEnd = function () {
    const st = S.game.state;
    const e = st.ended;
    const years = S.round((S.absDay(st.date) - st.startYear * 365) / 365, 1);
    const body = '<div class="endscreen">' +
      '<div class="kind">' + (e.won ? 'Victory' : 'Defeat') + '</div>' +
      '<div class="verdict ' + (e.won ? 'c-sage' : 'c-clay') + '">' + esc(e.name) + '</div>' +
      '<div class="blurb">' + esc(e.blurb) + '</div>' +
      '<div class="grid g2" style="text-align:left">' +
      '<div class="card tight">' + kpi('Time in office', years + ' years', st.startYear + '–' + st.date.year) + '</div>' +
      '<div class="card tight">' + kpi('Final approval', S.round(st.society.approval, 0) + '%', 'Stability ' + S.round(st.society.stability, 0)) + '</div>' +
      '<div class="card tight">' + kpi('Economy', S.money(st.economy.gdp), 'from ' + S.money(S.ARCHETYPES.find((a) => a.id === st.nation.archetypeId).gdp)) + '</div>' +
      '<div class="card tight">' + kpi('Prestige', S.round(st.national.prestige, 0), 'Wars ' + (st.national.warsWon || 0) + 'W / ' + (st.national.warsLost || 0) + 'L') + '</div>' +
      '</div></div>';
    UI.showModal({
      eyebrow: S.dateLong(st.date), title: st.nation.name, body: body, sticky: true, wide: true,
      footer: [
        { label: 'Export the record', cls: 'ghost', act: () => S.game.exportSave() },
        { label: 'Begin again', cls: 'primary', act: () => { UI.closeModal(); S.game.deleteSave(); UI.showSetup(); } }
      ]
    });
  };

  /* ============================================================== SETUP */
  UI.setupState = { step: 0, archetypeId: null, governmentId: null, nationName: '', leaderName: '', currencyName: '', currencySymbol: '' };

  UI.showSetup = function () {
    const wrap = el('div.setup-wrap#setupWrap');
    document.body.appendChild(wrap);
    UI.setupState = { step: 0, archetypeId: null, governmentId: null, nationName: '', leaderName: '', currencyName: '', currencySymbol: '' };
    UI.renderSetup();
  };

  UI.renderSetup = function () {
    const wrap = document.getElementById('setupWrap');
    if (!wrap) return;
    const s = UI.setupState;
    const steps = ['The Country', 'The Order', 'The Details'];
    let html = '<div class="setup"><div class="title"><h1>STRATEGIAN</h1>' +
      '<div class="tag2">A government you are actually responsible for</div></div>' +
      '<div class="steps">' + steps.map((t, i) =>
        '<span class="' + (i === s.step ? 'on' : i < s.step ? 'done' : '') + '">' + (i + 1) + '. ' + t + '</span>').join('') + '</div>';

    if (s.step === 0) {
      html += '<h2>Choose the country you will govern</h2>' +
        '<div class="stepdesc">Everything from a global hegemon to a state that may not survive the year. This decides your starting economy, forces, society and the difficulty of everything that follows.</div>' +
        '<div class="choices">';
      S.ARCHETYPES.forEach((a) => {
        html += '<div class="choice ' + (s.archetypeId === a.id ? 'sel' : '') + '" data-arch="' + a.id + '">' +
          '<span class="diff c-' + (a.difficulty === 'Brutal' ? 'clay' : a.difficulty === 'Hard' ? 'gold' : a.difficulty === 'Demanding' ? 'steel' : 'sage') + '">' + a.difficulty + '</span>' +
          '<h4>' + esc(a.name) + '</h4><div class="sub">' + esc(a.sub) + '</div>' +
          '<div class="desc">' + esc(a.desc) + '</div>' +
          '<div class="stats">' + a.tags.map((t) => '<span class="tag c-mute tiny">' + esc(t) + '</span>').join('') + '</div>' +
          '<div class="small dim" style="margin-top:8px">' + S.people(a.pop) + ' people · ' + S.fmtScaled(a.gdp, '$') + ' output · ' +
          S.round(a.gdp * 1000 / a.pop, 0) + ' per head</div>' +
          '<div class="tiny dim" style="margin-top:6px;font-style:italic">' + esc(a.notes) + '</div></div>';
      });
      html += '</div>';
    } else if (s.step === 1) {
      html += '<h2>Choose how you will rule</h2>' +
        '<div class="stepdesc">This is not cosmetic. It changes where your legitimacy comes from, how fast policy moves, how much repression you can use, whether you face elections, and how you can lose.</div>' +
        '<div class="choices">';
      S.GOVERNMENTS.forEach((g) => {
        html += '<div class="choice ' + (s.governmentId === g.id ? 'sel' : '') + '" data-gov="' + g.id + '">' +
          '<h4>' + esc(g.name) + '</h4><div class="sub">' + esc(g.sub) + '</div>' +
          '<div class="desc">' + esc(g.desc) + '</div>' +
          '<div class="stats">' + g.traits.map((t) => '<span class="tag c-mute tiny">' + esc(t) + '</span>').join('') + '</div></div>';
      });
      html += '</div>';
    } else {
      const arch = S.ARCHETYPES.find((a) => a.id === s.archetypeId);
      const gov = S.GOVERNMENTS.find((g) => g.id === s.governmentId);
      const names = S.NATION_NAME_PARTS[arch.id];
      html += '<h2>Name your country</h2><div class="stepdesc">You are the ' +
        esc(S.LEADER_TITLES[gov.id]) + ' of a ' + esc(gov.name.toLowerCase()) + '.</div>' +
        '<div class="grid g2"><div class="card">' +
        '<div class="field"><div class="field-h"><label>Country name</label></div>' +
        '<input type="text" id="setName" value="' + esc(s.nationName || names[0]) + '"></div>' +
        '<div class="field"><div class="field-h"><label>Your name</label></div>' +
        '<input type="text" id="setLeader" value="' + esc(s.leaderName || 'Alvara Denn') + '"></div>' +
        '<div class="field"><div class="field-h"><label>Currency</label></div>' +
        '<div style="display:flex;gap:8px"><input type="text" id="setCur" value="' + esc(s.currencyName || arch.currency.name) + '">' +
        '<input type="text" id="setSym" style="max-width:80px" value="' + esc(s.currencySymbol || arch.currency.symbol) + '"></div>' +
        '<div class="desc">The name and symbol used throughout the treasury. You can change both later.</div></div>' +
        '<div class="btn-row"><button class="btn sm ghost" id="rollName">Suggest a name</button></div>' +
        '</div>' +
        '<div class="card"><div class="card-h"><h3>Opening Position</h3></div>' +
        '<div class="assess-row"><span class="k">Country</span><span class="v">' + esc(arch.name) + '</span></div>' +
        '<div class="assess-row"><span class="k">Government</span><span class="v">' + esc(gov.name) + '</span></div>' +
        '<div class="assess-row"><span class="k">Population</span><span class="v">' + S.people(arch.pop) + '</span></div>' +
        '<div class="assess-row"><span class="k">Output</span><span class="v">' + S.fmtScaled(arch.gdp, '$') + '</span></div>' +
        '<div class="assess-row"><span class="k">Debt</span><span class="v">' + arch.economy.debtGdp + '% of GDP</span></div>' +
        '<div class="assess-row"><span class="k">Inflation</span><span class="v">' + arch.economy.inflation + '%</span></div>' +
        '<div class="assess-row"><span class="k">Approval</span><span class="v">' + arch.society.approval + '%</span></div>' +
        '<div class="assess-row"><span class="k">Corruption</span><span class="v">' + arch.society.corruption + '/100</span></div>' +
        '<div class="assess-row"><span class="k">Nuclear</span><span class="v">' + (arch.military.nuclear > 10 ? 'Armed' : 'None') + '</span></div>' +
        '<div class="assess-row"><span class="k">Difficulty</span><span class="v">' + esc(arch.difficulty) + '</span></div>' +
        '<div class="notice" style="margin-top:12px">' + esc(arch.notes) + '</div>' +
        '</div></div>';
    }

    html += '<div class="setup-nav">' +
      '<button class="btn ghost" id="setBack"' + (s.step === 0 ? ' disabled' : '') + '>Back</button>' +
      '<div class="btn-row">' +
      (S.game.hasSave() && s.step === 0 ? '<button class="btn ghost" id="setLoad">Continue saved game</button>' : '') +
      '<button class="btn primary" id="setNext"' +
      ((s.step === 0 && !s.archetypeId) || (s.step === 1 && !s.governmentId) ? ' disabled' : '') + '>' +
      (s.step === 2 ? 'Take office' : 'Continue') + '</button></div></div></div>';

    wrap.innerHTML = html;

    S.qsa('[data-arch]', wrap).forEach((d) => {
      d.onclick = () => { s.archetypeId = d.dataset.arch; UI.renderSetup(); };
    });
    S.qsa('[data-gov]', wrap).forEach((d) => {
      d.onclick = () => { s.governmentId = d.dataset.gov; UI.renderSetup(); };
    });
    const back = document.getElementById('setBack');
    if (back) back.onclick = () => { s.step = Math.max(0, s.step - 1); UI.renderSetup(); };
    const load = document.getElementById('setLoad');
    if (load) load.onclick = () => {
      const st = S.game.loadSave();
      if (st) { wrap.parentNode.removeChild(wrap); UI.init(); UI.toast('Saved game restored.'); }
      else UI.toast('No readable save found.', 'bad');
    };
    const rn = document.getElementById('rollName');
    if (rn) rn.onclick = () => {
      const arch = S.ARCHETYPES.find((a) => a.id === s.archetypeId);
      const names = S.NATION_NAME_PARTS[arch.id];
      s.nationName = names[Math.floor(Math.random() * names.length)];
      UI.renderSetup();
    };
    const next = document.getElementById('setNext');
    if (next) next.onclick = () => {
      if (s.step === 2) {
        s.nationName = (document.getElementById('setName') || {}).value || s.nationName;
        s.leaderName = (document.getElementById('setLeader') || {}).value || 'Alvara Denn';
        s.currencyName = (document.getElementById('setCur') || {}).value || 'Unit';
        s.currencySymbol = (document.getElementById('setSym') || {}).value || '¤';
        S.game.newGame({
          archetypeId: s.archetypeId, governmentId: s.governmentId,
          nationName: s.nationName, leaderName: s.leaderName,
          currencyName: s.currencyName, currencySymbol: s.currencySymbol
        });
        wrap.parentNode.removeChild(wrap);
        UI.init();
        UI.showIntro();
      } else {
        // capture text fields when leaving step 2 backwards is handled by re-render
        s.step++;
        UI.renderSetup();
      }
    };
  };

  UI.showIntro = function () {
    const st = S.game.state;
    const arch = S.ARCHETYPES.find((a) => a.id === st.nation.archetypeId);
    const gov = S.gov(st);
    UI.showModal({
      eyebrow: S.dateLong(st.date), title: 'You Have Taken Office',
      body: '<div class="brief-text">' +
        '<p>You are <b>' + esc(st.nation.leaderTitle + ' ' + st.nation.leader) + '</b> of <b>' + esc(st.nation.name) +
        '</b>, governing as a ' + esc(gov.name.toLowerCase()) + '.</p>' +
        '<p>' + esc(arch.desc) + '</p>' +
        '<p class="small dim">Matters will arrive on your desk with deadlines. Ignore them and the default course is taken for you, badly. ' +
        'Every ministry on the left is yours to set directly — budgets, tax, monetary policy, doctrine, liberties, trade. ' +
        'The wire on the right tells you how it is playing.</p>' +
        '<p class="small dim">You are not only a respondent. Every department screen opens with an <b>Initiatives</b> panel — ' +
        'mobilise, denounce a government, declare war, launch a hospital or rail programme, sweep the ministries for corruption. ' +
        'Programmes run for years and cost money every one of them.</p>' +
        '<p class="small dim">The clock stops itself for anything urgent and starts again once you have ruled on it. ' +
        '<span class="help-key">Space</span> pauses, <span class="help-key">1</span> and <span class="help-key">2</span> set the speed. The game saves itself every year.</p>' +
        '</div>',
      footer: [{ label: 'Begin', cls: 'primary', act: () => { UI.closeModal(); S.game.setSpeed(1); } }]
    });
  };

})(window.S);

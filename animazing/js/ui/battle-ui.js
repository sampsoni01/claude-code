/* Animazing — expedition (run map, events, forge) and the battle screen.
   The battle screen drives the DOM-free engine: every player action produces
   a queue of granular events which we play back with floaters, shakes and a
   combat log, then re-render the full board. */
(function (AZ) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = AZ.util.esc;

  var NODE_META = {
    battle: { icon: '⚔', name: 'Battle', desc: 'A fair fight, as fair as fights get. Gold and a card reward await.' },
    elite:  { icon: '☠', name: 'Elite', desc: 'A famed foe. Harder — but elites hoard crystals and relics.' },
    event:  { icon: '❓', name: 'Mystery', desc: 'Something strange on the road. Could be fortune. Could be teeth.' },
    forge:  { icon: '⚒', name: 'Forge', desc: 'A safe hearth. Mend the team or trade for coin.' },
    boss:   { icon: '👹', name: 'Boss', desc: 'The master of this road. Clear it to finish the expedition.' }
  };

  /* ================= EXPEDITION (run map) ================= */

  AZ.screens.expedition = {
    render: function () {
      var el = AZ.ui.screenEl('expedition');
      var p = AZ.state.get();
      var run = AZ.state.run();

      if (p.team.members.length < AZ.schema.LIMITS.teamSize) {
        el.innerHTML = '<div class="exp-wrap"><div class="screen-head"><h2 class="screen-title gold-text">Expedition</h2></div>' +
          '<div class="panel exp-need">You need a full team of four heroes before setting out.' +
          '<button class="btn btn-gold" id="exp-to-team">Assemble the team</button></div></div>';
        el.querySelector('#exp-to-team').addEventListener('click', function () { AZ.ui.showScreen('team'); });
        return;
      }

      if (!run) {
        var tiers = '';
        for (var t = 1; t <= p.maxTier; t++) {
          tiers += '<button class="btn ' + (t === p.maxTier ? 'btn-gold' : 'btn-ghost') + '" data-tier="' + t + '">Tier ' + t + '</button>';
        }
        el.innerHTML = '<div class="exp-wrap"><div class="screen-head"><h2 class="screen-title gold-text">Expedition</h2>' +
          '<div class="screen-note">Eight nodes. One boss. Team HP persists between fights — pick your road wisely.</div></div>' +
          '<div class="panel exp-start"><div class="exp-start-title">Choose a difficulty tier</div>' +
          '<div class="exp-tiers">' + tiers + '</div>' +
          '<div class="exp-team-preview" id="exp-team-preview"></div>' +
          '</div></div>';
        var preview = el.querySelector('#exp-team-preview');
        preview.innerHTML = p.team.members.map(function (id) {
          var ch = AZ.content.getCharacter(id);
          return ch ? AZ.ui.charCardHTML(ch, { level: AZ.state.charLevel(id), small: true }) : '';
        }).join('');
        el.querySelectorAll('[data-tier]').forEach(function (b) {
          b.addEventListener('click', function () {
            AZ.state.newRun(parseInt(b.getAttribute('data-tier'), 10));
            AZ.screens.expedition.render();
          });
        });
        return;
      }

      /* Active run: path + doors */
      var node = AZ.state.currentNode();
      var h = '<div class="exp-wrap"><div class="screen-head"><h2 class="screen-title gold-text">Expedition · Tier ' + run.tier + '</h2>' +
        '<button class="btn btn-ghost btn-sm" id="exp-abandon">Abandon</button></div>';
      h += '<div class="exp-path">';
      run.nodes.forEach(function (n, i) {
        var stepNo = i + 1;
        var cls = stepNo < run.step ? 'done' : (stepNo === run.step ? 'current' : 'future');
        var icon = n.options.length === 1 ? NODE_META[n.options[0]].icon : '❖';
        h += '<div class="exp-node ' + cls + '" title="Node ' + stepNo + '"><span>' + icon + '</span></div>';
        if (i < run.nodes.length - 1) h += '<div class="exp-link ' + (stepNo < run.step ? 'done' : '') + '"></div>';
      });
      h += '</div>';
      h += '<div class="exp-hp-strip">' + AZ.state.get().team.members.map(function (id) {
        var ch = AZ.content.getCharacter(id);
        var cfg = AZ.state.buildUnitFor(id);
        if (!ch || !cfg) return '';
        var pct = Math.round(100 * cfg.hp / cfg.maxHp);
        return '<div class="exp-hp"><img src="' + AZ.art.artFor(ch) + '" alt="">' +
          '<div class="hp-bar sm"><div class="hp-fill" style="width:' + pct + '%"></div></div>' +
          '<span>' + cfg.hp + '/' + cfg.maxHp + '</span></div>';
      }).join('') + '</div>';
      h += '<div class="exp-doors-title">Node ' + run.step + ' — choose your door</div><div class="exp-doors">';
      (node ? node.options : []).forEach(function (type) {
        var meta = NODE_META[type];
        h += '<div class="door tilt" data-door="' + type + '"><div class="azc-sheen"></div>' +
          '<div class="door-icon">' + meta.icon + '</div>' +
          '<div class="door-name gold-text">' + meta.name + '</div>' +
          '<div class="door-desc">' + meta.desc + '</div></div>';
      });
      h += '</div></div>';
      el.innerHTML = h;

      el.querySelector('#exp-abandon').addEventListener('click', function () {
        AZ.ui.confirmModal('Abandon this expedition? Progress on the road is lost (loot you already banked is kept).', function () {
          AZ.state.abandonRun();
          AZ.screens.expedition.render();
        }, { danger: true, yesLabel: 'Abandon' });
      });
      el.querySelectorAll('.door').forEach(function (door) {
        door.addEventListener('click', function () {
          var type = door.getAttribute('data-door');
          AZ.state.chooseOption(type);
          if (type === 'event') openEvent();
          else if (type === 'forge') openForge();
          else startBattle(type);
        });
      });
    }
  };

  function afterNodeComplete() {
    var res = AZ.state.advanceRun();
    AZ.ui.updateCurrencies();
    if (res.done && res.victoryBonus != null) {
      AZ.ui.modal({
        title: 'Expedition Complete!',
        body: '<div class="run-complete"><div class="rc-glyph">👑</div>' +
          '<p>Tier ' + res.tier + ' has been cleared. Tier ' + (res.tier + 1) + ' is now open.</p>' +
          '<p class="rc-bonus">+' + res.victoryBonus + ' 💠 Anima Crystals</p></div>',
        noClose: true,
        actions: [{ label: 'Return in glory', cls: 'btn-gold', onClick: function () { AZ.ui.showScreen('hub'); } }]
      });
      return;
    }
    AZ.ui.showScreen('expedition');
  }

  /* ---------------- events & forge ---------------- */

  function openEvent() {
    var run = AZ.state.run();
    var pool = AZ.content.events();
    if (!pool.length) { afterNodeComplete(); return; }
    var rng = AZ.util.rng(run.seed + run.step * 131);
    var ev = rng.pick(pool);
    var body = '<div class="event-box"><div class="event-glyph">' + esc(ev.glyph || '❓') + '</div>' +
      '<p class="event-desc">' + esc(ev.desc) + '</p></div>';
    AZ.ui.modal({
      title: esc(ev.name),
      body: body,
      noClose: true,
      actions: ev.choices.map(function (c) {
        return { label: c.label, cls: 'btn-gold', onClick: function () {
          var out = AZ.state.applyEventChoice(c.result || {});
          AZ.ui.updateCurrencies();
          AZ.ui.modal({
            title: esc(ev.name),
            body: '<div class="event-box">' + out.lines.map(function (l) { return '<p class="event-line">' + esc(l) + '</p>'; }).join('') + '</div>',
            noClose: true,
            actions: [{ label: 'Onward', cls: 'btn-gold', onClick: afterNodeComplete }]
          });
        } };
      })
    });
  }

  function openForge() {
    AZ.ui.modal({
      title: 'The Forge',
      body: '<div class="event-box"><div class="event-glyph">⚒</div>' +
        '<p class="event-desc">The smith stokes crimson coals and looks your battered company over. “Rest, or trade. Roads don’t wait.”</p></div>',
      noClose: true,
      actions: [
        { label: 'Rest — heal team 35%', cls: 'btn-gold', onClick: function () {
          AZ.state.applyEventChoice({ healPct: 35 });
          AZ.ui.toast('The team rests by the coals. +35% HP.', 'good');
          afterNodeComplete();
        } },
        { label: 'Work the bellows — +60 gold', cls: 'btn-ghost', onClick: function () {
          AZ.state.applyEventChoice({ gold: 60 });
          AZ.ui.toast('Honest work. +60 gold.', 'good');
          afterNodeComplete();
        } }
      ]
    });
  }

  /* ================= BATTLE ================= */

  var B = { battle: null, nodeType: null, busy: false, targeting: null, log: [] };

  function startBattle(type) {
    var cfg = AZ.state.makeBattleConfig(type);
    if (!cfg) { AZ.ui.showScreen('expedition'); return; }
    B.battle = AZ.battle.create(cfg);
    B.nodeType = type;
    B.targeting = null;
    B.log = [];
    AZ.ui.showScreen('battle');
    B.battle.start();
    pump();
  }
  AZ.startBattle = startBattle;

  AZ.screens.battle = {
    render: function () {
      if (!B.battle) {
        AZ.ui.screenEl('battle').innerHTML = '<div class="exp-wrap"><div class="panel exp-need">No battle in progress.' +
          '<button class="btn btn-gold" id="b-back">To the Expedition</button></div></div>';
        var back = AZ.ui.screenEl('battle').querySelector('#b-back');
        if (back) back.addEventListener('click', function () { AZ.ui.showScreen('expedition'); });
        return;
      }
      renderAll();
    }
  };

  function delayFor(e) {
    var fast = AZ.state.get().settings.fast;
    var base = { log: 40, draw: 90, intents: 120, roundStart: 650, play: 260, moveUsed: 420, hit: 300, dot: 280, blockGain: 200, healGain: 220, statusGain: 200, energyGain: 140, evade: 300, die: 500, downed: 550, revive: 450, passiveAdd: 380, passiveExpire: 250, stunSkip: 380, end: 600 };
    var d = base[e.t] != null ? base[e.t] : 120;
    return fast ? Math.max(25, Math.round(d * 0.35)) : d;
  }

  function unitEl(uid) {
    return AZ.ui.screenEl('battle').querySelector('[data-uid="' + uid + '"]');
  }

  function pump() {
    var evs = B.battle.drainQueue();
    if (!evs.length) { renderAll(); afterQueue(); return; }
    B.busy = true;
    renderAll();
    playEvents(evs, 0, function () {
      B.busy = false;
      renderAll();
      afterQueue();
    });
  }

  function playEvents(evs, i, done) {
    if (i >= evs.length) { done(); return; }
    var e = evs[i];
    handleEvent(e);
    setTimeout(function () { playEvents(evs, i + 1, done); }, delayFor(e));
  }

  function handleEvent(e) {
    if (e.t === 'log') { pushLog(e.msg, e.cls); return; }
    var el;
    switch (e.t) {
      case 'roundStart':
        renderAll();
        banner('Round ' + e.round);
        break;
      case 'turnStart': renderAll(); break;
      case 'play': {
        el = unitEl(e.uid);
        AZ.ui.floatText(el, '“' + e.cardName + '”', 'f-play');
        renderAll();
        break;
      }
      case 'moveUsed': {
        el = unitEl(e.uid);
        AZ.ui.floatText(el, '“' + e.moveName + '”', 'f-move');
        if (el) AZ.ui.flash(el, 'acting');
        break;
      }
      case 'hit': {
        renderAll();
        el = unitEl(e.uid);
        if (e.amount > 0) { AZ.ui.floatText(el, '-' + e.amount, 'f-dmg'); AZ.ui.shake(el); }
        else AZ.ui.floatText(el, 'Blocked!', 'f-block');
        if (e.blocked > 0 && e.amount > 0) AZ.ui.floatText(el, '🛡' + e.blocked, 'f-block');
        break;
      }
      case 'dot': {
        renderAll();
        el = unitEl(e.uid);
        AZ.ui.floatText(el, '-' + e.amount + ' ' + (AZ.schema.STATUSES[e.status] || {}).icon, 'f-dmg');
        break;
      }
      case 'blockGain': renderAll(); AZ.ui.floatText(unitEl(e.uid), '🛡+' + e.amount, 'f-block'); break;
      case 'healGain': renderAll(); AZ.ui.floatText(unitEl(e.uid), '+' + e.amount, 'f-heal'); break;
      case 'statusGain': {
        renderAll();
        var meta = AZ.schema.STATUSES[e.status] || {};
        AZ.ui.floatText(unitEl(e.uid), (meta.icon || '') + '+' + e.stacks, meta.kind === 'buff' ? 'f-buff' : 'f-debuff');
        break;
      }
      case 'energyGain': renderAll(); AZ.ui.floatText(unitEl(e.uid), '⚡+' + e.amount, 'f-buff'); break;
      case 'evade': AZ.ui.floatText(unitEl(e.uid), 'EVADE!', 'f-buff'); break;
      case 'die': {
        el = unitEl(e.uid);
        if (el) el.classList.add('dying');
        break;
      }
      case 'downed': {
        renderAll();
        el = unitEl(e.uid);
        if (el) AZ.ui.shake(el);
        AZ.ui.floatText(el, 'DOWN', 'f-dmg');
        break;
      }
      case 'revive': renderAll(); AZ.ui.floatText(unitEl(e.uid), 'REVIVED!', 'f-heal'); break;
      case 'passiveAdd': renderAll(); banner(e.passive.icon + ' ' + e.passive.name, 'passive'); break;
      case 'stunSkip': renderAll(); AZ.ui.floatText(unitEl(e.uid), '💫 Stunned', 'f-debuff'); break;
      case 'cleanse': renderAll(); AZ.ui.floatText(unitEl(e.uid), '✨ Cleansed', 'f-buff'); break;
      default: break;
    }
  }

  function banner(text, cls) {
    var root = document.getElementById('fx-root');
    var el = document.createElement('div');
    el.className = 'round-banner ' + (cls || '');
    el.innerHTML = '<span>' + esc(text) + '</span>';
    root.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 20);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 350); }, 950);
  }

  function pushLog(msg, cls) {
    B.log.push({ msg: msg, cls: cls });
    if (B.log.length > 120) B.log.shift();
    var logEl = AZ.ui.screenEl('battle').querySelector('.b-log-lines');
    if (logEl) {
      logEl.innerHTML = logHTML();
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
  function logHTML() {
    return B.log.map(function (l) { return '<div class="log-line log-' + (l.cls || 'n') + '">' + esc(l.msg) + '</div>'; }).join('');
  }

  function afterQueue() {
    var b = B.battle;
    if (!b) return;
    if (b.over) {
      setTimeout(function () { showResult(); }, 300);
    }
  }

  /* ---------------- render ---------------- */

  function intentBadge(enemy) {
    var b = B.battle;
    var prev = b.previewIntent(enemy);
    if (!prev) return '';
    var inner, cls;
    switch (prev.kind) {
      case 'attack': inner = '⚔ ' + prev.damage + (prev.hits > 1 ? '<i>×' + prev.hits + '</i>' : ''); cls = 'i-attack'; break;
      case 'defend': inner = '🛡'; cls = 'i-defend'; break;
      case 'buff': inner = '↑'; cls = 'i-buff'; break;
      case 'debuff': inner = '↓'; cls = 'i-debuff'; break;
      default: inner = '🎲'; cls = 'i-chaos'; break;
    }
    return '<div class="intent-badge ' + cls + '" title="' + esc(prev.name) + '">' + inner + '</div>';
  }

  function unitHTML(u) {
    var b = B.battle;
    var isEnemy = u.side === 'enemy';
    var pctHp = Math.max(0, Math.round(100 * u.hp / u.maxHp));
    var cls = 'unit ' + (isEnemy ? 'enemy' : 'ally');
    if (u.downed) cls += ' downed';
    if (isEnemy && u.hp <= 0) cls += ' dead';
    if (!isEnemy && b.activeUid === u.uid) cls += ' active-ally';
    if (!isEnemy && !u.acted && !u.downed && b.phase === 'player' && !b.activeUid) cls += ' ready';
    if (B.targeting) {
      var k = B.targeting.pick;
      if (k === 'foe' && isEnemy && u.hp > 0) cls += ' targetable';
      if (k === 'friend' && !isEnemy && !u.downed) cls += ' targetable';
      if (k === 'downed' && !isEnemy && u.downed) cls += ' targetable';
    }
    var h = '<div class="' + cls + '" data-uid="' + u.uid + '">';
    if (isEnemy && u.hp > 0) h += intentBadge(u);
    if (u.boss) h += '<div class="unit-crown">👹</div>';
    else if (u.elite) h += '<div class="unit-crown">☠</div>';
    h += '<div class="unit-portrait r-' + u.rarity + '"><img src="' + AZ.art.artFor(u) + '" alt=""></div>';
    h += '<div class="unit-name">' + esc(u.name) + (u.level > 1 ? ' <i>Lv.' + u.level + '</i>' : '') + '</div>';
    h += '<div class="hp-row"><div class="hp-bar"><div class="hp-fill' + (pctHp < 30 ? ' low' : '') + '" style="width:' + pctHp + '%"></div>' +
      '<span class="hp-num">' + Math.max(0, u.hp) + '/' + u.maxHp + '</span></div>' +
      (u.block > 0 ? '<div class="block-badge" title="Block">🛡' + u.block + '</div>' : '') + '</div>';
    h += '<div class="status-row">' + AZ.ui.statusChipsHTML(u) + '</div>';
    if (!isEnemy) {
      if (u.downed) h += '<div class="unit-flag flag-down">FALLEN</div>';
      else if (u.acted && b.phase === 'player') h += '<div class="unit-flag flag-acted">acted</div>';
      else if (!u.acted && b.phase === 'player' && !b.activeUid) h += '<div class="unit-flag flag-ready">ready</div>';
    }
    h += '</div>';
    return h;
  }

  function renderAll() {
    var el = AZ.ui.screenEl('battle');
    var b = B.battle;
    if (!b) return;
    var meta = NODE_META[B.nodeType] || NODE_META.battle;
    var active = b.active();

    var h = '<div class="battle-shell' + (B.busy ? ' locked' : '') + '">';
    h += '<div class="b-top">';
    h += '<div class="b-round">' + meta.icon + ' ' + meta.name + ' · <b>Round ' + b.round + '</b></div>';
    h += '<div class="b-passives">' + b.passives.map(function (p) {
      return '<span class="passive-chip pc-' + p.side + '" title="' + esc(p.name + ': ' + (p.desc || '')) + '">' +
        esc(p.icon) + ' ' + esc(p.name) + (p.duration > 0 ? ' <b>' + p.duration + '</b>' : '') + '</span>';
    }).join('') + '</div>';
    h += '<div class="b-controls"><button class="btn btn-ghost btn-sm" id="b-log-toggle">Log</button>' +
      '<button class="btn btn-crimson btn-sm" id="b-retreat">Retreat</button></div>';
    h += '</div>';

    h += '<div class="arena"><div class="arena-floor"></div>';
    h += '<div class="enemy-row">' + b.units.filter(function (u) { return u.side === 'enemy' && u.hp > 0; }).map(unitHTML).join('') + '</div>';
    h += '<div class="ally-row">' + b.units.filter(function (u) { return u.side === 'ally'; }).map(unitHTML).join('') + '</div>';
    h += '</div>';

    /* hand dock */
    h += '<div class="hand-dock">';
    if (active) {
      h += '<div class="dock-left"><img class="dock-portrait" src="' + AZ.art.artFor(active) + '" alt="">' +
        '<div class="dock-info"><b>' + esc(active.name) + '</b><span>draw ' + active.drawPile.length + ' · discard ' + active.discard.length + '</span></div></div>';
      h += '<div class="energy-orb tilt"><b>' + active.energy + '</b><span>/' + active.energyMax + '</span></div>';
      h += '<div class="hand-fan" id="hand-fan">' + active.hand.map(function (c, i) {
        var can = b.canPlay(c);
        var sel = B.targeting && B.targeting.iid === c.iid;
        var n = active.hand.length;
        var spread = Math.min(9, n * 1.4);
        var rot = n > 1 ? (-spread / 2 + (spread / (n - 1)) * i) : 0;
        return '<div class="hand-slot' + (sel ? ' selected' : '') + '" style="--hrot:' + rot.toFixed(1) + 'deg">' +
          AZ.ui.cardHTML(c.def, { iid: c.iid, disabled: !can.ok, noTilt: true }) + '</div>';
      }).join('') + '</div>';
      h += '<div class="dock-right"><button class="btn btn-gold" id="b-end-turn">End Turn</button></div>';
    } else if (b.phase === 'player' && !b.over) {
      var ready = b.getReadyAllies();
      h += '<div class="dock-hint">' + (ready.length
        ? '✦ Choose a hero to take their turn — the order is yours (' + ready.length + ' remaining)'
        : 'Resolving…') + '</div>';
    } else {
      h += '<div class="dock-hint">Enemy phase…</div>';
    }
    h += '</div>';

    h += '<div class="b-log" id="b-log"><div class="b-log-head">Combat Log</div><div class="b-log-lines">' + logHTML() + '</div></div>';
    if (B.targeting) h += '<div class="target-hint">Choose a target — or click elsewhere to cancel</div>';
    h += '</div>';
    el.innerHTML = h;

    /* keep log drawer state */
    var logDrawer = el.querySelector('#b-log');
    if (B.logOpen) logDrawer.classList.add('open');
    var lines = el.querySelector('.b-log-lines');
    if (lines) lines.scrollTop = lines.scrollHeight;

    /* --------- interactions --------- */
    el.querySelector('#b-log-toggle').addEventListener('click', function () {
      B.logOpen = !B.logOpen;
      logDrawer.classList.toggle('open', B.logOpen);
    });
    el.querySelector('#b-retreat').addEventListener('click', function () {
      AZ.ui.confirmModal('Retreat from battle? The expedition is lost (banked loot is kept).', function () {
        B.battle.concede();
        pump();
      }, { danger: true, yesLabel: 'Retreat' });
    });
    var endBtn = el.querySelector('#b-end-turn');
    if (endBtn) endBtn.addEventListener('click', function () {
      if (B.busy) return;
      B.targeting = null;
      B.battle.endTurn();
      pump();
    });

    el.querySelectorAll('.unit').forEach(function (uEl) {
      uEl.addEventListener('click', function () {
        if (B.busy || b.over) return;
        var uid = uEl.getAttribute('data-uid');
        var u = b.unit(uid);
        if (!u) return;
        if (B.targeting) {
          var k = B.targeting.pick;
          var valid = (k === 'foe' && u.side === 'enemy' && u.hp > 0) ||
                      (k === 'friend' && u.side === 'ally' && !u.downed) ||
                      (k === 'downed' && u.side === 'ally' && u.downed);
          if (!valid) { B.targeting = null; renderAll(); return; }
          var iid = B.targeting.iid;
          B.targeting = null;
          var res = b.playCard(iid, uid);
          if (!res.ok && res.reason) AZ.ui.toast(res.reason, 'error');
          pump();
          return;
        }
        if (u.side === 'ally' && b.phase === 'player' && !b.activeUid && !u.acted && !u.downed) {
          b.beginTurn(uid);
          pump();
        }
      });
    });

    el.querySelectorAll('.hand-slot .az-card').forEach(function (cEl) {
      cEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (B.busy || !b.active()) return;
        var iid = cEl.getAttribute('data-iid');
        var card = null;
        b.active().hand.forEach(function (c) { if (c.iid === iid) card = c; });
        if (!card) return;
        var can = b.canPlay(card);
        if (!can.ok) { AZ.ui.toast(can.reason, 'error'); return; }
        if (can.pick) {
          /* single-foe fights skip the click when there is only one choice */
          if (can.pick === 'foe' && b.enemies().length === 1) {
            var res1 = b.playCard(iid, b.enemies()[0].uid);
            if (!res1.ok && res1.reason) AZ.ui.toast(res1.reason, 'error');
            pump();
            return;
          }
          B.targeting = { iid: iid, pick: can.pick };
          renderAll();
          return;
        }
        var res = b.playCard(iid);
        if (!res.ok && res.reason) AZ.ui.toast(res.reason, 'error');
        pump();
      });
    });

    el.querySelector('.arena').addEventListener('click', function (e) {
      if (B.targeting && e.target.classList.contains('arena')) { B.targeting = null; renderAll(); }
    });
  }

  /* ---------------- results ---------------- */

  function showResult() {
    var b = B.battle;
    if (!b || !b.result) return;
    if (b.result.victory) {
      var rewards = AZ.state.completeBattle(b, B.nodeType);
      AZ.ui.updateCurrencies();
      var chosen = { done: false };
      var body = '<div class="victory-box"><div class="v-glyph">勝</div>';
      body += '<div class="v-loot"><span>+' + rewards.gold + ' 🪙</span>' +
        (rewards.crystals ? '<span>+' + rewards.crystals + ' 💠</span>' : '') + '</div>';
      if (rewards.item) body += '<div class="v-item">Relic seized: <b>' + esc(rewards.item.name) + '</b></div>';
      if (rewards.cardChoices.length) {
        body += '<div class="v-choice-title">Claim one ability card</div><div class="v-cards">' +
          rewards.cardChoices.map(function (c, i) {
            return '<div class="v-card-pick" data-pick="' + i + '">' + AZ.ui.cardHTML(c, { showOwner: true, small: true }) + '</div>';
          }).join('') + '</div>';
      }
      body += '</div>';
      var m = AZ.ui.modal({
        title: 'Victory',
        body: body,
        noClose: true,
        cls: 'modal-reveal',
        actions: [{ label: 'Continue', cls: 'btn-gold', onClick: function () {
          B.battle = null;
          afterNodeComplete();
        } }]
      });
      m.el.querySelectorAll('.v-card-pick').forEach(function (pick) {
        pick.addEventListener('click', function () {
          if (chosen.done) return;
          chosen.done = true;
          var c = rewards.cardChoices[parseInt(pick.getAttribute('data-pick'), 10)];
          AZ.state.grantCard(c.id, 1);
          pick.classList.add('picked');
          m.el.querySelectorAll('.v-card-pick').forEach(function (o) { if (o !== pick) o.classList.add('dimmed'); });
          AZ.ui.toast('“' + esc(c.name) + '” added to your collection.', 'good');
        });
      });
    } else {
      AZ.state.failRun();
      AZ.ui.updateCurrencies();
      AZ.ui.modal({
        title: 'Defeat',
        body: '<div class="defeat-box"><div class="v-glyph d-glyph">敗</div>' +
          '<p>The road wins this time. Rounds survived: ' + b.result.rounds + '.</p>' +
          '<p class="defeat-note">Gold already banked is kept. The team will be ready again — stronger, if you visit the Altar or the Studio first.</p></div>',
        noClose: true,
        actions: [{ label: 'Limp home', cls: 'btn-crimson', onClick: function () {
          B.battle = null;
          AZ.ui.showScreen('hub');
        } }]
      });
    }
  }

})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

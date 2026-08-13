/* Animazing — meta screens: title, sanctum hub, collection, team builder,
   summon altar and settings/codex. */
(function (AZ) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = AZ.util.esc;
  var ui = function () { return AZ.ui; };

  /* ================= TITLE ================= */

  AZ.screens.title = {
    render: function () {
      var el = ui().screenEl('title');
      el.innerHTML =
        '<div class="title-wrap">' +
        '  <div class="title-emblem tilt"><span>絢</span></div>' +
        '  <h1 class="title-logo gold-text">ANIMAZING</h1>' +
        '  <div class="title-sub">a chronicle of gold &amp; crimson</div>' +
        '  <button class="btn btn-gold btn-large" id="title-enter">Enter the Sanctum</button>' +
        '  <div class="title-foot">Assemble four heroes · Duel with ability cards · Forge your own legend in the Studio</div>' +
        '</div>';
      el.querySelector('#title-enter').addEventListener('click', function () {
        AZ.ui.showScreen('hub');
      });
    }
  };

  /* ================= HUB ================= */

  var HUB_TILES = [
    { screen: 'expedition', glyph: '⚔', name: 'Expedition', desc: 'Lead your four heroes through a gauntlet of battles, elites, strange events and a waiting boss.' },
    { screen: 'collection', glyph: '🎴', name: 'Collection', desc: 'Every hero, ability card and relic you have gathered — and the ones still hiding from you.' },
    { screen: 'team', glyph: '四', name: 'Team', desc: 'Choose your four, order their turns, tune each deck and equip relics.' },
    { screen: 'summon', glyph: '💠', name: 'Summon Altar', desc: 'Spend crystals and gold on new heroes, ability packs and relic caches.' },
    { screen: 'studio', glyph: '✒', name: 'Creator Studio', desc: 'Your world, your rules: upload art, write heroes, invent abilities. New content joins the game instantly.' },
    { screen: 'codex', glyph: '📜', name: 'Codex', desc: 'How battles, statuses, combos and passives actually work.' }
  ];

  AZ.screens.hub = {
    render: function () {
      var el = ui().screenEl('hub');
      var p = AZ.state.get();
      var run = AZ.state.run();
      var h = '<div class="hub-wrap">';
      h += '<div class="hub-head"><h2 class="screen-title gold-text">The Sanctum</h2>';
      h += '<div class="hub-stats">' +
        '<span>Battles won <b>' + p.stats.wins + '</b></span>' +
        '<span>Expeditions cleared <b>' + p.stats.runsWon + '</b></span>' +
        '<span>Highest tier <b>' + (p.stats.bestTier || '—') + '</b></span>' +
        '</div></div>';
      if (run) {
        h += '<div class="hub-resume panel"><span>An expedition is underway — node ' + run.step + ' of ' + run.nodes.length +
          ', Tier ' + run.tier + '.</span><button class="btn btn-crimson" id="hub-resume-btn">Resume</button></div>';
      }
      h += '<div class="hub-grid">';
      HUB_TILES.forEach(function (t) {
        h += '<div class="hub-tile tilt" data-screen="' + t.screen + '">' +
          '<div class="azc-sheen"></div>' +
          '<div class="hub-glyph">' + t.glyph + '</div>' +
          '<div class="hub-name gold-text">' + t.name + '</div>' +
          '<div class="hub-desc">' + t.desc + '</div></div>';
      });
      h += '</div></div>';
      el.innerHTML = h;
      el.querySelectorAll('.hub-tile').forEach(function (tile) {
        tile.addEventListener('click', function () {
          var s = tile.getAttribute('data-screen');
          if (s === 'codex') { showCodex(); return; }
          AZ.ui.showScreen(s);
        });
      });
      var resume = el.querySelector('#hub-resume-btn');
      if (resume) resume.addEventListener('click', function () { AZ.ui.showScreen('expedition'); });
    }
  };

  /* ================= COLLECTION ================= */

  var collectionTab = 'heroes';

  AZ.screens.collection = {
    render: function () {
      var el = ui().screenEl('collection');
      var h = '<div class="coll-wrap">';
      h += '<div class="screen-head"><h2 class="screen-title gold-text">Collection</h2>';
      h += '<div class="tab-row">' +
        tabBtn('heroes', 'Heroes') + tabBtn('cards', 'Ability Cards') + tabBtn('relics', 'Relics') +
        '</div></div>';
      h += '<div id="coll-body"></div></div>';
      el.innerHTML = h;
      el.querySelectorAll('.tab-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          collectionTab = b.getAttribute('data-tab');
          AZ.screens.collection.render();
        });
      });
      var body = el.querySelector('#coll-body');
      if (collectionTab === 'heroes') renderHeroes(body);
      else if (collectionTab === 'cards') renderCards(body);
      else renderRelics(body);
    }
  };

  function tabBtn(key, label) {
    return '<button class="tab-btn' + (collectionTab === key ? ' tab-active' : '') + '" data-tab="' + key + '">' + label + '</button>';
  }

  function visibleCharacters() {
    var p = AZ.state.get();
    return AZ.content.characters().filter(function (c) {
      if (c.sample && !p.settings.showSamples) return false;
      return true;
    });
  }

  function renderHeroes(body) {
    var p = AZ.state.get();
    var chars = visibleCharacters();
    var owned = chars.filter(function (c) { return AZ.state.ownsChar(c.id); });
    var locked = chars.filter(function (c) { return !AZ.state.ownsChar(c.id); });
    var h = '<div class="coll-count">' + owned.length + ' / ' + chars.length + ' heroes recruited</div>';
    h += '<div class="char-grid">';
    owned.concat(locked).forEach(function (c) {
      h += AZ.ui.charCardHTML(c, { level: AZ.state.ownsChar(c.id) ? AZ.state.charLevel(c.id) : null, locked: !AZ.state.ownsChar(c.id) });
    });
    h += '</div>';
    if (!chars.length) h = emptyNote('No heroes visible. Create your own in the Studio, or re-enable sample content in Settings.');
    body.innerHTML = h;
    body.querySelectorAll('.char-card').forEach(function (cardEl) {
      cardEl.addEventListener('click', function () {
        var id = cardEl.getAttribute('data-char-id');
        if (!AZ.state.ownsChar(id)) { AZ.ui.toast('Not recruited yet — try the Summon Altar.', 'info'); return; }
        showHeroDetail(id);
      });
    });
  }

  function showHeroDetail(charId) {
    var ch = AZ.content.getCharacter(charId);
    var level = AZ.state.charLevel(charId);
    var cards = AZ.content.cardsForOwner(charId).filter(function (c) { return c.owner !== '*'; });
    var role = AZ.schema.ROLES[ch.role] || {};
    var hpBonus = (level - 1) * 4;
    var body = '<div class="hero-detail">';
    body += '<div class="hd-left"><div class="hd-art r-' + ch.rarity + '">' + AZ.ui.artImg(ch) + '</div>';
    body += '<div class="hd-meta">' + AZ.ui.rarityGem(ch.rarity) + ' ' + AZ.ui.elementBadge(ch.element) +
      ' <span class="hd-role">' + esc(role.icon || '') + ' ' + esc(role.label || '') + '</span></div>';
    body += '<div class="hd-stats">' +
      stat('HP', ch.stats.hp + (hpBonus ? ' <i>+' + hpBonus + '</i>' : '')) +
      stat('Energy', ch.stats.energy) +
      stat('Draw', ch.stats.draw) +
      stat('Speed', ch.stats.speed) +
      stat('Level', level) +
      '</div>';
    if (ch.innate) body += '<div class="hd-innate"><b>' + esc(ch.innate.icon || '◆') + ' ' + esc(ch.innate.name) + '</b> — ' +
      esc(ch.innate.desc || AZ.schema.passiveToText(ch.innate)) + '</div>';
    if (ch.lore) body += '<div class="hd-lore">' + esc(ch.lore) + '</div>';
    body += '</div>';
    body += '<div class="hd-right"><div class="hd-cards-title">Ability Cards</div><div class="card-strip">';
    if (!cards.length) body += emptyNote('No signature cards yet — author some in the Studio.');
    cards.forEach(function (c) {
      var n = AZ.state.cardCount(c.id);
      body += AZ.ui.cardHTML(c, { small: true, count: n === 99 ? null : n, disabled: n <= 0 });
    });
    body += '</div></div></div>';
    AZ.ui.modal({ title: esc(ch.name) + ' <span class="modal-sub">' + esc(ch.title || '') + '</span>', body: body, wide: true });
  }

  function stat(label, val) {
    return '<span class="stat-pill"><label>' + label + '</label><b>' + val + '</b></span>';
  }

  function renderCards(body) {
    var p = AZ.state.get();
    var chars = visibleCharacters();
    var cards = AZ.content.cards().filter(function (c) {
      if (c.owner === '*') return true;
      var owner = AZ.content.getCharacter(c.owner);
      if (!owner) return false;
      if (owner.sample && !p.settings.showSamples) return false;
      return true;
    });
    var ownedCount = cards.filter(function (c) { return AZ.state.cardCount(c.id) > 0; }).length;
    var h = '<div class="coll-count">' + ownedCount + ' / ' + cards.length + ' ability cards discovered</div>';
    h += '<div class="card-grid">';
    cards.forEach(function (c) {
      var n = AZ.state.cardCount(c.id);
      h += AZ.ui.cardHTML(c, { count: n === 99 ? null : n, disabled: n <= 0, showOwner: true });
    });
    h += '</div>';
    body.innerHTML = h;
  }

  function renderRelics(body) {
    var items = AZ.content.items();
    var h = '<div class="relic-list">';
    items.forEach(function (it) {
      var n = AZ.state.itemCount(it.id);
      h += AZ.ui.itemHTML(it, { count: n });
    });
    h += '</div>';
    if (!items.length) h = emptyNote('No relics exist yet.');
    body.innerHTML = h;
  }

  function emptyNote(msg) { return '<div class="empty-note">' + msg + '</div>'; }

  /* ================= TEAM ================= */

  AZ.screens.team = {
    render: function () {
      var el = ui().screenEl('team');
      var p = AZ.state.get();
      var members = p.team.members;
      var h = '<div class="team-wrap"><div class="screen-head"><h2 class="screen-title gold-text">Team of Four</h2>' +
        '<div class="screen-note">Turn order in battle is yours to choose each round — this is your marching order.</div></div>';
      h += '<div class="team-slots">';
      for (var i = 0; i < AZ.schema.LIMITS.teamSize; i++) {
        var id = members[i];
        var ch = id ? AZ.content.getCharacter(id) : null;
        h += '<div class="team-slot panel" data-slot="' + i + '">';
        h += '<div class="ts-index">' + (i + 1) + '</div>';
        if (ch) {
          var deck = p.team.decks[id] || [];
          var equips = (p.team.equips[id] || []).map(function (iid) { return AZ.content.getItem(iid); }).filter(Boolean);
          h += '<div class="ts-char" data-char-id="' + esc(id) + '">' +
            AZ.ui.charCardHTML(ch, { level: AZ.state.charLevel(id), small: true }) + '</div>';
          h += '<div class="ts-info"><span>' + deck.length + ' cards</span><span>' +
            (equips.length ? equips.map(function (e) { return esc(e.name); }).join(', ') : 'no relics') + '</span></div>';
          h += '<div class="ts-actions">' +
            '<button class="btn btn-ghost btn-sm" data-act="deck" data-char="' + esc(id) + '">Deck</button>' +
            '<button class="btn btn-ghost btn-sm" data-act="relics" data-char="' + esc(id) + '">Relics</button>' +
            '<button class="btn btn-ghost btn-sm" data-act="swap" data-slot-i="' + i + '">Swap</button>' +
            (i > 0 ? '<button class="btn btn-ghost btn-sm" data-act="left" data-slot-i="' + i + '">◀</button>' : '') +
            (i < members.length - 1 ? '<button class="btn btn-ghost btn-sm" data-act="right" data-slot-i="' + i + '">▶</button>' : '') +
            '</div>';
        } else {
          h += '<button class="ts-empty" data-act="swap" data-slot-i="' + i + '">+ Choose a hero</button>';
        }
        h += '</div>';
      }
      h += '</div></div>';
      el.innerHTML = h;

      el.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var act = btn.getAttribute('data-act');
          if (act === 'deck') openDeckEditor(btn.getAttribute('data-char'));
          else if (act === 'relics') openEquipEditor(btn.getAttribute('data-char'));
          else if (act === 'swap') openRosterPicker(parseInt(btn.getAttribute('data-slot-i'), 10));
          else if (act === 'left' || act === 'right') {
            var i = parseInt(btn.getAttribute('data-slot-i'), 10);
            var j = act === 'left' ? i - 1 : i + 1;
            var m = AZ.state.get().team.members;
            var tmp = m[i]; m[i] = m[j]; m[j] = tmp;
            AZ.state.save();
            AZ.screens.team.render();
          }
        });
      });
      el.querySelectorAll('.ts-char .char-card').forEach(function (cc) {
        cc.addEventListener('click', function () { showHeroDetail(cc.getAttribute('data-char-id')); });
      });
    }
  };

  function openRosterPicker(slotIndex) {
    var p = AZ.state.get();
    var owned = visibleCharacters().filter(function (c) { return AZ.state.ownsChar(c.id); });
    var body = '<div class="char-grid roster-grid">';
    owned.forEach(function (c) {
      var inTeam = p.team.members.indexOf(c.id) >= 0;
      body += '<div class="roster-pick' + (inTeam ? ' in-team' : '') + '" data-pick="' + esc(c.id) + '">' +
        AZ.ui.charCardHTML(c, { level: AZ.state.charLevel(c.id), small: true }) +
        (inTeam ? '<div class="roster-flag">In team</div>' : '') + '</div>';
    });
    body += '</div>';
    var m = AZ.ui.modal({ title: 'Choose a hero for slot ' + (slotIndex + 1), body: body, wide: true });
    m.el.querySelectorAll('.roster-pick').forEach(function (pick) {
      pick.addEventListener('click', function () {
        var id = pick.getAttribute('data-pick');
        var members = AZ.state.get().team.members.slice();
        var existingIdx = members.indexOf(id);
        if (existingIdx >= 0 && existingIdx !== slotIndex) {
          members[existingIdx] = members[slotIndex] || null;
        }
        members[slotIndex] = id;
        AZ.state.setTeam(members.filter(Boolean));
        m.close();
        AZ.screens.team.render();
      });
    });
  }

  /* ---------------- deck editor ---------------- */

  function openDeckEditor(charId) {
    var ch = AZ.content.getCharacter(charId);
    var deck = (AZ.state.get().team.decks[charId] || []).slice();
    var L = AZ.schema.LIMITS;

    function available(cardId) {
      var used = deck.filter(function (id) { return id === cardId; }).length;
      return AZ.state.cardCount(cardId) - used;
    }

    var m = AZ.ui.modal({
      title: 'Deck — ' + esc(ch.name),
      body: '<div class="deck-editor">' +
        '<div class="de-col"><div class="de-head">Current deck <span id="de-count"></span></div><div class="card-strip" id="de-deck"></div></div>' +
        '<div class="de-col"><div class="de-head">Owned cards <span class="de-hint">(click to add)</span></div><div class="card-strip" id="de-pool"></div></div>' +
        '</div>',
      wide: true,
      cls: 'modal-tall',
      actions: [
        { label: 'Auto-build', cls: 'btn-ghost', onClick: function () { deck = AZ.state.autoBuildDeck(charId); paint(); return true; } },
        { label: 'Save deck', cls: 'btn-gold', onClick: function () {
            var errs = AZ.state.setDeck(charId, deck);
            if (errs.length) { AZ.ui.toast(errs[0], 'error'); return true; }
            AZ.ui.toast('Deck saved.', 'good');
            AZ.screens.team.render();
          } },
        { label: 'Cancel', cls: 'btn-ghost' }
      ]
    });

    function paint() {
      var deckEl = m.el.querySelector('#de-deck');
      var poolEl = m.el.querySelector('#de-pool');
      var countEl = m.el.querySelector('#de-count');
      countEl.textContent = deck.length + ' / ' + L.deckMin + '–' + L.deckMax;
      countEl.className = deck.length < L.deckMin || deck.length > L.deckMax ? 'bad' : 'good';
      deckEl.innerHTML = deck.map(function (id, i) {
        var c = AZ.content.getCard(id);
        return c ? '<div class="de-entry" data-i="' + i + '">' + AZ.ui.cardHTML(c, { small: true, noTilt: true }) + '</div>' : '';
      }).join('') || emptyNote('Empty deck — add cards from the right.');
      poolEl.innerHTML = AZ.content.cardsForOwner(charId).map(function (c) {
        var avail = available(c.id);
        var count = AZ.state.cardCount(c.id);
        return '<div class="de-entry" data-add="' + esc(c.id) + '">' +
          AZ.ui.cardHTML(c, { small: true, noTilt: true, disabled: avail <= 0, count: count === 99 ? null : avail }) + '</div>';
      }).join('');
      deckEl.querySelectorAll('.de-entry').forEach(function (e) {
        e.addEventListener('click', function () {
          deck.splice(parseInt(e.getAttribute('data-i'), 10), 1);
          paint();
        });
      });
      poolEl.querySelectorAll('.de-entry').forEach(function (e) {
        e.addEventListener('click', function () {
          var id = e.getAttribute('data-add');
          if (available(id) <= 0) { AZ.ui.toast('No copies left of that card.', 'error'); return; }
          if (deck.length >= L.deckMax) { AZ.ui.toast('Deck is full (' + L.deckMax + ').', 'error'); return; }
          deck.push(id);
          paint();
        });
      });
    }
    paint();
  }

  /* ---------------- relic equip editor ---------------- */

  function openEquipEditor(charId) {
    var ch = AZ.content.getCharacter(charId);
    var selected = (AZ.state.get().team.equips[charId] || []).slice();
    var L = AZ.schema.LIMITS;
    var ownedItems = AZ.content.items().filter(function (it) { return AZ.state.itemCount(it.id) > 0; });

    var m = AZ.ui.modal({
      title: 'Relics — ' + esc(ch.name) + ' <span class="modal-sub">(' + L.equipSlots + ' slots)</span>',
      body: '<div class="relic-list" id="eq-list"></div>',
      wide: true,
      actions: [
        { label: 'Save', cls: 'btn-gold', onClick: function () {
            var errs = AZ.state.setEquips(charId, selected);
            if (errs.length) { AZ.ui.toast(errs[0], 'error'); return true; }
            AZ.ui.toast('Relics equipped.', 'good');
            AZ.screens.team.render();
          } },
        { label: 'Cancel', cls: 'btn-ghost' }
      ]
    });

    function paint() {
      var list = m.el.querySelector('#eq-list');
      if (!ownedItems.length) { list.innerHTML = emptyNote('No relics owned yet — win them on expeditions or open a Relic Cache.'); return; }
      list.innerHTML = ownedItems.map(function (it) {
        var free = AZ.state.itemCount(it.id) - AZ.state.equippedCount(it.id, charId);
        var isSel = selected.indexOf(it.id) >= 0;
        return '<div class="eq-row' + (isSel ? ' eq-selected' : '') + (free <= 0 && !isSel ? ' eq-unavail' : '') + '" data-item="' + esc(it.id) + '">' +
          AZ.ui.itemHTML(it, { count: free, selected: isSel }) + '</div>';
      }).join('');
      list.querySelectorAll('.eq-row').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-item');
          var idx = selected.indexOf(id);
          if (idx >= 0) selected.splice(idx, 1);
          else {
            if (selected.length >= L.equipSlots) { AZ.ui.toast('Only ' + L.equipSlots + ' relic slots.', 'error'); return; }
            var free = AZ.state.itemCount(id) - AZ.state.equippedCount(id, charId);
            if (free <= 0) { AZ.ui.toast('All copies are equipped by teammates.', 'error'); return; }
            selected.push(id);
          }
          paint();
        });
      });
    }
    paint();
  }

  /* ================= SUMMON ================= */

  AZ.screens.summon = {
    render: function () {
      var el = ui().screenEl('summon');
      var p = AZ.state.get();
      var C = AZ.state.COSTS;
      var h = '<div class="summon-wrap"><div class="screen-head"><h2 class="screen-title gold-text">Summon Altar</h2>' +
        '<div class="screen-note">Pity: an SR or better hero is guaranteed within every 10 hero summons <b>(' + p.pity + '/10)</b>.</div></div>';
      h += '<div class="banner-row">';
      h += banner('hero', '召', 'Hero Summon',
        'Call a new hero to your banner. Duplicates ascend the hero (+1 level, +4 max HP).',
        [{ id: 'hero1', label: '1× — ' + C.characterSummon + ' 💠' }, { id: 'hero10', label: '10× — ' + (C.characterSummon * 10) + ' 💠' }]);
      h += banner('pack', '技', 'Ability Pack',
        'Three ability cards for heroes you own. Copies let you stack decks.',
        [{ id: 'pack1', label: 'Open — ' + C.abilityPack + ' 🪙' }]);
      h += banner('relic', '宝', 'Relic Cache',
        'One relic to equip on any hero. Relics power up stats and add battle hooks.',
        [{ id: 'relic1', label: 'Open — ' + C.itemCache + ' 🪙' }]);
      h += '</div></div>';
      el.innerHTML = h;
      el.querySelector('[data-pull="hero1"]').addEventListener('click', function () { doHeroSummon(1); });
      el.querySelector('[data-pull="hero10"]').addEventListener('click', function () { doHeroSummon(10); });
      el.querySelector('[data-pull="pack1"]').addEventListener('click', doAbilityPack);
      el.querySelector('[data-pull="relic1"]').addEventListener('click', doRelicCache);
    }
  };

  function banner(kind, glyph, name, desc, buttons) {
    return '<div class="banner banner-' + kind + ' tilt"><div class="azc-sheen"></div>' +
      '<div class="banner-glyph">' + glyph + '</div>' +
      '<div class="banner-name gold-text">' + name + '</div>' +
      '<div class="banner-desc">' + desc + '</div>' +
      '<div class="banner-actions">' + buttons.map(function (b) {
        return '<button class="btn btn-gold" data-pull="' + b.id + '">' + b.label + '</button>';
      }).join('') + '</div></div>';
  }

  function doHeroSummon(n) {
    var results = [];
    for (var i = 0; i < n; i++) {
      var r = AZ.state.summonCharacter();
      if (r.error) { if (!results.length) { AZ.ui.toast(r.error, 'error'); return; } break; }
      results.push(r);
    }
    AZ.ui.updateCurrencies();
    showRevealModal('Heroes Answer the Call', results.map(function (r) {
      return {
        html: AZ.ui.charCardHTML(r.character, { level: r.level, small: results.length > 3 }),
        rarity: r.character.rarity,
        note: r.isNew ? 'NEW!' : 'Ascended to Lv.' + r.level
      };
    }), function () { AZ.screens.summon.render(); });
  }

  function doAbilityPack() {
    var r = AZ.state.summonAbilityPack();
    if (r.error) { AZ.ui.toast(r.error, 'error'); return; }
    AZ.ui.updateCurrencies();
    showRevealModal('Ability Pack', r.cards.map(function (c) {
      return { html: AZ.ui.cardHTML(c, { showOwner: true }), rarity: c.rarity, note: null };
    }), function () { AZ.screens.summon.render(); });
  }

  function doRelicCache() {
    var r = AZ.state.summonItemCache();
    if (r.error) { AZ.ui.toast(r.error, 'error'); return; }
    AZ.ui.updateCurrencies();
    showRevealModal('Relic Cache', [{ html: AZ.ui.itemHTML(r.item), rarity: r.item.rarity, note: null }],
      function () { AZ.screens.summon.render(); });
  }

  /* Pack-opening reveal: cards drop in face-down, flip on click (or all at once). */
  function showRevealModal(title, entries, onClose) {
    var body = '<div class="reveal-grid">' + entries.map(function (e, i) {
      return '<div class="flip-card" data-i="' + i + '" style="animation-delay:' + (i * 90) + 'ms">' +
        '<div class="flip-inner">' +
        '<div class="flip-back"><span>絢</span></div>' +
        '<div class="flip-face fr-' + e.rarity + '">' + e.html + (e.note ? '<div class="reveal-note">' + esc(e.note) + '</div>' : '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
    var m = AZ.ui.modal({
      title: title, body: body, wide: true, cls: 'modal-reveal', onClose: onClose,
      actions: [{ label: 'Reveal all', cls: 'btn-ghost', onClick: function (api) {
        api.el.querySelectorAll('.flip-card').forEach(function (f, i) {
          setTimeout(function () { f.classList.add('flipped'); }, i * 140);
        });
        return true;
      } }, { label: 'Done', cls: 'btn-gold' }]
    });
    m.el.querySelectorAll('.flip-card').forEach(function (f) {
      f.addEventListener('click', function () { f.classList.add('flipped'); });
    });
  }

  /* ================= SETTINGS ================= */

  AZ.screens.settings = {
    render: function () {
      var el = ui().screenEl('settings');
      var p = AZ.state.get();
      var h = '<div class="settings-wrap"><div class="screen-head"><h2 class="screen-title gold-text">Settings</h2></div>';
      h += '<div class="panel set-panel"><div class="panel-title">Content</div>';
      h += toggleRow('showSamples', 'Show sample content', 'The starter cast stays visible in your collection and summon pool. Turn off once your own cast can stand alone (samples still serve as enemies).', p.settings.showSamples);
      h += toggleRow('customInGacha', 'Custom content in summons', 'Heroes and cards you make in the Studio appear in the Summon Altar pools.', p.settings.customInGacha);
      h += toggleRow('fast', 'Fast battle animations', 'Snappier combat playback.', p.settings.fast);
      h += '</div>';
      h += '<div class="panel set-panel"><div class="panel-title">Save Data</div><div class="set-actions">' +
        '<button class="btn btn-ghost" id="set-export">Export full save</button>' +
        '<label class="btn btn-ghost btn-file">Import save<input type="file" id="set-import" accept="application/json"></label>' +
        '<button class="btn btn-crimson" id="set-reset">Reset everything</button>' +
        '</div><div class="set-note">Progress lives in this browser. Export regularly — especially your Studio content (the Studio has its own pack export too).</div></div>';
      h += '<div class="panel set-panel"><div class="panel-title">Codex</div><div class="set-actions">' +
        '<button class="btn btn-gold" id="set-codex">Open the Codex</button></div></div>';
      h += '</div>';
      el.innerHTML = h;

      el.querySelectorAll('[data-toggle]').forEach(function (t) {
        t.addEventListener('click', function () {
          var key = t.getAttribute('data-toggle');
          p.settings[key] = !p.settings[key];
          AZ.state.save();
          AZ.screens.settings.render();
        });
      });
      el.querySelector('#set-export').addEventListener('click', function () {
        var text = JSON.stringify(AZ.storage.buildFullSave(), null, 2);
        AZ.storage.saveTextFile('animazing-save.json', text).then(function (res) {
          AZ.ui.reportSave(res, text, 'Save file');
        });
      });
      el.querySelector('#set-import').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        file.text().then(function (text) {
          return AZ.storage.importFullSave(JSON.parse(text));
        }).then(function () {
          AZ.content.init();
          AZ.state.init();
          AZ.ui.toast('Save imported. Welcome back.', 'good');
          AZ.ui.showScreen('hub');
        }).catch(function (err) {
          AZ.ui.toast('Import failed: ' + esc(err.message), 'error');
        });
      });
      el.querySelector('#set-reset').addEventListener('click', function () {
        AZ.ui.confirmModal(
          'This wipes your profile, collection and progress. Studio content and uploaded art are kept. Export a save first if in doubt.',
          function () { AZ.state.resetAll(); AZ.ui.toast('A fresh page. A new legend.', 'good'); AZ.ui.showScreen('hub'); },
          { danger: true, yesLabel: 'Reset profile' });
      });
      el.querySelector('#set-codex').addEventListener('click', showCodex);
    }
  };

  function toggleRow(key, label, desc, on) {
    return '<div class="toggle-row" data-toggle="' + key + '">' +
      '<div class="toggle-info"><b>' + label + '</b><span>' + desc + '</span></div>' +
      '<div class="toggle-pill' + (on ? ' on' : '') + '"><div class="toggle-dot"></div></div></div>';
  }

  /* ================= CODEX ================= */

  function showCodex() {
    var statuses = Object.keys(AZ.schema.STATUSES).map(function (k) {
      var s = AZ.schema.STATUSES[k];
      return '<div class="codex-status"><span class="status-chip st-' + s.kind + '">' + s.icon + '</span><b>' + s.label + '</b> — ' + s.desc + '</div>';
    }).join('');
    var body =
      '<div class="codex">' +
      '<h3>The Round</h3>' +
      '<p>Each round, every hero on your team of four takes a turn — <b>in any order you choose</b>. Click a hero to begin their turn: they draw to five cards and gain their Energy. Play cards, end their turn, pick the next hero. When all four have acted, enemies act out their telegraphed intents, and a new round begins.</p>' +
      '<h3>Reading the enemy</h3>' +
      '<p>Every enemy shows an <b>intent badge</b>: ⚔ incoming damage (with the number), 🛡 defending, ↑ buffing, ↓ debuffing you, 🎲 chaos. Block absorbs damage but normally wears off at your next turn. Taunt drags attacks onto your guardian. Plan the order of your four turns around what is coming.</p>' +
      '<h3>Synergy</h3>' +
      '<p>Cards carry <b>tags</b> (Fire, Blade, Storm, Venom…). Some cards combo off tags the team has already played this round — order matters. <b>Passives</b> stay on the battlefield for several rounds and can buff your side, punish tags, heal each round, or roll pure chaos. <b>Relics</b> equipped on a hero add hooks (extra Fire damage, round-start Block…) that your cards can build around. Innate hero passives are always on.</p>' +
      '<h3>Statuses</h3>' + statuses +
      '<h3>Expeditions</h3>' +
      '<p>An expedition is eight nodes: battles, elites, forges (rest), strange events, and a boss. Your team’s HP carries between fights; the fallen crawl back at 25%. Victory pays gold, crystals and a choice of ability cards. Clearing the boss unlocks the next difficulty tier.</p>' +
      '<h3>Make it yours</h3>' +
      '<p>The <b>Creator Studio</b> is the heart of Animazing: upload PNG portraits, write heroes, invent ability cards with the same effect system the samples use, then export it all as a content pack file.</p>' +
      '</div>';
    AZ.ui.modal({ title: 'Codex', body: body, wide: true, cls: 'modal-tall' });
  }
  AZ.screens.codexOpen = showCodex;

})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

/* Animazing — Creator Studio.
   The player's upload bay and authoring desk: create heroes, ability cards,
   relics and enemies with uploaded PNG art and custom text. Creations are
   stored in the browser (localStorage + IndexedDB), join the live game
   immediately (collection, decks, summon pool, enemy pool), and can be
   exported as content-pack files that later graduate into packs/ as a
   permanent part of the game. */
(function (AZ) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = AZ.util.esc;
  var S = { tab: 'characters', currentId: null, current: null, isNew: false };
  var uidN = 0;
  function fid() { uidN++; return 'stf-' + uidN; }

  var TABS = [
    { key: 'characters', label: 'Heroes' },
    { key: 'cards', label: 'Ability Cards' },
    { key: 'items', label: 'Relics' },
    { key: 'enemies', label: 'Enemies' },
    { key: 'packs', label: 'Packs & Export' }
  ];

  /* ================= templates ================= */

  function newId(prefix, name) { return prefix + '-' + AZ.util.slug(name || 'new') + '-' + Math.random().toString(36).slice(2, 7); }

  function newCharacter() {
    return { id: newId('ch-x'), name: 'New Hero', title: '', rarity: 'R', element: 'flame', role: 'striker',
      stats: { hp: 40, energy: 3, draw: 5, speed: 5 }, lore: '', glyph: '', imageId: null, innate: null, inGacha: true };
  }
  function newCard() {
    var owner = AZ.content.characters()[0];
    return { id: newId('ab-x'), name: 'New Ability', owner: owner ? owner.id : '*', rarity: 'R', type: 'attack', cost: 1,
      tags: [], flavor: '', imageId: null, exhaust: false, retain: false, inGacha: true,
      effects: [{ op: 'damage', amount: 6, target: 'foe' }] };
  }
  function newItem() {
    return { id: newId('it-x'), name: 'New Relic', rarity: 'R', slot: 'charm', tags: [], flavor: '', imageId: null,
      statMods: {}, hooks: [], inGacha: true };
  }
  function newEnemy() {
    return { id: newId('en-x'), name: 'New Enemy', element: 'shadow', glyph: '', imageId: null,
      stats: { hp: 30, speed: 5 }, elite: false, boss: false, sequence: false, innate: null,
      moves: [{ name: 'Claw', weight: 1, intent: 'attack', effects: [{ op: 'damage', amount: 6, target: 'foe' }] }] };
  }

  /* ================= screen ================= */

  AZ.screens.studio = {
    render: function () {
      var el = AZ.ui.screenEl('studio');
      var h = '<div class="studio-wrap">';
      h += '<div class="screen-head"><h2 class="screen-title gold-text">Creator Studio</h2>' +
        '<div class="screen-note">Upload PNG art, write the text, and it becomes part of the game and its meta — instantly. ' +
        'Creations live in this browser; use <b>Packs &amp; Export</b> to save them as files (and later make them permanent).</div></div>';
      h += '<div class="tab-row">' + TABS.map(function (t) {
        return '<button class="tab-btn' + (S.tab === t.key ? ' tab-active' : '') + '" data-tab="' + t.key + '">' + t.label + '</button>';
      }).join('') + '</div>';
      h += '<div class="studio-layout"><aside class="studio-side" id="st-list"></aside><div class="studio-main" id="st-main"></div></div>';
      h += '</div>';
      el.innerHTML = h;
      el.querySelectorAll('.tab-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          S.tab = b.getAttribute('data-tab');
          S.current = null; S.currentId = null; S.isNew = false;
          AZ.screens.studio.render();
        });
      });
      if (S.tab === 'packs') { renderPacks(); return; }
      renderList();
      renderForm();
    }
  };

  function listFor(kind) {
    var list = { characters: AZ.content.characters(), cards: AZ.content.cards(), items: AZ.content.items(), enemies: AZ.content.enemies() }[kind] || [];
    return list.slice().sort(function (a, b) {
      var ca = AZ.content.isCustom(kind, a.id) ? 0 : 1;
      var cb = AZ.content.isCustom(kind, b.id) ? 0 : 1;
      return ca - cb;
    });
  }

  function renderList() {
    var side = document.getElementById('st-list');
    var list = listFor(S.tab);
    var h = '<button class="btn btn-gold st-new" id="st-new">+ New</button><div class="st-entries">';
    list.forEach(function (e) {
      var isCustom = AZ.content.isCustom(S.tab, e.id);
      h += '<div class="st-entry' + (S.currentId === e.id ? ' st-active' : '') + '" data-id="' + esc(e.id) + '">' +
        '<span class="st-entry-name">' + esc(e.name) + '</span>' +
        '<span class="st-entry-badges">' + (isCustom ? '<i class="st-b-custom">yours</i>' : (e.sample ? '<i class="st-b-sample">sample</i>' : '<i class="st-b-pack">pack</i>')) + '</span>' +
        '</div>';
    });
    h += '</div>';
    side.innerHTML = h;
    side.querySelector('#st-new').addEventListener('click', function () {
      S.current = { characters: newCharacter, cards: newCard, items: newItem, enemies: newEnemy }[S.tab]();
      S.currentId = S.current.id;
      S.isNew = true;
      renderList(); renderForm();
    });
    side.querySelectorAll('.st-entry').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id');
        var entity = { characters: AZ.content.getCharacter, cards: AZ.content.getCard, items: AZ.content.getItem, enemies: AZ.content.getEnemy }[S.tab](id);
        S.current = AZ.util.deepClone(entity);
        S.currentId = id;
        S.isNew = false;
        renderList(); renderForm();
      });
    });
  }

  /* ================= form plumbing ================= */

  function fld(label, inner, hint) {
    return '<div class="field"><label>' + label + (hint ? ' <i class="fld-hint">' + hint + '</i>' : '') + '</label>' + inner + '</div>';
  }
  function inp(id, value, type, attrs) {
    return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
  }
  function ta(id, value, rows) {
    return '<textarea id="' + id + '" rows="' + (rows || 3) + '">' + esc(value || '') + '</textarea>';
  }
  function sel(id, options, value) {
    return '<select id="' + id + '">' + options.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(value) ? ' selected' : '') + '>' + esc(o.l) + '</option>';
    }).join('') + '</select>';
  }
  function raritySel(id, v) { return sel(id, AZ.schema.RARITY_ORDER.map(function (r) { return { v: r, l: r + ' — ' + AZ.schema.RARITIES[r].label }; }), v); }
  function elementSel(id, v) { return sel(id, Object.keys(AZ.schema.ELEMENTS).map(function (k) { return { v: k, l: AZ.schema.ELEMENTS[k].glyph + ' ' + AZ.schema.ELEMENTS[k].label }; }), v); }
  function on(root, id, ev, fn) {
    var el = root.querySelector('#' + id);
    if (el) el.addEventListener(ev, fn);
    return el;
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function parseTags(s) {
    return String(s || '').split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
  }

  /* Art uploader: PNG/JPG/WebP -> IndexedDB, preview, remove. */
  function artUploader(entity, label) {
    var id = fid();
    var html = '<div class="field"><label>' + (label || 'Artwork (PNG upload)') + '</label>' +
      '<div class="art-upload" id="' + id + '">' +
      '<div class="art-preview"><img src="' + AZ.art.artFor(entity) + '" alt=""></div>' +
      '<div class="art-actions">' +
      '<label class="btn btn-ghost btn-sm btn-file">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" class="art-file"></label>' +
      (entity.imageId ? '<button class="btn btn-ghost btn-sm art-clear">Use generated art</button>' : '') +
      '<div class="art-note">' + (entity.imageId ? 'Custom art uploaded ✓' : 'No upload yet — using generated art. Portraits look best square-ish, ≥360px.') + '</div>' +
      '</div></div></div>';
    return { html: html, bind: function (root, refresh) {
      var box = root.querySelector('#' + id);
      box.querySelector('.art-file').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        AZ.storage.fileToDataUrl(file, 640).then(function (dataUrl) {
          var imgId = 'img-' + AZ.util.uid('a');
          return AZ.storage.putImage(imgId, dataUrl).then(function () {
            entity.imageId = imgId;
            AZ.ui.toast('Art uploaded.', 'good');
            refresh();
          });
        }).catch(function (err) { AZ.ui.toast('Upload failed: ' + esc(err.message), 'error'); });
      });
      var clear = box.querySelector('.art-clear');
      if (clear) clear.addEventListener('click', function () { entity.imageId = null; refresh(); });
    } };
  }

  /* ================= effect editor ================= */

  var TOP_OPS = ['damage', 'block', 'heal', 'status', 'energy', 'draw', 'revive', 'cleanse', 'passive', 'random'];
  var SUB_OPS = ['damage', 'block', 'heal', 'status', 'energy', 'draw'];

  function defaultOp(op) {
    switch (op) {
      case 'damage': return { op: 'damage', amount: 6, target: 'foe' };
      case 'block': return { op: 'block', amount: 6, target: 'self' };
      case 'heal': return { op: 'heal', amount: 5, target: 'self' };
      case 'status': return { op: 'status', status: 'strength', stacks: 1, target: 'self' };
      case 'energy': return { op: 'energy', amount: 1 };
      case 'draw': return { op: 'draw', amount: 1 };
      case 'revive': return { op: 'revive', amount: 30, target: 'downed-friend' };
      case 'cleanse': return { op: 'cleanse', target: 'self' };
      case 'passive': return { op: 'passive', passive: { name: 'New Passive', icon: '◆', duration: 2, tags: [], hooks: [{ on: 'roundStart', effects: [{ op: 'block', amount: 3, target: 'all-friends' }] }] } };
      case 'random': return { op: 'random', choices: [[{ op: 'damage', amount: 8, target: 'random-foe' }], [{ op: 'block', amount: 6, target: 'self' }]] };
      default: return { op: op };
    }
  }

  function targetSel(value, cls) {
    var keys = Object.keys(AZ.schema.TARGETS);
    return '<select class="' + cls + '">' + keys.map(function (k) {
      return '<option value="' + k + '"' + (k === value ? ' selected' : '') + '>' + AZ.schema.TARGETS[k].label + '</option>';
    }).join('') + '</select>';
  }
  function statusSel(value, cls) {
    return '<select class="' + cls + '">' + Object.keys(AZ.schema.STATUSES).map(function (k) {
      var s = AZ.schema.STATUSES[k];
      return '<option value="' + k + '"' + (k === value ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>';
    }).join('') + '</select>';
  }

  var SCALES = [
    { v: '', l: 'flat amount' },
    { v: 'perRoundTag', l: '+X per tag played this round' },
    { v: 'perStatusTarget', l: '+X per status stack on target' },
    { v: 'perStatusSelf', l: '+X per status stack on self' },
    { v: 'perSelfBlock', l: '+X per point of own Block' },
    { v: 'perPassive', l: '+X per active passive' }
  ];
  function scaleOf(amount) {
    if (typeof amount !== 'object' || !amount) return '';
    for (var i = 1; i < SCALES.length; i++) if (amount[SCALES[i].v]) return SCALES[i].v;
    return '';
  }

  var CONDS = [
    { v: '', l: 'always' },
    { v: 'tagThisRound', l: 'Combo: tag played this round' },
    { v: 'selfHpBelowPct', l: 'If own HP below %' },
    { v: 'selfHasBlock', l: 'If self has Block' },
    { v: 'targetHasStatus', l: 'If target has status' },
    { v: 'itemTag', l: 'If item with tag equipped' },
    { v: 'passiveActive', l: 'While tagged passive active' },
    { v: 'chance', l: 'Random chance %' }
  ];
  function condOf(op) {
    if (!op.if) return '';
    for (var i = 1; i < CONDS.length; i++) if (op.if[CONDS[i].v] != null) return CONDS[i].v;
    return '';
  }

  /* Renders an editable list of effect ops into rootEl. Mutates `effects`. */
  function effectsEditor(rootEl, effects, opts) {
    opts = opts || {};
    var ops = opts.sub ? SUB_OPS : TOP_OPS;

    function render() {
      var h = '';
      effects.forEach(function (op, i) {
        h += '<div class="fx-row" data-i="' + i + '"><div class="fx-main">';
        h += '<select class="fx-op">' + ops.map(function (o) {
          return '<option value="' + o + '"' + (op.op === o ? ' selected' : '') + '>' + AZ.schema.EFFECT_OPS[o].label + '</option>';
        }).join('') + '</select>';
        h += opFields(op, i);
        h += '<button class="fx-del" title="Remove">✕</button></div>';
        if (!opts.sub) h += condRow(op, i);
        if (op.op === 'passive') h += passiveRow(op, i);
        if (op.op === 'random') h += randomRow(op, i);
        h += '</div>';
      });
      h += '<button class="btn btn-ghost btn-sm fx-add">+ add effect</button>';
      rootEl.innerHTML = h;
      bind();
      if (opts.onChange) opts.onChange();
    }

    function opFields(op, i) {
      var h = '<span class="fx-fields">';
      if (op.op === 'damage') {
        var base = AZ.schema.amountBase(op.amount);
        var sc = scaleOf(op.amount);
        h += numF('amount', base, 'dmg');
        h += '<input class="fx-times" type="number" min="1" max="9" value="' + (op.times || 1) + '" title="hits">';
        h += targetSel(op.target || 'foe', 'fx-target');
        h += '<select class="fx-scale" title="scaling">' + SCALES.map(function (s) { return '<option value="' + s.v + '"' + (sc === s.v ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') + '</select>';
        if (sc) h += scaleParams(op.amount, sc);
      } else if (op.op === 'block' || op.op === 'heal') {
        h += numF('amount', AZ.schema.amountBase(op.amount));
        h += targetSel(op.target || 'self', 'fx-target');
      } else if (op.op === 'status') {
        h += statusSel(op.status, 'fx-status');
        h += numF('stacks', op.stacks != null ? op.stacks : 1);
        h += targetSel(op.target || 'foe', 'fx-target');
      } else if (op.op === 'energy' || op.op === 'draw') {
        h += numF('amount', AZ.schema.amountBase(op.amount) || 1);
      } else if (op.op === 'revive') {
        h += numF('amount', AZ.schema.amountBase(op.amount) || 30) + '<span class="fx-lbl">% HP</span>';
      } else if (op.op === 'cleanse') {
        h += targetSel(op.target || 'self', 'fx-target');
      }
      h += '</span>';
      return h;
    }
    function numF(k, v, title) {
      return '<input class="fx-num fx-' + k + '" type="number" value="' + v + '" title="' + (title || k) + '">';
    }
    function scaleParams(amount, sc) {
      var p = amount && typeof amount === 'object' ? amount[sc] || {} : {};
      var h = '<span class="fx-scale-params">';
      if (sc === 'perRoundTag' || sc === 'perPassive' ) h += '<input class="fx-sc-tag" type="text" placeholder="tag" value="' + esc(p.tag || '') + '">';
      if (sc === 'perStatusTarget' || sc === 'perStatusSelf') h += statusSel(p.status || 'poison', 'fx-sc-status');
      h += '<input class="fx-sc-mult" type="number" placeholder="×" value="' + (p.mult != null ? p.mult : 1) + '" title="amount per stack/tag">';
      h += '</span>';
      return h;
    }
    function condRow(op, i) {
      var c = condOf(op);
      var h = '<div class="fx-cond"><span class="fx-lbl">when</span><select class="fx-cond-sel">' +
        CONDS.map(function (cc) { return '<option value="' + cc.v + '"' + (c === cc.v ? ' selected' : '') + '>' + cc.l + '</option>'; }).join('') + '</select>';
      if (c === 'tagThisRound') h += '<input class="fx-cond-tag" placeholder="tag" value="' + esc(op.if.tagThisRound || '') + '">' +
        '<input class="fx-cond-min" type="number" min="1" value="' + (op.if.minCount || 1) + '" title="minimum count">';
      if (c === 'selfHpBelowPct') h += '<input class="fx-cond-num" type="number" value="' + (op.if.selfHpBelowPct || 50) + '">';
      if (c === 'targetHasStatus') h += statusSel(op.if.targetHasStatus || 'poison', 'fx-cond-status');
      if (c === 'itemTag') h += '<input class="fx-cond-tag" placeholder="tag" value="' + esc(op.if.itemTag || '') + '">';
      if (c === 'passiveActive') h += '<input class="fx-cond-tag" placeholder="tag or name" value="' + esc(op.if.passiveActive || '') + '">';
      if (c === 'chance') h += '<input class="fx-cond-num" type="number" min="1" max="100" value="' + Math.round((op.if.chance || 0.5) * 100) + '">';
      h += '</div>';
      return h;
    }
    function passiveRow(op, i) {
      var p = op.passive;
      var hook = p.hooks[0] || { on: 'roundStart', effects: [] };
      p.hooks[0] = hook;
      var trigs = ['roundStart', 'roundEnd', 'turnStart', 'cardPlayed', 'unitDamaged', 'foeDefeated', 'modifyDamage'];
      var h = '<div class="fx-passive"><div class="fx-p-line">' +
        '<input class="fx-p-name" placeholder="passive name" value="' + esc(p.name) + '">' +
        '<input class="fx-p-icon" placeholder="◆" value="' + esc(p.icon || '') + '" title="icon (emoji)">' +
        '<input class="fx-p-dur" type="number" value="' + (p.duration != null ? p.duration : 2) + '" title="rounds (-1 = whole battle)">' +
        '<input class="fx-p-tags" placeholder="tags (comma)" value="' + esc((p.tags || []).join(', ')) + '">' +
        '</div><div class="fx-p-line"><span class="fx-lbl">trigger</span>' +
        '<select class="fx-p-trig">' + trigs.map(function (t) {
          return '<option value="' + t + '"' + (hook.on === t ? ' selected' : '') + '>' + (AZ.schema.TRIGGERS[t] || {}).label + '</option>';
        }).join('') + '</select>';
      if (hook.on === 'cardPlayed') h += '<input class="fx-p-tagfilter" placeholder="only tag (optional)" value="' + esc(hook.tagFilter || '') + '">';
      if (hook.on === 'modifyDamage') h += '<input class="fx-p-modtags" placeholder="tags (comma)" value="' + esc((hook.tags || []).join(', ')) + '">' +
        '<span class="fx-lbl">+dmg</span><input class="fx-p-modadd" type="number" value="' + (hook.add || 1) + '">';
      h += '</div>';
      if (hook.on !== 'modifyDamage') h += '<div class="fx-sub" data-sub="passive"></div>';
      h += '</div>';
      return h;
    }
    function randomRow(op, i) {
      var h = '<div class="fx-random">';
      op.choices.forEach(function (choice, ci) {
        h += '<div class="fx-choice"><div class="fx-choice-head">outcome ' + (ci + 1) +
          (op.choices.length > 2 ? ' <button class="fx-choice-del" data-ci="' + ci + '">✕</button>' : '') +
          '</div><div class="fx-sub" data-sub="choice" data-ci="' + ci + '"></div></div>';
      });
      if (op.choices.length < 4) h += '<button class="btn btn-ghost btn-sm fx-choice-add">+ outcome</button>';
      h += '</div>';
      return h;
    }

    function bind() {
      rootEl.querySelectorAll('.fx-row').forEach(function (row) {
        var i = parseInt(row.getAttribute('data-i'), 10);
        var op = effects[i];
        row.querySelector('.fx-op').addEventListener('change', function (e) {
          effects[i] = defaultOp(e.target.value);
          render();
        });
        row.querySelector('.fx-del').addEventListener('click', function () {
          effects.splice(i, 1);
          render();
        });
        function reread() {
          var q = function (s) { return row.querySelector(s); };
          if (op.op === 'damage') {
            var scSel = q('.fx-scale').value;
            var base = num(q('.fx-amount').value, 0);
            if (!scSel) op.amount = base;
            else {
              var spec = { base: base };
              var param = { mult: q('.fx-sc-mult') ? num(q('.fx-sc-mult').value, 1) : 1 };
              if (q('.fx-sc-tag')) param.tag = q('.fx-sc-tag').value.trim().toLowerCase();
              if (q('.fx-sc-status')) param.status = q('.fx-sc-status').value;
              spec[scSel] = param;
              op.amount = spec;
            }
            op.times = Math.max(1, num(q('.fx-times').value, 1));
            if (op.times === 1) delete op.times;
            op.target = q('.fx-target').value;
          } else if (op.op === 'block' || op.op === 'heal') {
            op.amount = num(q('.fx-amount').value, 0);
            op.target = q('.fx-target').value;
          } else if (op.op === 'status') {
            op.status = q('.fx-status').value;
            op.stacks = num(q('.fx-stacks').value, 1);
            op.target = q('.fx-target').value;
          } else if (op.op === 'energy' || op.op === 'draw') {
            op.amount = num(q('.fx-amount').value, 1);
          } else if (op.op === 'revive') {
            op.amount = num(q('.fx-amount').value, 30);
            op.target = 'downed-friend';
          } else if (op.op === 'cleanse') {
            op.target = q('.fx-target').value;
          }
          /* condition */
          var condSel = q('.fx-cond-sel');
          if (condSel) {
            var c = condSel.value;
            if (!c) delete op.if;
            else {
              op.if = {};
              if (c === 'tagThisRound') {
                op.if.tagThisRound = (q('.fx-cond-tag') ? q('.fx-cond-tag').value.trim().toLowerCase() : '');
                var mc = q('.fx-cond-min') ? num(q('.fx-cond-min').value, 1) : 1;
                if (mc > 1) op.if.minCount = mc;
              }
              if (c === 'selfHpBelowPct') op.if.selfHpBelowPct = q('.fx-cond-num') ? num(q('.fx-cond-num').value, 50) : 50;
              if (c === 'selfHasBlock') op.if.selfHasBlock = true;
              if (c === 'targetHasStatus') op.if.targetHasStatus = q('.fx-cond-status') ? q('.fx-cond-status').value : 'poison';
              if (c === 'itemTag') op.if.itemTag = q('.fx-cond-tag') ? q('.fx-cond-tag').value.trim().toLowerCase() : '';
              if (c === 'passiveActive') op.if.passiveActive = q('.fx-cond-tag') ? q('.fx-cond-tag').value.trim().toLowerCase() : '';
              if (c === 'chance') op.if.chance = (q('.fx-cond-num') ? num(q('.fx-cond-num').value, 50) : 50) / 100;
            }
          }
          /* passive sub-fields */
          if (op.op === 'passive') {
            var p = op.passive;
            p.name = q('.fx-p-name').value || 'Passive';
            p.icon = q('.fx-p-icon').value || '◆';
            p.duration = num(q('.fx-p-dur').value, 2);
            p.tags = parseTags(q('.fx-p-tags').value);
            var hook = p.hooks[0];
            hook.on = q('.fx-p-trig').value;
            if (hook.on === 'cardPlayed') hook.tagFilter = q('.fx-p-tagfilter') ? q('.fx-p-tagfilter').value.trim().toLowerCase() || undefined : undefined;
            else delete hook.tagFilter;
            if (hook.on === 'modifyDamage') {
              hook.tags = q('.fx-p-modtags') ? parseTags(q('.fx-p-modtags').value) : [];
              hook.add = q('.fx-p-modadd') ? num(q('.fx-p-modadd').value, 1) : 1;
              delete hook.effects;
            } else {
              delete hook.tags; delete hook.add;
              hook.effects = hook.effects || [];
            }
          }
          if (opts.onChange) opts.onChange();
        }
        row.querySelectorAll('select, input').forEach(function (ctl) {
          if (ctl.classList.contains('fx-op')) return;
          ctl.addEventListener('change', function () {
            var needsRerender = ctl.classList.contains('fx-scale') || ctl.classList.contains('fx-cond-sel') || ctl.classList.contains('fx-p-trig');
            reread();
            if (needsRerender) render();
          });
          ctl.addEventListener('input', reread);
        });
        /* nested editors */
        if (op.op === 'passive') {
          var subEl = row.querySelector('[data-sub="passive"]');
          if (subEl) effectsEditor(subEl, op.passive.hooks[0].effects = op.passive.hooks[0].effects || [], { sub: true, onChange: opts.onChange });
        }
        if (op.op === 'random') {
          row.querySelectorAll('[data-sub="choice"]').forEach(function (subEl) {
            var ci = parseInt(subEl.getAttribute('data-ci'), 10);
            effectsEditor(subEl, op.choices[ci], { sub: true, onChange: opts.onChange });
          });
          var addC = row.querySelector('.fx-choice-add');
          if (addC) addC.addEventListener('click', function () {
            op.choices.push([{ op: 'damage', amount: 6, target: 'random-foe' }]);
            render();
          });
          row.querySelectorAll('.fx-choice-del').forEach(function (d) {
            d.addEventListener('click', function () {
              op.choices.splice(parseInt(d.getAttribute('data-ci'), 10), 1);
              render();
            });
          });
        }
      });
      var add = rootEl.querySelector('.fx-add');
      if (add) add.addEventListener('click', function () {
        effects.push(defaultOp(opts.sub ? 'damage' : 'damage'));
        render();
      });
    }

    render();
    return { render: render };
  }

  function jsonEditButton(effectsArr, onApplied) {
    var id = fid();
    return { html: '<button class="btn btn-ghost btn-sm" id="' + id + '">Edit as JSON (advanced)</button>',
      bind: function (root) {
        on(root, id, 'click', function () {
          var m = AZ.ui.modal({
            title: 'Effects JSON',
            body: '<textarea class="json-ta" rows="16">' + esc(JSON.stringify(effectsArr, null, 2)) + '</textarea>' +
              '<div class="set-note">The full DSL is documented in docs/DESIGN.md — targets, scaling amounts, conditions, passives, chaos.</div>',
            wide: true,
            actions: [
              { label: 'Apply', cls: 'btn-gold', onClick: function (api) {
                try {
                  var parsed = JSON.parse(api.el.querySelector('.json-ta').value);
                  if (!Array.isArray(parsed)) throw new Error('Must be a JSON array of effect ops.');
                  var errs = [];
                  AZ.schema.validateCard({ name: 'x', rarity: 'N', type: 'attack', cost: 0, owner: '*', effects: parsed }).forEach(function (e) {
                    if (e.indexOf('effect') >= 0 || e.indexOf('passive') >= 0) errs.push(e);
                  });
                  if (errs.length) { AZ.ui.toast(errs[0], 'error'); return true; }
                  effectsArr.splice.apply(effectsArr, [0, effectsArr.length].concat(parsed));
                  onApplied();
                } catch (err) { AZ.ui.toast('Invalid JSON: ' + esc(err.message), 'error'); return true; }
              } },
              { label: 'Cancel', cls: 'btn-ghost' }
            ]
          });
        });
      } };
  }

  /* ================= forms per kind ================= */

  function renderForm() {
    var main = document.getElementById('st-main');
    if (!S.current) {
      main.innerHTML = '<div class="st-placeholder"><div class="st-ph-glyph">✒</div>' +
        '<p>Select an entry to edit — or press <b>+ New</b> to begin.</p>' +
        '<p class="set-note">Samples can’t be edited directly, but open one and press “Duplicate as mine” to use it as a scaffold.</p></div>';
      return;
    }
    var isCustom = S.isNew || AZ.content.isCustom(S.tab, S.currentId);
    if (S.tab === 'characters') charForm(main, isCustom);
    else if (S.tab === 'cards') cardForm(main, isCustom);
    else if (S.tab === 'items') itemForm(main, isCustom);
    else if (S.tab === 'enemies') enemyForm(main, isCustom);
  }

  function formShell(main, formHtml, previewLabel) {
    main.innerHTML = '<div class="st-form-grid"><div class="st-form">' + formHtml + '</div>' +
      '<div class="st-preview"><div class="st-preview-label">' + (previewLabel || 'Live preview') + '</div><div id="st-preview-body"></div></div></div>';
  }

  function actionRow(isCustom) {
    var h = '<div class="st-actions">';
    if (isCustom) {
      h += '<button class="btn btn-gold" id="st-save">Save to game</button>';
      if (!S.isNew) h += '<button class="btn btn-crimson" id="st-delete">Delete</button>';
    } else {
      h += '<button class="btn btn-gold" id="st-dup">Duplicate as mine</button>' +
        '<span class="set-note">Samples are read-only scaffolding.</span>';
    }
    h += '</div>';
    return h;
  }

  function bindCommonActions(main, isCustom, buildEntity, kind, afterSave) {
    if (!isCustom) {
      on(main, 'st-dup', 'click', function () {
        var copy = AZ.util.deepClone(S.current);
        copy.id = newId({ characters: 'ch-x', cards: 'ab-x', items: 'it-x', enemies: 'en-x' }[kind], copy.name);
        copy.name = copy.name + ' (mine)';
        delete copy.sample;
        S.current = copy;
        S.currentId = copy.id;
        S.isNew = true;
        renderList(); renderForm();
      });
      return;
    }
    on(main, 'st-save', 'click', function () {
      var entity = buildEntity();
      var errs = AZ.content.saveCustom(kind, entity);
      if (errs.length) { AZ.ui.toast(errs[0], 'error'); return; }
      S.isNew = false;
      S.currentId = entity.id;
      if (afterSave) afterSave(entity);
      AZ.ui.toast('“' + esc(entity.name) + '” saved into the game.', 'good');
      renderList();
    });
    on(main, 'st-delete', 'click', function () {
      AZ.ui.confirmModal('Delete “' + esc(S.current.name) + '” from your content? Decks and teams that used it are cleaned up.', function () {
        AZ.content.deleteCustom(kind, S.currentId);
        cleanupAfterDelete(kind, S.currentId);
        S.current = null; S.currentId = null;
        AZ.screens.studio.render();
      }, { danger: true, yesLabel: 'Delete' });
    });
  }

  function cleanupAfterDelete(kind, id) {
    var p = AZ.state.get();
    if (kind === 'characters') {
      p.team.members = p.team.members.filter(function (m) { return m !== id; });
      delete p.team.decks[id];
      delete p.team.equips[id];
      delete p.ownedChars[id];
    }
    if (kind === 'cards') {
      Object.keys(p.team.decks).forEach(function (cid) {
        p.team.decks[cid] = p.team.decks[cid].filter(function (c) { return c !== id; });
      });
      delete p.ownedCards[id];
    }
    if (kind === 'items') {
      Object.keys(p.team.equips).forEach(function (cid) {
        p.team.equips[cid] = p.team.equips[cid].filter(function (i) { return i !== id; });
      });
      delete p.ownedItems[id];
    }
    AZ.state.save();
  }

  /* ---------- hero form ---------- */

  function charForm(main, isCustom) {
    var c = S.current;
    var art = artUploader(c, 'Portrait (PNG upload)');
    var innateOn = !!c.innate;
    var h = '<div class="st-form-title">' + (S.isNew ? 'New Hero' : esc(c.name)) + '</div>';
    h += '<div class="fld-grid">';
    h += fld('Name', inp('cf-name', c.name));
    h += fld('Title', inp('cf-title', c.title, 'text', 'placeholder="e.g. The Cinder Duelist"'));
    h += fld('Rarity', raritySel('cf-rarity', c.rarity));
    h += fld('Element', elementSel('cf-element', c.element));
    h += fld('Role', sel('cf-role', Object.keys(AZ.schema.ROLES).map(function (k) { return { v: k, l: AZ.schema.ROLES[k].icon + ' ' + AZ.schema.ROLES[k].label }; }), c.role));
    h += fld('Portrait glyph', inp('cf-glyph', c.glyph || '', 'text', 'maxlength="2" placeholder="炎 (used by generated art)"'));
    h += '</div><div class="fld-grid">';
    h += fld('Max HP', inp('cf-hp', c.stats.hp, 'number', 'min="1" max="999"'));
    h += fld('Energy / turn', inp('cf-energy', c.stats.energy, 'number', 'min="1" max="9"'));
    h += fld('Cards drawn', inp('cf-draw', c.stats.draw, 'number', 'min="1" max="10"'));
    h += fld('Speed', inp('cf-speed', c.stats.speed, 'number', 'min="1" max="99"'));
    h += '</div>';
    h += art.html;
    h += fld('Lore', ta('cf-lore', c.lore, 4), 'the custom text that gives them a soul');
    h += '<div class="field"><label><input type="checkbox" id="cf-gacha"' + (c.inGacha !== false ? ' checked' : '') + '> Appears in the Summon Altar pool</label></div>';
    h += '<div class="field"><label><input type="checkbox" id="cf-innate"' + (innateOn ? ' checked' : '') + '> Innate passive (always active in battle)</label></div>';
    h += '<div id="cf-innate-box" class="' + (innateOn ? '' : 'hidden') + '"><div class="fx-holder" id="cf-innate-ed"></div></div>';
    h += actionRow(isCustom);
    formShell(main, h, 'Collection card');

    function refreshPreview() {
      document.getElementById('st-preview-body').innerHTML =
        AZ.ui.charCardHTML(c, { level: 1 }) +
        (c.innate ? '<div class="hd-innate st-pv-innate"><b>' + esc(c.innate.icon || '◆') + ' ' + esc(c.innate.name || 'Innate') + '</b> — ' +
          esc(AZ.schema.passiveToText(c.innate)) + '</div>' : '');
    }
    function rebind(sel2, key, isNum, target) {
      on(main, sel2, 'input', function (e) {
        var v = isNum ? num(e.target.value, 0) : e.target.value;
        (target || c)[key] = v;
        refreshPreview();
      });
    }
    rebind('cf-name', 'name'); rebind('cf-title', 'title'); rebind('cf-glyph', 'glyph'); rebind('cf-lore', 'lore');
    rebind('cf-hp', 'hp', true, c.stats); rebind('cf-energy', 'energy', true, c.stats);
    rebind('cf-draw', 'draw', true, c.stats); rebind('cf-speed', 'speed', true, c.stats);
    on(main, 'cf-rarity', 'change', function (e) { c.rarity = e.target.value; refreshPreview(); });
    on(main, 'cf-element', 'change', function (e) { c.element = e.target.value; refreshPreview(); });
    on(main, 'cf-role', 'change', function (e) { c.role = e.target.value; refreshPreview(); });
    on(main, 'cf-gacha', 'change', function (e) { c.inGacha = e.target.checked; });
    on(main, 'cf-innate', 'change', function (e) {
      if (e.target.checked) {
        c.innate = c.innate || { name: c.name + '’s Gift', icon: '◆', duration: -1, tags: [], hooks: [{ on: 'roundStart', effects: [{ op: 'block', amount: 2, target: 'self' }] }] };
        main.querySelector('#cf-innate-box').classList.remove('hidden');
        mountInnate();
      } else {
        c.innate = null;
        main.querySelector('#cf-innate-box').classList.add('hidden');
      }
      refreshPreview();
    });
    function mountInnate() {
      var holder = main.querySelector('#cf-innate-ed');
      holder.innerHTML = '';
      var wrap = document.createElement('div');
      holder.appendChild(wrap);
      effectsEditor(wrap, [{ op: 'passive', passive: c.innate }], { onChange: refreshPreview });
    }
    if (innateOn) mountInnate();
    art.bind(main, function () { renderForm(); });
    refreshPreview();
    bindCommonActions(main, isCustom, function () { return AZ.util.deepClone(c); }, 'characters', function (entity) {
      if (!AZ.state.ownsChar(entity.id)) AZ.state.grantCharacter(entity.id);
    });
  }

  /* ---------- ability card form ---------- */

  function cardForm(main, isCustom) {
    var c = S.current;
    c.effects = c.effects || [];
    var art = artUploader(c, 'Card art (PNG upload, optional — falls back to owner portrait)');
    var owners = [{ v: '*', l: '✦ Universal (any hero)' }].concat(AZ.content.characters().map(function (ch) { return { v: ch.id, l: ch.name }; }));
    var jsonBtn = jsonEditButton(c.effects, function () { renderForm(); });

    var h = '<div class="st-form-title">' + (S.isNew ? 'New Ability Card' : esc(c.name)) + '</div>';
    h += '<div class="fld-grid">';
    h += fld('Name', inp('af-name', c.name));
    h += fld('Owner', sel('af-owner', owners, c.owner));
    h += fld('Type', sel('af-type', Object.keys(AZ.schema.CARD_TYPES).map(function (k) { return { v: k, l: AZ.schema.CARD_TYPES[k].label }; }), c.type));
    h += fld('Rarity', raritySel('af-rarity', c.rarity));
    h += fld('Energy cost', inp('af-cost', c.cost, 'number', 'min="0" max="9"'));
    h += fld('Tags', inp('af-tags', (c.tags || []).join(', '), 'text', 'placeholder="fire, blade"'), 'combo fuel — comma separated');
    h += '</div>';
    h += fld('Flavor text', ta('af-flavor', c.flavor, 2));
    h += '<div class="field st-checks"><label><input type="checkbox" id="af-exhaust"' + (c.exhaust ? ' checked' : '') + '> Exhaust (once per battle)</label>' +
      '<label><input type="checkbox" id="af-retain"' + (c.retain ? ' checked' : '') + '> Retain (kept in hand)</label>' +
      '<label><input type="checkbox" id="af-gacha"' + (c.inGacha !== false ? ' checked' : '') + '> In ability-pack pool</label></div>';
    h += art.html;
    h += '<div class="field"><label>Effects <i class="fld-hint">this is the machinery of the card</i></label><div class="fx-holder" id="af-effects"></div>' + jsonBtn.html + '</div>';
    h += actionRow(isCustom);
    formShell(main, h, 'Card preview (exactly as in game)');

    function refreshPreview() {
      document.getElementById('st-preview-body').innerHTML = AZ.ui.cardHTML(c, { showOwner: true, noTilt: false });
    }
    on(main, 'af-name', 'input', function (e) { c.name = e.target.value; refreshPreview(); });
    on(main, 'af-owner', 'change', function (e) { c.owner = e.target.value; refreshPreview(); });
    on(main, 'af-type', 'change', function (e) { c.type = e.target.value; refreshPreview(); });
    on(main, 'af-rarity', 'change', function (e) { c.rarity = e.target.value; refreshPreview(); });
    on(main, 'af-cost', 'input', function (e) { c.cost = num(e.target.value, 0); refreshPreview(); });
    on(main, 'af-tags', 'input', function (e) { c.tags = parseTags(e.target.value); refreshPreview(); });
    on(main, 'af-flavor', 'input', function (e) { c.flavor = e.target.value; refreshPreview(); });
    on(main, 'af-exhaust', 'change', function (e) { c.exhaust = e.target.checked; refreshPreview(); });
    on(main, 'af-retain', 'change', function (e) { c.retain = e.target.checked; refreshPreview(); });
    on(main, 'af-gacha', 'change', function (e) { c.inGacha = e.target.checked; });
    effectsEditor(main.querySelector('#af-effects'), c.effects, { onChange: refreshPreview });
    jsonBtn.bind(main);
    art.bind(main, function () { renderForm(); });
    refreshPreview();
    bindCommonActions(main, isCustom, function () { return AZ.util.deepClone(c); }, 'cards', function (entity) {
      var have = AZ.state.cardCount(entity.id);
      if (have < 2 && have !== 99) AZ.state.grantCard(entity.id, 2 - have);
    });
  }

  /* ---------- relic form ---------- */

  function itemForm(main, isCustom) {
    var c = S.current;
    c.statMods = c.statMods || {};
    c.hooks = c.hooks || [];
    var art = artUploader(c, 'Relic art (PNG upload, optional)');
    var h = '<div class="st-form-title">' + (S.isNew ? 'New Relic' : esc(c.name)) + '</div>';
    h += '<div class="fld-grid">';
    h += fld('Name', inp('if-name', c.name));
    h += fld('Rarity', raritySel('if-rarity', c.rarity));
    h += fld('Slot', sel('if-slot', [{ v: 'weapon', l: 'Weapon' }, { v: 'armor', l: 'Armor' }, { v: 'charm', l: 'Charm' }], c.slot));
    h += fld('Tags', inp('if-tags', (c.tags || []).join(', '), 'text', 'placeholder="fire, war"'));
    h += '</div><div class="fld-grid">';
    h += fld('+Max HP', inp('if-hp', c.statMods.hp || 0, 'number', ''));
    h += fld('+Energy', inp('if-energy', c.statMods.energy || 0, 'number', 'min="-2" max="3"'));
    h += fld('+Draw', inp('if-draw', c.statMods.draw || 0, 'number', 'min="-2" max="3"'));
    h += fld('Gold bonus %', inp('if-gold', Math.round((c.goldBonus || 0) * 100), 'number', 'min="0" max="200"'));
    h += '</div>';
    h += fld('Flavor text', ta('if-flavor', c.flavor, 2));
    h += art.html;
    h += '<div class="field"><label>Battle hook <i class="fld-hint">what the relic does during combat</i></label><div class="fx-holder" id="if-hooks"></div></div>';
    h += '<div class="field"><label><input type="checkbox" id="if-gacha"' + (c.inGacha !== false ? ' checked' : '') + '> In relic-cache pool</label></div>';
    h += actionRow(isCustom);
    formShell(main, h, 'Relic preview');

    function refreshPreview() {
      document.getElementById('st-preview-body').innerHTML = AZ.ui.itemHTML(c, {});
    }
    on(main, 'if-name', 'input', function (e) { c.name = e.target.value; refreshPreview(); });
    on(main, 'if-rarity', 'change', function (e) { c.rarity = e.target.value; refreshPreview(); });
    on(main, 'if-slot', 'change', function (e) { c.slot = e.target.value; refreshPreview(); });
    on(main, 'if-tags', 'input', function (e) { c.tags = parseTags(e.target.value); refreshPreview(); });
    on(main, 'if-flavor', 'input', function (e) { c.flavor = e.target.value; refreshPreview(); });
    on(main, 'if-gacha', 'change', function (e) { c.inGacha = e.target.checked; });
    ['hp', 'energy', 'draw'].forEach(function (k) {
      on(main, 'if-' + k, 'input', function (e) {
        var v = num(e.target.value, 0);
        if (v) c.statMods[k] = v; else delete c.statMods[k];
        refreshPreview();
      });
    });
    on(main, 'if-gold', 'input', function (e) {
      var v = num(e.target.value, 0) / 100;
      if (v) c.goldBonus = v; else delete c.goldBonus;
      refreshPreview();
    });
    /* Hook editor: reuse the passive row machinery via a wrapper op. */
    var hookWrap = c.hooks.length
      ? [{ op: 'passive', passive: { name: c.name, icon: '宝', duration: -1, tags: c.tags || [], hooks: c.hooks } }]
      : [];
    var holder = main.querySelector('#if-hooks');
    var hookOps = hookWrap.length ? hookWrap : [{ op: 'passive', passive: { name: 'hook', icon: '宝', duration: -1, tags: [], hooks: [{ on: 'battleStart', effects: [] }] } }];
    if (!c.hooks.length) c.hooks = hookOps[0].passive.hooks;
    else hookOps[0].passive.hooks = c.hooks;
    effectsEditor(holder, hookOps, { onChange: function () {
      c.hooks = hookOps[0] && hookOps[0].op === 'passive' ? hookOps[0].passive.hooks : [];
      refreshPreview();
    } });
    art.bind(main, function () { renderForm(); });
    refreshPreview();
    bindCommonActions(main, isCustom, function () {
      var out = AZ.util.deepClone(c);
      /* strip empty hooks */
      out.hooks = (out.hooks || []).filter(function (hk) { return hk.on === 'modifyDamage' ? true : (hk.effects || []).length; });
      return out;
    }, 'items', function (entity) {
      if (AZ.state.itemCount(entity.id) < 1) AZ.state.grantItem(entity.id, 1);
    });
  }

  /* ---------- enemy form ---------- */

  function enemyForm(main, isCustom) {
    var c = S.current;
    c.moves = c.moves || [];
    var art = artUploader(c, 'Enemy art (PNG upload)');
    var h = '<div class="st-form-title">' + (S.isNew ? 'New Enemy' : esc(c.name)) + '</div>';
    h += '<div class="fld-grid">';
    h += fld('Name', inp('ef-name', c.name));
    h += fld('Element', elementSel('ef-element', c.element));
    h += fld('Glyph', inp('ef-glyph', c.glyph || '', 'text', 'maxlength="2" placeholder="鬼"'));
    h += fld('Max HP', inp('ef-hp', c.stats.hp, 'number', 'min="1"'));
    h += fld('Speed', inp('ef-speed', c.stats.speed, 'number', 'min="1" max="99"'));
    h += '</div>';
    h += '<div class="field st-checks">' +
      '<label><input type="checkbox" id="ef-elite"' + (c.elite ? ' checked' : '') + '> Elite</label>' +
      '<label><input type="checkbox" id="ef-boss"' + (c.boss ? ' checked' : '') + '> Boss</label>' +
      '<label><input type="checkbox" id="ef-seq"' + (c.sequence ? ' checked' : '') + '> Moves cycle in order (else weighted random)</label></div>';
    h += art.html;
    h += '<div class="field"><label>Moveset <i class="fld-hint">targets are side-relative: “Chosen foe” = one of the player’s heroes</i></label><div id="ef-moves"></div>' +
      '<button class="btn btn-ghost btn-sm" id="ef-add-move">+ add move</button></div>';
    h += actionRow(isCustom);
    formShell(main, h, 'Enemy preview');

    function refreshPreview() {
      var prev = '<div class="unit enemy st-pv-unit"><div class="unit-portrait r-' + (c.boss ? 'UR' : c.elite ? 'SSR' : 'R') + '">' +
        '<img src="' + AZ.art.artFor(c) + '"></div><div class="unit-name">' + esc(c.name) + '</div>' +
        '<div class="hp-row"><div class="hp-bar"><div class="hp-fill" style="width:100%"></div><span class="hp-num">' + c.stats.hp + '/' + c.stats.hp + '</span></div></div></div>';
      prev += '<div class="st-pv-moves">' + (c.moves || []).map(function (m) {
        return '<div class="st-pv-move"><b>' + esc(m.name) + '</b> <i>(' + esc(m.intent || 'attack') + ')</i> — ' + esc(AZ.schema.effectsToText(m.effects)) + '</div>';
      }).join('') + '</div>';
      document.getElementById('st-preview-body').innerHTML = prev;
    }
    on(main, 'ef-name', 'input', function (e) { c.name = e.target.value; refreshPreview(); });
    on(main, 'ef-glyph', 'input', function (e) { c.glyph = e.target.value; refreshPreview(); });
    on(main, 'ef-element', 'change', function (e) { c.element = e.target.value; refreshPreview(); });
    on(main, 'ef-hp', 'input', function (e) { c.stats.hp = num(e.target.value, 1); refreshPreview(); });
    on(main, 'ef-speed', 'input', function (e) { c.stats.speed = num(e.target.value, 5); });
    on(main, 'ef-elite', 'change', function (e) { c.elite = e.target.checked; refreshPreview(); });
    on(main, 'ef-boss', 'change', function (e) { c.boss = e.target.checked; refreshPreview(); });
    on(main, 'ef-seq', 'change', function (e) { c.sequence = e.target.checked; });

    function paintMoves() {
      var box = main.querySelector('#ef-moves');
      box.innerHTML = '';
      c.moves.forEach(function (m, mi) {
        var row = document.createElement('div');
        row.className = 'ef-move';
        row.innerHTML = '<div class="ef-move-head">' +
          '<input class="ef-m-name" value="' + esc(m.name) + '" placeholder="move name">' +
          '<select class="ef-m-intent">' + ['attack', 'defend', 'buff', 'debuff', 'chaos'].map(function (k) {
            return '<option value="' + k + '"' + (m.intent === k ? ' selected' : '') + '>' + k + '</option>';
          }).join('') + '</select>' +
          '<input class="ef-m-weight" type="number" min="1" max="9" value="' + (m.weight || 1) + '" title="weight">' +
          '<button class="fx-del ef-m-del">✕</button></div>' +
          '<div class="ef-m-effects"></div>';
        box.appendChild(row);
        row.querySelector('.ef-m-name').addEventListener('input', function (e) { m.name = e.target.value; refreshPreview(); });
        row.querySelector('.ef-m-intent').addEventListener('change', function (e) { m.intent = e.target.value; refreshPreview(); });
        row.querySelector('.ef-m-weight').addEventListener('input', function (e) { m.weight = num(e.target.value, 1); });
        row.querySelector('.ef-m-del').addEventListener('click', function () {
          c.moves.splice(mi, 1);
          paintMoves(); refreshPreview();
        });
        effectsEditor(row.querySelector('.ef-m-effects'), m.effects = m.effects || [], { sub: true, onChange: refreshPreview });
      });
    }
    paintMoves();
    on(main, 'ef-add-move', 'click', function () {
      c.moves.push({ name: 'New Move', weight: 1, intent: 'attack', effects: [{ op: 'damage', amount: 6, target: 'foe' }] });
      paintMoves(); refreshPreview();
    });
    art.bind(main, function () { renderForm(); });
    refreshPreview();
    bindCommonActions(main, isCustom, function () { return AZ.util.deepClone(c); }, 'enemies', null);
  }

  /* ================= packs panel ================= */

  function renderPacks() {
    var side = document.getElementById('st-list');
    var main = document.getElementById('st-main');
    var counts = AZ.content.counts();
    var custom = AZ.content.customContent();
    side.innerHTML = '<div class="st-pack-side"><div class="panel-title">Your content</div>' +
      '<div class="st-pack-counts">' +
      '<span>Heroes <b>' + custom.characters.length + '</b></span>' +
      '<span>Cards <b>' + custom.cards.length + '</b></span>' +
      '<span>Relics <b>' + custom.items.length + '</b></span>' +
      '<span>Enemies <b>' + custom.enemies.length + '</b></span>' +
      '</div><div class="set-note">Total game content: ' + counts.characters + ' heroes, ' + counts.cards + ' cards, ' +
      counts.items + ' relics, ' + counts.enemies + ' enemies.</div></div>';

    main.innerHTML =
      '<div class="st-form"><div class="st-form-title">Packs &amp; Export</div>' +
      '<p class="st-pack-p">Everything you create lives in <b>this browser</b> (text in localStorage, art in IndexedDB). ' +
      'A <b>content pack</b> bundles your custom heroes, cards, relics, enemies and their uploaded images into one JSON file: ' +
      'your backup, your way to share, and the staging format for making content permanent.</p>' +
      '<p class="st-pack-p">To make a pack part of the game for every player: export the <b>.js pack</b>, drop it into the ' +
      '<code>packs/</code> folder, and add one script tag to <code>index.html</code> (instructions in <code>packs/README.md</code>).</p>' +
      '<div class="fld-grid">' +
      fld('Pack name', inp('pk-name', 'My Animazing Pack')) +
      fld('Author', inp('pk-author', '')) +
      '</div>' +
      '<div class="st-actions">' +
      '<button class="btn btn-gold" id="pk-export-json">⬇ Export pack (.json)</button>' +
      '<button class="btn btn-gold" id="pk-export-js">⬇ Export auto-loading pack (.js)</button>' +
      '<label class="btn btn-ghost btn-file">⬆ Import pack (.json)<input type="file" id="pk-import" accept="application/json"></label>' +
      '</div>' +
      '<div class="st-actions"><button class="btn btn-crimson" id="pk-clear">Clear ALL my custom content</button></div>' +
      '</div>';

    function packMeta() {
      return { name: main.querySelector('#pk-name').value || 'Animazing Pack', author: main.querySelector('#pk-author').value || '' };
    }
    on(main, 'pk-export-json', 'click', function () {
      var pack = AZ.storage.buildContentPack(AZ.content.customContent(), packMeta());
      AZ.storage.downloadJSON(pack, AZ.util.slug(pack.name) + '.animazing-pack.json');
      AZ.ui.toast('Pack exported.', 'good');
    });
    on(main, 'pk-export-js', 'click', function () {
      var pack = AZ.storage.buildContentPack(AZ.content.customContent(), packMeta());
      var js = '/* Animazing content pack — drop into packs/ and register in packs/index.js (see packs/README.md). */\n' +
        '(function () {\n  var root = typeof window !== "undefined" ? window : globalThis;\n' +
        '  root.AZ = root.AZ || {};\n  root.AZ.PACKS = root.AZ.PACKS || [];\n' +
        '  root.AZ.PACKS.push(' + JSON.stringify(packToLayer(pack), null, 2) + ');\n})();\n';
      var blob = new Blob([js], { type: 'text/javascript' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = AZ.util.slug(pack.name) + '.pack.js';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 250);
      AZ.ui.toast('JS pack exported — see packs/README.md to wire it in.', 'good');
    });
    on(main, 'pk-import', 'change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        return AZ.storage.importContentPack(JSON.parse(text));
      }).then(function (result) {
        AZ.content.init();
        grantAllCustom();
        var msg = 'Imported: ' + result.added + ' new, ' + result.replaced + ' updated, ' + result.images + ' images.';
        if (result.errors.length) msg += ' Skipped ' + result.errors.length + ' invalid entries.';
        AZ.ui.toast(msg, result.errors.length ? 'info' : 'good');
        AZ.screens.studio.render();
      }).catch(function (err) { AZ.ui.toast('Import failed: ' + esc(err.message), 'error'); });
    });
    on(main, 'pk-clear', 'click', function () {
      AZ.ui.confirmModal('Delete ALL your custom heroes, cards, relics and enemies? Uploaded art is kept in the browser but unreferenced. Export a pack first!', function () {
        var custom2 = AZ.content.customContent();
        ['characters', 'cards', 'items', 'enemies'].forEach(function (kind) {
          custom2[kind].slice().forEach(function (e2) {
            AZ.content.deleteCustom(kind, e2.id);
            cleanupAfterDelete(kind, e2.id);
          });
        });
        AZ.screens.studio.render();
      }, { danger: true, yesLabel: 'Delete everything' });
    });
  }

  /* Pack JSON (with images map) -> registry layer shape. Images are written
     into the media store on load by main.js. */
  function packToLayer(pack) {
    return {
      packId: AZ.util.slug(pack.name),
      name: pack.name,
      author: pack.author,
      characters: pack.characters,
      cards: pack.cards,
      items: pack.items,
      enemies: pack.enemies,
      images: pack.images
    };
  }

  function grantAllCustom() {
    var custom = AZ.content.customContent();
    custom.characters.forEach(function (ch) { if (!AZ.state.ownsChar(ch.id)) AZ.state.grantCharacter(ch.id); });
    custom.cards.forEach(function (cd) { var have = AZ.state.cardCount(cd.id); if (have < 2 && have !== 99) AZ.state.grantCard(cd.id, 2 - have); });
    custom.items.forEach(function (it) { if (AZ.state.itemCount(it.id) < 1) AZ.state.grantItem(it.id, 1); });
  }
  AZ.studioGrantAllCustom = grantAllCustom;

})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

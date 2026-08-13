/* Animazing — shared UI toolkit: screen router, modals, toasts, 3D tilt,
   and the renderers for cards, hero plates and relics used everywhere. */
(function (AZ) {
  'use strict';
  if (typeof document === 'undefined') return;

  var esc = AZ.util.esc;
  var currentScreen = null;

  /* ---------------- router ---------------- */

  function screenEl(name) { return document.getElementById('screen-' + name); }

  function showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var el = screenEl(name);
    if (!el) return;
    el.classList.add('active');
    currentScreen = name;
    document.getElementById('topbar').classList.toggle('hidden', name === 'title');
    var navBtns = document.querySelectorAll('.nav-btn');
    for (var j = 0; j < navBtns.length; j++) {
      navBtns[j].classList.toggle('nav-active', navBtns[j].getAttribute('data-screen') === name);
    }
    if (AZ.screens && AZ.screens[name] && AZ.screens[name].render) AZ.screens[name].render();
    updateCurrencies();
    el.scrollTop = 0;
  }

  function getCurrentScreen() { return currentScreen; }

  function updateCurrencies() {
    var p = AZ.state.get();
    if (!p) return;
    var g = document.getElementById('cur-gold');
    var c = document.getElementById('cur-crystals');
    if (g) g.textContent = AZ.util.fmt(p.gold);
    if (c) c.textContent = AZ.util.fmt(p.crystals);
  }

  /* ---------------- toast ---------------- */

  function toast(msg, kind) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.innerHTML = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 20);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 400);
    }, 3200);
  }

  /* ---------------- modals ---------------- */

  function modal(opts) {
    var root = document.getElementById('modal-root');
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var box = document.createElement('div');
    box.className = 'modal' + (opts.wide ? ' modal-wide' : '') + (opts.cls ? ' ' + opts.cls : '');
    var html = '';
    if (opts.title) html += '<div class="modal-title"><span>' + opts.title + '</span>' +
      (opts.noClose ? '' : '<button class="modal-x" aria-label="Close">✕</button>') + '</div>';
    html += '<div class="modal-body">' + (opts.body || '') + '</div>';
    if (opts.actions && opts.actions.length) {
      html += '<div class="modal-actions">' + opts.actions.map(function (a, i) {
        return '<button class="btn ' + (a.cls || 'btn-gold') + '" data-action="' + i + '">' + esc(a.label) + '</button>';
      }).join('') + '</div>';
    }
    box.innerHTML = html;
    backdrop.appendChild(box);
    root.appendChild(backdrop);
    setTimeout(function () { backdrop.classList.add('show'); }, 15);

    var api = {
      el: box,
      backdrop: backdrop,
      close: function () {
        backdrop.classList.remove('show');
        setTimeout(function () { backdrop.remove(); }, 260);
        if (opts.onClose) opts.onClose();
      }
    };
    var x = box.querySelector('.modal-x');
    if (x) x.addEventListener('click', api.close);
    if (!opts.noClose && !opts.modalOnly) {
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) api.close(); });
    }
    (opts.actions || []).forEach(function (a, i) {
      var btn = box.querySelector('[data-action="' + i + '"]');
      if (btn) btn.addEventListener('click', function () {
        var keep = a.onClick ? a.onClick(api) : undefined;
        if (keep !== true) api.close();
      });
    });
    if (opts.onOpen) opts.onOpen(api);
    return api;
  }

  function confirmModal(msg, onYes, opts) {
    opts = opts || {};
    return modal({
      title: opts.title || 'Are you certain?',
      body: '<p class="confirm-text">' + msg + '</p>',
      actions: [
        { label: opts.yesLabel || 'Confirm', cls: opts.danger ? 'btn-crimson' : 'btn-gold', onClick: function () { onYes(); } },
        { label: 'Cancel', cls: 'btn-ghost' }
      ]
    });
  }

  /* ---------------- 3D tilt ---------------- */

  function bindTilt(rootEl) {
    rootEl.addEventListener('mousemove', function (e) {
      var t = e.target.closest ? e.target.closest('.tilt') : null;
      if (!t || !rootEl.contains(t)) return;
      var r = t.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;
      var py = (e.clientY - r.top) / r.height;
      t.style.setProperty('--rx', ((py - 0.5) * -12).toFixed(2) + 'deg');
      t.style.setProperty('--ry', ((px - 0.5) * 14).toFixed(2) + 'deg');
      t.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      t.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      t.classList.add('tilting');
    }, { passive: true });
    rootEl.addEventListener('mouseout', function (e) {
      var t = e.target.closest ? e.target.closest('.tilt') : null;
      if (!t) return;
      if (e.relatedTarget && t.contains(e.relatedTarget)) return;
      t.classList.remove('tilting');
      t.style.setProperty('--rx', '0deg');
      t.style.setProperty('--ry', '0deg');
    }, { passive: true });
  }

  /* ---------------- floaters (battle FX) ---------------- */

  function floatText(anchorEl, text, cls) {
    if (!anchorEl) return;
    var root = document.getElementById('fx-root');
    var r = anchorEl.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    el.style.left = (r.left + r.width / 2 + (Math.random() * 30 - 15)) + 'px';
    el.style.top = (r.top + r.height * 0.30) + 'px';
    root.appendChild(el);
    setTimeout(function () { el.classList.add('rise'); }, 15);
    setTimeout(function () { el.remove(); }, 1300);
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function flash(el, cls) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 450);
  }

  /* ---------------- shared renderers ---------------- */

  function elementBadge(elKey) {
    var el = AZ.schema.ELEMENTS[elKey];
    if (!el) return '';
    return '<span class="el-badge el-' + elKey + '" title="' + esc(el.label) + '">' + el.glyph + '</span>';
  }

  function rarityGem(rarity) {
    return '<span class="rarity-gem rg-' + rarity + '" title="' + esc((AZ.schema.RARITIES[rarity] || {}).label || rarity) + '">' + rarity + '</span>';
  }

  function artImg(entity, cls) {
    return '<img class="' + (cls || '') + '" src="' + AZ.art.artFor(entity) + '" alt="" draggable="false">';
  }

  /* Ability card. opts: {count, small, disabled, showOwner, footNote, noTilt} */
  function cardHTML(card, opts) {
    opts = opts || {};
    var ownerChar = card.owner === '*' ? null : AZ.content.getCharacter(card.owner);
    var artEntity = card.imageId ? card : (ownerChar || { name: card.name, element: 'steel', portraitSeed: card.name });
    var typeLabel = (AZ.schema.CARD_TYPES[card.type] || {}).label || card.type;
    var tags = (card.tags || []).filter(function (t) { return t !== 'basic'; });
    var text = AZ.schema.cardText(card);
    var cls = 'az-card r-' + card.rarity + (opts.small ? ' sm' : '') + (opts.disabled ? ' disabled' : '') + (opts.noTilt ? '' : ' tilt');
    var h = '<div class="' + cls + '" data-card-id="' + esc(card.id) + '"' + (opts.iid ? ' data-iid="' + esc(opts.iid) + '"' : '') + '>';
    h += '<div class="azc-frame"></div><div class="azc-sheen"></div>';
    h += '<div class="azc-cost">' + card.cost + '</div>';
    h += '<div class="azc-art">' + artImg(artEntity) + '</div>';
    h += '<div class="azc-name">' + esc(card.name) + '</div>';
    h += '<div class="azc-type">' + esc(typeLabel) + (tags.length ? ' · ' + tags.map(esc).join(' · ') : '') + '</div>';
    h += '<div class="azc-text">' + esc(text) + '</div>';
    if (card.flavor && !opts.small) h += '<div class="azc-flavor">' + esc(card.flavor) + '</div>';
    if (opts.showOwner) {
      h += '<div class="azc-owner">' + esc(ownerChar ? ownerChar.name : 'Universal') + '</div>';
    }
    if (opts.count != null) h += '<div class="azc-count">×' + opts.count + '</div>';
    if (opts.footNote) h += '<div class="azc-foot">' + opts.footNote + '</div>';
    h += '</div>';
    return h;
  }

  /* Hero collection card. opts: {owned, level, locked, small} */
  function charCardHTML(ch, opts) {
    opts = opts || {};
    var role = AZ.schema.ROLES[ch.role] || {};
    var cls = 'char-card r-' + ch.rarity + (opts.locked ? ' locked' : '') + (opts.small ? ' sm' : '') + ' tilt';
    var h = '<div class="' + cls + '" data-char-id="' + esc(ch.id) + '">';
    h += '<div class="azc-frame"></div><div class="azc-sheen"></div>';
    h += '<div class="cc-art">' + artImg(ch) + '</div>';
    h += '<div class="cc-rarity">' + rarityGem(ch.rarity) + elementBadge(ch.element) + '</div>';
    h += '<div class="cc-name">' + esc(ch.name) + '</div>';
    h += '<div class="cc-title">' + esc(ch.title || role.label || '') + '</div>';
    if (opts.level != null) h += '<div class="cc-lvl">Lv.' + opts.level + '</div>';
    if (opts.locked) h += '<div class="cc-lock">🔒</div>';
    if (ch.sample) h += '<div class="cc-sample" title="Starter sample — replace me in the Studio">SAMPLE</div>';
    h += '</div>';
    return h;
  }

  /* Relic row/tile. opts: {count, small, selected} */
  function itemHTML(item, opts) {
    opts = opts || {};
    var h = '<div class="relic r-' + item.rarity + (opts.selected ? ' selected' : '') + '" data-item-id="' + esc(item.id) + '">';
    h += '<div class="relic-art">' + artImg(item.imageId ? item : { name: item.name, element: (item.tags || [])[0] === 'fire' ? 'flame' : 'steel', portraitSeed: item.name, glyph: '宝' }) + '</div>';
    h += '<div class="relic-info"><div class="relic-name">' + esc(item.name) + ' ' + rarityGem(item.rarity) + '</div>';
    h += '<div class="relic-text">' + esc(AZ.schema.itemText(item)) + '</div>';
    if (item.flavor) h += '<div class="relic-flavor">' + esc(item.flavor) + '</div>';
    h += '</div>';
    if (opts.count != null) h += '<div class="relic-count">×' + opts.count + '</div>';
    h += '</div>';
    return h;
  }

  function statusChipsHTML(unit) {
    var keys = Object.keys(unit.statuses || {});
    if (!keys.length) return '';
    return keys.map(function (k) {
      var meta = AZ.schema.STATUSES[k];
      if (!meta) return '';
      return '<span class="status-chip st-' + meta.kind + '" title="' + esc(meta.label + ': ' + meta.desc) + '">' +
        meta.icon + '<b>' + unit.statuses[k] + '</b></span>';
    }).join('');
  }

  AZ.ui = {
    showScreen: showScreen,
    getCurrentScreen: getCurrentScreen,
    screenEl: screenEl,
    updateCurrencies: updateCurrencies,
    toast: toast,
    modal: modal,
    confirmModal: confirmModal,
    bindTilt: bindTilt,
    floatText: floatText,
    shake: shake,
    flash: flash,
    elementBadge: elementBadge,
    rarityGem: rarityGem,
    artImg: artImg,
    cardHTML: cardHTML,
    charCardHTML: charCardHTML,
    itemHTML: itemHTML,
    statusChipsHTML: statusChipsHTML
  };
  AZ.screens = AZ.screens || {};
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

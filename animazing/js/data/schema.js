/* Animazing — content schema: rarities, elements, statuses, effect DSL metadata,
   validation, and the auto-generated rules text used on every card.
   This file is the single source of truth for what content "means";
   the Studio, the battle engine and the card renderer all read from it. */
(function (AZ) {
  'use strict';

  var RARITY_ORDER = ['N', 'R', 'SR', 'SSR', 'UR'];
  var RARITIES = {
    N:   { key: 'N',   label: 'Normal',      weight: 40, cardWeight: 45, essence: 1,  color: '#9aa0a8' },
    R:   { key: 'R',   label: 'Rare',        weight: 30, cardWeight: 30, essence: 2,  color: '#6fb3d9' },
    SR:  { key: 'SR',  label: 'Super Rare',  weight: 20, cardWeight: 17, essence: 5,  color: '#b985e8' },
    SSR: { key: 'SSR', label: 'Spectral',    weight: 8,  cardWeight: 7,  essence: 12, color: '#e8b64a' },
    UR:  { key: 'UR',  label: 'Ultra Rare',  weight: 2,  cardWeight: 1,  essence: 30, color: '#f05a5a' }
  };

  var ELEMENTS = {
    flame:   { key: 'flame',   label: 'Flame',   glyph: '炎', color: '#e0562e' }, // 炎
    frost:   { key: 'frost',   label: 'Frost',   glyph: '雪', color: '#69b7d8' }, // 雪
    storm:   { key: 'storm',   label: 'Storm',   glyph: '雷', color: '#c9a83b' }, // 雷
    shadow:  { key: 'shadow',  label: 'Shadow',  glyph: '影', color: '#7d5fa8' }, // 影
    radiant: { key: 'radiant', label: 'Radiant', glyph: '光', color: '#e8c85a' }, // 光
    steel:   { key: 'steel',   label: 'Steel',   glyph: '鋼', color: '#8d99a6' }  // 鋼
  };

  var ROLES = {
    striker:  { key: 'striker',  label: 'Striker',  icon: '⚔️', blurb: 'Raw offense and combo damage.' },
    guardian: { key: 'guardian', label: 'Guardian', icon: '🛡️', blurb: 'Block, taunts and retaliation.' },
    mystic:   { key: 'mystic',   label: 'Mystic',   icon: '🔮', blurb: 'Debuffs, damage-over-time, chaos.' },
    support:  { key: 'support',  label: 'Support',  icon: '🌸', blurb: 'Healing, buffs and revival.' },
    trickster:{ key: 'trickster',label: 'Trickster',icon: '🃏', blurb: 'Draw, energy and random mayhem.' }
  };

  var CARD_TYPES = {
    attack:  { key: 'attack',  label: 'Attack' },
    guard:   { key: 'guard',   label: 'Guard' },
    skill:   { key: 'skill',   label: 'Skill' },
    passive: { key: 'passive', label: 'Passive' }
  };

  /* decay: 'permanent' — never expires
            'round'     — loses 1 stack at end of each round
            'tick'      — acts then loses 1 stack at its owner's turn start */
  var STATUSES = {
    strength:  { key: 'strength',  label: 'Strength',  icon: '💪', kind: 'buff',   decay: 'permanent', desc: 'Attacks deal +1 damage per stack.' },
    fortify:   { key: 'fortify',   label: 'Fortify',   icon: '🏰', kind: 'buff',   decay: 'permanent', desc: 'Gain +1 extra Block per stack whenever you gain Block.' },
    vulnerable:{ key: 'vulnerable',label: 'Vulnerable',icon: '💔', kind: 'debuff', decay: 'round',     desc: 'Takes 50% more attack damage.' },
    weak:      { key: 'weak',      label: 'Weak',      icon: '🌫️', kind: 'debuff', decay: 'round', desc: 'Attacks deal 25% less damage.' },
    poison:    { key: 'poison',    label: 'Poison',    icon: '☠️', kind: 'debuff', decay: 'tick',      desc: 'Loses HP equal to stacks at turn start (ignores Block), then -1 stack.' },
    burn:      { key: 'burn',      label: 'Burn',      icon: '🔥', kind: 'debuff', decay: 'tick',      desc: 'Takes damage equal to stacks at turn start (Block absorbs it), then -1 stack.' },
    regen:     { key: 'regen',     label: 'Regen',     icon: '🌿', kind: 'buff',   decay: 'tick',      desc: 'Heals HP equal to stacks at turn start, then -1 stack.' },
    thorns:    { key: 'thorns',    label: 'Thorns',    icon: '🌹', kind: 'buff',   decay: 'round',     desc: 'Attackers take damage equal to stacks when they hit you.' },
    evade:     { key: 'evade',     label: 'Evade',     icon: '💨', kind: 'buff',   decay: 'round',     desc: 'Negates the next attack hit entirely. One stack per hit.' },
    taunt:     { key: 'taunt',     label: 'Taunt',     icon: '🎯', kind: 'buff',   decay: 'round',     desc: 'Enemies must target this unit.' },
    stun:      { key: 'stun',      label: 'Stun',      icon: '💫', kind: 'debuff', decay: 'special',   desc: 'Skips its next turn. One stack per turn skipped.' },
    aegis:     { key: 'aegis',     label: 'Aegis',     icon: '✨', kind: 'buff',   decay: 'round',     desc: 'Block is not removed at the start of your turn.' }
  };

  /* Side-relative target keywords, shared by hero cards and enemy moves. */
  var TARGETS = {
    'foe':           { label: 'Chosen foe',        needsPick: true },
    'all-foes':      { label: 'All foes',          needsPick: false },
    'random-foe':    { label: 'Random foe',        needsPick: false },
    'self':          { label: 'Self',              needsPick: false },
    'friend-target': { label: 'Chosen ally',       needsPick: true },
    'all-friends':   { label: 'All allies',        needsPick: false },
    'random-friend': { label: 'Random ally',       needsPick: false },
    'lowest-friend': { label: 'Most wounded ally', needsPick: false },
    'downed-friend': { label: 'Fallen ally',       needsPick: true }
  };

  /* Effect DSL — every op the interpreter understands, with the field metadata
     the Studio uses to build its form UI. */
  var EFFECT_OPS = {
    damage: { label: 'Deal damage',  fields: ['amount', 'times', 'target'], defaultTarget: 'foe' },
    block:  { label: 'Grant Block',  fields: ['amount', 'target'],          defaultTarget: 'self' },
    heal:   { label: 'Heal',         fields: ['amount', 'target'],          defaultTarget: 'self' },
    revive: { label: 'Revive',       fields: ['amount', 'target'],          defaultTarget: 'downed-friend' },
    status: { label: 'Apply status', fields: ['status', 'stacks', 'target'],defaultTarget: 'foe' },
    cleanse:{ label: 'Cleanse debuffs', fields: ['target'],                 defaultTarget: 'self' },
    energy: { label: 'Gain energy',  fields: ['amount'],                    defaultTarget: 'self' },
    draw:   { label: 'Draw cards',   fields: ['amount'],                    defaultTarget: 'self' },
    passive:{ label: 'Unleash passive', fields: ['passive'],                defaultTarget: 'self' },
    random: { label: 'Chaos (random effect)', fields: ['choices'],          defaultTarget: 'self' }
  };

  /* Triggers usable by passives and item hooks. */
  var TRIGGERS = {
    battleStart:  { label: 'When battle starts' },
    roundStart:   { label: 'At the start of each round' },
    roundEnd:     { label: 'At the end of each round' },
    turnStart:    { label: 'When the owner’s turn starts' },
    cardPlayed:   { label: 'When an allied card is played' },
    unitDamaged:  { label: 'When an ally takes attack damage' },
    foeDefeated:  { label: 'When a foe is defeated' },
    modifyDamage: { label: 'Modify damage dealt (by tag)' }
  };

  var LIMITS = { deckMin: 6, deckMax: 12, handSize: 5, energy: 3, teamSize: 4, equipSlots: 2 };

  /* ------------------------------------------------------------------ */
  /* Amount helpers                                                      */
  /* ------------------------------------------------------------------ */

  function amountBase(a) {
    if (typeof a === 'number') return a;
    if (a && typeof a === 'object') return a.base || 0;
    return 0;
  }

  function amountToText(a) {
    if (typeof a === 'number') return String(a);
    if (!a || typeof a !== 'object') return '0';
    var parts = [String(a.base || 0)];
    if (a.perRoundTag) parts.push('+' + a.perRoundTag.mult + ' per ' + capitalize(a.perRoundTag.tag) + ' card played this round');
    if (a.perStatusTarget) parts.push('+' + a.perStatusTarget.mult + ' per stack of target’s ' + statusLabel(a.perStatusTarget.status));
    if (a.perStatusSelf) parts.push('+' + a.perStatusSelf.mult + ' per stack of your ' + statusLabel(a.perStatusSelf.status));
    if (a.perSelfBlock) parts.push('+' + a.perSelfBlock.mult + ' per point of your Block');
    if (a.perDownedFriend) parts.push('+' + a.perDownedFriend.mult + ' per fallen ally');
    if (a.perPassive) parts.push('+' + a.perPassive.mult + ' per active ' + (a.perPassive.tag ? capitalize(a.perPassive.tag) + ' ' : '') + 'passive');
    return parts.length > 1 ? parts[0] + ' (' + parts.slice(1).join(', ') + ')' : parts[0];
  }

  function statusLabel(k) { return (STATUSES[k] && STATUSES[k].label) || capitalize(k); }
  function capitalize(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ------------------------------------------------------------------ */
  /* Condition text                                                      */
  /* ------------------------------------------------------------------ */

  function conditionToText(c) {
    if (!c) return '';
    if (c.tagThisRound) {
      var n = c.minCount || 1;
      return 'Combo — ' + (n > 1 ? n + ' ' : '') + capitalize(c.tagThisRound) + (n > 1 ? ' cards' : '') + ' played this round';
    }
    if (c.selfHpBelowPct != null) return 'If below ' + c.selfHpBelowPct + '% HP';
    if (c.selfHasBlock) return 'If you have Block';
    if (c.targetHasStatus) return 'If target has ' + statusLabel(c.targetHasStatus);
    if (c.targetHasBlock) return 'If target has Block';
    if (c.itemTag) return 'If a ' + capitalize(c.itemTag) + ' item is equipped';
    if (c.passiveActive) return 'While a ' + capitalize(c.passiveActive) + ' passive is active';
    if (c.chance != null) return Math.round(c.chance * 100) + '% chance';
    return 'Conditional';
  }

  /* ------------------------------------------------------------------ */
  /* Effects -> rules text (used on rendered cards; WYSIWYG in Studio)   */
  /* ------------------------------------------------------------------ */

  function targetPhrase(t, side) {
    switch (t) {
      case 'foe': return '';
      case 'all-foes': return ' to all foes';
      case 'random-foe': return ' to a random foe';
      case 'self': return '';
      case 'friend-target': return ' to an ally';
      case 'all-friends': return ' to all allies';
      case 'random-friend': return ' to a random ally';
      case 'lowest-friend': return ' to the most wounded ally';
      case 'downed-friend': return ' to a fallen ally';
      default: return '';
    }
  }

  function opToText(op) {
    if (!op || !op.op) return '';
    var t = op.target || EFFECT_OPS[op.op] && EFFECT_OPS[op.op].defaultTarget;
    var s;
    switch (op.op) {
      case 'damage':
        s = 'Deal ' + amountToText(op.amount) + ' damage';
        if (op.times && op.times > 1) s += ' ×' + op.times;
        s += targetPhrase(t) + '.';
        return s;
      case 'block':
        if (t === 'self') return 'Gain ' + amountToText(op.amount) + ' Block.';
        if (t === 'all-friends') return 'All allies gain ' + amountToText(op.amount) + ' Block.';
        return 'Grant ' + amountToText(op.amount) + ' Block' + targetPhrase(t) + '.';
      case 'heal':
        if (t === 'self') return 'Heal ' + amountToText(op.amount) + ' HP.';
        return 'Heal ' + amountToText(op.amount) + ' HP' + targetPhrase(t) + '.';
      case 'revive':
        return 'Revive a fallen ally with ' + amountToText(op.amount) + '% HP.';
      case 'status':
        var st = statusLabel(op.status);
        var stacks = amountToText(op.stacks != null ? op.stacks : 1);
        var kind = STATUSES[op.status] ? STATUSES[op.status].kind : 'debuff';
        if (t === 'self') return 'Gain ' + stacks + ' ' + st + '.';
        if (t === 'all-friends') return 'All allies gain ' + stacks + ' ' + st + '.';
        if (t === 'friend-target') return 'An ally gains ' + stacks + ' ' + st + '.';
        return 'Apply ' + stacks + ' ' + st + targetPhrase(t) + '.';
      case 'cleanse':
        if (t === 'self') return 'Cleanse your debuffs.';
        return 'Cleanse debuffs' + targetPhrase(t) + '.';
      case 'energy': return 'Gain ' + amountToText(op.amount) + ' Energy.';
      case 'draw': return 'Draw ' + amountToText(op.amount) + ' card' + (amountBase(op.amount) === 1 ? '' : 's') + '.';
      case 'passive':
        var p = op.passive || {};
        var dur = (p.duration == null || p.duration < 0) ? 'for the battle' : 'for ' + p.duration + ' round' + (p.duration === 1 ? '' : 's');
        return 'Unleash “' + (p.name || 'Passive') + '” ' + dur + ': ' + passiveToText(p);
      case 'random':
        var opts = (op.choices || []).map(function (ops) {
          return ops.map(opToText).join(' ');
        });
        return 'Chaos — one of: ' + opts.join(' / ');
      default: return '';
    }
  }

  function passiveToText(p) {
    var hooks = p.hooks || [];
    if (!hooks.length) return p.desc || '';
    return hooks.map(function (h) {
      var trig = TRIGGERS[h.on] ? TRIGGERS[h.on].label : h.on;
      if (h.on === 'modifyDamage') {
        return (h.tags && h.tags.length ? capitalize(h.tags.join('/')) : 'All') + ' cards deal +' + (h.add || 0) + ' damage.';
      }
      var eff = (h.effects || []).map(opToText).join(' ');
      var filter = h.tagFilter ? ' (' + capitalize(h.tagFilter) + ' cards)' : '';
      return trig + filter + ': ' + eff;
    }).join(' ');
  }

  function effectsToText(effects) {
    if (!effects || !effects.length) return '';
    return effects.map(function (op) {
      var body = opToText(op);
      if (op.if) {
        var cond = conditionToText(op.if);
        return cond + ': ' + body;
      }
      return body;
    }).filter(Boolean).join(' ');
  }

  function cardText(card) {
    if (card.textOverride) return card.textOverride;
    var t = effectsToText(card.effects);
    var extras = [];
    if (card.exhaust) extras.push('Exhaust.');
    if (card.retain) extras.push('Retain.');
    return [t].concat(extras).filter(Boolean).join(' ');
  }

  function itemText(item) {
    if (item.textOverride) return item.textOverride;
    var bits = [];
    var m = item.statMods || {};
    if (m.hp) bits.push((m.hp > 0 ? '+' : '') + m.hp + ' Max HP.');
    if (m.energy) bits.push((m.energy > 0 ? '+' : '') + m.energy + ' Energy.');
    if (m.draw) bits.push((m.draw > 0 ? '+' : '') + m.draw + ' card draw.');
    if (item.goldBonus) bits.push('+' + Math.round(item.goldBonus * 100) + '% gold from battles.');
    (item.hooks || []).forEach(function (h) {
      if (h.on === 'modifyDamage') {
        bits.push((h.tags && h.tags.length ? capitalize(h.tags.join('/')) : 'All') + ' cards deal +' + (h.add || 0) + ' damage.');
      } else {
        var trig = TRIGGERS[h.on] ? TRIGGERS[h.on].label : h.on;
        bits.push(trig + ': ' + (h.effects || []).map(opToText).join(' '));
      }
    });
    return bits.join(' ');
  }

  /* ------------------------------------------------------------------ */
  /* Validation (used by the Studio and pack import)                     */
  /* ------------------------------------------------------------------ */

  function isNonEmptyString(s) { return typeof s === 'string' && s.trim().length > 0; }

  function validateCharacter(c) {
    var errs = [];
    if (!isNonEmptyString(c.name)) errs.push('Character needs a name.');
    if (!RARITIES[c.rarity]) errs.push('Unknown rarity "' + c.rarity + '".');
    if (!ELEMENTS[c.element]) errs.push('Unknown element "' + c.element + '".');
    if (!ROLES[c.role]) errs.push('Unknown role "' + c.role + '".');
    var st = c.stats || {};
    if (!(st.hp > 0)) errs.push('Max HP must be positive.');
    if (!(st.energy >= 1 && st.energy <= 9)) errs.push('Energy must be 1–9.');
    if (!(st.draw >= 1 && st.draw <= 10)) errs.push('Draw must be 1–10.');
    return errs;
  }

  function validateEffects(effects, errs, where) {
    errs = errs || [];
    if (!Array.isArray(effects)) { errs.push(where + ': effects must be a list.'); return errs; }
    effects.forEach(function (op, i) {
      if (!op || !EFFECT_OPS[op.op]) { errs.push(where + ' effect #' + (i + 1) + ': unknown op "' + (op && op.op) + '".'); return; }
      if (op.target && !TARGETS[op.target]) errs.push(where + ' effect #' + (i + 1) + ': unknown target "' + op.target + '".');
      if (op.op === 'status' && !STATUSES[op.status]) errs.push(where + ' effect #' + (i + 1) + ': unknown status "' + op.status + '".');
      if (op.op === 'random') (op.choices || []).forEach(function (ops, j) { validateEffects(ops, errs, where + ' chaos option ' + (j + 1)); });
      if (op.op === 'passive') {
        var p = op.passive || {};
        (p.hooks || []).forEach(function (h) {
          if (!TRIGGERS[h.on]) errs.push(where + ': passive hook has unknown trigger "' + h.on + '".');
          if (h.effects) validateEffects(h.effects, errs, where + ' passive hook');
        });
      }
    });
    return errs;
  }

  function validateCard(card) {
    var errs = [];
    if (!isNonEmptyString(card.name)) errs.push('Card needs a name.');
    if (!RARITIES[card.rarity]) errs.push('Unknown rarity "' + card.rarity + '".');
    if (!CARD_TYPES[card.type]) errs.push('Unknown card type "' + card.type + '".');
    if (!(card.cost >= 0 && card.cost <= 9)) errs.push('Cost must be 0–9.');
    if (!isNonEmptyString(card.owner)) errs.push('Card needs an owner character (or Universal).');
    validateEffects(card.effects || [], errs, 'Card');
    return errs;
  }

  function validateItem(item) {
    var errs = [];
    if (!isNonEmptyString(item.name)) errs.push('Item needs a name.');
    if (!RARITIES[item.rarity]) errs.push('Unknown rarity "' + item.rarity + '".');
    (item.hooks || []).forEach(function (h) {
      if (!TRIGGERS[h.on]) errs.push('Item hook has unknown trigger "' + h.on + '".');
      if (h.effects) validateEffects(h.effects, errs, 'Item hook');
    });
    return errs;
  }

  function validateEnemy(e) {
    var errs = [];
    if (!isNonEmptyString(e.name)) errs.push('Enemy needs a name.');
    if (!(e.stats && e.stats.hp > 0)) errs.push('Enemy Max HP must be positive.');
    if (!Array.isArray(e.moves) || !e.moves.length) errs.push('Enemy needs at least one move.');
    (e.moves || []).forEach(function (m, i) {
      if (!isNonEmptyString(m.name)) errs.push('Move #' + (i + 1) + ' needs a name.');
      validateEffects(m.effects || [], errs, 'Move "' + (m.name || i + 1) + '"');
    });
    return errs;
  }

  AZ.schema = {
    RARITY_ORDER: RARITY_ORDER,
    RARITIES: RARITIES,
    ELEMENTS: ELEMENTS,
    ROLES: ROLES,
    CARD_TYPES: CARD_TYPES,
    STATUSES: STATUSES,
    TARGETS: TARGETS,
    EFFECT_OPS: EFFECT_OPS,
    TRIGGERS: TRIGGERS,
    LIMITS: LIMITS,
    amountBase: amountBase,
    amountToText: amountToText,
    conditionToText: conditionToText,
    opToText: opToText,
    passiveToText: passiveToText,
    effectsToText: effectsToText,
    cardText: cardText,
    itemText: itemText,
    validateCharacter: validateCharacter,
    validateCard: validateCard,
    validateItem: validateItem,
    validateEnemy: validateEnemy,
    capitalize: capitalize,
    statusLabel: statusLabel
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

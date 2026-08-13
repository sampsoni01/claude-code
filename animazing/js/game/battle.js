/* Animazing — battle engine (DOM-free, deterministic with a seed).
   The engine mutates state synchronously and pushes granular events into
   a queue; the UI drains the queue and animates at its own pace. The same
   engine runs headless in Node for tests.

   Round flow:
     roundStart -> player phase (pick any ready ally, play cards, end turn,
     repeat until all four have acted) -> enemy phase (telegraphed intents
     resolve in speed order) -> roundEnd -> next roundStart.               */
(function (AZ) {
  'use strict';

  var STATUSES = function () { return AZ.schema.STATUSES; };

  function makeUnit(cfg, side) {
    var unit = {
      uid: AZ.util.uid('u'),
      side: side,                       // 'ally' | 'enemy'
      refId: cfg.refId || cfg.charId || cfg.enemyId || null,
      name: cfg.name || 'Unknown',
      title: cfg.title || '',
      element: cfg.element || 'steel',
      role: cfg.role || null,
      rarity: cfg.rarity || 'N',
      level: cfg.level || 1,
      imageId: cfg.imageId || null,
      portraitSeed: cfg.portraitSeed || cfg.name || 'x',
      maxHp: Math.max(1, cfg.maxHp || 30),
      hp: null,
      block: 0,
      statuses: {},
      energyMax: cfg.energyMax || AZ.schema.LIMITS.energy,
      energy: 0,
      drawSize: cfg.drawSize || AZ.schema.LIMITS.handSize,
      speed: cfg.speed || 5,
      items: cfg.items || [],
      innate: cfg.innate || null,
      acted: false,
      downed: false,
      /* ally deck */
      drawPile: [], hand: [], discard: [], exhaust: [],
      /* enemy AI */
      moves: cfg.moves || null,
      sequence: !!cfg.sequence,
      moveCursor: 0,
      intent: null,
      boss: !!cfg.boss,
      elite: !!cfg.elite
    };
    unit.hp = Math.max(1, Math.min(unit.maxHp, cfg.hp != null ? cfg.hp : unit.maxHp));
    if (side === 'ally') {
      unit.deckDefs = (cfg.deckDefs || []).slice();
    }
    return unit;
  }

  function create(config) {
    var battle = {
      rng: AZ.util.rng(config.seed != null ? config.seed : Math.floor(Math.random() * 1e9)),
      round: 0,
      phase: 'idle',                 // idle | player | enemy | over
      units: [],
      passives: [],
      tagsThisRound: { ally: {}, enemy: {} },
      queue: [],
      over: false,
      result: null,
      activeUid: null,
      stats: { damageDealt: 0, damageTaken: 0, cardsPlayed: 0 }
    };

    (config.allies || []).forEach(function (cfg) { battle.units.push(makeUnit(cfg, 'ally')); });
    (config.enemies || []).forEach(function (cfg) { battle.units.push(makeUnit(cfg, 'enemy')); });
    battle.boons = config.boons || [];

    /* ---------------- event plumbing ---------------- */

    battle.emit = function (e) { battle.queue.push(e); };
    battle.drainQueue = function () { return battle.queue.splice(0, battle.queue.length); };
    battle.log = function (msg, cls) { battle.emit({ t: 'log', msg: msg, cls: cls || '' }); };

    /* ---------------- lookups ---------------- */

    battle.unit = function (uid) {
      for (var i = 0; i < battle.units.length; i++) if (battle.units[i].uid === uid) return battle.units[i];
      return null;
    };
    battle.unitsOfSide = function (side, opts) {
      opts = opts || {};
      return battle.units.filter(function (u) {
        if (u.side !== side) return false;
        if (u.side === 'enemy') return opts.includeDead ? true : u.hp > 0;
        return opts.includeDowned ? true : !u.downed;
      });
    };
    battle.livingFoesOf = function (side) { return battle.unitsOfSide(side === 'ally' ? 'enemy' : 'ally'); };
    battle.allies = function () { return battle.units.filter(function (u) { return u.side === 'ally'; }); };
    battle.enemies = function () { return battle.units.filter(function (u) { return u.side === 'enemy' && u.hp > 0; }); };
    battle.active = function () { return battle.activeUid ? battle.unit(battle.activeUid) : null; };

    battle.resolveTargets = function (source, key, chosen) {
      var foes = battle.livingFoesOf(source.side);
      var friends = battle.unitsOfSide(source.side);
      switch (key) {
        case 'foe':
          if (chosen && chosen.side !== source.side && chosen.hp > 0 && !chosen.downed) return [chosen];
          return foes.length ? [pickFoeFor(source, foes)] : [];
        case 'all-foes': return foes.slice();
        case 'random-foe': return foes.length ? [battle.rng.pick(foes)] : [];
        case 'self': return (source.hp > 0 && !source.downed) ? [source] : [];
        case 'friend-target':
          if (chosen && chosen.side === source.side && !chosen.downed && chosen.hp > 0) return [chosen];
          return friends.length ? [friends[0]] : [];
        case 'all-friends': return friends.slice();
        case 'random-friend': return friends.length ? [battle.rng.pick(friends)] : [];
        case 'lowest-friend':
          if (!friends.length) return [];
          return [friends.slice().sort(function (a, b) { return (a.hp / a.maxHp) - (b.hp / b.maxHp); })[0]];
        case 'downed-friend': {
          if (chosen && chosen.side === source.side && chosen.downed) return [chosen];
          var downed = battle.unitsOfSide(source.side, { includeDowned: true }).filter(function (u) { return u.downed; });
          return downed.length ? [downed[0]] : [];
        }
        default: return [];
      }
    };

    /* Enemies honor Taunt when choosing a victim. */
    function pickFoeFor(source, foes) {
      var taunters = foes.filter(function (u) { return (u.statuses.taunt || 0) > 0; });
      var pool = taunters.length ? taunters : foes;
      return battle.rng.pick(pool);
    }

    /* ---------------- primitives ---------------- */

    battle.getStatus = function (unit, key) { return unit.statuses[key] || 0; };

    battle.applyStatus = function (source, target, key, stacks) {
      if (!STATUSES()[key] || target.hp <= 0 || target.downed) return;
      target.statuses[key] = (target.statuses[key] || 0) + stacks;
      battle.emit({ t: 'statusGain', uid: target.uid, status: key, stacks: stacks });
      battle.log(target.name + (STATUSES()[key].kind === 'buff' ? ' gains ' : ' suffers ') + stacks + ' ' + STATUSES()[key].label + '.',
        STATUSES()[key].kind);
    };

    battle.cleanse = function (target) {
      var removed = [];
      Object.keys(target.statuses).forEach(function (k) {
        if (STATUSES()[k] && STATUSES()[k].kind === 'debuff') { removed.push(k); delete target.statuses[k]; }
      });
      if (removed.length) {
        battle.emit({ t: 'cleanse', uid: target.uid });
        battle.log(target.name + ' is cleansed of debuffs.', 'buff');
      }
    };

    battle.gainBlock = function (target, amount) {
      if (target.hp <= 0 || target.downed || amount <= 0) return;
      var total = amount + (target.statuses.fortify || 0);
      target.block += total;
      battle.emit({ t: 'blockGain', uid: target.uid, amount: total });
      battle.log(target.name + ' gains ' + total + ' Block.', 'block');
    };

    battle.heal = function (target, amount) {
      if (target.hp <= 0 || target.downed || amount <= 0) return;
      var healed = Math.min(amount, target.maxHp - target.hp);
      if (healed <= 0) return;
      target.hp += healed;
      battle.emit({ t: 'healGain', uid: target.uid, amount: healed });
      battle.log(target.name + ' heals ' + healed + ' HP.', 'heal');
    };

    battle.revive = function (target, pct) {
      if (!target.downed) return;
      target.downed = false;
      target.hp = Math.max(1, Math.floor(target.maxHp * (pct / 100)));
      target.statuses = {};
      target.block = 0;
      target.acted = true; // rejoins the fight next round
      battle.emit({ t: 'revive', uid: target.uid });
      battle.log(target.name + ' returns to the fight with ' + target.hp + ' HP!', 'heal');
    };

    battle.gainEnergy = function (unit, amount) {
      if (amount <= 0) return;
      unit.energy = Math.min(9, unit.energy + amount);
      battle.emit({ t: 'energyGain', uid: unit.uid, amount: amount });
      battle.log(unit.name + ' gains ' + amount + ' Energy.', 'energy');
    };

    battle.drawCards = function (unit, n) {
      if (unit.side !== 'ally' || n <= 0) return;
      var drawn = 0;
      for (var i = 0; i < n && unit.hand.length < 10; i++) {
        if (!unit.drawPile.length) {
          if (!unit.discard.length) break;
          unit.drawPile = battle.rng.shuffle(unit.discard);
          unit.discard = [];
        }
        unit.hand.push(unit.drawPile.pop());
        drawn++;
      }
      if (drawn > 0) battle.emit({ t: 'draw', uid: unit.uid, n: drawn });
    };

    /* Damage that ignores Block (poison, sacrifice effects). */
    battle.hpLoss = function (target, amount, label) {
      if (target.hp <= 0 || target.downed || amount <= 0) return;
      target.hp -= amount;
      battle.stats.damageTaken += target.side === 'ally' ? amount : 0;
      battle.emit({ t: 'hit', uid: target.uid, amount: amount, blocked: 0, pierce: true, label: label || '' });
      afterDamage(target, null);
    };

    /* Collect +damage modifiers from the source's items and side passives. */
    function damageMods(source, tags) {
      var add = 0;
      function scanHooks(hooks) {
        (hooks || []).forEach(function (h) {
          if (h.on !== 'modifyDamage') return;
          if (h.tags && h.tags.length) {
            var match = (tags || []).some(function (t) { return h.tags.indexOf(t) >= 0; });
            if (!match) return;
          }
          add += h.add || 0;
        });
      }
      (source.items || []).forEach(function (it) { scanHooks(it.hooks); });
      battle.passives.forEach(function (p) {
        if (p.side !== 'global' && p.side !== source.side) return;
        scanHooks(p.hooks);
      });
      return add;
    }

    battle.attack = function (source, target, base, opts) {
      opts = opts || {};
      if (battle.over || !target || target.hp <= 0 || target.downed) return 0;
      var isAttack = opts.isAttack !== false;
      var amt = base;
      if (isAttack) {
        amt += source.statuses.strength || 0;
        amt += damageMods(source, opts.tags);
        if ((source.statuses.weak || 0) > 0) amt = Math.floor(amt * 0.75);
        if ((target.statuses.vulnerable || 0) > 0) amt = Math.floor(amt * 1.5);
      }
      amt = Math.max(0, amt);

      if (isAttack && (target.statuses.evade || 0) > 0) {
        target.statuses.evade -= 1;
        if (target.statuses.evade <= 0) delete target.statuses.evade;
        battle.emit({ t: 'evade', uid: target.uid });
        battle.log(target.name + ' evades the attack!', 'buff');
        return 0;
      }

      var blocked = Math.min(target.block, amt);
      target.block -= blocked;
      var through = amt - blocked;
      target.hp -= through;
      if (source.side === 'ally') battle.stats.damageDealt += through;
      if (target.side === 'ally') battle.stats.damageTaken += through;
      battle.emit({ t: 'hit', uid: target.uid, sourceUid: source.uid, amount: through, blocked: blocked });
      battle.log(source.name + ' hits ' + target.name + ' for ' + through +
        (blocked ? ' (' + blocked + ' blocked)' : '') + '.', source.side === 'ally' ? 'attack' : 'danger');

      if (isAttack && through > 0) {
        runHooks('unitDamaged', { unit: target, source: source, amount: through });
      }

      /* Thorns retaliation (non-attack damage; no recursion). */
      if (isAttack && (target.statuses.thorns || 0) > 0 && source.hp > 0 && !source.downed) {
        var th = target.statuses.thorns;
        var tBlocked = Math.min(source.block, th);
        source.block -= tBlocked;
        var tThrough = th - tBlocked;
        source.hp -= tThrough;
        battle.emit({ t: 'hit', uid: source.uid, amount: tThrough, blocked: tBlocked, label: 'Thorns' });
        battle.log(source.name + ' takes ' + tThrough + ' Thorns damage.', 'danger');
        afterDamage(source, target);
      }

      afterDamage(target, source);
      return through;
    };

    function afterDamage(unit, source) {
      if (unit.hp > 0 || unit.downed) { battle.checkEnd(); return; }
      unit.hp = 0;
      if (unit.side === 'enemy') {
        unit.statuses = {};
        unit.intent = null;
        battle.emit({ t: 'die', uid: unit.uid });
        battle.log(unit.name + ' is defeated!', 'victory');
        runHooks('foeDefeated', { unit: unit, killerSide: source ? source.side : 'ally' });
      } else {
        unit.downed = true;
        unit.statuses = {};
        unit.block = 0;
        unit.hand = unit.hand || [];
        unit.discard = (unit.discard || []).concat(unit.hand.splice(0, unit.hand.length));
        if (battle.activeUid === unit.uid) { unit.acted = true; battle.activeUid = null; }
        battle.emit({ t: 'downed', uid: unit.uid });
        battle.log(unit.name + ' has fallen…', 'danger');
      }
      battle.checkEnd();
    }

    /* ---------------- passives ---------------- */

    battle.addPassive = function (source, def) {
      var side = def.side || source.side;
      var existing = battle.passives.filter(function (p) { return p.name === def.name && p.side === side; })[0];
      if (existing) {
        existing.duration = def.duration == null ? -1 : def.duration;
        battle.emit({ t: 'passiveRefresh', id: existing.id });
        battle.log('“' + def.name + '” is renewed.', 'chaos');
        return existing;
      }
      var p = {
        id: AZ.util.uid('p'),
        name: def.name || 'Passive',
        icon: def.icon || '◆',
        side: side,
        duration: def.duration == null ? -1 : def.duration,
        hooks: def.hooks || [],
        tags: def.tags || [],
        ownerUid: source.uid,
        desc: def.desc || AZ.schema.passiveToText(def)
      };
      battle.passives.push(p);
      battle.emit({ t: 'passiveAdd', passive: { id: p.id, name: p.name, icon: p.icon, side: p.side, duration: p.duration, desc: p.desc } });
      battle.log('Passive unleashed: “' + p.name + '”.', 'chaos');
      return p;
    };

    function hookSource(p, fallbackUnit) {
      var owner = battle.unit(p.ownerUid);
      if (owner && owner.hp > 0 && !owner.downed) return owner;
      if (fallbackUnit && fallbackUnit.hp > 0 && !fallbackUnit.downed) return fallbackUnit;
      var friends = battle.unitsOfSide(p.side === 'global' ? 'ally' : p.side);
      return friends[0] || owner || fallbackUnit;
    }

    function runHooks(trigger, ctx) {
      ctx = ctx || {};
      if (battle.over && trigger !== 'foeDefeated') return;
      /* battlefield passives */
      battle.passives.slice().forEach(function (p) {
        (p.hooks || []).forEach(function (h) {
          if (h.on !== trigger) return;
          if (trigger === 'cardPlayed') {
            if (p.side !== 'global' && ctx.unit.side !== p.side) return;
            if (h.tagFilter && (!ctx.card || (ctx.card.tags || []).indexOf(h.tagFilter) < 0)) return;
          }
          if (trigger === 'turnStart' && p.side !== 'global' && ctx.unit && ctx.unit.side !== p.side) return;
          if (trigger === 'unitDamaged' && p.side !== 'global' && ctx.unit && ctx.unit.side !== p.side) return;
          if (trigger === 'foeDefeated' && p.side !== 'global' && ctx.killerSide && ctx.killerSide !== p.side) return;
          var src = hookSource(p, ctx.unit);
          if (!src) return;
          AZ.effects.resolve(battle, src, h.effects || [], { target: ctx.unit && ctx.unit.side === src.side ? ctx.unit : null });
        });
      });
      /* personal item hooks */
      battle.units.forEach(function (u) {
        if (u.hp <= 0 || u.downed) return;
        (u.items || []).forEach(function (it) {
          (it.hooks || []).forEach(function (h) {
            if (h.on !== trigger) return;
            if ((trigger === 'turnStart' || trigger === 'cardPlayed' || trigger === 'unitDamaged') && ctx.unit !== u) return;
            if (trigger === 'foeDefeated' && ctx.killerSide && ctx.killerSide !== u.side) return;
            if (trigger === 'cardPlayed' && h.tagFilter && (!ctx.card || (ctx.card.tags || []).indexOf(h.tagFilter) < 0)) return;
            AZ.effects.resolve(battle, u, h.effects || [], {});
          });
        });
      });
    }
    battle.runHooks = runHooks;

    /* ---------------- turn mechanics ---------------- */

    function tickUnit(unit) {
      /* Block wears off unless protected by Aegis. */
      if ((unit.statuses.aegis || 0) <= 0) unit.block = 0;
      /* Poison: pierces Block. */
      if ((unit.statuses.poison || 0) > 0) {
        var pz = unit.statuses.poison;
        battle.emit({ t: 'dot', uid: unit.uid, status: 'poison', amount: pz });
        battle.log(unit.name + ' suffers ' + pz + ' Poison damage.', 'debuff');
        unit.statuses.poison -= 1;
        if (unit.statuses.poison <= 0) delete unit.statuses.poison;
        unit.hp -= pz;
        afterDamage(unit, null);
        if (unit.hp <= 0 || unit.downed) return false;
      }
      /* Burn: Block absorbs it. */
      if ((unit.statuses.burn || 0) > 0) {
        var bn = unit.statuses.burn;
        var blocked = Math.min(unit.block, bn);
        unit.block -= blocked;
        var through = bn - blocked;
        unit.hp -= through;
        battle.emit({ t: 'dot', uid: unit.uid, status: 'burn', amount: through });
        battle.log(unit.name + ' burns for ' + through + (blocked ? ' (' + blocked + ' blocked)' : '') + '.', 'debuff');
        unit.statuses.burn -= 1;
        if (unit.statuses.burn <= 0) delete unit.statuses.burn;
        afterDamage(unit, null);
        if (unit.hp <= 0 || unit.downed) return false;
      }
      if ((unit.statuses.regen || 0) > 0) {
        battle.heal(unit, unit.statuses.regen);
        unit.statuses.regen -= 1;
        if (unit.statuses.regen <= 0) delete unit.statuses.regen;
      }
      return true;
    }

    battle.start = function () {
      battle.phase = 'player';
      battle.emit({ t: 'battleStart' });
      battle.log('The battle begins!', 'phase');
      /* Ally decks */
      battle.allies().forEach(function (u) {
        var instances = (u.deckDefs || []).map(function (def) { return { iid: AZ.util.uid('ci'), def: def }; });
        u.drawPile = battle.rng.shuffle(instances);
        u.hand = []; u.discard = []; u.exhaust = [];
      });
      /* Innate passives (characters + enemies), then run-level boons. */
      battle.units.forEach(function (u) {
        if (u.innate) battle.addPassive(u, u.innate);
      });
      (battle.boons || []).forEach(function (b) {
        var anchor = battle.unitsOfSide(b.side === 'enemy' ? 'enemy' : 'ally')[0];
        if (anchor) battle.addPassive(anchor, b);
      });
      runHooks('battleStart', {});
      startRound();
      return battle;
    };

    function startRound() {
      if (battle.over) return;
      battle.round += 1;
      battle.phase = 'player';
      battle.tagsThisRound = { ally: {}, enemy: {} };
      battle.activeUid = null;
      battle.emit({ t: 'roundStart', round: battle.round });
      battle.log('— Round ' + battle.round + ' —', 'phase');
      battle.allies().forEach(function (u) { u.acted = u.downed; });
      runHooks('roundStart', {});
      if (battle.over) return;
      /* Stunned heroes lose their turn up front. */
      battle.unitsOfSide('ally').forEach(function (u) {
        if ((u.statuses.stun || 0) > 0) {
          u.statuses.stun -= 1;
          if (u.statuses.stun <= 0) delete u.statuses.stun;
          u.acted = true;
          battle.emit({ t: 'stunSkip', uid: u.uid });
          battle.log(u.name + ' is stunned and loses their turn!', 'debuff');
        }
      });
      /* Telegraph enemy intents. */
      battle.enemies().forEach(function (e) { chooseIntent(e); });
      battle.emit({ t: 'intents' });
      maybeAutoEnemyPhase();
    }

    function chooseIntent(enemy) {
      if (!enemy.moves || !enemy.moves.length) { enemy.intent = null; return; }
      var move;
      if (enemy.sequence) {
        move = enemy.moves[enemy.moveCursor % enemy.moves.length];
        enemy.moveCursor += 1;
      } else {
        move = battle.rng.weighted(enemy.moves, function (m) { return m.weight || 1; });
      }
      var victims = battle.resolveTargets(enemy, 'foe', null);
      enemy.intent = { move: move, targetUid: victims.length ? victims[0].uid : null };
    }

    /* Damage preview for the intent badge. */
    battle.previewIntent = function (enemy) {
      if (!enemy.intent) return null;
      var move = enemy.intent.move;
      var dmg = 0, hits = 0;
      (move.effects || []).forEach(function (op) {
        if (op.op !== 'damage') return;
        var per = AZ.effects.evalAmount(op.amount, { battle: battle, source: enemy, target: null }) + (enemy.statuses.strength || 0);
        if ((enemy.statuses.weak || 0) > 0) per = Math.floor(per * 0.75);
        var times = op.times || 1;
        dmg += per * times;
        hits += times;
      });
      return { kind: move.intent || (dmg > 0 ? 'attack' : 'buff'), name: move.name, damage: dmg, hits: hits, targetUid: enemy.intent.targetUid };
    };

    battle.getReadyAllies = function () {
      return battle.unitsOfSide('ally').filter(function (u) { return !u.acted && u.hp > 0; });
    };

    battle.beginTurn = function (uid) {
      if (battle.over || battle.phase !== 'player' || battle.activeUid) return { ok: false, reason: 'busy' };
      var unit = battle.unit(uid);
      if (!unit || unit.side !== 'ally' || unit.acted || unit.downed) return { ok: false, reason: 'not-ready' };
      battle.activeUid = uid;
      battle.emit({ t: 'turnStart', uid: uid });
      battle.log('It is ' + unit.name + '’s turn.', 'phase');
      if (!tickUnit(unit)) { battle.activeUid = null; unit.acted = true; maybeAutoEnemyPhase(); return { ok: true, downed: true }; }
      unit.energy = unit.energyMax;
      runHooks('turnStart', { unit: unit });
      battle.drawCards(unit, Math.max(0, unit.drawSize - unit.hand.length));
      battle.checkEnd();
      return { ok: true };
    };

    battle.canPlay = function (card) {
      var unit = battle.active();
      if (!unit) return { ok: false, reason: 'No active hero.' };
      if (card.def.cost > unit.energy) return { ok: false, reason: 'Not enough Energy.' };
      var kind = AZ.effects.pickKind(card.def.effects);
      if (kind === 'downed') {
        var downed = battle.unitsOfSide('ally', { includeDowned: true }).filter(function (u) { return u.downed; });
        if (!downed.length) return { ok: false, reason: 'No fallen ally to revive.' };
      }
      return { ok: true, pick: kind };
    };

    battle.playCard = function (iid, targetUid) {
      if (battle.over || battle.phase !== 'player') return { ok: false, reason: 'Not the moment.' };
      var unit = battle.active();
      if (!unit) return { ok: false, reason: 'Pick a hero first.' };
      var idx = -1;
      for (var i = 0; i < unit.hand.length; i++) if (unit.hand[i].iid === iid) { idx = i; break; }
      if (idx < 0) return { ok: false, reason: 'Card not in hand.' };
      var card = unit.hand[idx];
      var can = battle.canPlay(card);
      if (!can.ok) return can;
      var chosen = targetUid ? battle.unit(targetUid) : null;

      unit.energy -= card.def.cost;
      unit.hand.splice(idx, 1);
      (card.def.exhaust ? unit.exhaust : unit.discard).push(card);
      battle.stats.cardsPlayed += 1;

      /* Log combo tags first so "per X played this round" includes this card. */
      (card.def.tags || []).forEach(function (tag) {
        battle.tagsThisRound.ally[tag] = (battle.tagsThisRound.ally[tag] || 0) + 1;
      });

      battle.emit({ t: 'play', uid: unit.uid, cardId: card.def.id, cardName: card.def.name, targetUid: targetUid || null });
      battle.log(unit.name + ' plays “' + card.def.name + '”.', 'play');

      AZ.effects.resolve(battle, unit, card.def.effects || [], { target: chosen, card: card.def });
      if (!battle.over) runHooks('cardPlayed', { unit: unit, card: card.def });
      battle.checkEnd();
      return { ok: true };
    };

    battle.endTurn = function () {
      if (battle.over || battle.phase !== 'player') return { ok: false };
      var unit = battle.active();
      if (!unit) return { ok: false };
      var kept = [];
      unit.hand.forEach(function (c) { (c.def.retain ? kept : unit.discard).push(c); });
      unit.hand = kept;
      unit.acted = true;
      battle.activeUid = null;
      battle.emit({ t: 'turnEnd', uid: unit.uid });
      maybeAutoEnemyPhase();
      return { ok: true };
    };

    function maybeAutoEnemyPhase() {
      if (battle.over) return;
      if (battle.getReadyAllies().length === 0 && !battle.activeUid) {
        enemyPhase();
        if (!battle.over) {
          endRound();
          startRound();
        }
      }
    }

    function enemyPhase() {
      battle.phase = 'enemy';
      battle.emit({ t: 'phase', phase: 'enemy' });
      battle.log('Enemy phase…', 'phase');
      var order = battle.enemies().slice().sort(function (a, b) { return b.speed - a.speed; });
      order.forEach(function (enemy) {
        if (battle.over || enemy.hp <= 0) return;
        if (!tickUnit(enemy)) return;
        if ((enemy.statuses.stun || 0) > 0) {
          enemy.statuses.stun -= 1;
          if (enemy.statuses.stun <= 0) delete enemy.statuses.stun;
          battle.emit({ t: 'stunSkip', uid: enemy.uid });
          battle.log(enemy.name + ' is stunned and reels!', 'buff');
          return;
        }
        if (!enemy.intent) chooseIntent(enemy);
        if (!enemy.intent) return;
        var move = enemy.intent.move;
        var target = enemy.intent.targetUid ? battle.unit(enemy.intent.targetUid) : null;
        if (!target || target.downed || target.hp <= 0 || target.side === 'enemy') {
          var re = battle.resolveTargets(enemy, 'foe', null);
          target = re.length ? re[0] : null;
        }
        /* Re-check taunt at execution time. */
        var taunters = battle.unitsOfSide('ally').filter(function (u) { return (u.statuses.taunt || 0) > 0; });
        if (taunters.length && (!target || (target.statuses.taunt || 0) <= 0)) {
          target = battle.rng.pick(taunters);
        }
        battle.emit({ t: 'moveUsed', uid: enemy.uid, moveName: move.name, targetUid: target ? target.uid : null });
        battle.log(enemy.name + ' uses “' + move.name + '”.', 'danger');
        AZ.effects.resolve(battle, enemy, move.effects || [], { target: target });
        (move.tags || []).forEach(function (tag) {
          battle.tagsThisRound.enemy[tag] = (battle.tagsThisRound.enemy[tag] || 0) + 1;
        });
        battle.checkEnd();
      });
    }

    function endRound() {
      if (battle.over) return;
      battle.emit({ t: 'roundEnd', round: battle.round });
      runHooks('roundEnd', {});
      /* Decay round-based statuses. */
      battle.units.forEach(function (u) {
        if (u.hp <= 0 || u.downed) return;
        Object.keys(u.statuses).forEach(function (k) {
          var meta = STATUSES()[k];
          if (meta && meta.decay === 'round') {
            u.statuses[k] -= 1;
            if (u.statuses[k] <= 0) delete u.statuses[k];
          }
        });
      });
      /* Age battlefield passives. */
      battle.passives = battle.passives.filter(function (p) {
        if (p.duration < 0) return true;
        p.duration -= 1;
        if (p.duration <= 0) {
          battle.emit({ t: 'passiveExpire', id: p.id, name: p.name });
          battle.log('“' + p.name + '” fades.', 'chaos');
          return false;
        }
        return true;
      });
    }

    battle.checkEnd = function () {
      if (battle.over) return;
      if (battle.enemies().length === 0) {
        battle.over = true;
        battle.phase = 'over';
        battle.result = { victory: true, rounds: battle.round, stats: battle.stats };
        battle.emit({ t: 'end', victory: true });
        battle.log('VICTORY!', 'victory');
        return;
      }
      var aliveAllies = battle.unitsOfSide('ally');
      if (aliveAllies.length === 0) {
        battle.over = true;
        battle.phase = 'over';
        battle.result = { victory: false, rounds: battle.round, stats: battle.stats };
        battle.emit({ t: 'end', victory: false });
        battle.log('The team has fallen…', 'danger');
      }
    };

    battle.concede = function () {
      if (battle.over) return;
      battle.over = true;
      battle.phase = 'over';
      battle.result = { victory: false, conceded: true, rounds: battle.round, stats: battle.stats };
      battle.emit({ t: 'end', victory: false });
      battle.log('The team retreats…', 'danger');
    };

    return battle;
  }

  AZ.battle = { create: create };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

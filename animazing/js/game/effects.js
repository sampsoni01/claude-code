/* Animazing — effect DSL interpreter.
   Effects are plain-data op lists authored in the Studio (or in starter
   content). The interpreter is side-relative: the same DSL powers hero
   cards, enemy moves, item hooks and battlefield passives.

   Op shape: { op, target?, amount?, times?, status?, stacks?, passive?,
               choices?, if?, exhaust-level flags live on the card }.
   Amounts are numbers or scaling objects — see evalAmount(). */
(function (AZ) {
  'use strict';

  /* -------------------- amounts -------------------- */

  function evalAmount(spec, ctx) {
    if (typeof spec === 'number') return spec;
    if (!spec || typeof spec !== 'object') return 0;
    var battle = ctx.battle, source = ctx.source, target = ctx.target;
    var v = spec.base || 0;
    if (spec.perRoundTag && battle) {
      var counts = battle.tagsThisRound[source.side] || {};
      v += (counts[spec.perRoundTag.tag] || 0) * (spec.perRoundTag.mult || 1);
    }
    if (spec.perStatusTarget && target) {
      v += (target.statuses[spec.perStatusTarget.status] || 0) * (spec.perStatusTarget.mult || 1);
    }
    if (spec.perStatusSelf && source) {
      v += (source.statuses[spec.perStatusSelf.status] || 0) * (spec.perStatusSelf.mult || 1);
    }
    if (spec.perSelfBlock && source) {
      v += source.block * (spec.perSelfBlock.mult || 1);
    }
    if (spec.perDownedFriend && battle) {
      var downed = battle.unitsOfSide(source.side, { includeDowned: true }).filter(function (u) { return u.downed; }).length;
      v += downed * (spec.perDownedFriend.mult || 1);
    }
    if (spec.perPassive && battle) {
      var n = battle.passives.filter(function (p) {
        if (p.side !== 'global' && p.side !== source.side) return false;
        if (spec.perPassive.tag) return (p.tags || []).indexOf(spec.perPassive.tag) >= 0;
        return true;
      }).length;
      v += n * (spec.perPassive.mult || 1);
    }
    return Math.max(0, Math.floor(v));
  }

  /* -------------------- conditions -------------------- */

  function checkCond(cond, ctx) {
    if (!cond) return true;
    var battle = ctx.battle, source = ctx.source, target = ctx.target;
    if (cond.tagThisRound) {
      var counts = (battle && battle.tagsThisRound[source.side]) || {};
      return (counts[cond.tagThisRound] || 0) >= (cond.minCount || 1);
    }
    if (cond.selfHpBelowPct != null) {
      return source && (source.hp / source.maxHp) * 100 < cond.selfHpBelowPct;
    }
    if (cond.selfHasBlock) return source && source.block > 0;
    if (cond.targetHasStatus) return !!(target && (target.statuses[cond.targetHasStatus] || 0) > 0);
    if (cond.targetHasBlock) return !!(target && target.block > 0);
    if (cond.itemTag) {
      return !!(source && (source.items || []).some(function (it) {
        return (it.tags || []).indexOf(cond.itemTag) >= 0;
      }));
    }
    if (cond.passiveActive) {
      return !!(battle && battle.passives.some(function (p) {
        if (p.side !== 'global' && p.side !== source.side) return false;
        return (p.tags || []).indexOf(cond.passiveActive) >= 0 || p.name === cond.passiveActive;
      }));
    }
    if (cond.chance != null) return battle ? battle.rng.chance(cond.chance) : Math.random() < cond.chance;
    return true;
  }

  /* -------------------- resolution -------------------- */

  /* opts: { target: chosen unit or null, card: cardDef or null, tags: extra tags } */
  function resolve(battle, source, effects, opts) {
    opts = opts || {};
    (effects || []).forEach(function (op) {
      if (battle.over) return;
      applyOp(battle, source, op, opts);
    });
  }

  function applyOp(battle, source, op, opts) {
    if (!op || !op.op) return;
    var meta = AZ.schema.EFFECT_OPS[op.op];
    var targetKey = op.target || (meta && meta.defaultTarget) || 'self';
    var condCtx = { battle: battle, source: source, target: firstTarget(battle, source, targetKey, opts.target) };
    if (!checkCond(op.if, condCtx)) return;

    var tags = (opts.card && opts.card.tags) || op.tags || opts.tags || [];

    switch (op.op) {
      case 'damage': {
        var times = op.times || 1;
        for (var i = 0; i < times; i++) {
          if (battle.over) break;
          var tgts = battle.resolveTargets(source, targetKey, opts.target);
          tgts.forEach(function (tgt) {
            if (battle.over || tgt.hp <= 0 || tgt.downed) return;
            var amt = evalAmount(op.amount, { battle: battle, source: source, target: tgt });
            battle.attack(source, tgt, amt, { tags: tags, isAttack: op.isAttack !== false });
          });
        }
        break;
      }
      case 'block':
        eachTarget(battle, source, targetKey, opts, function (tgt) {
          battle.gainBlock(tgt, evalAmount(op.amount, { battle: battle, source: source, target: tgt }));
        });
        break;
      case 'heal':
        eachTarget(battle, source, targetKey, opts, function (tgt) {
          battle.heal(tgt, evalAmount(op.amount, { battle: battle, source: source, target: tgt }));
        });
        break;
      case 'revive': {
        var tgtsR = battle.resolveTargets(source, 'downed-friend', opts.target);
        tgtsR.forEach(function (tgt) {
          var pct = evalAmount(op.amount != null ? op.amount : 30, { battle: battle, source: source, target: tgt });
          battle.revive(tgt, pct);
        });
        break;
      }
      case 'status':
        eachTarget(battle, source, targetKey, opts, function (tgt) {
          var stacks = evalAmount(op.stacks != null ? op.stacks : 1, { battle: battle, source: source, target: tgt });
          if (stacks > 0) battle.applyStatus(source, tgt, op.status, stacks);
        });
        break;
      case 'cleanse':
        eachTarget(battle, source, targetKey, opts, function (tgt) { battle.cleanse(tgt); });
        break;
      case 'energy':
        battle.gainEnergy(source, evalAmount(op.amount, { battle: battle, source: source }));
        break;
      case 'draw':
        battle.drawCards(source, evalAmount(op.amount, { battle: battle, source: source }));
        break;
      case 'passive':
        if (op.passive) battle.addPassive(source, op.passive);
        break;
      case 'random': {
        var choices = op.choices || [];
        if (!choices.length) break;
        var pickIdx = battle.rng.int(choices.length);
        battle.log(source.name + '’s chaos effect surges…', 'chaos');
        resolve(battle, source, choices[pickIdx], opts);
        break;
      }
      default: break;
    }
  }

  function eachTarget(battle, source, targetKey, opts, fn) {
    battle.resolveTargets(source, targetKey, opts.target).forEach(function (tgt) {
      if (battle.over) return;
      fn(tgt);
    });
  }

  function firstTarget(battle, source, targetKey, chosen) {
    var t = battle.resolveTargets(source, targetKey, chosen);
    return t.length ? t[0] : null;
  }

  /* Does this effect list need the player to pick a target, and of what kind? */
  function pickKind(effects) {
    var kind = null;
    (effects || []).forEach(function (op) {
      if (!op) return;
      var meta = AZ.schema.EFFECT_OPS[op.op];
      var t = op.target || (meta && meta.defaultTarget);
      if (t === 'foe') kind = kind || 'foe';
      if (t === 'friend-target') kind = kind || 'friend';
      if (t === 'downed-friend') kind = kind || 'downed';
      if (op.op === 'random') {
        (op.choices || []).forEach(function (ops) { kind = kind || pickKind(ops); });
      }
    });
    return kind;
  }

  AZ.effects = {
    evalAmount: evalAmount,
    checkCond: checkCond,
    resolve: resolve,
    pickKind: pickKind
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

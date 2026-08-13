/* Animazing — meta-game state: the player profile (currencies, collection,
   team, decks, equipment), the summon altar (gacha with pity), and the
   expedition run structure (Slay-the-Spire-style node map).
   All mutations save immediately. */
(function (AZ) {
  'use strict';

  var profile = null;

  /* ---------------- profile lifecycle ---------------- */

  function defaultProfile() {
    return {
      v: 1,
      createdAt: new Date().toISOString(),
      gold: 0,
      crystals: 0,
      pity: 0,
      ownedChars: {},   // charId -> {level, copies}
      ownedCards: {},   // cardId -> count
      ownedItems: {},   // itemId -> count
      team: { members: [], decks: {}, equips: {} },
      settings: { showSamples: true, customInGacha: true, fast: false },
      run: null,
      maxTier: 1,
      stats: { battles: 0, wins: 0, runs: 0, runsWon: 0, summons: 0, bestTier: 0 },
      seenIntro: false
    };
  }

  function init() {
    profile = AZ.storage.loadProfile();
    if (!profile) {
      profile = defaultProfile();
      firstRunGrants();
      save();
    }
    return profile;
  }

  function save() { AZ.storage.saveProfile(profile); }
  function get() { return profile; }

  function resetAll() {
    AZ.storage.clearProfile();
    profile = defaultProfile();
    firstRunGrants();
    save();
  }

  /* Starter grants: a playable team of four plus a spread of their cards. */
  function firstRunGrants() {
    profile.gold = 500;
    profile.crystals = 120;
    var starters = ['ch-kira', 'ch-taro', 'ch-hana', 'ch-yuki'];
    starters.forEach(function (id) { grantCharacter(id); });
    AZ.content.cards().forEach(function (card) {
      if (card.owner === '*') { grantCard(card.id, 4); return; }
      if (starters.indexOf(card.owner) < 0) return;
      var n = (card.rarity === 'N' || card.rarity === 'R') ? 2 : 1;
      grantCard(card.id, n);
    });
    ['it-iron-plate', 'it-ember-charm', 'it-jade-talisman'].forEach(function (id) { grantItem(id, 1); });
    profile.team.members = starters.slice();
    starters.forEach(function (id) { profile.team.decks[id] = autoBuildDeck(id); });
    profile.team.equips = { 'ch-taro': ['it-iron-plate'], 'ch-kira': ['it-ember-charm'], 'ch-hana': ['it-jade-talisman'] };
  }

  /* ---------------- currencies ---------------- */

  function spend(kind, amount) {
    if ((profile[kind] || 0) < amount) return false;
    profile[kind] -= amount;
    save();
    return true;
  }
  function earn(kind, amount) {
    profile[kind] = (profile[kind] || 0) + Math.max(0, Math.round(amount));
    save();
  }

  /* ---------------- collection ---------------- */

  function grantCharacter(id) {
    var entry = profile.ownedChars[id];
    var result;
    if (!entry) {
      profile.ownedChars[id] = { level: 1, copies: 1 };
      result = { id: id, isNew: true, level: 1 };
    } else {
      entry.copies += 1;
      entry.level = Math.min(10, entry.level + 1);
      result = { id: id, isNew: false, level: entry.level };
    }
    save();
    return result;
  }

  function grantCard(id, n) {
    profile.ownedCards[id] = (profile.ownedCards[id] || 0) + (n || 1);
    save();
  }

  function grantItem(id, n) {
    profile.ownedItems[id] = (profile.ownedItems[id] || 0) + (n || 1);
    save();
  }

  function ownsChar(id) { return !!profile.ownedChars[id]; }
  function cardCount(id) {
    var card = AZ.content.getCard(id);
    if (card && card.owner === '*') return 99; // basics are unlimited
    return profile.ownedCards[id] || 0;
  }
  function itemCount(id) { return profile.ownedItems[id] || 0; }

  function charLevel(id) {
    var e = profile.ownedChars[id];
    return e ? e.level : 1;
  }

  /* ---------------- team, decks, equipment ---------------- */

  function setTeam(members) {
    profile.team.members = members.slice(0, AZ.schema.LIMITS.teamSize);
    profile.team.members.forEach(function (id) {
      if (!profile.team.decks[id] || !profile.team.decks[id].length) profile.team.decks[id] = autoBuildDeck(id);
    });
    save();
  }

  function autoBuildDeck(charId) {
    var order = AZ.schema.RARITY_ORDER;
    var pool = [];
    AZ.content.cardsForOwner(charId).forEach(function (card) {
      var owned = cardCount(card.id);
      if (card.owner === '*') owned = Math.min(owned, 2);
      for (var i = 0; i < owned && i < 3; i++) pool.push(card);
    });
    pool.sort(function (a, b) { return order.indexOf(b.rarity) - order.indexOf(a.rarity); });
    var deck = pool.slice(0, 10).map(function (c) { return c.id; });
    var basics = ['ab-strike', 'ab-guard'];
    var bi = 0;
    while (deck.length < AZ.schema.LIMITS.deckMin) {
      deck.push(basics[bi % basics.length]);
      bi++;
    }
    return deck;
  }

  function setDeck(charId, cardIds) {
    var errs = validateDeck(charId, cardIds);
    if (errs.length) return errs;
    profile.team.decks[charId] = cardIds.slice();
    save();
    return [];
  }

  function validateDeck(charId, cardIds) {
    var errs = [];
    var L = AZ.schema.LIMITS;
    if (cardIds.length < L.deckMin) errs.push('Deck needs at least ' + L.deckMin + ' cards.');
    if (cardIds.length > L.deckMax) errs.push('Deck can hold at most ' + L.deckMax + ' cards.');
    var counts = {};
    cardIds.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    Object.keys(counts).forEach(function (id) {
      var card = AZ.content.getCard(id);
      if (!card) { errs.push('Unknown card in deck: ' + id); return; }
      if (card.owner !== '*' && card.owner !== charId) errs.push('“' + card.name + '” belongs to another hero.');
      if (counts[id] > cardCount(id)) errs.push('Not enough copies of “' + card.name + '” (' + counts[id] + '/' + cardCount(id) + ').');
    });
    return errs;
  }

  /* How many copies of an item are equipped across the team, optionally
     excluding one hero (for editing their own loadout). */
  function equippedCount(itemId, exceptCharId) {
    var n = 0;
    Object.keys(profile.team.equips).forEach(function (cid) {
      if (cid === exceptCharId) return;
      (profile.team.equips[cid] || []).forEach(function (id) { if (id === itemId) n++; });
    });
    return n;
  }

  function setEquips(charId, itemIds) {
    var L = AZ.schema.LIMITS;
    var list = itemIds.slice(0, L.equipSlots);
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      var used = equippedCount(id, charId) + list.slice(0, i).filter(function (x) { return x === id; }).length;
      if (used >= itemCount(id)) return ['Not enough copies of that item to equip.'];
    }
    profile.team.equips[charId] = list;
    save();
    return [];
  }

  /* ---------------- battle unit construction ---------------- */

  function buildUnitFor(charId) {
    var ch = AZ.content.getCharacter(charId);
    if (!ch) return null;
    var level = charLevel(charId);
    var itemDefs = (profile.team.equips[charId] || [])
      .map(function (id) { return AZ.content.getItem(id); })
      .filter(Boolean);
    var maxHp = ch.stats.hp + (level - 1) * 4;
    var energyMax = ch.stats.energy;
    var drawSize = ch.stats.draw;
    itemDefs.forEach(function (it) {
      var m = it.statMods || {};
      maxHp += m.hp || 0;
      energyMax += m.energy || 0;
      drawSize += m.draw || 0;
    });
    var deckIds = profile.team.decks[charId] && profile.team.decks[charId].length
      ? profile.team.decks[charId] : autoBuildDeck(charId);
    var deckDefs = deckIds.map(function (id) { return AZ.content.getCard(id); }).filter(Boolean);
    var hp = maxHp;
    if (profile.run && profile.run.hp && profile.run.hp[charId] != null) {
      hp = Math.min(maxHp, Math.max(1, profile.run.hp[charId]));
    }
    return {
      refId: charId,
      name: ch.name,
      title: ch.title || '',
      element: ch.element,
      role: ch.role,
      rarity: ch.rarity,
      level: level,
      imageId: ch.imageId || null,
      portraitSeed: ch.name,
      glyph: ch.glyph,
      maxHp: maxHp,
      hp: hp,
      energyMax: Math.max(1, energyMax),
      drawSize: Math.max(1, drawSize),
      speed: ch.stats.speed || 5,
      items: itemDefs,
      innate: ch.innate || null,
      deckDefs: deckDefs
    };
  }

  function scaleEffects(effects, factor) {
    return (effects || []).map(function (op) {
      var copy = AZ.util.deepClone(op);
      if (copy.op === 'damage') {
        if (typeof copy.amount === 'number') copy.amount = Math.round(copy.amount * factor);
        else if (copy.amount && typeof copy.amount === 'object') copy.amount.base = Math.round((copy.amount.base || 0) * factor);
      }
      if (copy.op === 'block' && typeof copy.amount === 'number') copy.amount = Math.round(copy.amount * factor);
      if (copy.op === 'random' && copy.choices) copy.choices = copy.choices.map(function (ops) { return scaleEffects(ops, factor); });
      return copy;
    });
  }

  function buildEnemyCfg(enemyDef, hpScale, dmgScale) {
    return {
      refId: enemyDef.id,
      name: enemyDef.name,
      element: enemyDef.element || 'shadow',
      rarity: enemyDef.boss ? 'UR' : (enemyDef.elite ? 'SSR' : 'R'),
      imageId: enemyDef.imageId || null,
      portraitSeed: enemyDef.name,
      glyph: enemyDef.glyph,
      maxHp: Math.round(enemyDef.stats.hp * hpScale),
      speed: enemyDef.stats.speed || 5,
      moves: (enemyDef.moves || []).map(function (m) {
        var mm = AZ.util.deepClone(m);
        mm.effects = scaleEffects(m.effects, dmgScale);
        return mm;
      }),
      sequence: !!enemyDef.sequence,
      innate: enemyDef.innate || null,
      boss: !!enemyDef.boss,
      elite: !!enemyDef.elite
    };
  }

  /* ---------------- summons (gacha) ---------------- */

  var COSTS = { characterSummon: 10, abilityPack: 100, itemCache: 150 };

  function gachaCharacterPool() {
    var settings = profile.settings;
    return AZ.content.characters().filter(function (c) {
      if (c.sample && !settings.showSamples) return false;
      if (!c.sample && AZ.content.isCustom('characters', c.id)) {
        if (!settings.customInGacha || c.inGacha === false) return false;
      }
      if (c.inGacha === false) return false;
      return true;
    });
  }

  function summonCharacter(rngOpt) {
    if (!spend('crystals', COSTS.characterSummon)) return { error: 'Not enough Anima Crystals.' };
    var pool = gachaCharacterPool();
    if (!pool.length) { earn('crystals', COSTS.characterSummon); return { error: 'The summon pool is empty — create heroes in the Studio or re-enable samples.' }; }
    var rng = rngOpt || AZ.util.rng(Math.floor(Math.random() * 1e9));
    var R = AZ.schema.RARITIES, ORDER = AZ.schema.RARITY_ORDER;
    profile.pity += 1;
    var forceHigh = profile.pity >= 10;
    var candidates = forceHigh
      ? pool.filter(function (c) { return ORDER.indexOf(c.rarity) >= ORDER.indexOf('SR'); })
      : pool;
    if (!candidates.length) candidates = pool;
    var pick = rng.weighted(candidates, function (c) { return R[c.rarity] ? R[c.rarity].weight : 1; });
    if (ORDER.indexOf(pick.rarity) >= ORDER.indexOf('SR')) profile.pity = 0;
    var grant = grantCharacter(pick.id);
    profile.stats.summons += 1;
    save();
    return { character: pick, isNew: grant.isNew, level: grant.level, pity: profile.pity };
  }

  function gachaCardPool() {
    var settings = profile.settings;
    return AZ.content.cards().filter(function (card) {
      if (card.owner === '*') return false;
      if (!ownsChar(card.owner)) return false;
      var ch = AZ.content.getCharacter(card.owner);
      if (ch && ch.sample && !settings.showSamples) return false;
      if (AZ.content.isCustom('cards', card.owner === '*' ? '' : card.id) && !settings.customInGacha) return false;
      if (card.inGacha === false) return false;
      return true;
    });
  }

  function summonAbilityPack(rngOpt) {
    var pool = gachaCardPool();
    if (!pool.length) return { error: 'No ability cards to find — recruit more heroes first.' };
    if (!spend('gold', COSTS.abilityPack)) return { error: 'Not enough gold.' };
    var rng = rngOpt || AZ.util.rng(Math.floor(Math.random() * 1e9));
    var R = AZ.schema.RARITIES;
    var pulls = [];
    for (var i = 0; i < 3; i++) {
      var card = rng.weighted(pool, function (c) { return R[c.rarity] ? R[c.rarity].cardWeight : 1; });
      grantCard(card.id, 1);
      pulls.push(card);
    }
    profile.stats.summons += 1;
    save();
    return { cards: pulls };
  }

  function summonItemCache(rngOpt) {
    var pool = AZ.content.items().filter(function (it) {
      if (it.sample && !profile.settings.showSamples) return false;
      if (it.inGacha === false) return false;
      return true;
    });
    if (!pool.length) return { error: 'No relics to find.' };
    if (!spend('gold', COSTS.itemCache)) return { error: 'Not enough gold.' };
    var rng = rngOpt || AZ.util.rng(Math.floor(Math.random() * 1e9));
    var R = AZ.schema.RARITIES;
    var item = rng.weighted(pool, function (it) { return R[it.rarity] ? R[it.rarity].cardWeight : 1; });
    grantItem(item.id, 1);
    profile.stats.summons += 1;
    save();
    return { item: item };
  }

  /* ---------------- expedition runs ---------------- */

  function generateNodes(rng) {
    return [
      { options: ['battle'] },
      { options: rng.shuffle(['battle', 'event']) },
      { options: rng.shuffle(['battle', 'forge']) },
      { options: rng.shuffle(['elite', 'battle']) },
      { options: rng.shuffle(['event', 'battle', 'forge']) },
      { options: rng.shuffle(['forge', 'elite']) },
      { options: rng.shuffle(['battle', 'elite', 'event']) },
      { options: ['boss'] }
    ];
  }

  function newRun(tier) {
    tier = Math.max(1, Math.min(tier || 1, profile.maxTier));
    var seed = Math.floor(Math.random() * 1e9);
    var rng = AZ.util.rng(seed);
    var hp = {};
    profile.team.members.forEach(function (id) {
      var cfg = buildUnitFor(id);
      if (cfg) hp[id] = cfg.maxHp;
    });
    profile.run = {
      tier: tier,
      seed: seed,
      step: 1,
      nodes: generateNodes(rng),
      hp: hp,
      goldEarned: 0,
      boons: [],
      current: null
    };
    profile.stats.runs += 1;
    save();
    return profile.run;
  }

  function run() { return profile.run; }

  function currentNode() {
    var r = profile.run;
    if (!r) return null;
    return r.nodes[r.step - 1] || null;
  }

  function chooseOption(type) {
    var r = profile.run;
    if (!r) return null;
    r.current = { type: type };
    save();
    return r.current;
  }

  function enemyPoolFor(type) {
    /* Samples stay in the opposition pool even when hidden from the
       collection/gacha — someone has to be the bad guys. Custom enemies
       join the pool the moment they're saved in the Studio. */
    var all = AZ.content.enemies();
    if (type === 'boss') {
      var bosses = all.filter(function (e) { return e.boss; });
      return bosses.length ? bosses : all;
    }
    if (type === 'elite') {
      var elites = all.filter(function (e) { return e.elite; });
      return elites.length ? elites : all;
    }
    return all.filter(function (e) { return !e.boss && !e.elite; });
  }

  function makeBattleConfig(type) {
    var r = profile.run;
    if (!r) return null;
    var rng = AZ.util.rng(r.seed + r.step * 977);
    var step = r.step, tier = r.tier;
    var hpScale = 1 + 0.10 * (step - 1) + 0.35 * (tier - 1);
    var dmgScale = 1 + 0.05 * (step - 1) + 0.22 * (tier - 1);
    var pool = enemyPoolFor(type);
    var enemies = [];
    if (type === 'boss') {
      enemies.push(buildEnemyCfg(rng.pick(pool), hpScale, dmgScale));
    } else if (type === 'elite') {
      enemies.push(buildEnemyCfg(rng.pick(pool), hpScale, dmgScale));
      var minions = enemyPoolFor('battle');
      if (minions.length && rng.chance(0.6)) enemies.push(buildEnemyCfg(rng.pick(minions), hpScale * 0.8, dmgScale));
    } else {
      var n = Math.min(3, 1 + rng.int(2) + (step > 4 ? 1 : 0));
      for (var i = 0; i < n; i++) enemies.push(buildEnemyCfg(rng.pick(pool), hpScale, dmgScale));
    }
    var allies = profile.team.members.map(buildUnitFor).filter(Boolean);
    return {
      allies: allies,
      enemies: enemies,
      seed: r.seed + r.step * 7919,
      boons: AZ.util.deepClone(r.boons || []),
      nodeType: type
    };
  }

  function teamGoldBonus() {
    var bonus = 0;
    Object.keys(profile.team.equips).forEach(function (cid) {
      (profile.team.equips[cid] || []).forEach(function (id) {
        var it = AZ.content.getItem(id);
        if (it && it.goldBonus) bonus += it.goldBonus;
      });
    });
    return bonus;
  }

  function rewardCardChoices(rng) {
    var pool = gachaCardPool();
    if (!pool.length) return [];
    var R = AZ.schema.RARITIES;
    var picks = [], guard = 0;
    while (picks.length < 3 && guard < 50) {
      guard++;
      var c = rng.weighted(pool, function (x) { return R[x.rarity] ? R[x.rarity].cardWeight : 1; });
      if (picks.indexOf(c) < 0) picks.push(c);
      if (picks.length >= pool.length) break;
    }
    return picks;
  }

  /* Called with the finished (victorious) battle. Returns the rewards blob. */
  function completeBattle(battle, nodeType) {
    var r = profile.run;
    profile.stats.battles += 1;
    profile.stats.wins += 1;
    var rng = AZ.util.rng((r ? r.seed : 1) + (r ? r.step : 0) * 31 + 7);
    var tierMult = r ? 1 + 0.30 * (r.tier - 1) : 1;
    var base = nodeType === 'boss' ? 150 : nodeType === 'elite' ? 80 : 40;
    var stepBonus = r ? r.step * 10 : 0;
    var gold = Math.round((base + stepBonus) * tierMult * (1 + teamGoldBonus()));
    var crystals = nodeType === 'boss' ? 40 : nodeType === 'elite' ? 15 : 0;
    if (rng.chance(0.15)) crystals += 5;

    /* Persist team HP through the run; the fallen crawl back at 25%. */
    if (r) {
      battle.allies().forEach(function (u) {
        r.hp[u.refId] = u.downed ? Math.max(1, Math.floor(u.maxHp * 0.25)) : u.hp;
      });
      r.goldEarned += gold;
    }
    earn('gold', gold);
    if (crystals) earn('crystals', crystals);

    var rewards = {
      gold: gold,
      crystals: crystals,
      cardChoices: rewardCardChoices(rng),
      item: null
    };
    if (nodeType === 'elite' && rng.chance(0.7)) {
      var pool = AZ.content.items();
      if (pool.length) { rewards.item = rng.pick(pool); grantItem(rewards.item.id, 1); }
    }
    save();
    return rewards;
  }

  function advanceRun() {
    var r = profile.run;
    if (!r) return { done: true };
    r.current = null;
    r.step += 1;
    if (r.step > r.nodes.length) {
      var tier = r.tier;
      profile.stats.runsWon += 1;
      profile.stats.bestTier = Math.max(profile.stats.bestTier, tier);
      profile.maxTier = Math.max(profile.maxTier, tier + 1);
      var bonus = 30 + tier * 15;
      earn('crystals', bonus);
      profile.run = null;
      save();
      return { done: true, victoryBonus: bonus, tier: tier };
    }
    save();
    return { done: false, step: r.step };
  }

  function failRun() {
    profile.stats.battles += 1;
    profile.run = null;
    save();
  }

  function abandonRun() {
    profile.run = null;
    save();
  }

  /* Event + forge resolution. Returns a description of what happened. */
  function applyEventChoice(result, rngOpt) {
    var rng = rngOpt || AZ.util.rng(Math.floor(Math.random() * 1e9));
    var out = [];
    var r = profile.run;
    if (result.costGold) {
      if (!spend('gold', result.costGold)) return { failed: true, lines: ['Not enough gold.'] };
      out.push('-' + result.costGold + ' gold');
    }
    if (result.gold) { earn('gold', result.gold); out.push('+' + result.gold + ' gold'); }
    if (result.crystals) { earn('crystals', result.crystals); out.push('+' + result.crystals + ' crystals'); }
    if (result.healPct && r) {
      Object.keys(r.hp).forEach(function (cid) {
        var cfg = buildUnitFor(cid);
        if (!cfg) return;
        r.hp[cid] = Math.min(cfg.maxHp, r.hp[cid] + Math.ceil(cfg.maxHp * result.healPct / 100));
      });
      out.push('Team healed ' + result.healPct + '%');
    }
    if (result.hpCostPct && r) {
      Object.keys(r.hp).forEach(function (cid) {
        r.hp[cid] = Math.max(1, r.hp[cid] - Math.ceil(r.hp[cid] * result.hpCostPct / 100));
      });
      out.push('Team lost ' + result.hpCostPct + '% HP');
    }
    if (result.item) {
      var pool = AZ.content.items();
      if (pool.length) {
        var item = rng.pick(pool);
        grantItem(item.id, 1);
        out.push('Found relic: ' + item.name);
      }
    }
    if (result.boon && r) { r.boons.push(result.boon); out.push('Blessing gained: ' + result.boon.name); }
    if (result.curse && r) { r.boons.push(result.curse); out.push('Curse gained: ' + result.curse.name); }
    if (result.gamble) {
      if (profile.gold < result.gamble.stake) { out.push('Too poor to gamble. The tanuki laughs.'); }
      else if (rng.chance(0.5)) { earn('gold', result.gamble.win); out.push('WON the wager! +' + result.gamble.win + ' gold'); }
      else { spend('gold', result.gamble.stake); out.push('Lost the wager. -' + result.gamble.stake + ' gold'); }
    }
    save();
    return { failed: false, lines: out.length ? out : ['Nothing happened. Probably.'] };
  }

  AZ.state = {
    init: init,
    get: get,
    save: save,
    resetAll: resetAll,
    spend: spend,
    earn: earn,
    grantCharacter: grantCharacter,
    grantCard: grantCard,
    grantItem: grantItem,
    ownsChar: ownsChar,
    cardCount: cardCount,
    itemCount: itemCount,
    charLevel: charLevel,
    setTeam: setTeam,
    autoBuildDeck: autoBuildDeck,
    setDeck: setDeck,
    validateDeck: validateDeck,
    setEquips: setEquips,
    equippedCount: equippedCount,
    buildUnitFor: buildUnitFor,
    buildEnemyCfg: buildEnemyCfg,
    COSTS: COSTS,
    gachaCharacterPool: gachaCharacterPool,
    summonCharacter: summonCharacter,
    summonAbilityPack: summonAbilityPack,
    summonItemCache: summonItemCache,
    newRun: newRun,
    run: run,
    currentNode: currentNode,
    chooseOption: chooseOption,
    makeBattleConfig: makeBattleConfig,
    completeBattle: completeBattle,
    advanceRun: advanceRun,
    failRun: failRun,
    abandonRun: abandonRun,
    applyEventChoice: applyEventChoice
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));

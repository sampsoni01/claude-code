#!/usr/bin/env node
/* Animazing — headless engine test suite.
   Run: node animazing/tests/engine-test.js
   Loads the same modules the browser uses (they attach to globalThis.AZ)
   and exercises combat math, statuses, synergies, gacha and pack I/O. */
'use strict';

var path = require('path');
var base = path.join(__dirname, '..');
['js/core/util.js', 'js/data/schema.js', 'js/core/storage.js', 'js/game/effects.js',
 'js/game/battle.js', 'js/data/starter.js', 'js/game/content.js', 'js/game/state.js']
  .forEach(function (p) { require(path.join(base, p)); });

var AZ = globalThis.AZ;
var failures = 0, checks = 0;

function ok(cond, label) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); }
  else { failures++; console.error('  ✗ FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function section(name) { console.log('\n== ' + name + ' =='); }

/* ------------------------------------------------------------------ */
section('Content registry');
AZ.content.init();
ok(AZ.content.characters().length >= 6, 'starter characters present: ' + AZ.content.characters().length);
ok(AZ.content.cards().length >= 30, 'starter cards present: ' + AZ.content.cards().length);
ok(AZ.content.enemies().length >= 6, 'starter enemies present: ' + AZ.content.enemies().length);
ok(AZ.content.cardsForOwner('ch-kira').some(function (c) { return c.id === 'ab-strike'; }), 'universal basics are usable by heroes');
var badCard = { id: 'x', name: '', rarity: 'ZZ', type: 'attack', cost: 1, owner: 'ch-kira', effects: [{ op: 'nope' }] };
ok(AZ.schema.validateCard(badCard).length >= 3, 'card validation catches bad name/rarity/op');

/* Every starter effect validates against the DSL. */
var dslErrors = [];
AZ.content.cards().forEach(function (c) { AZ.schema.validateCard(c).forEach(function (e) { dslErrors.push(c.id + ': ' + e); }); });
AZ.content.enemies().forEach(function (e) { AZ.schema.validateEnemy(e).forEach(function (err) { dslErrors.push(e.id + ': ' + err); }); });
AZ.content.items().forEach(function (it) { AZ.schema.validateItem(it).forEach(function (err) { dslErrors.push(it.id + ': ' + err); }); });
if (dslErrors.length) dslErrors.forEach(function (e) { console.error('    ' + e); });
eq(dslErrors.length, 0, 'all starter content passes schema validation');

/* Card text renders for everything. */
var untexted = AZ.content.cards().filter(function (c) { return !AZ.schema.cardText(c); });
eq(untexted.length, 0, 'every card generates rules text');

/* ------------------------------------------------------------------ */
section('Profile, decks, unit building');
AZ.state.init();
var profile = AZ.state.get();
ok(profile.team.members.length === 4, 'first-run grants a team of 4');
ok(profile.gold > 0 && profile.crystals > 0, 'starting currencies granted');
var unit = AZ.state.buildUnitFor('ch-kira');
ok(unit && unit.deckDefs.length >= AZ.schema.LIMITS.deckMin, 'Kira has a legal deck (' + unit.deckDefs.length + ' cards)');
ok(unit.items.length === 1 && unit.items[0].id === 'it-ember-charm', 'Kira has the Ember Charm equipped');
var deckErrs = AZ.state.validateDeck('ch-kira', profile.team.decks['ch-kira']);
eq(deckErrs.length, 0, 'auto-built deck validates');
var badDeck = AZ.state.validateDeck('ch-kira', ['ab-taro-bulwark', 'ab-strike', 'ab-strike', 'ab-strike', 'ab-strike', 'ab-strike']);
ok(badDeck.length >= 1, 'deck validation rejects another hero’s card');

/* ------------------------------------------------------------------ */
section('Battle: basics, block, vulnerable, combos');

function fixedBattle(opts) {
  opts = opts || {};
  var allies = (opts.team || ['ch-kira', 'ch-taro', 'ch-hana', 'ch-yuki']).map(AZ.state.buildUnitFor);
  var enemyDef = AZ.content.getEnemy(opts.enemy || 'en-gloomdrop');
  var enemies = [AZ.state.buildEnemyCfg(enemyDef, opts.hpScale || 1, 1)];
  if (opts.twoEnemies) enemies.push(AZ.state.buildEnemyCfg(enemyDef, opts.hpScale || 1, 1));
  return AZ.battle.create({ allies: allies, enemies: enemies, seed: opts.seed != null ? opts.seed : 42 });
}

function giveHand(battle, unit, cardIds) {
  unit.hand = cardIds.map(function (id) { return { iid: AZ.util.uid('ci'), def: AZ.content.getCard(id) }; });
}

var b = fixedBattle({ hpScale: 10 }); // beefy slime so it survives the math checks
b.start();
eq(b.round, 1, 'battle starts at round 1');
ok(b.enemies()[0].intent, 'enemy telegraphs an intent');
var kira = b.allies()[0];
b.beginTurn(kira.uid);
eq(kira.energy, 3, 'active hero gets 3 energy');
eq(kira.hand.length, 5, 'active hero draws 5');
kira.energy = 99; // the checks below play many cards in one turn

var slime = b.enemies()[0];
var hpBefore = slime.hp;
giveHand(b, kira, ['ab-strike']);
var res = b.playCard(kira.hand[0].iid, slime.uid);
ok(res.ok, 'Strike resolves');
eq(hpBefore - slime.hp, 6, 'Strike deals exactly 6 (no modifiers on a basic)');

/* Fire card: Ember Heart innate gives +1 fire damage, Ember Charm +2. */
hpBefore = slime.hp;
giveHand(b, kira, ['ab-kira-flame-slash']);
b.playCard(kira.hand[0].iid, slime.uid);
eq(hpBefore - slime.hp, 11, 'Flame Slash 8 +1 innate +2 Ember Charm = 11');

/* Vulnerable: floor(x * 1.5). */
slime.statuses.vulnerable = 2;
hpBefore = slime.hp;
giveHand(b, kira, ['ab-strike']);
b.playCard(kira.hand[0].iid, slime.uid);
eq(hpBefore - slime.hp, 9, 'Vulnerable Strike: floor(6*1.5) = 9');
delete slime.statuses.vulnerable;

/* Weak: floor(x * 0.75). */
kira.statuses.weak = 1;
hpBefore = slime.hp;
giveHand(b, kira, ['ab-strike']);
b.playCard(kira.hand[0].iid, slime.uid);
eq(hpBefore - slime.hp, 4, 'Weak Strike: floor(6*0.75) = 4');
delete kira.statuses.weak;

/* Block absorbs. */
slime.block = 4;
hpBefore = slime.hp;
giveHand(b, kira, ['ab-strike']);
b.playCard(kira.hand[0].iid, slime.uid);
eq(hpBefore - slime.hp, 2, 'Block absorbs 4 of Strike’s 6');
eq(slime.block, 0, 'Block is consumed');

/* Combo scaling: Thunder Finale counts storm tags including itself. */
var b2 = fixedBattle({ team: ['ch-renji', 'ch-taro', 'ch-hana', 'ch-yuki'], hpScale: 10, seed: 7 });
b2.start();
var renji = b2.allies()[0];
b2.beginTurn(renji.uid);
renji.energy = 9;
var foe = b2.enemies()[0];
giveHand(b2, renji, ['ab-renji-static-jab', 'ab-renji-static-jab', 'ab-renji-thunder-finale']);
b2.playCard(renji.hand[0].iid, foe.uid);
b2.playCard(renji.hand[0].iid, foe.uid);
hpBefore = foe.hp;
b2.playCard(renji.hand[0].iid, foe.uid);
eq(hpBefore - foe.hp, 8 + 3 * 4, 'Thunder Finale: 8 + 4×3 storm cards (including itself) = 20');
ok(renji.exhaust.length === 1, 'Thunder Finale exhausts');

/* Shield Slam scales off current Block. */
var b3 = fixedBattle({ team: ['ch-taro', 'ch-kira', 'ch-hana', 'ch-yuki'], hpScale: 10, seed: 11 });
b3.start();
var taro = b3.allies()[0];
b3.beginTurn(taro.uid);
taro.energy = 9;
taro.block = 10;
var foe3 = b3.enemies()[0];
hpBefore = foe3.hp;
giveHand(b3, taro, ['ab-taro-shield-slam']);
b3.playCard(taro.hand[0].iid, foe3.uid);
eq(hpBefore - foe3.hp, 10, 'Shield Slam deals damage equal to Block (10)');

/* ------------------------------------------------------------------ */
section('Statuses: poison ticks, thorns, taunt, evade');

var b4 = fixedBattle({ team: ['ch-shizuka', 'ch-taro', 'ch-hana', 'ch-yuki'], hpScale: 10, seed: 3 });
b4.start(); // Shizuka's innate applies 2 Poison to a random foe at battle start
var foe4 = b4.enemies()[0];
eq(foe4.statuses.poison, 2, 'First Whisper innate poisons a foe at battle start');
var shizuka = b4.allies()[0];
b4.beginTurn(shizuka.uid);
giveHand(b4, shizuka, ['ab-shizuka-venom-needle']);
b4.playCard(b4.active().hand[0].iid, foe4.uid);
eq(foe4.statuses.poison, 4, 'Venom Needle stacks poison to 4');
hpBefore = foe4.hp;
/* Nightmare Bloom: 4 + 2 per poison stack = 4 + 8 = 12 */
giveHand(b4, shizuka, ['ab-shizuka-nightmare-bloom']);
b4.playCard(b4.active().hand[0].iid, foe4.uid);
eq(hpBefore - foe4.hp, 12, 'Nightmare Bloom scales with target poison (4 + 2×4)');

/* Poison tick fires when the enemy acts. */
b4.endTurn();
b4.allies().forEach(function (u) { if (!u.acted) { b4.beginTurn(u.uid); b4.endTurn(); } });
ok(b4.round === 2, 'round advances after everyone acts');
ok(foe4.hp <= hpBefore - 12 - 4 || foe4.hp <= 0, 'poison ticked for 4 during the enemy phase');

/* Taunt forces enemy targeting. */
var b5 = fixedBattle({ team: ['ch-taro', 'ch-kira', 'ch-hana', 'ch-yuki'], hpScale: 1, seed: 5 });
b5.start();
var taro5 = b5.allies()[0];
b5.beginTurn(taro5.uid);
giveHand(b5, taro5, ['ab-taro-provoke']);
b5.playCard(taro5.hand[0].iid);
eq(taro5.statuses.taunt, 1, 'Provoke applies taunt');
var othersHp = b5.allies().slice(1).map(function (u) { return u.hp; });
b5.endTurn();
b5.allies().forEach(function (u) { if (!u.acted && !u.downed) { b5.beginTurn(u.uid); b5.endTurn(); } });
var othersAfter = b5.allies().slice(1).map(function (u) { return u.hp; });
ok(othersHp.join() === othersAfter.join(), 'taunt redirected all enemy attacks to Taro');

/* Evade negates a hit. */
var b6 = fixedBattle({ hpScale: 10, seed: 9 });
b6.start();
var kira6 = b6.allies()[0];
kira6.statuses.evade = 1;
var foe6 = b6.enemies()[0];
hpBefore = kira6.hp;
b6.attack(foe6, kira6, 50, { tags: [], isAttack: true });
eq(kira6.hp, hpBefore, 'evade negates the whole hit');
ok(!kira6.statuses.evade, 'evade stack consumed');

/* Thorns retaliates. */
var b7 = fixedBattle({ hpScale: 10, seed: 13 });
b7.start();
var kira7 = b7.allies()[0];
kira7.statuses.thorns = 3;
var foe7 = b7.enemies()[0];
hpBefore = foe7.hp;
b7.attack(foe7, kira7, 1, { tags: [], isAttack: true });
eq(hpBefore - foe7.hp, 3, 'attacker takes 3 thorns damage');

/* ------------------------------------------------------------------ */
section('Battlefield passives and hooks');

var b8 = fixedBattle({ team: ['ch-renji', 'ch-taro', 'ch-hana', 'ch-yuki'], hpScale: 10, seed: 21 });
b8.start();
var renji8 = b8.allies()[0];
b8.beginTurn(renji8.uid);
renji8.energy = 9;
giveHand(b8, renji8, ['ab-renji-storm-circuit', 'ab-renji-static-jab']);
b8.playCard(renji8.hand[0].iid);
var circuit = b8.passives.filter(function (p) { return p.name === 'Storm Circuit'; })[0];
ok(!!circuit, 'Storm Circuit passive enters the field (alongside innate passives)');
var totalEnemyHp = function () { return b8.enemies().reduce(function (s, e) { return s + e.hp; }, 0); };
hpBefore = totalEnemyHp();
b8.playCard(renji8.hand[0].iid, b8.enemies()[0].uid);
/* Static Jab: 4 direct + 3 from Storm Circuit hook */
eq(hpBefore - totalEnemyHp(), 7, 'Storm Circuit adds 3 bonus damage on a storm card (4+3)');

/* Passive expires after its duration. */
ok(circuit.duration === 2, 'Storm Circuit lasts 2 rounds');

/* Conditional combo: Cinder Guard bonus only after a blade card. */
var b9 = fixedBattle({ hpScale: 10, seed: 33 });
b9.start();
var kira9 = b9.allies()[0];
b9.beginTurn(kira9.uid);
kira9.energy = 9;
giveHand(b9, kira9, ['ab-kira-cinder-guard', 'ab-kira-flash-step', 'ab-kira-cinder-guard']);
b9.playCard(kira9.hand[0].iid);
var blockNoCombo = kira9.block;
eq(blockNoCombo, 7, 'Cinder Guard alone: 7 Block');
b9.playCard(kira9.hand[0].iid); // Flash Step (blade tag) — draws 2, tags blade
b9.playCard(kira9.hand.filter(function (c) { return c.def.id === 'ab-kira-cinder-guard'; })[0].iid);
eq(kira9.block, 7 + 7 + 4, 'Cinder Guard after a Blade card: 7 + 4 combo bonus');

/* ------------------------------------------------------------------ */
section('Defeat, revive, end conditions');

var b10 = fixedBattle({ team: ['ch-hana', 'ch-kira', 'ch-taro', 'ch-yuki'], hpScale: 10, seed: 55 });
b10.start();
var hana = b10.allies()[0];
var kira10 = b10.allies()[1];
b10.hpLoss(kira10, 9999, 'test');
ok(kira10.downed, 'hero at 0 HP is downed, not dead');
ok(!b10.over, 'battle continues while allies remain');
b10.beginTurn(hana.uid);
hana.energy = 9;
giveHand(b10, hana, ['ab-hana-second-bloom']);
var canRes = b10.canPlay(hana.hand[0]);
ok(canRes.ok, 'Second Bloom is playable with a fallen ally');
b10.playCard(hana.hand[0].iid, kira10.uid);
ok(!kira10.downed && kira10.hp === Math.floor(kira10.maxHp * 0.4), 'revive restores 40% HP');

var b11 = fixedBattle({ seed: 77 });
b11.start();
b11.attack(b11.allies()[0], b11.enemies()[0], 9999, { tags: [] });
ok(b11.over && b11.result.victory, 'killing all enemies ends the battle in victory');

/* ------------------------------------------------------------------ */
section('Summons and pity');

var startCrystals = 500;
profile.crystals = startCrystals;
profile.pity = 0;
var seenRarities = {};
var rng = AZ.util.rng(1234);
var pulls = 0;
for (var i = 0; i < 30; i++) {
  var r = AZ.state.summonCharacter(rng);
  if (r.error) break;
  pulls++;
  seenRarities[r.character.rarity] = true;
}
eq(pulls, 30, '30 summons succeed with enough crystals');
eq(profile.crystals, startCrystals - 30 * AZ.state.COSTS.characterSummon, 'crystals deducted per pull');
ok(profile.pity < 10, 'pity never reaches 10 (guarantee triggers)');

profile.gold = 1000;
var packRes = AZ.state.summonAbilityPack(AZ.util.rng(99));
eq((packRes.cards || []).length, 3, 'ability pack yields 3 cards');
var itemRes = AZ.state.summonItemCache(AZ.util.rng(100));
ok(!!itemRes.item, 'item cache yields a relic');

/* ------------------------------------------------------------------ */
section('Run map');

AZ.state.newRun(1);
var run = AZ.state.run();
eq(run.nodes.length, 8, 'run has 8 nodes');
eq(run.nodes[0].options[0], 'battle', 'first node is a battle');
eq(run.nodes[7].options[0], 'boss', 'final node is the boss');
var cfg = AZ.state.makeBattleConfig('battle');
ok(cfg.allies.length === 4 && cfg.enemies.length >= 1, 'battle config builds teams');
var bossCfg = AZ.state.makeBattleConfig('boss');
ok(bossCfg.enemies[0].boss, 'boss node spawns a boss');
ok(bossCfg.enemies[0].maxHp >= 170, 'boss HP scales from base');

/* Simulated victory & rewards */
var battle = AZ.battle.create(cfg);
battle.start();
battle.enemies().slice().forEach(function (e) { battle.attack(battle.allies()[0], e, 9999, { tags: [] }); });
ok(battle.over && battle.result.victory, 'sim battle won');
var goldBefore = profile.gold;
var rewards = AZ.state.completeBattle(battle, 'battle');
ok(rewards.gold > 0 && profile.gold > goldBefore, 'victory pays gold');
ok(rewards.cardChoices.length === 3, 'victory offers 3 card choices');
var adv = AZ.state.advanceRun();
eq(adv.done, false, 'run advances to step 2');
AZ.state.abandonRun();
ok(!AZ.state.run(), 'abandon clears the run');

/* ------------------------------------------------------------------ */
section('Event choices');

AZ.state.newRun(1);
var ev = AZ.state.applyEventChoice({ gold: 60 });
ok(!ev.failed && /60 gold/.test(ev.lines.join(' ')), 'event gold reward applies');
var withBoon = AZ.state.applyEventChoice({ boon: { name: 'Test Boon', hooks: [], side: 'ally', duration: -1 } });
eq(AZ.state.run().boons.length, 1, 'boons attach to the run');
var cfgBoon = AZ.state.makeBattleConfig('battle');
var bb = AZ.battle.create(cfgBoon);
bb.start();
ok(bb.passives.some(function (p) { return p.name === 'Test Boon'; }), 'run boons become battle passives');
AZ.state.abandonRun();

/* ------------------------------------------------------------------ */
section('Content pack roundtrip');

var packErrs = AZ.content.saveCustom('characters', {
  id: 'c-test-hero', name: 'Test Hero', rarity: 'SR', element: 'flame', role: 'striker',
  stats: { hp: 40, energy: 3, draw: 5, speed: 5 }, lore: 'test', inGacha: true
});
eq(packErrs.length, 0, 'custom character saves');
AZ.content.saveCustom('cards', {
  id: 'c-test-card', name: 'Test Bolt', rarity: 'R', type: 'attack', cost: 1, owner: 'c-test-hero',
  tags: ['fire'], effects: [{ op: 'damage', amount: 7, target: 'foe' }]
});
var pack = AZ.storage.buildContentPack(AZ.content.customContent(), { name: 'Test Pack' });
eq(pack.characters.length, 1, 'pack contains the custom character');
AZ.content.deleteCustom('characters', 'c-test-hero');
AZ.content.deleteCustom('cards', 'c-test-card');
ok(AZ.content.customContent().characters.length === 0, 'custom character deleted');

AZ.storage.importContentPack(pack).then(function (result) {
  eq(result.added, 2, 'pack import restores 2 entities');
  AZ.content.init(); // re-read merged content
  ok(!!AZ.content.getCharacter('c-test-hero'), 'imported character is queryable');
  var u = null;
  AZ.state.grantCharacter('c-test-hero');
  AZ.state.grantCard('c-test-card', 2);
  u = (function () {
    var members = profile.team.members.slice();
    profile.team.members = ['c-test-hero'];
    profile.team.decks['c-test-hero'] = AZ.state.autoBuildDeck('c-test-hero');
    var built = AZ.state.buildUnitFor('c-test-hero');
    profile.team.members = members;
    return built;
  })();
  ok(u && u.deckDefs.length >= AZ.schema.LIMITS.deckMin, 'imported hero builds a playable unit');

  console.log('\n' + (failures === 0
    ? 'ALL ' + checks + ' CHECKS PASSED'
    : failures + ' of ' + checks + ' checks FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}).catch(function (e) {
  console.error('pack roundtrip crashed:', e);
  process.exit(1);
});

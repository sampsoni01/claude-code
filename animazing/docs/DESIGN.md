# Animazing — Design & Systems Reference

This document is the authoritative reference for how the game works mechanically, the full content schema + effect DSL (what the Studio's "Edit as JSON" expects), and the architecture's extension points.

---

## 1. Battle rules

### Round structure

```
roundStart ─► PLAYER PHASE ─► ENEMY PHASE ─► roundEnd ─► next round
              (4 hero turns,     (intents
               any order)         resolve)
```

- **Player phase.** Every living hero acts once per round, in any order — click a *ready* hero to begin their turn. On turn start: Block wears off (unless **Aegis**), Poison/Burn/Regen tick, energy refills, hand draws up to draw size (default 5). Play cards while energy lasts, then end the turn and pick the next hero. Stunned heroes lose their turn (stun −1).
- **Enemy phase.** Enemies act in speed order, executing the intent telegraphed at round start. Intents re-target if the victim fell, and always respect **Taunt**.
- **Round end.** Round-decay statuses lose 1 stack; timed battlefield passives age and expire.
- **End conditions.** All enemies dead → victory. All heroes fallen → defeat. Fallen heroes are *downed*, not dead — revivable in-battle, and back at 25% HP after a won fight.

### Damage pipeline (attacks)

```
base + Strength + modifyDamage hooks (items & side passives, tag-matched)
  → ×0.75 floor if attacker Weak
  → ×1.5  floor if target Vulnerable
  → Evade? negate hit, consume 1 stack
  → Block absorbs; remainder hits HP
  → Thorns retaliates on the attacker (own Block applies)
```

Multi-hit cards run the pipeline per hit. Poison ticks ignore Block; Burn ticks are blockable. `isAttack:false` damage (self-costs, curses) skips Strength/Weak/Vulnerable/Thorns/Evade entirely.

### Statuses

| Status | Kind | Decay | Effect |
|---|---|---|---|
| Strength | buff | permanent | +1 attack damage per stack |
| Fortify | buff | permanent | +1 extra Block whenever you gain Block |
| Vulnerable | debuff | round | takes +50% attack damage |
| Weak | debuff | round | deals −25% attack damage |
| Poison | debuff | tick | turn-start HP loss = stacks (pierces Block), then −1 |
| Burn | debuff | tick | turn-start damage = stacks (blockable), then −1 |
| Regen | buff | tick | turn-start heal = stacks, then −1 |
| Thorns | buff | round | attackers take damage = stacks |
| Evade | buff | round | negates the next attack hit; 1 stack per hit |
| Taunt | buff | round | enemies must target this unit |
| Stun | debuff | special | skips its next turn, one stack per skip |
| Aegis | buff | round | Block persists through your turn start |

### Synergy layers

1. **Combo tags** — playing a card logs its tags for the round (per side). Conditions (`tagThisRound`) and scaling amounts (`perRoundTag`) read that log. The played card counts itself.
2. **Battlefield passives** — named, iconed effects with hooks, a side (`ally`/`enemy`/`global`) and a duration in rounds (−1 = whole battle). Same-name same-side passives refresh rather than stack.
3. **Relic hooks** — identical hook system, permanently attached to the equipped hero (plus flat stat mods and gold bonuses).
4. **Innate hero passives** — a passive definition on the character, auto-cast at battle start.
5. **Run boons/curses** — passive definitions attached to the expedition, injected into every battle.

Hook triggers: `battleStart`, `roundStart`, `roundEnd`, `turnStart` (owner), `cardPlayed` (side-filtered, optional `tagFilter`), `unitDamaged`, `foeDefeated`, and the special `modifyDamage` (`{tags, add}` — flat damage bonus for tag-matched attacks).

---

## 2. Effect DSL

Effects are arrays of plain-data ops. The same DSL powers hero cards, enemy moves, item hooks, innates and passives — and everything the Studio saves.

### Ops

```jsonc
{ "op": "damage",  "amount": A, "times": 2, "target": T }   // times optional
{ "op": "block",   "amount": A, "target": T }
{ "op": "heal",    "amount": A, "target": T }
{ "op": "revive",  "amount": 40 }                            // % HP, targets downed-friend
{ "op": "status",  "status": "poison", "stacks": A, "target": T }
{ "op": "cleanse", "target": T }                             // removes debuffs
{ "op": "energy",  "amount": A }                             // caster
{ "op": "draw",    "amount": A }                             // caster
{ "op": "passive", "passive": { "name", "icon", "duration", "tags": [], "side"?, "hooks": [ { "on", "tagFilter"?, "tags"?, "add"?, "effects": [...] } ] } }
{ "op": "random",  "choices": [ [ops], [ops], ... ] }        // chaos: uniform pick
```

Extra op fields: `isAttack:false` (raw damage), `tags` (when there's no card context).

### Targets (side-relative)

`foe` (chosen), `all-foes`, `random-foe`, `self`, `friend-target` (chosen ally), `all-friends`, `random-friend`, `lowest-friend` (most wounded), `downed-friend`. For enemy moves, "foe" means the player's heroes.

### Amounts

A plain number, or a scaling object:

```jsonc
{ "base": 8,
  "perRoundTag":    { "tag": "storm",  "mult": 4 },   // +4 per Storm card this round
  "perStatusTarget":{ "status": "poison", "mult": 2 },
  "perStatusSelf":  { "status": "strength", "mult": 1 },
  "perSelfBlock":   { "mult": 1 },
  "perDownedFriend":{ "mult": 5 },
  "perPassive":     { "tag": "fire", "mult": 3 } }    // tag optional
```

All scalers sum onto `base`; result floors at 0.

### Conditions (`"if"` on any op)

```jsonc
{ "tagThisRound": "fire", "minCount": 3 }   // combo
{ "selfHpBelowPct": 50 }
{ "selfHasBlock": true }
{ "targetHasStatus": "poison" }
{ "targetHasBlock": true }
{ "itemTag": "fire" }                        // caster has a tagged relic equipped
{ "passiveActive": "fire" }                  // side has a tagged/named passive up
{ "chance": 0.5 }
```

Card text is **auto-generated** from effects (see `schema.js: cardText`), so authored cards always read correctly; `textOverride` exists for special cases.

---

## 3. Content schemas (pack/Studio format)

```jsonc
// Character
{ "id": "ch-…", "name": "", "title": "", "rarity": "N|R|SR|SSR|UR",
  "element": "flame|frost|storm|shadow|radiant|steel", "role": "striker|guardian|mystic|support|trickster",
  "stats": { "hp": 40, "energy": 3, "draw": 5, "speed": 5 },
  "lore": "", "glyph": "炎"?, "imageId": null, "innate": PassiveDef|null,
  "inGacha": true, "sample": true? }

// Ability card
{ "id": "ab-…", "owner": "ch-… | *", "name": "", "rarity": "…", "type": "attack|guard|skill|passive",
  "cost": 1, "tags": ["fire"], "flavor": "", "imageId": null,
  "exhaust": false, "retain": false, "inGacha": true,
  "effects": [ ...ops ], "textOverride": ""? }

// Relic
{ "id": "it-…", "name": "", "rarity": "…", "slot": "weapon|armor|charm", "tags": [],
  "statMods": { "hp": 8, "energy": 0, "draw": 0 }?, "goldBonus": 0.25?,
  "hooks": [ { "on": trigger, ... } ], "flavor": "", "imageId": null, "inGacha": true }

// Enemy
{ "id": "en-…", "name": "", "element": "…", "glyph": "鬼"?, "imageId": null,
  "stats": { "hp": 30, "speed": 5 }, "elite": false, "boss": false,
  "sequence": false,                       // true = moves cycle in order
  "innate": PassiveDef|null,
  "moves": [ { "name": "", "weight": 2, "intent": "attack|defend|buff|debuff|chaos", "effects": [...] } ] }
```

`imageId` keys into the media store (IndexedDB locally; the `images` map in packs). Entities without art render a procedural gold-kanji sigil derived from element + name.

---

## 4. Meta systems

- **Collection** — heroes (level 1–10; dupes +1 level = +4 max HP), card copies (deck may include as many copies as owned; universal basics unlimited), relic copies (each copy equips one hero, 2 slots each).
- **Decks** — per hero, 6–12 cards from their own + universal pools. Auto-build fills sensibly.
- **Summons** — hero summon 10💠 (pity: SR+ guaranteed within 10), ability pack 100🪙 (3 cards for owned heroes), relic cache 150🪙. Custom content participates via `inGacha` + the global settings toggle.
- **Expeditions** — 8 nodes; enemy HP scales `1 + 0.10·(step−1) + 0.35·(tier−1)`, damage scales gentler. Elites bring minions and drop relics/crystals; bosses end the run and unlock the next tier. Six starter events (heals, merchants, gambles, boons, curses) live in the same content layer as everything else — packs can add more via an `events` array.

---

## 5. Architecture & extension points

```
schema.js      ─ what content MEANS (validation, DSL metadata, auto-text)
storage.js     ─ saves, IndexedDB media, pack import/export      [versioned formats]
starter.js     ─ sample layer + procedural portrait art
content.js     ─ layered registry: starter → file packs → local Studio content
effects.js     ─ DSL interpreter (pure, battle-primitive driven)
battle.js      ─ DOM-free engine; emits an event queue the UI plays back
state.js       ─ profile, gacha, decks, run map                  [v1 profile, migratable]
ui/*           ─ screen renderers over the same registries
```

Deliberate seams for what's next:

- **Story mode** — a chapter is just `{ dialogue, fixedBattles: [enemy ids + scaling], rewards }`; `state.makeBattleConfig` already accepts arbitrary enemy sets and boons, and `content.events()` shows how packs feed new node types. Add a `story` array to the pack format (version-gate with `version: 2`) and a reader screen.
- **Deeper progression** — hero levels, essence, and per-entity `inGacha` flags exist; ascension tiers, card upgrades (level on the deck entry), and crafting slot into `state.js` without touching the engine.
- **New mechanics** — new statuses = one entry in `schema.STATUSES` + handling in `battle.js`; new DSL ops = one entry in `EFFECT_OPS` + a case in `effects.js` (+ optional Studio builder row); text generation follows automatically.
- **Determinism** — battles are seeded end-to-end; replays/dailies need only a stored seed.

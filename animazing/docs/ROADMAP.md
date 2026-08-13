# Animazing — Roadmap

The current build is a complete, playable core: team-of-four card battles, expeditions, collection/gacha meta, and the Creator Studio. This file sketches the intended expansions and where each one plugs into the existing architecture — so future work deepens the game instead of rewriting it.

## Near — content & polish

- [ ] **Author the real cast** in the Studio (portraits + lore + kits), export as a pack, commit to `packs/`, then flip *Show sample content* off by default once the roster stands alone.
- [ ] Sound: card plays, hits, pack-opening sting (a tiny WebAudio layer; no assets required for procedural chimes).
- [ ] Deck strategy niceties: card upgrade previews, deck stats (curve, tag counts) in the deck editor.
- [ ] More starter events + an event editor tab in the Studio (`events` already ride the content layers).

## Mid — story mode (the reserved seat)

Planned shape, using existing seams (`docs/DESIGN.md §5`):

- **Chapters as content**: `{ id, title, scenes: [ {art, dialogue[]}, {battle: {enemies, scaling, boons}}, … ], rewards, unlocks }` added to the pack format as `story` (bump pack `version` to 2 — imports are already version-gated).
- A **Tale** screen on the hub: chapter select → dialogue reader (portrait + text advancing on click, same art pipeline as everything else) → fixed battles via `state.makeBattleConfig`-style configs with hand-picked enemy sets and story boons.
- Story-locked unlocks: heroes/cards granted by chapter completion instead of gacha (`inGacha:false` content + a `grantOnChapter` field).
- Written in the Studio eventually: a "Chapters" tab with a scene-list editor.

## Mid — progression meta

- **Ascension**: essence from duplicate heroes past level 10 → rarity ascension (stat curve + a signature card upgrade). Hooks: `ownedChars[id].copies` is already tracked.
- **Card mastery**: per-card play counters → leveled cards (`+1 damage/block` tiers); deck entries become `{cardId, level}`.
- **Crafting**: convert spare cards/relics into shards → targeted crafting, pity-adjacent.
- **Daily seeds**: deterministic battles already run on seeds; a daily expedition is a stored seed + leaderboard-ready stats (`battle.stats`).

## Far

- **PvP ghosts**: your team + decks exported as a pack-like blob, fought by the AI on the other side (the engine is side-symmetric; enemy moves and hero cards share the DSL).
- **Guild/co-op events**: shared boss HP pools across saves via any tiny backend.
- **Animated art**: `imageId` can hold APNG/WebP already; a `spriteSheet` field is the richer path.

## Non-goals (for now)

Server accounts, real-money anything, and content moderation pipelines — Animazing is a personal, local-first world by design.

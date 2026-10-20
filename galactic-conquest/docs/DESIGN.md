# Galactic Conquest: Design Draft v0.1

Status: discussion draft. Nothing here is built. Every section ends with the decisions still open.

## 1. Pitch and pillars

You inherit a single system on the edge of a living galaxy. Rival empires are already expanding, trading, and fighting each other. You grow by claiming planets, planting outposts, and commissioning named capital ships that carry your fleets, squadrons, and elite forces across the lanes. Everything you own is a bargaining chip: planets can be ceded to end a war, sold for a fortune in rare resources, or cracked open and destroyed so nobody else can have them.

Pillars, in priority order:

1. **The galaxy moves without you.** Rival empires pursue visible agendas on a schedule. Logging in should feel like catching up on news that affects you.
2. **Capital ships are characters.** Named, persistent, upgradeable. Losing one hurts. Each one is a mobile base that hosts fleets, squadrons, and elite forces.
3. **Short sessions, long arcs.** A session is two to five minutes. A campaign runs for months.
4. **Everything is tradeable.** Planets, resources, ships, favors, and intelligence all have a price.
5. **Wealth is the score.** Military power is a means. The goal is to accumulate resources and turn them into a bigger, richer empire.

## 2. Session structure and time model

**Time model.** Wall-clock timers, mobile style. The galaxy simulation advances on a fixed tick (proposed: every 10 minutes). Production accrues per tick. Rival empires make decisions on ticks. Travel, builds, and research are timers measured in wall-clock time.

**Offline catch-up.** When the player returns, the sim replays every missed tick deterministically, then shows a "While you were away" report: income, completed builds, rival moves, attacks, offers received. Catch-up is capped (proposed: 72 hours of full-rate production, then a reduced rate) so a lapsed player is not ruined, and so an active player is rewarded.

**Loops.**

| Loop | Length | What the player does |
|---|---|---|
| Session | 2 to 5 min | Collect, queue builds, read the feed, answer one or two events, move a capital ship, set research |
| Daily | once a day | Contracts and bounties, market price cycle, council vote, rival tick consequences |
| Weekly | once a week | Era event, campaign objective, a rival shifts agenda |
| Campaign | months | Expand from one system to dominate, ally with, or outtrade a sector |

**Home screen ("the Bridge").** Resource bar, capital ship cards with status, the galaxy feed, active queues, and alerts. Tabs: Bridge, Galaxy Map, Empire, Diplomacy, Market.

Open: tick length (10 vs 15 min), catch-up cap, whether to include a daily council vote at launch.

## 3. The galaxy

- A node graph of star systems joined by hyperlanes. Proposed size: 80 to 150 systems per galaxy, grouped into named sectors. Tap a node to select it. No free-space movement.
- Each system holds zero to five bodies: planets, moons, asteroid belts.
- Travel is time along lanes. Outposts extend **supply range**. Ships outside supply range lose readiness each tick and cannot repair.
- Intel levels per system: unknown, surveyed, monitored. Monitoring comes from listening posts, embassies, or a Command Ship nearby. Rival agendas are only visible where you have intel.
- Chokepoints are deliberate: some sectors connect through one or two lanes, which makes outposts and defense platforms matter.

Open: galaxy size at launch, whether lanes can be built or only discovered.

## 4. Empire pieces

### 4.1 Planets

Every planet has a type, a size (3 to 8 building slots), one or two traits, and sometimes one exclusive resource deposit.

| Type | Base output | Likely exclusive deposit | Notes |
|---|---|---|---|
| Terran | Credits, stability | Xenobiomass | The balanced colony world |
| Ocean | Credits (trade) | Xenobiomass | Trade ports are cheap here |
| Volcanic | Alloy | Neutronium | Hard to keep stable |
| Ice | Fuel | Exotic Gases | Slow growth |
| Desert | Research | Rare Isotopes | Solar arrays |
| Gas Giant | Fuel | Exotic Gases | Orbital habitats only, rings |
| Barren | Alloy | Rare Isotopes | Mining, cheap to claim |
| Gaia | Everything | Any | Rare. Rivals covet them |
| Ruins | Research | Ancient Relics | Precursor sites, unique tech |
| Dead World | Nothing | None | What is left after destruction |

Traits are small, legible modifiers. Examples: Deep Veins (+25% alloy), Thin Atmosphere (-10% stability), Chokepoint (+defense), Ancient Shipyard (-20% ship build time), Spice Markets (+trade income), Hostile Fauna (elite forces train faster).

**Buildings** fill slots: Mine, Refinery, Shipyard, Lab, Trade Port, Garrison, Defense Grid, Orbital Habitat (gas giants), Extractor (required to tap an exclusive deposit).

**Stability** is the one soft stat. War, neglect, and a missing garrison lower it. Low stability cuts output and can flip a planet to a rival with a strong claim. Keeps the "ceding is sometimes smart" lever honest.

**Cede.** A diplomatic action. Transfers a planet to a rival. Ends a war, raises relations sharply, and resets that rival's grievance memory. Rivals value planets by traits and deposits, so a Gaia world buys a lot of peace.

**Trade.** Planets can be sold or swapped for resources, tech, or other planets. Rivals initiate offers too. The galactic market handles exclusive resources with prices that drift with supply and with who is at war.

**Destroy.** Late-game. A Planet Cracker (needs Antimatter) or a scuttle order on your own world. Yields a one-time windfall of whatever deposit the planet had, then leaves a Dead World: a belt that only takes outposts. Galaxy-wide infamy. Militarists respect it, Zealots and Merchants never forgive it. This is the dramatic lever and should be rare, expensive, and loud.

Open: whether planets have population or only stability, and whether Dead Worlds can ever be restored.

### 4.2 Outposts

Cheap and fast claims on empty systems, belts, and moons. Roles, chosen at build or by upgrade:

- Supply Depot: extends supply range, the default.
- Listening Post: intel on adjacent systems.
- Shipyard: builds escort ships in the field.
- Trade Hub: taxes lanes passing through.
- Defense Platform: a fixed fleet with no upkeep.

Outposts can be captured intact. They are the frontier skirmish piece: easy to lose, easy to retake.

### 4.3 Capital ships

The primary game piece. Each is named, persistent, and has a commander with traits and experience.

| Hull | Squadrons | Fleets | Elite units | Role |
|---|---|---|---|---|
| Carrier | 8 | 2 | 2 | Squadron warfare, screening |
| Dreadnought | 2 | 4 | 1 | Line battles, sieges |
| Command Ship | 2 | 2 | 2 | Diplomacy range, intel, buffs to nearby forces |
| Assault Carrier | 3 | 2 | 5 | Planet invasions, boarding |
| Mobile Foundry | 1 | 2 | 1 | Builds ships and outposts in the field, repairs |

Each hull has module slots for components: shields, drives, sensors, fabricators, armor. Components consume exclusive resources, which is what makes planets matter.

**Losing one.** A defeated capital ship is disabled and drifts, not destroyed. Recover it within a window (proposed: 24 hours) with a friendly fleet or Mobile Foundry. Miss the window, or let a rival reach it first, and it is gone. Gem "insurance" can extend the window. This softens the worst moment in the game without removing the stakes.

### 4.4 Fleets

Groups of escort and line ships: corvettes, frigates, destroyers, cruisers. A fleet attaches to a capital ship or stations at a planet or outpost. Fleets carry a doctrine setting (Aggressive, Balanced, Evasive) that drives auto-resolution.

### 4.5 Squadrons

Small craft deployed from hangars: Interceptors, Bombers, Gunships, Electronic Warfare craft. A rock-paper-scissors layer: Interceptors beat Bombers, Bombers beat line ships, line ships with point defense beat Interceptors, EW craft blunt everything a little.

### 4.6 Elite forces

Units carried in barracks and deployed in the last phase of a battle or on missions:

- Marines: boarding, capture disabled ships and outposts intact.
- Drop Troops: planet invasions against garrisons.
- Commandos: sabotage missions, raids on rival shipyards.
- Specialists: engineers (repair in the field), envoys (diplomacy range), agents (intel).

## 5. Economy

**Common resources.** Credits, Alloy, Fuel, Research.

**Exclusive resources.** Found only on specific planets, extracted only with an Extractor, needed for advanced components. These are the engine of trade and war.

| Resource | Unlocks |
|---|---|
| Neutronium | Heavy armor, Dreadnought hulls |
| Tachyon Crystals | Drives, sensors, lane range |
| Antimatter | Heavy weapons, the Planet Cracker |
| Xenobiomass | Elite forces, medical, stability |
| Exotic Gases | Shields, cloaking |
| Rare Isotopes | Reactors, research boosts |
| Ancient Relics | Precursor tech, unique components |

**Gems.** Premium currency. Earned from daily log-in, achievements, and contracts. Purchased with money. See section 10.

**Build queues.** Two free queue slots empire-wide, more from tech and gems.

**Timer bands** (proposed, tune in play):

| Item | Early | Mid | Late |
|---|---|---|---|
| Outpost | 2 min | 20 min | 2 h |
| Building | 5 min | 1 h | 8 h |
| Escort ship | 1 min | 15 min | 1 h |
| Squadron | 30 s | 5 min | 30 min |
| Capital ship | 1 h | 8 h | 48 h |
| Research | 30 min | 6 h | 3 days |
| Lane jump | 2 to 5 min | 10 to 30 min | 1 to 2 h |

Open: exact numbers, upkeep model, whether Fuel is consumed per jump or per tick.

## 6. Combat

Auto-resolved, phased. Player agency is before the fight: composition, loadouts, doctrine, commander, and whether to commit elite forces.

1. **Approach.** Sensors and drives decide initiative and whether the defender can refuse battle.
2. **Squadron phase.** Interceptors, bombers, and point defense trade blows.
3. **Line phase.** Fleets exchange fire. Shields, then armor, then hull.
4. **Boarding and invasion.** Elite forces act against disabled ships, outposts, and garrisons.
5. **Retreat check.** Doctrine and commander traits decide who disengages.

Presented as a 10 to 20 second replay with a skip button and a results card. Deterministic from a seed, so the replay and the report always agree.

**Defense while offline.** New empires get a three-day shield. After that, incoming attacks have a visible ETA (travel time along lanes) and trigger an opt-in notification, so there is time to set doctrine and reposition. Defense uses your pre-set doctrine.

Open: whether to offer any mid-battle input at all (proposed: none at launch).

## 7. Rival empires

Five to eight per galaxy, each with an archetype, three active goals, a relationship value with every other empire, and a grievance memory.

| Archetype | Name style | Behavior | Pressure on the player |
|---|---|---|---|
| Expansionist | the Hegemony | Claims systems fast, outposts everywhere, thin defense | Border friction |
| Mercantile | the Consortium | Buys planets, hires mercenaries, sanctions enemies | Price wars, buyouts |
| Militarist | the Dominion | Builds Dreadnoughts, wars on weak neighbors, respects strength | Sieges |
| Isolationist | the Enclave | Fortifies, rarely expands, trades tech | A wall, and a good partner |
| Zealot | the Covenant | Hunts planet destroyers, seeks Gaia and Ruins worlds | Moral crusades |
| Technocrat | the Institute | Research race, hoards relics, sells tech | Outpaces you |
| Swarm | the Hive | Spreads by outposts, ignores diplomacy, periodic surges | The clock |

Rivals act on the galaxy tick: expand, build, trade, propose treaties, declare war, cede planets, and on rare occasions destroy them. Their actions appear in the galaxy feed as news. They also fight each other, which creates opportunities. Intel reveals their goals, so a monitored rival can be anticipated.

Difficulty comes from proximity and era escalation, not from rubber-banding against the player.

Open: rival count at launch, how much rivals react to player power.

## 8. Diplomacy and trade

- Relations run from Hostile to Allied. Actions move them: gifts, trade, ceding, broken treaties, destroyed planets.
- Treaties: Non-Aggression, Trade Route, Research Pact, Defensive Alliance.
- Demands and tribute: a strong empire can demand resources or a planet. So can you.
- Embassies need a Command Ship or an Envoy specialist in range.
- The Galactic Market: buy and sell exclusive resources at drifting prices. Trade routes between your Trade Ports and rival ports pay per tick and can be raided.

## 9. Progression and endgame

- Tech tree with four branches: Industry, Military, Science, Diplomacy. Research is timer-based.
- Empire rank unlocks hull classes, queue slots, and treaty types.
- **Eras.** Every two to three weeks a galaxy-wide event shifts the board: a precursor awakening, a Hive surge, a market crash, a new lane opening.
- **Endgame.** A campaign ends when the player dominates a sector, holds a majority of exclusive deposits, or completes precursor research. Then "New Galaxy" with legacy perks and a fresh map. This keeps the long-term style without an endless plateau.

Open: whether to reset at all, or run a single persistent galaxy with eras only.

## 10. Monetization and engagement

Single-player against rivals means there is no pay-to-win pressure to protect against. Sell time and identity, not power.

**Gem sources.** Daily log-in, achievements, contracts, era rewards, purchases.

**Gem sinks.** Speed-ups (cost scales with time remaining), extra queue slots, capital ship insurance, commander recruitment, cosmetics: ship skins, empire emblems, UI themes.

**Season pass.** Cosmetic track plus a gem track, keyed to eras.

**Engagement hooks.** Daily contracts and bounties. The galaxy feed. Appointment mechanics: market cycles, council votes, era countdowns. Opt-in notifications for build complete, incoming attack, offer received.

**Never.** No loot boxes. No selling exclusive resources directly. No energy system that blocks play.

## 11. Scope and phases

**Phase 0, prototype.** Galaxy map with one sector, one home system, planets and outposts, one capital ship hull, build timers, three rivals that only expand, basic auto-resolve, save and resume. Playable in a phone browser.

**Phase 1, vertical slice.** The full piece set, trade, cede, rival agendas, battle replay, offline report, the Bridge screen.

**Phase 2, depth.** Diplomacy, destroy mechanics, eras, contracts, gem economy scaffolding.

**Phase 3, release.** Store wrapper, push notifications, cloud save, onboarding, polish.

## 12. Technical approach

**Recommendation: a web app installed as a PWA, wrapped for stores later.**

- TypeScript, Vite, Preact for panels and lists, PixiJS for the galaxy map and battle replays.
- A deterministic simulation core with no rendering dependencies and a seeded random generator. Tick-based. This is what makes offline catch-up, replays, and automated tests possible, and it ports to a server later if multiplayer is ever wanted.
- Saves in IndexedDB. Service worker for offline launch. Hosted as static files, so it opens from a link on the phone and installs to the home screen.
- Capacitor later for App Store and Play Store builds and native push.

Why not Godot or Unity: both are good engines, but neither can be previewed on the phone from this environment without a build pipeline. The web route means every iteration is a link.

Note on this repository: it is a fork of the Claude Code repository. The game can live in the `galactic-conquest/` folder, but a dedicated repository would be cleaner once code starts.

## 13. Decisions needed before building

1. **Players.** Pure single-player against rivals, or eventual asynchronous multiplayer? This decides local-first versus server-authoritative architecture. Recommendation: single-player, with the sim core kept portable.
2. **Galaxy lifecycle.** Endless persistent galaxy with eras, or campaigns that end and restart with legacy perks? Recommendation: campaigns with legacy perks.
3. **Orientation.** Portrait or landscape? Recommendation: portrait, one-handed.
4. **Map.** Hyperlane node graph, hex grid, or free space? Recommendation: node graph.
5. **Combat presentation.** Results card only, short replay, or tactical control? Recommendation: short replay.
6. **Stack.** Web PWA, Godot, or Unity? Recommendation: web PWA.
7. **Art direction.** See ART.md. Recommendation: the "command deck hologram" direction, produced mostly in code.
8. **Repository.** Keep the game in this fork, or start a dedicated repo?

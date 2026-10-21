# Galactic Conquest: Build Brief

Version 4, October 20, 2026. The complete output of the design refinement chat, including answers to the coding session's design-gap questions 3 to 14. This replaces HANDOFF.md and every earlier version of this brief, and overrides DESIGN.md and ART.md wherever they disagree. Commit it to `galactic-conquest/docs/BUILD_BRIEF.md`, and commit `galactic-conquest-bible.xlsx` (the project bible) to `galactic-conquest/data/`.

## Instructions for the coding session

This document and the bible are the source of truth. Re-read both at the start of every session; never rely on memory of earlier conversations. Start with test build 1 in section 18, not the full game. Each test build is a rough, playable link the owner opens on their phone. Do not polish a build or move to the next one until the owner signs off. Read the bible for names, naming rules, events, tech, commanders, art specs, prompt templates, assets, and audio slots; never hard-code content that belongs there. Section 19 lists what you must not do. Section 22 lists assumptions to confirm with the owner before building the parts they affect. When the owner makes a new decision, record it in this brief.

## 1. Summary

| Item | Decision |
|---|---|
| Game name | Undecided. "Galactic Conquest" is a working title |
| Pitch | A space empire strategy game for phones, in continuous pausable time, where trade, war, logistics, and diplomacy interlock and rival factions chase hidden agendas |
| Primary fantasy | A sandbox. All four systems are mandatory; the player chooses which to lean into, and that shapes their playstyle |
| Players | Single-player against AI factions, structured so multiplayer can be added later |
| Lifecycle | Campaigns of roughly 30 hours of play, ending in a win or a defeat |
| Win conditions | Military or wealth, each held for 45 minutes. No diplomatic win |
| Orientation | Portrait first, layout able to support landscape later |
| Platform | Web app installed to the home screen, wrapped for app stores later |
| Map | Three levels: galaxy node graph, star system view, planet view |
| Combat | Planned and committed in advance, then resolves on its own. Only reserves and retreat during battle. Large, chaotic battles |
| Time | Runs only while the app is open and unpaused. No offline progress, no speed controls |
| Rivals | 6 by default, player can choose up to 10 |
| Monetization | None |
| Repository | A dedicated repository; name still to be chosen |

## 2. Pillars

1. **The galaxy never waits while you play.** Rivals act continuously; pausing is how the player thinks.
2. **Capital ships are characters.** Named, renamed, remembered. Their commanders go down with them.
3. **Any session length works.** A few minutes to approve deals and order ships, or an hour planning an offensive.
4. **Everything is tradeable.** Resources, ships, treaties, intelligence.
5. **Every system matters, the player chooses depth.** The four systems interlock through in-world requirements (section 10), never through level gates.

## 3. Time and build times

- The clock runs only while the game is open and unpaused. Closing the app or leaving the screen pauses it automatically and cleanly.
- Build, travel, and research timers count down only during play.
- No speed controls. Dead time is prevented by parallel progress, a steady flow of small advisor decisions, and short tasks.
- Most decisions can be made while paused.
- Leaving the game open unattended is discouraged naturally by the risk of missed invasions and events.
- **Each shipyard and each barracks runs one build at a time.** More shipyards and barracks mean more parallel builds.

**Starting build times, in minutes of play (tune in playtesting):**

| Ships | Minutes | Regiments | Minutes | Buildings | Minutes |
|---|---|---|---|---|---|
| Fighter squadron | 2 | Infantry | 2 | Outpost | 3 |
| Bomber squadron | 3 | Mercy | 3 | Small: supply depot, research lab, embassy | 5 |
| Corvette | 5 | Armor | 5 | Medium: trade hub, extractor, fuel refinery, barracks | 8 |
| Scout | 4 | Heavies | 6 | Large: shipyard, orbital defense platform, shield generator | 12 |
| Merchant vessel | 2 | | | Repairing a recovered capital ship | 10 |
| Cargo ship | 4 | | | | |
| Freighter | 7 | | | | |
| Tanker | 8 | | | | |
| Carrier | 12 | | | | |
| Dreadnought | 15 | | | | |
| Capital ship | 20 | | | | |

## 4. Win and defeat

- **Two win conditions. There is no diplomatic win;** diplomacy is a strategic tool only.
- **Military win:** control 40% of systems and hold fleet strength above the next two rivals combined.
- **Wealth win:** produce 40% of total galaxy output, or control 60% of exclusive resource trade, measured by trade volume (section 11).
- **Hold for 45 minutes of play,** with a countdown visible to the whole galaxy. As a countdown runs, rivals grow more willing to form coalitions against the leader.
- **Dips:** falling below a threshold pauses the countdown. It resets only if the leader stays below for more than 10 minutes.
- AI factions can win too (assumption to confirm, section 22). A rival completing its countdown ends the player's campaign in defeat.
- Every faction has a home planet that cannot be destroyed, only occupied. Occupying a home planet should be rare.
- An empire with an occupied home survives on its other colonies and outposts. Losing every asset is defeat, which ends the player's campaign.

## 5. Map

- **Galaxy:** node graph of star systems joined by lanes. A strategic overview the player visits when needed. Start from 80 to 150 systems and confirm in test build 2. Galaxy-scale special objects appear here: black hole systems, nebulae, and supernova remnants or pulsars with dangerous shortcut lanes. Three or four types at launch, each with one gameplay effect.
- **Star system:** the main screen. The star and all planets in view at once, at most 7 planets plus up to 2 small points of interest (dwarf planets, rogue moons, comets, derelicts). Asteroid belts are drawn as a ring and take no slot. Planets stay fixed on their orbit rings and spin in place, so tap targets never move.
- **Ships are never in empty space.** They are always holding station near a planet or point of interest, or in transit. Ships at a planet hold station with a gentle drift; departing ships glide off toward their lane.
- **Planet:** a higher-resolution planet with resources, income, and a strategic panel during conflicts in orbit or on the ground.

## 6. Planets

- Planets are hubs: refueling, trade, resource output, and the stage for battles. **No population and no stability.** Structure planets so population can be added later as a multiplier on output, without reworking them.
- **Only rocky terrestrial planets have building slots,** 3 to 8 depending on size, with home planets getting the most.
- **Gas planets are only for harvesting resources.** No building slots and no ground battles.
- **Buildings, grouped by track:**
  - Military: shipyard, barracks (raises and houses regiments), orbital defense platform, shield generator
  - Trade: trade hub, extractor (for an exclusive resource deposit)
  - Logistics: fuel refinery, supply depot
  - Diplomacy: embassy (gives public information about a faction)
  - General: research lab (produces research, the common resource that pays for tech)
- **Defense** comes from buildings plus regiments stationed on the planet. Orbital defense platforms and shield generators fight in orbit battles alongside ships.
- **Invasion requires orbit control first.**
- Destroying planets is deferred.

## 7. Ships, fleets, and commanders

**Ship classes, smallest to largest in each group:**

| Group | Classes | Notes |
|---|---|---|
| Battle | Fighter, bomber, corvette | Fighters and bombers are always stored in a home ship and launch for battle. Corvettes are stronger, more advanced, more expensive small warships with no hangar |
| Elite | Carrier, dreadnought, capital ship | Carrier: holds large numbers of fighters and bombers. Dreadnought: heavy firepower and shields, slow, has hangars for squadrons. Capital ship: carries the fleet's modifiers and is the command center for battles and fleet assignments |
| Trade | Merchant vessel, cargo ship, freighter, tanker | Unarmed by default. Defensive upgrades possible, never warship strength. Tankers carry liquids only (mostly fuel) |
| Intelligence | Scout | Costly. Part of the military track's intelligence division (section 14) |

**Fleets:**
- A fleet is founded by building a capital ship and hiring a commander. **At most one capital ship per fleet.**
- The player is offered **four commanders** to choose from, each with a hire cost, ongoing pay, perks, and sometimes a drawback. The pool lives in the bible's Commanders tab; names come from the culture lists.
- Commanders take ongoing pay on top of the fleet's maintenance, so the number of fleets is limited by the economy, not a hard cap. Multiple fleets are expected by the mid and late game.
- **Escorts are detached from an existing fleet.** The game suggests a size, the player picks how many ships to assign, and those ships leave their fleet for the mission. Default escort: fighters with a corvette, or a single carrier.
- Players can assign ships however they like; the groupings above are defaults.

**Orbit rules:** ships never land. Ships repair while in orbit. Ground regiments move to the surface automatically with no player input. Fighters and bombers stay inside their home ships.

**Tankers in battle:** tankers act as mobile batteries, recharging the fleet during battle. Enemies target them, so they must be protected.

**Ground forces:** organized as regiments, never individual units, and ordered as groups. Four types: infantry (conventional troops), armor (tanks), mercy (healing units), heavies (slow, high firepower).

## 8. Combat

**Planning**
- Space and ground combat are both planned before committing, then resolve on their own. Battles are deterministic from a seed.
- **Space setup:** formation, resource allocation, and a task per group (escort the capital ship, hunt fighters, strike their capital ship, screen the line, protect the tankers). Five or six tasks per unit type at most.
- **Ground setup:** each regiment gets a role (spearhead, flank, hold, reserve).
- **Opening strategies:** four or five at launch, such as Full Assault, Hold the Line, Squadron Screen, Hit and Run, and Siege. Commanders can unlock variants.
- **Saved battle plans per fleet,** so a quick session can confirm the last plan.

**During battle: no live control, with two exceptions, both set up beforehand**
- **Reinforcements:** before committing, the player can assign a reserve group and its parameters. During the battle, the player can send the reserve in at any time. No reserve assigned means no reinforcement option.
- **Retreat** can be ordered at any time, including while paused. It mitigates losses but is recorded as a defeat that every faction sees. Earlier retreats save more; pursuit always costs something.
- **Retreat from a battle at a planet warps the whole fleet to the nearest friendly system.** The same applies to enemies retreating from the player's systems.
- **The player is notified of every turning point** that could call for reinforcements or a retreat: a capital ship's shields failing, a tanker lost, enemy reinforcements arriving, the odds swinging sharply. Notifications offer the reserve (if assigned) and retreat. Nothing else changes mid-battle.
- If a fleet's capital ship is disabled mid-battle, the fleet loses its modifiers and the player can fight on without them or retreat. Staying keeps ships nearby to recover the derelict.
- If a rival controls an orbit, attempting a recovery there starts a new battle.

**Scale, length, and presentation**
- **Scale is deliberately large,** in the spirit of big cinematic space battles. The simulation tracks ships by count, and the battle view draws a representative swarm (hundreds in the numbers, dozens on screen).
- **Battle length:** 2 to 3 minutes of game time for small battles, about 5 for big ones, scaling with fleet size.
- **The battle view is deliberately chaotic but readable at a high level.** Never neat lines facing each other.
  - Elite ships and corvettes drift and wheel slowly through six angles (three drawings, mirrored), crossing each other's paths.
  - Fighters and bombers swarm in every direction, rotating freely with motion trails. Most of the chaos comes from them.
  - Depth layers: background ships smaller and dimmer, foreground passes larger.
  - Effects: crossing laser fire, flak, explosions and drifting debris, shield flares, brief camera shake on big hits.
  - Readability: faction-colored outlines, callouts for key moments ("Capital ship shields failing," "Tanker hit"), and a toggleable tactical overlay showing each group as a simple marker.
- **Post-battle debrief with a full replay,** using the battle's seed, with timeline markers on key moments so the player can jump to what they missed.

## 9. Disabled capital ships and commanders

- **Only capital ships can be disabled.** Carriers, dreadnoughts, and all smaller ships are destroyed or survive.
- A defeated capital ship drifts disabled in orbit for **5 minutes of game time**, pausing with the game.
- During those 5 minutes the owner can recover it. A recovered ship is unusable until repaired with resources and time. It keeps its inventory: upgrade modules, its commander, and the raw alloy it was built from. The owner can instead send it to a shipyard to break it down into materials.
- After the owner's window, rivals get **2 minutes** to secure it by getting enough personnel aboard and spending resources on quick fixes. Boarding speed depends on the size of the boarding party. If nobody secures it in time, it burns up in the atmosphere and kills everyone aboard.
- This works both ways: the player can capture rival capital ships the same way.
- **Commanders always share their ship's fate.** They die if it burns and are killed if it is captured.
- A fallen commander gets a hero's sendoff at every player-controlled location, posted in the bulletin, and is recorded permanently in a memorial under Achievements. Each entry stores name, ship, battles fought, and how they fell. The memorial's name is still to be chosen.
- All timings are starting values in an easy-to-tune settings table.

## 10. Logistics

- Fuel is spent per lane jump.
- Ships refuel at owned planets, and at allied planets only with a treaty.
- Supply range extends a few jumps from a refuel hub (fuel refinery or supply depot).
- Ships outside supply range lose readiness gradually and cannot repair.
- A fleet with no fuel can still limp one jump at a time, slowly, toward the nearest hub. No fleet is ever stranded.
- **Logistics strength** = size of the supply network (hubs and depots, systems covered) plus fuel production.
- Advisor requests look like "Third Fleet is low on fuel" or "Kessa is outside supply range."

**In-world requirements that interlock the four systems:**
- Before trading with, negotiating with, or attacking a faction, you must establish communications with them (contact).
- Market access needs a trade hub within supply range.
- Refueling at allied planets needs a treaty.
- Invasion needs orbit control.
- Elite ships need a shipyard and an alloy supply.
- Advanced components need the matching exclusive resource.
- Recurring deals need a supply path between both empires.

## 11. Trade

- **One galactic market** with drifting prices. Prices swing with galaxy events (a war cuts off a resource and its price spikes), and large purchases move prices for everyone, AI included. Market sales are instant at a trade hub.
- **Negotiated deals** through the trade advisor: one-time swaps and recurring deals. Large transactions come to the player as advisor requests for approval.
- **Recurring deals are carried by trade ships.** Each deal needs enough cargo capacity. Trips take 10 to 20 minutes of game time depending on cargo and upgrades, and deliver in batches. A deal pauses if no supply path connects the two empires.
- Trade ships travel visibly along lanes. Each trip through a risky lane has a chance of being raided, lowered by escorts and defensive upgrades. Risk comes from unclaimed or contested lanes and from hostile empires during wars. **Pirates are a hazard, not a faction.**
- Results go to a debrief in the trade tab. Only major losses, such as a whole shipment wiped out, surface as alerts.
- **Trade strength** = trade volume over a recent window (market plus deals) plus trade hubs owned.
- Every resource is tagged liquid or solid; tankers carry only liquids.

## 12. Progression (tech)

- Four tracks: military, trade, logistics, diplomacy. **12 levels each, 1 to 2 unlocks per level.** About 72 unlocks in total.
- **No cross-track gating in the tree.** Players specialize freely; the in-world requirements in section 10 do the interlocking.
- Leveling up costs research plus a strength threshold in that track.
- **Strength measures:** military = total fleet strength; trade and logistics as defined above; diplomacy = number and type of active treaties plus embassies.
- **Budget:** per track, 6 new gear (a new ship class, treaty type, building, or unit) and 12 stat buffs (upgrade tiers, faster refueling, longer range). 24 new gear and 48 buffs in total. New gear is the number to protect.
- The owner authors every unlock in the bible's Tech tab. Costs come from the formulas in the Tech budget tab, with per-row overrides.
- Intelligence upgrades (scout speed, accuracy, stealth, counterintelligence) sit in the military track.

## 13. Factions, species, and cultures

- **Factions are built from traits, not archetypes.** Four axes plus one or two quirks:
  - Government: junta, merchant republic, theocracy, hive collective, corporate charter, monarchy
  - Temperament: aggressive, cautious, opportunistic, honorable, treacherous
  - Economic focus: trade, industry, research, raiding, extraction
  - Quirks: for example xenophobic, relic collector, holds grudges forever, never breaks a treaty, covets a specific resource
- **The player chooses their own traits at the start of a run** from the same pool. Each trait carries stat modifiers.
- **Titles come from the government trait,** rendered in the culture's naming style.
- **Species carry no gameplay traits.** Every species can be good or evil. Species differences are flavor, mostly advisor dialogue. Any mechanical species quirk must be tiny and situational.
- **Three layers:** species (body, face base, ship silhouette family), culture (language and naming, features, clothing, architecture, hull detailing), faction (traits, palette, emblem, titles).
- **4 to 5 species, 2 cultures each.** At most 2 factions per species in a galaxy, always of different cultures.
- **Hidden agendas:** every faction pursues one in addition to a win condition, weighted by its traits and built from ordinary AI actions. The player uncovers agendas in tiers (hint, category, full) through intelligence (section 14). The player has no assigned agenda.
- **AI reads the player's strategy using the same intel rules the player has.** First version: counter-building against your fleet makeup, defending markets you dominate, and forming coalitions as you near a win.

## 14. Intelligence

- **Intelligence is a division of the military track.**
- **Scouts** are a costly unit the player dispatches to any star system.
- **Surveillance:** the longer a scout stays, the more it learns, in layers: fleet sizes first, then buildings and trade deals, then the rival's agenda from hint to category to full. Upgrades speed this up and improve accuracy.
- **Detection risk rises the longer a scout stays,** so the player chooses between waiting for the full picture and pulling out before being caught.
- **Sabotage:** a scout in place can spend its cover on one action, such as delaying a build, damaging a shipyard, or disrupting a trade deal. Sabotage sharply raises the odds of being caught.
- **Counterintelligence:** the player's systems have a chance to catch foreign scouts, raised by military track upgrades. A caught spy becomes an advisor request (expel quietly or make it public). Either side catching a spy hurts relations.
- **Passive intelligence:** merchants on trade runs, visitors, and diplomats bring a steady trickle of lower-detail information about the places they have been, so the player never relies on scouts alone.
- **Nebulae:** scouts there are harder to catch but gather information more slowly.
- **Embassies** give public information only: a faction's treaties and relations.
- **Every rival has a dossier screen** that fills in as information arrives, so the player's picture of them grows over time. Information can go stale; the dossier shows how old each piece is.
- Intelligence reports arrive through the military advisor.
- The AI follows exactly the same rules.

## 15. Treaties

- All treaties require contact first. Types:
  - **Non-aggression:** neither side attacks the other.
  - **Trade pact:** allows recurring deals and docking at each other's trade hubs.
  - **Alliance:** refueling at each other's planets, shared passive intelligence, and joining each other's defensive wars.
  - **Vassalage:** the vassal pays tribute and cannot sign its own alliances; the overlord protects it. Offered mainly as a **peace term** ("become my vassal or keep fighting"). The AI accepts based on desperation and temperament: a cautious faction near defeat accepts, an aggressive or honorable one fights on. The player can accept it too, as a way to survive a losing campaign.
- **Vassal buyout:** a vassal can buy its independence with a large payment, ending the vassalage without penalty.
- **No free exit otherwise.** A treaty ends only by mutual agreement or by breaking it.
- **Breaking a treaty** voids every treaty with the victim, drops relations with every faction, and blocks new treaties for a span of play time. The same rules apply to the player and the AI.

## 16. Advisors, events, and history

- One advisor per core system: military, trade, logistics, diplomacy. Fixed stand-ins with a name, face, and voice. They inform, deliver news, and carry out orders. They never push back.
- Each advisor keeps a short queue of pending decisions, so a quick session means clearing requests. Small typed requests generated by the systems and authored events land in the same queues.
- **Events grow out of galaxy conditions, not random rolls.** Each event shape has a trigger, actors filled in from the current game, two or three choices, and consequences, sometimes with a later follow-up. Target 40 to 60 shapes, authored in the bible's Events tab.
- Anti-repetition: cooldowns and memory of what the player has seen, relevance weighting, chains, escalation later in the game, rival agendas as a source, and advisor and species voice.
- Every event decision must have consequences that affect the campaign.
- **Galaxy history tab:** a permanent, scrollable record of notable events for the whole campaign, nothing ever dropped. It includes events involving the player and events between other factions (their wars, trades, treaties, conquests). Filters by faction and event type, plus an "involving me" toggle. The bulletin shows current news; the history tab is the archive. **It only shows what the player knows:** public events plus anything learned through intelligence. Secret dealings between rivals appear only once uncovered.

## 17. Art, audio, and data

**Who makes what**

| Owner creates | Coding session creates |
|---|---|
| Ships (all classes), ground regiments, planet templates, stars, special galaxy objects, points of interest | Menus and screen layouts, interface icons, galaxy map icons, effects (glow, particles, trails, explosions), backgrounds, a placeholder pixel font |
| Portraits and emblem parts: treated as the owner's until confirmed (section 22) | |
| All music and sound effects | |

- **Build around the owner's art now; do not wait for it.** Everything the owner makes uses placeholders until the owner drops in final files.
- **Placeholders must match final sizes exactly** (a labeled grey 64 x 64 box for a 64 x 64 dreadnought), so swapping in final art causes no layout changes.
- **Ask the owner early for one finished sample per category** (one ship, one planet template, one portrait) and test recoloring, cleanup, and lighting with it before the owner produces the rest.
- **Run a readability check on the battle view** as soon as the first few final ships arrive.

**Style**
- Pixel art, dark navy and neon hologram palette, amber for the player's interface, scanline motif.
- **3/4 view ships at higher resolution.** The top-down view was rejected as too flat. The game must look like a modern pixel art game (references for feel: Sea of Stars, Eastward, Crying Suns): higher-resolution sprites, dynamic lighting, glow and particle effects, smooth animation, and layered depth.
- **Elite ships and corvettes:** three drawings (side-on, angled toward the camera, angled away), mirrored for six angles. **Trade ships and scouts:** two drawings, mirrored. **Fighters and bombers:** one small drawing seen from above, rotated freely by the game. Light always comes from the upper left so mirroring stays believable.
- Engine glow, trails, shield shimmer, weapon bloom, and lighting are added by the game, not drawn into sprites.
- **3/4 showcase art** at higher resolution for construction and purchase screens, the ship screen, the memorial, and anywhere outside live play.
- **Planets:** the owner supplies 12 to 14 templates drawn in shading ramps. The game varies colors, atmosphere ring, and cloud layer within approved limits, and produces a contact sheet of variants for approval.
- **Faction recoloring:** any pixel in the reserved 4-shade magenta ramp is recolored per faction.
- **Portraits:** one face base per culture, with clothing as separate overlays.
- **Living screens:** spinning planets (scrolled surface strip behind a circle, separate cloud layer, fixed night shadow), parallax starfield, palette cycling for stars, nebulae and accretion disks, one lensing effect for black holes, ships drifting at station with flickering engines, shuttles between planets, hologram scanline sweep and alert glitches, occasional comets and solar flares. Cap animation at around 30 frames per second and offer a battery saver mode.
- **Art volume:** 11 ship classes and 4 regiment types per species. Fewer species at launch, or a shared civilian design for trade ships, reduces this.
- All sizes, frames, file names, and who makes each asset are in the bible's Art specs tab. Image prompt templates are in its Prompt templates tab.
- Use CC0 placeholder packs, logged in a credits file. Build a small cleanup tool for the owner's generated images: shrink to target size with hard edges, snap every pixel to the master palette, remove the background.

**Audio**
- Build named audio slots that load files dropped into an audio folder, as listed in the bible's Audio list tab. Play nothing until the player's first tap, as iPhones require.

**Data**
- The bible spreadsheet is the single source for names, naming rules, events, tech, commanders, art specs, prompt templates, the asset list, and audio slots. The game reads it (or CSV exports of its tabs).
- **Naming generator** configurable per culture and per category: consonant and vowel patterns, syllable and letter length limits, favored endings, banned letter pairs, chance of apostrophes, hyphens, and two-part names. Hand-picked names are used first; generated names fill in when a category runs dry. Ship names and faction words are never remixed.

## 18. Test builds, in order

Each is a rough, playable link on the phone. Stay rough until the owner signs off.

1. **Name generator preview:** reads the bible and shows 50 sample names per culture.
2. **Galaxy map in grey boxes:** a generated galaxy to tap around; check spacing, lanes, and size.
3. **Star system view:** placeholder planets spinning, ships holding station, starfield and effects.
4. **Battle sandbox:** two fleets with formations, tasks, plans, and an optional reserve; run, read the result, adjust numbers, rerun. Includes the chaotic battle view, turning-point notifications, tankers as targets, retreat and the warp to safety, the disabled capital ship windows, and the debrief replay.
5. **Economy loop:** one system with build queues, timers, resources, fuel, and the market; tests pacing and dead time.
6. **One rival and the advisors:** a single faction expanding while advisor requests arrive, with one recurring trade deal running and one scout gathering intel.
7. **Events prototype:** a few event shapes firing from galaxy conditions, recorded in the galaxy history tab.

Then assemble the first playable version from these pieces.

## 19. The coding session must not

- Produce final versions of anything the owner creates (section 17): ships, regiments, planets, stars, special objects, points of interest, portraits, emblems, music, sound effects, names, event text, tech unlocks, or commander perks. Placeholders only.
- Show any owner-made asset in the game until it is marked approved in the bible's Asset list or Audio list.
- Add monetization, premium currency, or speed-ups.
- Add speed controls or any progress while the app is closed.
- Add population or planet stability.
- Add a diplomatic win condition.
- Add level gates between tech tracks.
- Allow live control in battle beyond the pre-assigned reserve and retreat.
- Build any feature from the deferred list in section 20.
- Polish a test build, or move to the next one, before the owner signs off.
- Hard-code content that belongs in the bible.
- Make AI factions use information their own intel would not give them.

## 20. Feature status

**In the first version (core):** trait-built factions and player trait choice, generated galaxy and naming, advisors with request queues, two win conditions (military and wealth) with countdowns, hidden agendas with tiered reveals, intelligence with scouts, sabotage, counterintelligence, and rival dossiers, treaties including vassalage with buyout, planned large-scale combat with reserves, retreat, and disabled capital ships, multiple fleets with hired commanders, commander memorial, logistics and supply, galactic market and recurring deals carried by trade ships, tech tree, condition-based events, galaxy history tab, points of interest and galaxy-scale special objects.

**Absorbed into the core:** battle plans (combat setup), capture and rename (disabled ship rule), intercepted communications (agenda reveals), ship chronicle (a light version feeds the memorial), convoys (trade ships on lanes), pirate risk (as a lane hazard).

**Deferred to later phases:** refits with downtime, salvage fields, megaprojects, claims before attacks, sieges as a system, raids, contract board, mercenaries, cornering a market, successions and civil wars, pirate havens and pirate factions, expeditions, reputation tags, electronic warfare craft, advisors handling routine items on their own, deeper AI profiling, story event chains, faction-specific mechanics, population, planet destruction. The contract board and expeditions may appear early as event shapes, not systems.

**Cut:** diplomatic victory, refugees, terraforming, monetization, offline progress, speed controls.

## 21. Tunable starting values

| Setting | Starting value |
|---|---|
| Rival factions | 6 default, up to 10 |
| Species / cultures | 4 to 5 species, 2 cultures each |
| Factions per species | 2 maximum |
| Planets per system | 7 maximum, plus 2 points of interest |
| Building slots | 3 to 8 on rocky planets, none on gas planets |
| Galaxy size | 80 to 150 systems |
| Campaign length | about 30 hours of play |
| Build times | see section 3 |
| Builds per shipyard or barracks | 1 at a time |
| Trade ship trip | 10 to 20 minutes of game time |
| Battle length | 2 to 3 minutes small, about 5 minutes large |
| Owner recovery window | 5 minutes of game time |
| Rival capture window | 2 minutes of game time |
| Win thresholds | Military 40% of systems plus fleet above next two rivals combined; wealth 40% of galaxy output or 60% of exclusive trade |
| Win hold time | 45 minutes, with a 10-minute grace period for dips |
| Commanders offered per hire | 4 |
| Capital ships per fleet | 1 maximum |
| Opening strategies | 4 to 5 |
| Tasks per unit type | 5 to 6 |
| Tech | 4 tracks, 12 levels, about 72 unlocks (24 new gear, 48 buffs) |
| Event shapes | 40 to 60 |

## 22. Assumptions to confirm before building the affected part

- AI factions can win, and a rival's completed countdown ends the player's campaign.
- Escorts rejoin their source fleet when the mission ends.
- Tankers recharge the fleet during battle but do not refuel fleets between battles.
- Gas planets are harvested by an orbital structure, since they have no building slots.
- Retreating from a planet battle evacuates surface regiments with the fleet, and the warp still costs fuel and takes pursuit losses as it starts.
- Portraits and emblem parts are made by the owner.

## 23. Answers to design-gap questions 11 to 14

- **11. Starting position:** deliberately left open. The owner wants to experiment with balance first. Use your proposed default (one developed home system, one capital ship with a small starter fleet, resources for the first few builds) as a tunable placeholder, and follow up with the owner after the economy and battle test builds.
- **12. Advisor requests versus events:** your default stands. Typed requests from the systems and authored events share the same advisor queues (section 16).
- **13. Screen wake lock:** not discussed in detail. Proceed with your default (keep the screen awake while unpaused, with a setting to turn it off) and confirm with the owner in test build 5.
- **14. Target phone:** not discussed in detail. Proceed with your default (an iPhone 11 class device on Safari) and confirm with the owner before performance testing.

## 24. Technical guardrails from the design chat

These are requirements, not architecture choices.

- AI factions plan on a staggered schedule, never all at once and never every frame.
- Large battles track ships by count and draw a representative number on screen.
- Planets are generated once when the galaxy is created and saved as images; the higher-resolution version is generated the first time it is opened and then kept.
- Pause cleanly whenever the app leaves the screen.
- Saves must survive the phone clearing browser storage: provide a manual export and import, with cloud backup as a later option.
- Test ten factions on an older iPhone before calling the rival cap final.

## 25. Still open

- Starting position (after balance testing)
- Game name and memorial name
- Repository name
- Display typeface (a CC0 pixel font is fine as a placeholder)
- The seven exclusive resources and the common resources (credits, alloy, fuel, research) carry over from DESIGN.md; each needs a liquid or solid tag. Confirm during the economy test build
- Ground regiment icon view (top-down or side)

## 26. Decisions recorded by the coding session

- **October 21, 2026. Screen resolution.** The screen is 480 art pixels wide, scaled to the phone with nearest-neighbor filtering. All sprite sizes are in `docs/ART_SPEC.md`, which supersedes the sizes in the bible's Art specs tab until that tab is updated. Decided by the coding session at the owner's request for as many pixels as possible while keeping a pixel art look.
- **October 21, 2026. Test build 1 postponed.** The owner asked to skip the name generator until the Cultures and Syllables tabs are filled. Test build 2 is first.
- **October 21, 2026. Repository.** The dedicated repository is `sampsoni01/Starshine`. Paths in it are `docs/` and `data/` at the root, without the `galactic-conquest/` prefix.

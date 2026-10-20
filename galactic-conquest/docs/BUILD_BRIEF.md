# Galactic Conquest: Build Brief

Returned from the design refinement chat on October 20, 2026. This replaces the open questions and recommendations in HANDOFF.md, and overrides DESIGN.md and ART.md wherever they disagree. Commit it to `galactic-conquest/docs/BUILD_BRIEF.md`, along with `galactic-conquest-bible.xlsx` (the project bible) in `galactic-conquest/data/`.

## Instructions for the coding session

Start with test build 1 in section 12, not the full game. Each test build is a rough, playable link the owner opens on their phone. Do not polish a build or move to the next one until the owner signs off. Read the bible spreadsheet for names, events, art specs, prompt templates, and audio slots; never hard-code content that belongs there. Section 13 lists what you must not do.

## 1. Summary

| Item | Decision |
|---|---|
| Game name | Undecided. "Galactic Conquest" is a working title |
| Pitch | A space empire strategy game for phones, in continuous pausable time, where trade, war, logistics, and diplomacy interlock and rival factions chase hidden agendas |
| Primary fantasy | A sandbox. All four systems are mandatory; the player chooses which to lean into, and that shapes their playstyle |
| Players | Single-player against AI factions, structured so multiplayer can be added later |
| Lifecycle | Campaigns of roughly 30 hours of play, ending in a win or a defeat |
| Orientation | Portrait first, layout able to support landscape later |
| Platform | Web app installed to the home screen, wrapped for app stores later |
| Map | Three levels: galaxy node graph, star system view, planet view |
| Combat | Planned and committed in advance, then resolves without live control. Retreat available at any time |
| Time | Runs only while the app is open and unpaused. No offline progress, no speed controls |
| Rivals | 6 by default, player can choose up to 10 |
| Monetization | None |
| Repository | A dedicated repository; name still to be chosen |

## 2. Pillars (rewritten)

1. **The galaxy never waits while you play.** Rivals act continuously; pausing is how the player thinks.
2. **Capital ships are characters.** Named, renamed, remembered. Their commanders go down with them.
3. **Any session length works.** A few minutes to approve deals and order ships, or an hour planning an offensive.
4. **Everything is tradeable.** Resources, ships, treaties, intelligence.
5. **Every system matters, the player chooses depth.** Upgrades in one system require a minimum strength in others; neglecting logistics, for example, drags the whole empire down.

## 3. Time

- The clock runs only while the game is open and unpaused. Closing the app or leaving the screen pauses it automatically and cleanly.
- Build, travel, and research timers count down only during play. Starting scale: the largest capital ships take roughly 30 to 60 minutes of play; small craft take single-digit minutes. Tune in playtesting.
- No speed controls. Dead time is prevented by parallel progress (shipyards, research, trade, and construction running at once), a steady flow of small advisor decisions, and short tasks.
- Most decisions can be made while paused.
- Leaving the game open unattended is discouraged naturally by the risk of missed invasions and events.

## 4. Win and defeat

- **Military win:** control a set share of systems and hold battle dominance (for example, fleet strength above the next two rivals combined).
- **Wealth win:** your economy outproduces all rivals combined, or you control most of the exclusive resource trade.
- **Diplomatic win:** formal alliances or vassal treaties with a majority of surviving factions.
- Every win must be held for a sustained period with a countdown visible to the whole galaxy. As a countdown runs, rivals grow more willing to form coalitions against the leader, and grow more reluctant to sign treaties that would hand them the win.
- Treaties are formal, with severe penalties for breaking them. The same penalties apply to the player. Treacherous factions may break them anyway to stop a diplomatic win.
- Every faction has a home planet that cannot be destroyed, only occupied. Occupying a home planet should be rare.
- An empire with an occupied home survives on its other colonies and outposts. Losing every asset is defeat, which ends the player's campaign.

## 5. Map

- **Galaxy:** node graph of star systems joined by lanes. A strategic overview the player visits when needed. Start from 80 to 150 systems and confirm in test build 2. Galaxy-scale special objects appear here: black hole systems, nebulae that blind sensors and cut intel, and supernova remnants or pulsars with dangerous shortcut lanes. Three or four types at launch, each with one gameplay effect.
- **Star system:** the main screen. The star and all planets in view at once, at most 7 planets plus up to 2 small points of interest (dwarf planets, rogue moons, comets, derelicts). Asteroid belts are drawn as a ring and take no slot. Planets stay fixed on their orbit rings and spin in place, so tap targets never move.
- **Ships are never in empty space.** They are always orbiting a planet or point of interest, or in transit.
- **Planet:** a higher-resolution planet with resources, income, and a strategic panel during conflicts in orbit or on the ground.
- **Planets are hubs:** refueling, trade, resource output, and the stage for battles. No population and no stability for now. Structure planets so population can be added later as a multiplier on output, without reworking them.

## 6. Combat

- Space and ground combat are both planned before committing, then resolve on their own. Battles are deterministic from a seed.
- **Space setup:** formation, resource allocation, and a task per unit or squadron (escort the capital ship, hunt fighters, strike their capital ship, screen the line). Five or six tasks per unit type at most.
- **Ground setup:** forces are grouped into battalions and sub-armies, each given a role (spearhead, flank, hold, reserve).
- **Opening strategies:** four or five at launch, such as Full Assault, Hold the Line, Squadron Screen, Hit and Run, and Siege. Commander traits can unlock variants later.
- **Saved battle plans per capital ship,** so a quick session can confirm the last plan instead of rebuilding it.
- **Retreat** can be ordered at any time, including while paused. It mitigates losses but is recorded as a defeat that every faction sees. Earlier retreats save more; pursuit always costs something.
- If a rival controls an orbit, attempting a recovery there starts a new battle.

## 7. Disabled capital ships and commanders

- A defeated capital ship drifts disabled in orbit for **5 minutes of game time**, pausing with the game.
- During those 5 minutes the owner can recover it. A recovered ship is unusable until repaired with resources and time. It keeps its inventory: upgrade modules, its commander, and the raw alloy it was built from. The owner can instead send it to a shipyard to break it down into materials.
- After the owner's window, rivals get **2 minutes** to secure it by getting enough personnel aboard and spending resources on quick fixes. Boarding speed depends on the size of the boarding party, so a thin party may not finish. If nobody secures it in time, it burns up in the atmosphere and kills everyone aboard.
- This works both ways: the player can capture rival capital ships the same way.
- **Commanders always share their ship's fate.** They die if it burns and are killed if it is captured.
- A fallen commander gets a hero's sendoff at every player-controlled location, posted in the bulletin, and is recorded permanently in a memorial under Achievements. Each entry stores name, ship, battles fought, and how they fell. The memorial's name is still to be chosen (candidates: Roll of Honor, Hall of the Fallen, The Long Watch, Memorial Wall).
- All of these timings are starting values. Keep them in a settings table that is easy to tune after playtesting.

## 8. Factions, species, and cultures

- **Factions are built from traits, not archetypes.** Four axes, each with five or six options, plus one or two quirks:
  - Government: junta, merchant republic, theocracy, hive collective, corporate charter, monarchy
  - Temperament: aggressive, cautious, opportunistic, honorable, treacherous
  - Economic focus: trade, industry, research, raiding, extraction
  - Quirks: for example xenophobic, relic collector, holds grudges forever, never breaks a treaty, covets a specific resource
- **The player chooses their own traits at the start of a run** from the same pool. Each trait carries stat modifiers.
- **Titles come from the government trait** (any junta uses a marshal-style title, any theocracy a hierarch-style title), rendered in the culture's naming style.
- **Species carry no gameplay traits.** Every species can be good or evil. Species differences are flavor, mostly advisor dialogue (for example, the diplomacy advisor groaning about a famously stubborn species). Any mechanical species quirk must be tiny and situational.
- **Three layers:** species (body, face base, ship silhouette family), culture (language and naming, features, clothing, architecture, hull detailing), faction (traits, palette, emblem, titles).
- **4 to 5 species, 2 cultures each.** At most 2 factions per species in a galaxy, always of different cultures.
- **Hidden agendas:** every faction pursues one in addition to a win condition, weighted by its traits and built from ordinary AI actions. The player uncovers agendas in tiers (hint, category, full) through intelligence and diplomacy. The player has no assigned agenda.
- **AI reads the player's strategy using the same intel rules the player has.** First version: counter-building against your fleet makeup, defending markets you dominate, and forming coalitions as you near a win.

## 9. Advisors and events

- One advisor per core system: military, trade, logistics, diplomacy. Fixed stand-ins with a name, face, and voice. They inform, deliver news on their subject, and carry out orders. They never push back.
- Each advisor keeps a short queue of pending decisions, so a quick session means clearing requests.
- **Events grow out of galaxy conditions, not random rolls.** Each event shape has a trigger, actors filled in from the current game, two or three choices, and consequences, sometimes with a later follow-up. Target 40 to 60 shapes.
- Anti-repetition: cooldowns and memory of what the player has seen, relevance weighting, chains, escalation in later game, rival agendas as a source, and advisor and species voice.
- Every event decision must have consequences that affect the campaign.
- Event shapes are authored in the bible's Events tab.

## 10. Replay value

- Seeded galaxy generation: lane layout, chokepoints, and sector shapes differ each run.
- Exclusive resources shuffled across the galaxy each run.
- Rival traits, agendas, species, and cultures drawn fresh each run.
- Starting position varies.
- Names generated per culture from the owner's lists and rules, and the player can rename planets, ships, points of interest, commanders, and merchants.

## 11. Art, audio, and data

**Art**
- Pixel art, dark navy and neon hologram palette, amber for the player's interface, scanline motif.
- **Top-down ships in play.** Two facings drawn per ship (nose up, nose upper-right), rotated in quarter turns for the other six. Even overhead lighting so rotation looks correct.
- **3/4 showcase art** at higher resolution for construction and purchase screens, the ship screen, the memorial, and anywhere outside live play.
- **Planets:** the owner supplies 12 to 14 templates drawn in shading ramps. The game varies colors, atmosphere ring, and cloud layer within approved limits, and produces a contact sheet of variants for approval.
- **Faction recoloring:** any pixel in the reserved 4-shade magenta ramp is recolored per faction.
- **Portraits:** one face base per culture, with clothing as separate overlays.
- **Living screens:** spinning planets (scrolled surface strip behind a circle, separate cloud layer, fixed night shadow), parallax starfield, palette cycling for stars, nebulae and accretion disks, one lensing effect for black holes, ships gliding on orbits with flickering engines, shuttles between planets, hologram scanline sweep and alert glitches, occasional comets and solar flares. Cap animation at around 30 frames per second and offer a battery saver mode.
- All sizes, frames, and file names are in the bible's Art specs tab. Image prompt templates are in its Prompt templates tab.
- **The owner creates all final art.** Use placeholders only (CC0 packs, logged in a credits file). Build a small cleanup tool for generated images: shrink to target size with hard edges, snap every pixel to the master palette, remove the background.

**Audio**
- The owner creates all music and sound effects. Build named audio slots that load files dropped into an audio folder, as listed in the bible's Audio list tab. Play nothing until the player's first tap, as iPhones require.

**Data**
- The bible spreadsheet is the single source for names, naming rules, events, art specs, prompt templates, the asset list, and audio slots. The game reads it (or CSV exports of its tabs).
- **Naming generator** configurable per culture and per category: consonant and vowel patterns, syllable and letter length limits, favored endings, banned letter pairs, chance of apostrophes, hyphens, and two-part names. Hand-picked names are used first; generated names fill in when a category runs dry. Ship names and faction words are never remixed.

## 12. Test builds, in order

Each is a rough, playable link on the phone. Stay rough until the owner signs off.

1. **Name generator preview:** reads the bible and shows 50 sample names per culture.
2. **Galaxy map in grey boxes:** a generated galaxy to tap around; check spacing, lanes, and size.
3. **Star system view:** placeholder planets spinning, ships orbiting, starfield and effects.
4. **Battle sandbox:** two fleets with formations, tasks, and plans; run, read the result, adjust numbers, rerun. Includes retreat and the disabled ship windows.
5. **Economy loop:** one system with build queues, timers, and resources; tests pacing and dead time.
6. **One rival and the advisors:** a single faction expanding while advisor requests arrive.
7. **Events prototype:** a few event shapes firing from galaxy conditions.

Then assemble the first playable version from these pieces.

## 13. The coding session must not

- Produce final art, music, sound effects, names, or event text. Placeholders only.
- Show any asset in the game until it is marked approved in the bible's Asset list or Audio list.
- Add monetization, premium currency, or speed-ups.
- Add speed controls or any progress while the app is closed.
- Add population or planet stability.
- Build any feature from the deferred list in section 14.
- Polish a test build, or move to the next one, before the owner signs off.
- Hard-code content that belongs in the bible.
- Make AI factions use information their own intel would not give them.

## 14. Feature status

**In the first version (core):** trait-built factions and player trait choice, generated galaxy and naming, advisors with request queues, three win conditions with countdowns, hidden agendas with tiered reveals, planned combat with retreat and disabled ships, commander memorial, condition-based events, points of interest and galaxy-scale special objects.

**Absorbed into the core:** battle plans (combat setup), capture and rename (disabled ship rule), intercepted communications (agenda reveals), ship chronicle (a light version feeds the memorial).

**Deferred to later phases:** refits with downtime, salvage fields, megaprojects, claims before attacks, sieges, raids, convoys on lanes, contract board, mercenaries, cornering a market, successions and civil wars, pirate havens, expeditions, reputation tags, advisors handling routine items on their own, deeper AI profiling, story event chains, faction-specific mechanics, population. The contract board and expeditions may appear early as event shapes, not systems.

**Cut for now:** refugees, terraforming, monetization, offline progress, speed controls.

## 15. Tunable starting values

| Setting | Starting value |
|---|---|
| Rival factions | 6 default, up to 10 |
| Species / cultures | 4 to 5 species, 2 cultures each |
| Factions per species | 2 maximum |
| Planets per system | 7 maximum, plus 2 points of interest |
| Galaxy size | 80 to 150 systems |
| Campaign length | about 30 hours of play |
| Largest capital ship build | 30 to 60 minutes of play |
| Owner recovery window | 5 minutes of game time |
| Rival capture window | 2 minutes of game time |
| Opening strategies | 4 to 5 |
| Tasks per unit type | 5 to 6 |
| Event shapes | 40 to 60 |

## 16. Technical guardrails from the design chat

These are requirements, not architecture choices.

- AI factions plan on a staggered schedule, never all at once and never every frame.
- Planets are generated once when the galaxy is created and saved as images; the higher-resolution version is generated the first time it is opened and then kept.
- Pause cleanly whenever the app leaves the screen.
- Saves must survive the phone clearing browser storage: provide a manual export and import, with cloud backup as a later option.
- Test ten factions on an older iPhone before calling the rival cap final.

## 17. Still open

- Game name and memorial name
- Repository name
- Display typeface (a CC0 pixel font is fine as a placeholder)
- Tech tree and progression, not yet revisited
- The seven exclusive resources and the common resources (credits, alloy, fuel, research) carry over from DESIGN.md unchanged; confirm during the economy test build
- Ground unit view (top-down or side), to settle before drawing units

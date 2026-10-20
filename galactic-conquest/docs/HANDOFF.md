# Galactic Conquest: Design Handoff

Purpose: carry the current state of this game idea into a normal Claude chat, refine it there without the pressure to build, and come back with a clear brief. Paste this whole document into a new chat. The instructions below are addressed to that chat.

## Instructions for the next Claude

You are helping me refine the design of a mobile strategy game before any code exists. Your job is to help me cut scope, settle the open questions in section 7, decide which feature candidates in section 6 survive, and fill in the Build Brief in section 10. Push back when something is too large for a first version. Ask one or two questions at a time, not a list. Do not write code, choose libraries, or design engine architecture; a separate coding session will do that from the finished brief. Keep the pixel art plus hologram art direction unless I say otherwise.

## 1. The concept

A long-term galactic conquest game for phones. The player runs an empire made of planets, outposts, capital ships, and fleets. Planets carry bonuses and exclusive resources and can be ceded, traded, or destroyed. Capital ships are the primary game pieces: named, persistent mobile bases that host fleets, squadrons of small craft, and elite ground forces. The goal is to accumulate wealth and resources and turn them into ships, bases, components, and trade. Autonomous rival empires pursue their own agendas constantly. It is a mobile game, so build timers, a premium gem currency, and short engaging sessions all matter.

The five pillars, in priority order:

1. The galaxy moves without you. Logging in feels like catching up on news that affects you.
2. Capital ships are characters. Losing one hurts.
3. Short sessions, long arcs. Two to five minutes per session, months per campaign.
4. Everything is tradeable: planets, resources, ships, favors, intelligence.
5. Wealth is the score. Military power is a means.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Players | Single-player against AI rivals, built so multiplayer can be added later |
| Art | Pixel art, keeping the dark navy and neon hologram palette and the futuristic tone |
| Orientation | Portrait first, with a layout system that allows landscape to be turned on later |
| Repository | A dedicated repository, since this is an ongoing project |
| Platform | Playable on the phone through a web app installed to the home screen, wrapped for app stores later |

## 3. Recommendations made but not yet confirmed

- Galaxy lifecycle: one endless galaxy that keeps growing through era events, rather than campaigns that reset. Campaigns could be added later as an optional mode.
- Map: a node graph of star systems joined by hyperlanes, tapped rather than scrolled freely.
- Combat presentation: automatic resolution shown as a short skippable replay, with all player decisions made before the fight.
- Galaxy tick: the simulation advances every ten minutes, and rivals act on ticks.

## 4. Proposed design summary

**Time.** Wall-clock timers for builds, travel, and research. When the player returns, the simulation replays every missed tick and shows a "while you were away" report. Catch-up is capped so a lapsed player is not wiped out.

**Galaxy.** Roughly 80 to 150 star systems in named sectors, joined by lanes. Travel is time along lanes. Outposts extend supply range. Intel levels per system decide how much of a rival's agenda is visible. Chokepoints are deliberate.

**Planets.** Ten types, three to eight building slots, one or two small traits, and sometimes one exclusive resource deposit. Stability is the single soft stat. Ceding a planet ends a war and buys favor. Trading uses offers and a drifting market. Destroying a planet is a late-game act that yields a one-time windfall, leaves a permanent Dead World, and earns galaxy-wide infamy.

**Outposts.** Cheap, fast claims with a role: supply depot, listening post, shipyard, trade hub, defense platform. Easy to lose and retake.

**Capital ships.** Five hull classes with different hangar, fleet, and barracks capacity: Carrier, Dreadnought, Command Ship, Assault Carrier, Mobile Foundry. Each has a commander with traits. A defeated capital ship drifts disabled for a window before it is lost, so it can be recovered.

**Fleets, squadrons, elite forces.** Fleets are groups of escort ships with a doctrine setting. Squadrons are interceptors, bombers, gunships, and electronic warfare craft in a rock-paper-scissors layer. Elite forces are marines, drop troops, commandos, and specialists used for boarding, invasions, and missions.

**Economy.** Common resources: credits, alloy, fuel, research. Seven exclusive resources found only on specific planets and needed for advanced components, which drives trade and war. Gems are the premium currency. Two free build queue slots, more from tech and gems.

**Combat.** Five phases: approach, squadron fight, line fight, boarding and invasion, retreat check. Deterministic from a seed so the replay and the report always agree. New empires get a three-day shield, after which incoming attacks show an arrival time.

**Rival empires.** Five to eight per galaxy from seven archetypes: Expansionist, Mercantile, Militarist, Isolationist, Zealot, Technocrat, Swarm. Each has three active goals, relations with everyone, and a grievance memory. They trade, ally, war, cede, and occasionally destroy. Their moves appear in a galaxy news feed.

**Diplomacy.** Relations from Hostile to Allied. Treaties: non-aggression, trade route, research pact, defensive alliance. Demands and tribute. A galactic market for exclusive resources.

**Progression.** A tech tree with four branches. Empire rank unlocks hulls and treaty types. Era events every two to three weeks reshape the galaxy.

**Monetization.** Sell time and identity, never power: speed-ups, queue slots, capital ship insurance, cosmetics, a season pass. No loot boxes, no energy gate, no direct sale of exclusive resources.

## 5. Art direction

Pixel art in a "command deck hologram" world: near-black navy space, neon faction accents, one warm amber for the player's own interface, thin scanline motif, strong typography. Reference games for tone: Crying Suns, FTL, Halcyon 6.

Production rules that keep pixel art looking professional:

- One pixel size everywhere, integer scaling only, sprites on 16, 32, and 64 pixel bases.
- No free rotation of sprites. Map ships use eight or sixteen pre-drawn facings.
- Planets are generated procedurally by a shader, then pixelated and quantized to the palette with dithering. Unlimited variety at no asset cost.
- Escort ships come from a mirrored pixel ship generator. Capital ships are drawn individually.
- Each empire gets a generated emblem instead of a leader portrait.
- Glow is a one or two pixel additive halo. Bitmap fonts on the same grid.
- CC0 placeholder packs from Kenney until bespoke art replaces them, with every third-party asset logged in a credits file.
- Every art step produces a contact sheet reviewed on a phone.

Still to decide in the art: top-down versus three-quarter ship views, a display typeface, and whether rival leaders need faces at all. Three to six reference screenshots with a note on what is liked in each would settle most of this.

## 6. Feature candidates

Each is a candidate. Mark every one keep, later, or cut.

Capital ships as characters:
- Ship chronicle: an auto-written log of each ship's battles, planets, and commanders.
- Capture and rename: board a disabled rival capital ship and keep it, history included.
- Refits with downtime: swapping modules docks the ship for hours.
- Salvage fields: wreckage after battles that a Mobile Foundry can mine.

Planets and territory:
- Megaprojects: multi-day builds like an orbital ring or terraforming a Dead World.
- Terraforming chains: Barren to Desert to Terran over days.
- Refugees: accept displaced populations for growth at the cost of stability.
- Claims: rivals declare claims before they attack, giving warning.

Economy and trade:
- Convoys as objects on lanes that can be escorted or raided.
- Contract board: rivals post jobs, and the player can post jobs too.
- Mercenaries: rent a fleet for a limited time.
- Cornering a market: buy up a resource, prices spike, the Consortium sanctions you.

A living galaxy:
- Intercepted communications in the feed that reveal rival agendas.
- Successions and civil wars that split a rival into two factions.
- Pirate havens to bribe, hire, or burn.
- Expeditions: timed missions to ruins worlds that return with relics and a choice.
- Reputation tags like Planet Breaker or Honest Broker that change how archetypes treat you.

Combat without micromanagement:
- Battle plans chosen before a fight, unlocked by commander traits.
- Sieges: blockade a planet for hours before invading, with an appointment to return.
- Raids: squadron-only strikes on outposts and convoys for short sessions.

## 7. Open questions

1. Which fantasy is primary: admiral commanding ships, emperor managing worlds, or merchant prince getting rich? This decides where polish goes first.
2. How much text: narrative events with choices, or a mostly numeric game with a news feed?
3. How should losing feel: permanent loss, forgiving recovery, or something between?
4. Confirm or change the four recommendations in section 3.
5. Galaxy size at launch, and tick length.
6. Whether planets have population or only stability.
7. Whether to offer any mid-battle input at all.
8. Rival count at launch.
9. Top-down or three-quarter ship art.
10. Which name the game will carry.

## 8. Scope guardrail

The concern that triggered this handoff is scope growth. A useful test for every feature: does the smallest playable version need it? The smallest playable version proposed so far is:

- One sector of the galaxy, one home system, planets and outposts.
- One capital ship hull with fleets and squadrons.
- Build timers and offline catch-up.
- Three rivals that only expand and defend.
- Automatic combat with a results card.
- Save and resume on the phone.

Everything else is a later phase. Aim to come back with no more than six features beyond this list marked as keep for the first version.

## 9. Where things live

- Repository: sampsoni01/claude-code, branch claude/galactic-conquest-game-design-io8bam
- Full design draft: galactic-conquest/docs/DESIGN.md
- Art direction draft, still describing vector art and due for a pixel art rewrite: galactic-conquest/docs/ART.md
- This handoff: galactic-conquest/docs/HANDOFF.md
- The coding session that produced these: https://claude.ai/code/session_017atTQEi7xh4kJevejQ4vgH

## 10. Build Brief

Fill this in during the refinement chat and bring it back to a coding session. Keep it under one page.

- Game name:
- One-sentence pitch:
- Primary fantasy:
- Players and lifecycle:
- Orientation:
- Map style:
- Combat presentation:
- Tick length and catch-up cap:
- First-version feature list, six or fewer beyond the scope guardrail:
- Features deferred to later phases:
- Features cut:
- Art: ship view, typeface, reference images attached or linked, anything from the reference images to copy in spirit:
- Rival archetypes at launch and how many:
- Monetization at launch, if any:
- Dedicated repository name:
- Anything the coding session must not do:

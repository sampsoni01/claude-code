# Galactic Conquest: Art Direction and Pipeline v0.1

Status: discussion draft. The question this answers: how do we produce a consistent, good-looking mobile strategy game with no art team?

## 1. The direction: "Command Deck Hologram"

The player is standing at the tactical display of their flagship. Everything on screen is the ship's rendering of the galaxy: dark space, glowing vector shapes, crisp typography, thin holographic grids.

Concretely:

- **Space is dark.** Near-black navy backgrounds with a faint parallax starfield and nebula washes. Dark hides seams between assets and makes glow cheap and effective.
- **Shapes and glow, not paint.** Flat vector forms with a single accent glow. No painterly shading, no photo textures.
- **Planets are the only "soft" thing.** Procedurally rendered spheres with atmosphere rim light. They are the jewels on the display, so they get the most visual budget.
- **Ships are silhouettes.** Top-down, assembled from modular vector parts, tinted by faction. They read at thumbnail size, which is all a phone gives you.
- **Typography carries the UI.** A geometric display face for headings and numbers, a clean sans for body. Strong type makes vector UI look intentional instead of placeholder.
- **One signature motif.** A thin holographic scanline grid that appears on panels, map overlays, and loading states. Repetition is what makes a style feel like a style.

Why this direction over painterly or pixel art:

| | Vector hologram | Painterly | Pixel art |
|---|---|---|---|
| Cost per asset | Low, often zero (code) | High | Medium |
| Consistency across hundreds of assets | High, rules live in code | Hard without one artist | Medium |
| Scales to every phone size | Yes | Yes | Needs integer scaling, awkward on odd DPIs |
| Can be produced in this environment | Yes: SVG, shaders, code | No | Partly |
| Risk | Looks generic if undisciplined | Expensive, inconsistent | Charm can fight the "command deck" tone |

The risk on the chosen direction is "programmer art." The defenses are a style bible written before any asset, the typography, the planets, and the motif.

## 2. Style bible (write this first)

A single page that every asset obeys:

- **Palette.** Background navy ramp (3 steps). One warm UI accent (amber) for the player's own interface. Six faction accent colors, each a hue family with a bright and a dim step, assigned one per empire. Danger red, success teal, neutral grey.
- **Type.** Display: Orbitron or Exo 2. Body: Inter or Rajdhani. All from Google Fonts, bundled locally for offline.
- **Line and glow.** 2 px strokes at 1x. Glow is a 6 px blur of the accent at 40% opacity, additive blend. Never two glow colors on one object.
- **Icon grid.** 24 px grid, 2 px stroke, rounded joins. One stroke weight for every icon in the game.
- **Panels.** 1 px accent border, 8 px radius, translucent navy fill, scanline motif at 6% opacity.
- **Motion.** Everything eases in under 200 ms. Glow pulses only on things that need attention.

## 3. Asset classes and how each is produced

### 3.1 Planets: procedural, in a shader

A fragment shader draws a lit sphere from a seed: layered noise for terrain, a palette chosen by planet type, a cloud layer, an atmosphere rim light, rings for gas giants, and night-side city lights that grow as the planet develops. Deterministic from the planet's seed, so the same world always looks the same.

For performance on low-end phones, each planet is rendered once to a texture at the sizes the UI needs and cached. The shader runs rarely, not every frame.

Result: unlimited distinct planets, zero asset files, and a visual language that development on a planet is visible from orbit.

### 3.2 Ships: a modular vector kit

Top-down silhouettes assembled from SVG parts: prow, midsection, engine block, pylons, turrets, hangar bays. A hull family defines which parts fit. Faction tint is applied to a designated accent region; the hull stays grey-blue. Damage is a scorched overlay at three levels.

Escort and line ships are assembled from the kit. Capital ships are bespoke hero silhouettes, one per hull class, five at launch. They are the pieces the player names and loses, so they deserve individual drawings.

Squadrons are icons, not ships: a chevron, a dart, a diamond, a ring, each in the faction color. At the sizes squadrons appear, icons read and silhouettes do not.

### 3.3 Empire identity: an emblem generator

Each empire gets a procedurally generated emblem: a shape from a small set (shield, circle, hex, chevron), a glyph layer, and the faction color. Rivals are instantly tellable apart on the map and in the feed. This also sidesteps character portraits for rival leaders at launch; the emblem is the face.

### 3.4 UI icons

Two sources, chosen per icon:

- Draw our own on the 24 px grid for the core set (resources, ship classes, buildings, actions). Perhaps sixty icons.
- Fill gaps from game-icons.net (CC BY 3.0, attribution required) and the Kenney UI packs (CC0, no attribution required). Any third-party icon is restyled to the grid and stroke before use.

### 3.5 Placeholder phase

Kenney's Space Shooter Redux, Planets, and Space Kit packs are CC0 and cover ships, planets, and UI for a prototype. They let the game become playable before any bespoke art exists, and they get replaced class by class as the pipeline above comes online.

### 3.6 Hero illustration: deferred

Splash screens, era event cards, and leader portraits are the only places the direction calls for painted art. Three options when the time comes:

1. Stay in-style: emblems, silhouettes, and type. Cheapest and most consistent.
2. Image generation with a locked style prompt and a reference set, reviewed piece by piece. Fast and inconsistent. Store policies on generated content shift, so keep a record of how each piece was made.
3. Commission a handful of pieces from one artist once the game has a shape. Most expensive, best result.

Recommendation: option 1 through the vertical slice, then decide.

### 3.7 Effects and motion

Engine trails, weapon beams, shield flares, and explosions are code-driven particles with additive blending. Screen shake on capital ship hits. Glow bloom via blend modes, not post-processing, to stay cheap.

### 3.8 Audio

Later. A procedural ambient drone for the Bridge, CC0 packs for interface and weapon sounds, tracked in a credits file.

## 4. Production order

Each step produces a contact sheet: a single page that renders every asset from that step so it can be reviewed on the phone and approved or sent back.

1. Style bible and palette tokens.
2. Planet shader with the ten planet types.
3. One capital ship, the four escort classes, the four squadron icons.
4. UI kit: resource bar, panel, button, timer, list row, tab bar.
5. Emblem generator.
6. Galaxy map rendering: lanes, systems, fog, selection.
7. Remaining four capital ships.
8. Battle replay scene.

## 5. Review and licensing

- Every asset decision is reviewed on a phone, not a desktop. If it does not read at thumb size, it is redone.
- A credits file tracks every third-party asset, its license, and where it is used. CC0 needs no attribution but is logged anyway.
- Anything generated by an image model is logged with the tool and date.

## 6. Decisions needed

1. Approve the "command deck hologram" direction, or steer toward painterly or pixel art.
2. Top-down ship silhouettes versus three-quarter isometric. Recommendation: top-down.
3. Display typeface: Orbitron (more sci-fi) or Exo 2 (more restrained). Recommendation: Exo 2.
4. Whether rival leaders need faces at launch. Recommendation: no, emblems only.

# Starshine: Art Specification v1

This is what the code is built around. The Art specs tab of the bible should be updated to match these numbers. Everything here is in art pixels unless it says otherwise.

## 1. Screen and scaling

- **The screen is 480 art pixels wide.** Height follows the phone: 854 on a 16:9 phone, about 1040 on a modern 19.5:9 iPhone. Design every screen so that 480 x 854 holds everything important, and treat extra height as extra space.
- The game draws to a 480-wide canvas and scales it to the phone with nearest-neighbor filtering, no smoothing. On a modern iPhone one art pixel is about 2.4 device pixels. On an iPhone 11 it is about 1.7. On an iPhone SE it is about 1.6.
- Frame rate is capped at 30. Animations are authored at 10 frames per second unless the Art specs tab says otherwise.
- Safe zones: the top 48 rows and bottom 34 rows of art pixels can sit under phone bars. Interface elements avoid them. Art does not need to care.

## 2. File rules

- PNG with a transparent background. Alpha is either 0 or 255, never in between. No anti-aliasing, no soft edges, no blur.
- Every color in a sprite comes from the master palette, which the owner chooses: 32 to 48 colors including the faction ramp below. Send the palette as a one-row swatch strip PNG, one pixel per color, before the first sprite.
- **Faction ramp.** Four magentas reserved for anything that should take the faction's color. The game recolors them per faction. Use these exact values, light to dark:
  - `#FF9BFF`
  - `#FF2BFF`
  - `#C400C4`
  - `#6E006E`
- **Marker pixels.** Two colors the game reads and then removes. They never show on screen.
  - `#00FFFF` marks an engine exhaust point. The game draws engine glow and trails there.
  - `#FFFF00` marks a weapon hardpoint. The game draws weapon fire from there.
- Light comes from the upper left on every sprite, so mirrored copies look right.
- Animation frames sit side by side in one horizontal strip, left to right, all frames the same size.
- One file per drawn angle. Angles use the suffixes `_side`, `_toward`, `_away`.
- File names follow the bible: `type_species_culture_name_size[_angle].png`, all lowercase, underscores only.

## 3. Ships in play

All ships except fighters and bombers are 3/4 view. Side-on faces right. Angled toward the camera faces lower right. Angled away faces upper right. The game mirrors each drawing for the three left-facing directions, giving six facings.

| Ship | Size | Drawn angles | Notes |
|---|---|---|---|
| Capital ship | 128 x 128 | 3 | The largest thing in a fleet. Centerpiece of the battle view |
| Dreadnought | 96 x 96 | 3 | Heavy, bulky silhouette |
| Carrier | 96 x 96 | 3 | Visible hangar openings |
| Corvette | 48 x 48 | 3 | Small warship, no hangar |
| Fighter | 24 x 24 | 1, top-down, nose up | The game rotates it freely with a motion trail |
| Bomber | 24 x 24 | 1, top-down, nose up | Heavier than the fighter at a glance |
| Merchant vessel | 48 x 48 | 2 (side, toward) | Civilian look |
| Cargo ship | 48 x 48 | 2 (side, toward) | Civilian look |
| Freighter | 64 x 64 | 2 (side, toward) | Civilian look |
| Tanker | 64 x 64 | 2 (side, toward) | Must read as a tanker at a glance |
| Scout | 32 x 32 | 2 (side, toward) | Small and sleek |

Ship sprites are static. Engine glow, trails, shield shimmer, weapon fire, explosions, and lighting are drawn by the game.

## 4. Showcase art

Still images at a three-quarter angle with more detail than the in-play sprites, shown in construction screens, the ship screen, and the memorial.

| Asset | Size |
|---|---|
| Capital ship, dreadnought, carrier | 384 x 216 |
| Corvette, trade ships, scout (optional for version 1) | 192 x 108 |

Match the in-play sprite's design so the two read as the same ship.

## 5. Planets

- One **surface strip** per planet type at **512 x 256**, an equirectangular map that tiles seamlessly left to right. Draw it in shading ramps from the master palette.
- One optional **cloud strip** per planet type at **512 x 256** with transparency, also tiling left to right.
- The game renders every planet size from this single strip: 32, 48, 64, 80, and 96 diameters in the star system view, and 256 in the planet detail view. It wraps the strip around a sphere, spins it, adds the night-side shadow, the atmosphere ring, and color variation within approved limits.
- Target 12 to 14 planet types.

## 6. Stars and galaxy objects

| Asset | Size | Frames | Notes |
|---|---|---|---|
| Star | 128 x 128 | 4 to 8 in a strip, or one frame with palette-cycle shades marked | Corona animation |
| Black hole, nebula heart, pulsar, supernova remnant | 128 x 128 | 6 to 8 | Three or four types. The game adds lensing |
| Point of interest | 32 x 32 | 1 to 2 | Dwarf planet, rogue moon, comet, derelict, four to six types |
| Asteroid belt rocks | 16 x 16 | 3 to 4 variants | The game scatters them into a ring |

The galaxy map draws its own small icons for these. The owner's art appears in the star system view.

## 7. Ground, people, and emblems

| Asset | Size | Frames | Notes |
|---|---|---|---|
| Ground regiment icon | 32 x 32 | 1 to 2 | Infantry, armor, mercy, heavies. Each stands for a whole regiment |
| Portrait base | 96 x 96 bust | Blink 2, talk 2 to 3 | One per culture, face only |
| Portrait overlay | 96 x 96 | Matches the base | Uniforms, robes, armor, insignia. Four advisor roles plus six government types |
| Emblem parts | 48 x 48 | Separate layers | Shapes, borders, symbols, 8 to 12 of each. The game assembles emblems |

## 8. Made by the code

Menus and layouts, the bitmap font, interface icons at 24 x 24, galaxy map icons at 16 x 16, effects, particles, backgrounds, and the starfield. A CC0 pixel font stands in until a final one is chosen.

## 9. First samples to send

One of each, so recoloring, cleanup, and lighting can be tested before the rest is drawn:

1. The master palette swatch strip.
2. One corvette at 48 x 48, three angles, with engine and hardpoint markers.
3. One planet surface strip at 512 x 256.

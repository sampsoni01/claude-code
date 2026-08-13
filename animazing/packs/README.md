# Content packs

A **content pack** is one file containing custom heroes, ability cards, relics, enemies — and their uploaded images (embedded as data URLs). Packs are how Studio creations stop being browser-local and become *part of the game*.

## The lifecycle

1. **Create** in the Studio (heroes, cards, relics, enemies + PNG uploads). Everything lives in browser storage and is playable immediately.
2. **Export** from *Studio → Packs & Export*:
   - `.animazing-pack.json` — portable backup / sharing format. Anyone can import it via the same panel.
   - `.pack.js` — the same data wrapped as a script that registers itself on load.
3. **Make it permanent** — commit the `.js` pack here:

   ```
   packs/
   ├── index.js                  ← registry bootstrap (already wired into index.html)
   └── my-cast.pack.js           ← your exported pack
   ```

   then add one line to `index.html`, right below the `packs/index.js` tag:

   ```html
   <script src="packs/my-cast.pack.js"></script>
   ```

   Every player now gets that content built in — no imports, no browser storage involved.

## Merge rules

The content registry layers sources in order, later overriding earlier **by id**:

1. built-in starter samples
2. file packs (in `index.html` script order)
3. the local player's own Studio content

So a pack can *replace* a starter entity by reusing its id, and a player's local edits always win on their machine. Pack images are seeded into the media store at boot.

## Pack format (v1)

```jsonc
{
  "format": "animazing-pack",
  "version": 1,
  "name": "My Cast",
  "author": "you",
  "characters": [ /* see docs/DESIGN.md for schemas */ ],
  "cards": [],
  "items": [],
  "enemies": [],
  "images": { "img-…": "data:image/png;base64,…" }
}
```

Imports are validated entity-by-entity; invalid entries are skipped and reported, valid ones still land.

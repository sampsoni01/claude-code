# Starshine

A galactic conquest strategy game for phones. Working title.

- `docs/BUILD_BRIEF.md` is the source of truth for design decisions.
- `docs/ART_SPEC.md` holds the screen resolution and every sprite size.
- `data/galactic-conquest-bible.xlsx` is the content source: names, events, tech, commanders, art and audio lists.

## Test builds

Each test build is a rough page opened on the phone. They live under `testbuilds/`.

| Build | What it checks |
|---|---|
| tb02-galaxy | Generated galaxy as grey boxes: spacing, lanes, size |

## Working on it

```
npm install
npm run dev          # local preview
npm run typecheck
npm test
npm run build
npm run artifact tb02-galaxy   # single-file page in artifact/ for publishing
```

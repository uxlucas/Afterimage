# Launch video: script

About 42 seconds, square (1080 × 1080), no voice. A cursor drives the real viewer while one short line of copy explains each step. The example is the Northwind sign-in card, which has three saved versions.

The viewer needs to come across as two things. First, what it does: it wraps your prototype, keeps every saved version and shows what changed. Second, why that matters: you share one link and people can follow the work without a walkthrough.

| # | Time | On screen | Copy |
|---|------|-----------|------|
| 1 | 0–3s | v3 (Passkeys), resting. | **Every version of your prototype.** One link to all of them. |
| 2 | 3–10s | Click Highlight. Boxes draw over the card. Step through changes 1 to 3; the card for each says what it was and what it is now. | **See exactly what changed.** |
| 3 | 10–16s | Hover the timeline so the tip shows "v2 · Email first", click it, then click v1. | **Go back to any version.** |
| 4 | 16–28s | Go to latest, then Compare. Set Before to v1 and drag the wipe across the card. | **Compare any two.** |
| 5 | 28–34s | Switch to Side by side, zoom to 100%, step to the first change. | **Side by side, in sync.** |
| 6 | 34–39s | Open the panel and click Copy link. | **Share one link.** No walkthrough needed. |
| 7 | 39–42s | End card. | **Afterimage.** Version history for prototypes. |

The name on the end card comes from `END_TITLE` in `film.js`.

## How it's made

`record.mjs` serves the built Northwind example (`examples/northwind/.afterimage/site`) and this folder from one local origin. The viewer is at `/afterimage/`. It opens `stage.html` in headless Chrome at 960 × 960 CSS px with a device scale of 1.125, so the frames come out at 1080 px. The stage puts the copy in a band at the top and the viewer in a window below it, so captions never cover the UI. `film.js` draws the captions, the cursor and the end card.

Every action is a real click or drag, so the result shows how the viewer actually behaves. The script records Chrome's screencast frames, turns them into a constant 60 fps stream and encodes it as H.264.

```bash
cd launch/video
npm install
npm run afterimage:build --prefix ../../examples/northwind   # only if the example's site is stale
npm run record                  # writes out/afterimage.mp4
npm run record -- --stills      # one PNG per shot instead of a video, for layout checks
```

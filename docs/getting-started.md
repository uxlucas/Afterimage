# Getting started

This page takes a prototype from no history to a deployed one. Every command runs from the project root. To have a coding agent do the setup for you, paste the setup prompt from [agents.md](agents.md) instead.

## 1. Install

Afterimage needs Node 22 or later. A plain HTML folder with no `package.json` needs one first:

```bash
npm init -y
```

Then install Afterimage as a dev dependency:

```bash
npm install -D afterimage-cli
```

## 2. Set up the project

```bash
npx afterimage init
```

`init` looks at the project to find the prototype:

| Project | Saved folder | Build |
| --- | --- | --- |
| A folder with `index.html` at the top | the project root | none |
| One subfolder with an `index.html` | that folder | none |
| Vite | `dist` | `npm run build` |
| Next.js with `output: 'export'` | `out` | `npm run build` |
| Astro | `dist` | `npm run build` |
| SvelteKit with `@sveltejs/adapter-static` | the adapter's `pages` folder, `build` by default | `npm run build` |

For anything else, it asks which folder holds the prototype, or which folder your build writes to. Outside a terminal, or with `--no-input`, it stops and says how to name the folder instead. You can always name it yourself, with the command that builds it when there is one:

```bash
npx afterimage init --source public
npx afterimage init --source dist --build "npm run build"
```

A project that needs a server to render its pages has nothing static to save. For Next.js without `output: 'export'`, SvelteKit without `@sveltejs/adapter-static`, and Astro with an adapter but without `output: 'static'`, init stops and says what to change.

Then it writes these files and lists each one it created or changed:

- `afterimage.config.json`: where the prototype is and how it is built.
- `package.json`: the scripts `afterimage:save`, `afterimage:dev` and `afterimage:build`.
- `.gitattributes`: `afterimage/** -text`, so git never changes a saved version's line endings.
- `.gitignore`: `.afterimage/` (the built site) and `node_modules/`.
- `vercel.json` and `netlify.toml`: the host config. [deploying.md](deploying.md) explains each setting.

Nothing is written until every step has worked, so a mistake leaves the project as it was. Running init again is safe: it only adds what is missing, and never overwrites a setting of yours without asking first. Read the notes it prints after the list of files; they are things only you can decide.

## 3. Save a version

```bash
npx afterimage save "First version"
```

A save runs the build first, when the config has one, and stores the result as the next version: `afterimage/versions/v1/`, listed in `afterimage/versions.json`. Add notes with `--note`, as many as you like:

```bash
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days." --note "Checkbox is on by default."
```

If nothing changed since the last version, nothing is saved and it says so. A saved version is never edited afterwards: each one is fingerprinted, and every later save, dev and build checks the fingerprints first.

## 4. Open the history

```bash
npx afterimage dev
```

It prints `Afterimage is running at http://localhost:4321/afterimage/`. The port moves to the next free one when 4321 is busy, so open the address it prints. It keeps running until you stop it with Ctrl-C, and picks up each new save on its own.

`dev` serves the saved versions only. Keep running your app the way you do now, with its own dev server or by opening the folder in a browser.

## 5. Use the viewer

The viewer opens on the latest version, with a pill at the bottom of the page.

- `[` and `]` step to the previous and next version. `G` jumps to a version by number, and `L` goes back to the latest.
- `H` highlights what changed since the version before. `J` and `K` step through the changes one at a time.
- Hold `B` to see the previous version in place.
- `C` compares two versions. Drag the divider in Wipe, or put them next to each other in Side by side.
- `V` opens the panel with every version, its notes, and the list of changes.
- `.` hides Afterimage, `Esc` closes whatever is on top, and `?` lists every shortcut.

The address bar follows what you look at, so a link opens the same view. This one compares v4 with v2 and highlights the changes:

```text
http://localhost:4321/afterimage/?version=v4&mode=compare&base=v2&hl=1
```

[matching.md](matching.md) explains how the viewer decides what changed.

## 6. Commit the history

Commit `afterimage/` and `afterimage.config.json` with the project. The history is plain files in your project, so git is what keeps it: a fresh checkout can't get back a version that isn't committed. Don't add `afterimage/` to `.gitignore`, and don't edit, move or delete anything inside `afterimage/versions/`.

## 7. Deploy

```bash
npx afterimage build
```

This writes `.afterimage/site/` with your app at the root and the history at `/afterimage/`. On Vercel and Netlify, commit `vercel.json` or `netlify.toml` too and push: the host runs the same build. See [deploying.md](deploying.md).

Every saved version deploys with the site, so save only what you'd show. [limits.md](limits.md) lists what else to know before you share the link.

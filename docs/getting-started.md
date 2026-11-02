# Getting started

This page takes a prototype from no history to a deployed one. Every command runs from the project root. To have a coding agent do the setup for you, paste the setup prompt from [agents.md](agents.md) instead.

## 1. Set up the project

Afterimage needs Node 22 or later. One command installs it and sets the project up:

```bash
npx afterimage-cli init
```

npx asks once to fetch the package. `init` then installs it in the project as a dev dependency, with the package manager your lockfile names (npm when there is none), so `npx afterimage` and `npm run dev` run it from then on. A plain HTML folder with no `package.json` gets one.

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
- `package.json`: the scripts `afterimage:save`, `afterimage:dev` and `afterimage:build`, and a `dev` script that starts Afterimage beside your app.
- Your pages: the pill, one line in each plain HTML page or in a Vite app's `index.html`. For Next.js, Astro and SvelteKit init prints the one import to add.
- `.gitattributes`: `afterimage/** -text`, so git never changes a saved version's line endings.
- `.gitignore`: `.afterimage/` (the built site), `afterimage/.afterimage-*` (a save's lock and work folders) and `node_modules/`.
- `vercel.json` and `netlify.toml`: the host config. [deploying.md](deploying.md) explains each setting.

Nothing is written until every step has worked, so a mistake leaves the project as it was. Running init again is safe: it only adds what is missing, and never overwrites a setting of yours without asking first. Read the notes it prints after the list of files; they are things only you can decide.

## 2. Save a version

```bash
npx afterimage save "First version"
```

A save runs the build first, when the config has one, and stores the result as the next version: `afterimage/versions/v1/`, listed in `afterimage/versions.json`. It keeps every file in the folder, whatever its type, except source maps and hidden files; [commands.md](commands.md#what-a-save-keeps) has the rules. Add notes with `--note`, as many as you like:

```bash
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days." --note "Checkbox is on by default."
```

If nothing changed since the last version, nothing is saved and it says so. A saved version is never edited afterwards: each one is fingerprinted, and every later save, dev and build checks the fingerprints first.

## 3. Run the prototype with the pill

```bash
npm run dev
```

Your app starts as it always does, with Afterimage beside it, and the pill sits at the bottom of the page: the same bar the viewer has. Highlight outlines what changed since the version before, on the page you are on; Compare shows the two side by side; Version N of N lists every version. Turn it off again, or press Esc, and you are back on the live page. Save keeps the current state as the next version, the same as `afterimage save`. A plain HTML folder is served by Afterimage itself, at the address after `Your prototype is at`.

It keeps running until you stop it with Ctrl-C. It also prints `Afterimage is running at http://localhost:4321/afterimage/`, where the history opens on its own page. The port moves to the next free one when 4321 is busy. If your `dev` script doesn't start with `afterimage dev`, run your own dev command through it instead: `npx afterimage dev -- next dev`.

## 4. Use the viewer

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

## 5. Commit the history

Commit `afterimage/`, `afterimage.config.json`, `package.json` and your lockfile, `.gitattributes`, and `vercel.json` or `netlify.toml` with the project. The history is plain files in your project, so git is what keeps it: a fresh checkout can't get back a version that isn't committed. `.gitattributes` keeps git from changing a saved version's line endings, so a version cloned onto another machine still matches its fingerprint. Don't add `afterimage/` to `.gitignore`, and don't edit, move or delete anything inside `afterimage/versions/`.

## 6. Deploy

```bash
npx afterimage build
```

This writes `.afterimage/site/` with your app at the root and the history at `/afterimage/`. On Vercel and Netlify, push what you committed: the host runs the same build. See [deploying.md](deploying.md).

Every saved version deploys with the site, so save only what you'd show. [limits.md](limits.md) lists what else to know before you share the link.

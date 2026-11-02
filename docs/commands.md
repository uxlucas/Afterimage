# Commands

Run every command from the project root, where `afterimage.config.json` is. With Afterimage installed in the project, `npx afterimage` runs it, and so do the package scripts `npm run afterimage:save`, `npm run afterimage:dev` and `npm run afterimage:build` that init adds. Through a package script, the name and every flag go after `--`, as in `npm run afterimage:save -- "Name" --note "..."`, or npm takes the flags as its own and drops them.

```text
afterimage init [--source <folder>] [--build "<command>"] [--agent claude|cursor] [--no-input]
afterimage save "Name" [--note "..."]
afterimage dev [--port N] [-- <your dev command>]
afterimage build
```

`npx afterimage --help` lists them. `npx afterimage help <command>` and `--help` after a command print the same help for one command, with its flags. `-h` is the same as `--help`.

## init

```bash
npx afterimage init [--source <folder>] [--build "<command>"] [--agent claude|cursor] [--no-input]
```

Sets up Afterimage in the project: config, scripts, the pill, git rules and host config.

| Flag | What it does |
| --- | --- |
| `--source <folder>` | The folder that holds the prototype, or that your build writes to. It must be inside the project. |
| `--build "<command>"` | The command that builds the prototype, when there is one. Without a build, the folder must already exist. |
| `--agent claude` | Also copies Afterimage's skill to `.claude/skills/afterimage/`, for Claude Code. |
| `--agent cursor` | Also copies the same instructions as a rule to `.cursor/rules/afterimage.mdc`, for Cursor. |
| `--no-input` | Asks nothing, even in a terminal. Where init would have asked, it stops with a message or prints what is left for you to do. |

Without `--source`, init detects the prototype; [getting-started.md](getting-started.md#1-set-up-the-project) has the table. When it can't, it asks in a terminal, and otherwise stops with `Say where the prototype is: afterimage init --source <folder>`. A project with no static build to save stops, even in a terminal, with a message that says `no static build` and what to change: Next.js without `output: 'export'`, Astro with an adapter (or `output: 'server'`) but without `output: 'static'`, and SvelteKit without `@sveltejs/adapter-static`. With `--source`, init takes the folder you name instead.

It writes:

| File | What init does to it |
| --- | --- |
| `afterimage.config.json` | Creates it. With `--source` or `--build` on a later run, updates those two fields. |
| `package.json` | Adds the scripts `afterimage:save`, `afterimage:dev` and `afterimage:build` where they are missing, keeping the file's own indent and line endings. Makes the `dev` script start Afterimage beside your app: `vite` becomes `afterimage dev -- vite`, and a plain HTML folder with no `dev` script gets `afterimage dev`. Creates a private `package.json` when there is none. |
| Your pages | Adds the pill. A plain HTML page gets `<script src="/afterimage/overlay.js" defer></script>` before `</body>`, and a Vite app's `index.html` gets `<script type="module">import 'afterimage-cli/overlay';</script>`. For Next.js, Astro and SvelteKit it prints the one import to add, in a note that starts with `Add the Afterimage pill to your app`. A page that already loads the pill is left alone. |
| `.gitattributes` | Adds `afterimage/** -text`. |
| `.gitignore` | Adds `.afterimage/`, `afterimage/.afterimage-*` (a save's lock and work folders) and `node_modules/`. |
| `vercel.json` | Creates it, or adds what is missing. Asks before it changes a value that is already set. See [deploying.md](deploying.md#vercel). |
| `netlify.toml` | Creates it. An existing one is never edited: init prints the lines to add. See [deploying.md](deploying.md#netlify). |
| The agent's copy | Only with `--agent`. Asks before it replaces a copy you have changed. |

Every step is worked out before anything is written, so a bad input or a cancelled question leaves the project as it was. Running init again only adds what is missing; when everything is in place it says `Everything is already set up. Nothing changed.` The notes it prints after the list of files are for you: a setting it left alone, or a line to add by hand.

## save

```bash
npx afterimage save "Name" [--note "..."]
```

Builds the prototype and saves it as the next version.

| Flag | What it does |
| --- | --- |
| `--note "..."` | A note on the version. Repeat it for more than one. |

- The name goes in quotes, up to 120 characters. Each note is up to 500 characters.
- When the config has a build command, save runs it first. If the build fails, nothing is saved.
- The version goes to `afterimage/versions/vN/`, and `afterimage/versions.json` lists it first. On success it prints `Saved v4 "Remember me".`, then what the version adds and the history's total, such as `v4 adds 340 KB. History: 4 versions, 1.2 MB.` Once the total passes 100 MB it adds a line saying so ([limits.md](limits.md#history-size)).
- If the prototype is the same as the latest version, it prints `Nothing changed since v3 "Passkeys". Nothing was saved.` and exits 0.
- It checks every saved version against its fingerprint first, and stops if one was edited.
- One save runs at a time. While a save runs it holds `.afterimage-save.lock` in the history folder, and a second save stops with `Another save is active.` rather than waiting. A save that fails removes the lock itself. A save that was killed (Ctrl-C, a timeout) leaves the lock and a work folder behind, and the next save clears both once that process has ended. If `Another save is active.` still shows when no save is running, delete `afterimage/.afterimage-save.lock`.
- If the prototype changes while it is being saved, the save stops and saves nothing. Run it again once editing stops.

### What a save keeps

A save copies the prototype folder with these rules:

- `index.html` must be at its top.
- Every other file is kept, whatever its type, including files with no extension such as `_redirects` and `_headers`.
- Source maps (`.map`), hidden files and folders (names starting with `.`) and operating-system clutter (`.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`) are skipped.
- Anything listed in `exclude` in the config is left out.
- A symbolic link stops the save. Remove it, or add it to `exclude`.
- When the prototype is the project root, the project's own files stay out: `node_modules`, `afterimage`, `.afterimage`, `package.json`, `afterimage.config.json`, `vercel.json`, `netlify.toml`, the lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`), and a top-level README, LICENSE, CHANGELOG, CONTRIBUTING, CLAUDE, AGENTS or GEMINI file, bare or ending in `.md`, `.markdown`, `.txt` or `.rst`.

Each saved HTML page gets one tag added at the start of its `<head>`, `<script src="/afterimage/frame.js" data-afterimage-version="v4">`, which lets a built app load inside the viewer. A page is the version's top `index.html`, and any other `.html` file with a doctype, an `<html>` or a `<head>`. An HTML fragment without any of them, such as a partial the prototype fetches and inserts, is saved as it is. Nothing else in the files changes.

## dev

```bash
npx afterimage dev [--port N] [-- <your dev command>]
```

Runs your app's dev server with Afterimage beside it, so the pill on the prototype can save versions and show them. `npm run dev` does this once init has set the `dev` script.

| Flag | What it does |
| --- | --- |
| `--port N` | The port Afterimage starts from, 1 to 65535. The default is 4321. |
| `-- <your dev command>` | Your app's own dev command, such as `vite` or `next dev`. Afterimage runs it, and stops when it stops. |

- It prints `Afterimage is running at http://localhost:4321/afterimage/`, the history's own address. When the port is taken it tries the next one, up to 20 ports, and prints the one it got. The pill finds it on its own.
- With no dev command and no build, as for a plain HTML folder, it serves the prototype too and prints `Your prototype is at http://localhost:4321/`.
- The pill's Save runs the same save as `afterimage save`, with your build first. Only pages served from this machine can ask it to save.
- It only listens on this machine (127.0.0.1).
- When a save finishes it rebuilds what it serves and prints `Updated: N versions.` If that fails it prints `Could not update the history` and keeps serving the last good copy.
- It starts with no saved versions too, and the pill then offers to save the first one.
- It runs until you stop it with Ctrl-C, or until your dev command ends.

## build

```bash
npx afterimage build
```

Builds the prototype and writes the deployable site with the history at `/afterimage/`. It takes no flags besides `--help`.

- It checks every saved version against its fingerprint, then runs the build command when the config has one.
- It writes `.afterimage/site/`: the prototype at the root, and under `afterimage/` the viewer, `versions.json`, every saved version and the frame runtime (`sw.js` and `frame.js`).
- The root is your app's output exactly as its own build makes it, source maps, hidden files such as `.well-known/` and host files such as `_redirects` included. Only `exclude`, a `.git` or `node_modules` folder and operating-system clutter are left out. A symbolic link in the output stops the build: replace it with the file it points to, or add it to `exclude`.
- When the prototype is the project root (a plain folder), the project's own files stay out as they do for a save. When it is the project root or any folder with no build command, its hidden files and folders (`.env`, `.gitignore`, `.vscode/`) stay out too, except `.well-known/`.
- It stops if the app has its own top-level `afterimage` file or folder, since the history is served there.
- The previous site stays in place until the new one is complete, so a failed build leaves it as it was.
- With no saved versions it stops with `Save a first version with: afterimage save "Name"`.
- On success it prints `Built .afterimage/site with 2 versions. The history is at /afterimage/.` and a line that links to the host requirements in [deploying.md](deploying.md#other-static-hosts): the site has to be served from the root of a domain.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Done, including a save that found nothing to save. |
| `1` | It failed, with a message that says why. |
| `2` | The command was used wrongly: an unknown command or flag, a missing name, a bad port. The usage line follows. |
| `130` | You pressed Ctrl-C at one of init's questions. Nothing was changed. |

## The config file

`init` writes `afterimage.config.json`. You can edit it by hand.

```json
{
  "source": "dist",
  "build": "npm run build",
  "history": "afterimage",
  "out": ".afterimage/site",
  "exclude": [],
  "type": "vite"
}
```

| Field | Meaning |
| --- | --- |
| `source` | The folder that is saved, relative to the project. `.` is the project root. |
| `build` | The command that writes `source`, run through your shell like an npm script, or `null`. |
| `history` | The folder that holds the saved versions. Commit it. |
| `out` | Where `build` writes the site. Keep it git-ignored. |
| `exclude` | Paths inside `source` to leave out, as files or folders. |
| `type` | What init detected, for reference. |

Every path must stay inside the project. The host config runs `npm run afterimage:build` and serves `.afterimage/site`, so change `out` only if you change the host config to match.

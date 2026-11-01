---
name: afterimage
description: Saves, names, compares and deploys versions of this prototype in its Afterimage history (afterimage-cli). Use when the user asks to save or name a version of the prototype, add a note to one, see what changed between versions, open the version history, or get the history ready to deploy. Not for git commits, branches or package versions.
---

# Afterimage

Afterimage keeps a version history of this prototype. Each save builds the prototype and stores the built page as the next version (v1, v2, v3 and so on) in `afterimage/`. The viewer shows any saved version, and what changed between two of them. A version is the built page, kept to compare against and to share. It is not a backup of the source: the source belongs in git. Run every command from the project root, where `afterimage.config.json` is.

## Commands

### Save a version

```bash
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."
```

- It runs the prototype's build first when `afterimage.config.json` has one, then saves the result.
- The name goes in quotes, up to 120 characters. `--note` is optional and can be repeated, one note each, up to 500 characters.
- Keep names and notes to plain text. A `"`, `$` or backtick inside them breaks the shell's quoting, so leave those out or escape them for the shell you are in.
- On success it prints `Saved v4 "Remember me".` Tell the user the id it printed.
- `Nothing changed since v3 "Passkeys". Nothing was saved.` means the prototype is the same as the last saved version. Tell the user and stop there.

### Open the history

```bash
npx afterimage dev
```

- It keeps running until it is stopped. Start it as a background process, not a command you wait for.
- It prints `Afterimage is running at http://localhost:4321/afterimage/`. The port starts at 4321 and moves to the next free one when 4321 is busy, so give the user the URL it printed.
- If dev is already running from earlier, use the URL it printed then. When a save finishes, it rebuilds the history it serves and prints `Updated: N versions.` If that rebuild fails, it prints `Could not update the history` and keeps serving the last good copy.
- It serves the saved versions only. The app keeps running on its own dev server.
- It checks the history when it starts. With no saved versions it stops with `Save a first version with: afterimage save "Name"`.

### Build the deployable site

```bash
npx afterimage build
```

- It runs the prototype's build, then writes `.afterimage/site/`: the app at the root and the history at `/afterimage/`. That folder is git-ignored.
- With no saved versions it stops with `Save a first version with: afterimage save "Name"`.
- The host runs the same build when it deploys: `vercel.json` and `netlify.toml` run `npm run afterimage:build` and serve `.afterimage/site`.

### Set up

```bash
npx afterimage init --agent claude --no-input
```

- It writes `afterimage.config.json`, the `afterimage:save`, `afterimage:dev` and `afterimage:build` scripts in `package.json`, lines in `.gitattributes` and `.gitignore`, `vercel.json` and `netlify.toml`. Running it again is safe.
- `--agent claude` copies these instructions as a Claude Code skill to `.claude/skills/afterimage/`. `--agent cursor` copies them as a Cursor rule to `.cursor/rules/afterimage.mdc`. Pass the one for the agent you are.
- `--no-input` makes sure it never waits on a question. Where it would have asked, it stops with a message or prints a note instead.
- If its message contains `no static build`, the project has no static build to save: Next.js without `output: 'export'`, Astro with an adapter but without `output: 'static'`, or SvelteKit without `@sveltejs/adapter-static`. Tell the user what has to change, and stop. Don't pass `--source` to get around it. Once the user has made the change, run init again.
- Otherwise, if it stops with `Say where the prototype is`, it can't tell which folder holds the prototype. Ask the user which folder it is. Never guess. Then run init again with the same flags plus `--source <folder>`, and add `--build "<command>"` when a build command writes that folder.
- Anything it prints after the list of files, such as a note about an existing `vercel.json`, is for the user. Pass it on.

## Links into the viewer

Add these to the URL dev printed:

- `?version=v3` opens one version.
- `?version=v4&mode=compare&base=v2` compares v4 with the older v2.
- `&hl=1` highlights what changed.

With dev on its default port, a comparison is `http://localhost:4321/afterimage/?version=v4&mode=compare&base=v2`.

`afterimage/versions.json` lists the versions newest first, so the first `id` in it is the latest. An id that isn't in the history opens the latest version instead, so check an id is listed before you link to it.

## What people ask, and what to run

- **"Save a version called Remember me with a note that it keeps people signed in for 30 days."** Run `npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."` and tell the user the id it printed.
- **"What changed since v2?"** Read `afterimage/versions.json`. If v2 is the latest version, tell the user nothing has changed since v2, because it is the newest version, and don't open a comparison. If v2 isn't listed, say so. Otherwise make sure dev is running and give the user the URL dev printed with `?version=<latest>&mode=compare&base=v2` added. The viewer shows the changes, so don't write a text diff. It compares saved versions: if the prototype has changed since the last save, say that those changes aren't in the comparison.
- **"Get the version history ready to deploy."** Run `npx afterimage build`. If the project isn't a git repository, tell the user the history has to be committed to the repository the site deploys from, and stop. Otherwise run `git status --short -- afterimage afterimage.config.json package.json package-lock.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb .gitattributes vercel.json netlify.toml` and tell the user which of those aren't committed yet, since the host only sees what is in git. The rest of the project is the user's business. Tell them the site is in `.afterimage/site/` and the history will be at `/afterimage/` on the deployed site. Don't commit, push or deploy unless the user asks.
- **"Show me the version history."** Start dev and give the user the URL it printed.

## Rules

- **Never edit, move or delete anything in `afterimage/versions/`.** Every version is fingerprinted when it is saved. Once a saved version's files change, save and build stop and dev won't start. If one of them says a version has changed since it was saved, tell the user. Restoring it from git is their call.
- **Commit `afterimage/` with the project, and never add it to `.gitignore`.** The saved versions live only there, and a fresh checkout can't recover a version that isn't in git.
- **Save before risky changes.** Before a large or hard-to-undo change to the prototype, offer to save the current state first, so there is a version to compare the change against.
- **Only save what you'd publish.** Every saved version is deployed with the history, so never save secrets, private data or a broken state. A save keeps every file in the prototype folder, whatever its type, and leaves out only source maps, hidden files (names starting with `.`) and the paths in the config's `exclude`.
- **An unchanged prototype saves nothing.** `Nothing was saved` is the answer, not an error. Don't retry it.
- **One save at a time.** Don't start a save while another is running, and don't edit the prototype during one. A save that finds another one running stops with `Another save is active`. Wait for the first to finish. A save that was killed is cleared by the next save once its process has ended, so if the message stays while no save is running, tell the user, who can delete `afterimage/.afterimage-save.lock`.

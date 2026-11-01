---
name: afterimage
description: Saves, names, compares and deploys versions of this prototype with Afterimage (afterimage-cli). Use when the user asks to save or name a version, add a note to one, see what changed between versions, open the version history, or get the history ready to deploy.
---

# Afterimage

Afterimage keeps a version history of this prototype. Each save builds the prototype and stores the result as the next version (v1, v2, v3 and so on) in `afterimage/`. The viewer shows any saved version, and what changed between two of them. Run every command from the project root, where `afterimage.config.json` is.

## Commands

### Save a version

```bash
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."
```

- It runs the prototype's build first when `afterimage.config.json` has one, then saves the result.
- The name goes in quotes, up to 120 characters. `--note` is optional and can be repeated, one note each, up to 500 characters.
- On success it prints `Saved v4 "Remember me".` Tell the user the id it printed.
- `Nothing changed since v3 "Passkeys". Nothing was saved.` means the prototype is the same as the last saved version. Tell the user and stop there.

### Open the history

```bash
npx afterimage dev
```

- It keeps running until it is stopped. Start it as a background process, not a command you wait for.
- It prints `Afterimage is running at http://localhost:4321/afterimage/`. The port starts at 4321 and moves to the next free one when 4321 is busy, so give the user the URL it printed.
- If dev is already running from earlier, use the URL it printed then. It picks up new saves by itself and prints `Updated: N versions.`
- It serves the saved versions only. The app keeps running on its own dev server.
- With no saved versions it stops and says to save one first.

### Build the deployable site

```bash
npx afterimage build
```

- It runs the prototype's build, then writes `.afterimage/site/`: the app at the root and the history at `/afterimage/`. That folder is git-ignored.
- The host runs the same build when it deploys: `vercel.json` and `netlify.toml` run `npm run afterimage:build` and serve `.afterimage/site`.

### Set up

```bash
npx afterimage init
```

- It writes `afterimage.config.json`, the `afterimage:save`, `afterimage:dev` and `afterimage:build` scripts in `package.json`, lines in `.gitattributes` and `.gitignore`, `vercel.json` and `netlify.toml`. Running it again is safe.
- If it stops because it can't tell which folder holds the prototype, ask the user which folder it is. Never guess. Then run `npx afterimage init --source <folder>`, and add `--build "<command>"` when a build command writes that folder.
- Anything it prints after the list of files, such as a note about an existing `vercel.json`, is for the user. Pass it on.

## Links into the viewer

Add these to the URL dev printed:

- `?version=v3` opens one version.
- `?version=v4&mode=compare&base=v2` compares v4 with the older v2.
- `&hl=1` highlights what changed.

With dev on its default port, a comparison is `http://localhost:4321/afterimage/?version=v4&mode=compare&base=v2`.

`afterimage/versions.json` lists the versions newest first, so the first `id` in it is the latest. An id that isn't in the history opens the latest version instead.

## What people ask, and what to run

- **"Save a version called Remember me with a note that it keeps people signed in for 30 days."** Run `npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."` and tell the user the id it printed.
- **"What changed since v2?"** Make sure dev is running, read the latest id from `afterimage/versions.json`, and give the user the URL dev printed with `?version=<latest>&mode=compare&base=v2` added. The viewer shows the changes, so don't write a text diff. It compares saved versions: if the prototype has changed since the last save, say that those changes aren't in the comparison.
- **"Get the version history ready to deploy."** Run `npx afterimage build`. Then run `git status --short -- afterimage afterimage.config.json package.json .gitattributes vercel.json netlify.toml` and tell the user which of those files aren't committed yet, since the host only sees what is in git. Tell them the site is in `.afterimage/site/` and the history will be at `/afterimage/` on the deployed site. Don't commit, push or deploy unless the user asks.
- **"Show me the version history."** Start dev and give the user the URL it printed.

## Rules

- **Never edit, move or delete anything in `afterimage/versions/`.** Every version is fingerprinted when it is saved, and save, dev and build stop once a saved version's files change. If one of them says a version has changed since it was saved, tell the user. Restoring it from git is their call.
- **Commit `afterimage/` with the project, and never add it to `.gitignore`.** The saved versions live only there, and a fresh checkout can't recover a version that isn't in git.
- **Save before risky changes.** Before a large or hard-to-undo change to the prototype, offer to save the current state first, so the user can compare against it and go back to it.
- **Only save what you'd publish.** Every saved version is deployed with the history, so never save secrets, private data or a broken state.
- **An unchanged prototype saves nothing.** `Nothing was saved` is the answer, not an error. Don't retry it.
- **One save at a time.** Don't start a save while another is running, and don't edit the prototype during one. A save that finds another one running stops with `Another save is active`. Wait for the first to finish. If no save is running, one crashed: tell the user, who can delete `afterimage/.afterimage-save.lock`.

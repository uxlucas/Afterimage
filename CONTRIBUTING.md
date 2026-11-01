# Contributing

Thanks for helping. This page covers setting up a checkout, running the tests, how the examples are made, and what to watch for on Windows.

## Setup

You need Node 22 or later, and Google Chrome for the end-to-end tests.

```bash
git clone https://github.com/uxlucas/Afterimage.git
cd Afterimage
npm install
npm run build:viewer
```

`build:viewer` builds the viewer from `src/viewer/` into `viewer-dist/`, which is git-ignored. The CLI copies it into every site it builds, so `afterimage dev` and `afterimage build` stop with `The viewer is not built. Run "npm run build:viewer" first.` until it exists. Run it again after you change the viewer. `npm pack` runs it on its own, through `prepack`.

## Layout

- `bin/afterimage.mjs`: the command.
- `src/cli/`: the commands (`init`, `save`, `dev`, `build`) and what they share: config, detection, the history store, assembling the site.
- `src/engine/`: finding what changed between two versions. [docs/matching.md](docs/matching.md) explains it.
- `src/runtime/`: the frame runtime, `sw.js` and `frame.js`, which let a built app load inside a version. The comment at the top of `sw.js` explains the approach and lists every known limit.
- `src/viewer/`: the viewer, a React app.
- `agents/`: the skill and the Cursor rule that `init --agent` copies.
- `docs/`: the user docs.
- `examples/`: one project per supported kind of prototype, each with its saved history.
- `tests/`: unit tests, and end-to-end tests in `tests/e2e/`.

## Tests

```bash
npm test
```

The unit tests, with `node:test`. They need no browser and take well under a minute. They include checks that the docs and agent files only name commands and flags the CLI has, that their links point at files in the repo, and that the Northwind example's fingerprints haven't changed.

```bash
npm run test:e2e
```

The end-to-end tests. Before they run, `pretest:e2e` builds the viewer and runs `npm run install:examples`, which installs each example's own dependencies. Each test then builds an example with its own scripts, serves the result from a local static server, and drives the real viewer in Chrome through `playwright-core`, which uses the Chrome installed on your machine. They run one at a time and take a few minutes.

`install:examples` skips an example that already has a `node_modules` folder. After you change an example's dependencies, delete its `node_modules` and run it again.

Judge a run by its exit code, not by filtered output: a run that prints passing tests can still have a failing one.

## Examples

Each example in `examples/` is a real project with its own `package.json`. It depends on `afterimage-cli` through `file:../..`, so it runs this checkout's CLI and viewer.

- **Histories come from the real CLI.** Every version in `examples/*/afterimage/` was saved with `afterimage save`. Never edit, add or remove a file there by hand: each version is fingerprinted, and an edited one fails the tests and every save and build after it.
- **Northwind's history is fixed.** Its three versions are older than the frame runtime and have no frame tag. They are kept byte for byte, and a test checks their fingerprints.
- **To change an example's history,** change the example's source and save a new version with the CLI, from the example's folder: `npx afterimage save "Name"`. The end-to-end tests expect a particular change between each example's two newest versions, set in the `checks` table in `tests/e2e/examples.test.mjs`, so update that with it.
- **To add an example,** make the project, run `npx afterimage init` in it, save at least two versions with the CLI, and add it to `tests/e2e/examples.test.mjs`.

## Dependencies

Every dependency is pinned to an exact version, with no `^` or `~`, in the root `package.json` and in every example's. The examples' lockfiles are git-ignored, because they embed this package's own dependency list and would change with every edit to it. Exact pins are what keep an example's install the same from one machine to the next without them.

## Line endings on Windows

Saved history is byte-exact. A version's fingerprint is a SHA-256 over the bytes of its files, so if git turns LF into CRLF in a saved file on checkout, that version no longer matches and Afterimage refuses to save or build. With `core.autocrlf` on, which is common on Windows, git would do exactly that. `.gitattributes` prevents it:

- `examples/*/afterimage/** -text`: git treats every file in the examples' histories as binary and never converts its line endings. The framework examples also carry `afterimage/** -text` in their own `.gitattributes`: it is the line `init` writes into a user's project, for the same reason.
- `bin/* text eol=lf`: the command's `#!/usr/bin/env node` line must end in LF, or it fails on macOS and Linux. This keeps a package packed on Windows working there.
- `agents/** text eol=lf`: the skill and the Cursor rule ship with the same bytes from every platform.

If a fingerprint test fails right after a checkout on Windows, run `git check-attr -a` on one of the version's files to see whether the rule applied. Fix the checkout's line endings rather than saving the version again.

## Checking the viewer by hand

The end-to-end tests cover loading, highlights and compare. They don't cover how the viewer looks and feels. After a change to the viewer, run `npx afterimage dev` in an example and check these. For a long history, copy an example to a folder outside the repo and save more versions there; don't add them to the example itself.

At a desktop width, around 1440 by 900:

- On the first version, Highlight and Compare are disabled.
- The pill never shows a version's name. A long name truncates with an ellipsis in the version list.
- The version list's search narrows the list, and a term that matches nothing shows `No version matches “…”`.
- `G`, then a number outside the history and Enter, shows `Pick 1 to N` and keeps the current version. `Esc` puts the number back.
- A version with no visible changes shows `No visible changes`, draws no outlines, and `J` does nothing.
- Compare opens in Wipe with the divider in the middle and Before and After labels in the bottom corners. In Side by side, with Scroll synced on, scrolling one page moves the other to the same place; with it off, they scroll apart.
- `?version=v1&mode=compare&base=v2` opens the pair the right way round, as `version=v2&base=v1`. `?version=v1&mode=compare` falls back to exploring, since v1 has nothing before it.
- Keys typed into a text field or an editable element inside the prototype reach that field and trigger no shortcut.
- With the help sheet and the panel open in Compare, `Esc` closes the help sheet, then the panel, then leaves Compare.

With reduced motion (in Chrome DevTools, Rendering, emulate `prefers-reduced-motion: reduce`), the panel, the scroll to a change and the versions folder all arrive in their final state at once.

At a phone width, 375 by 812:

- No state scrolls sideways.
- The panel opens as a bottom sheet. Picking a change closes the sheet and scrolls the change into view, clear of the pill. Picking a version keeps the sheet open.
- Compare is Wipe only, and a `layout=side` link opens Wipe too. Stepping to a change on the hidden side moves the divider past it.

These checks run in Chromium. Safari and Firefox, and touch gestures such as dragging the divider or the sheet, need a check of their own.

## The agent files

`agents/skill/SKILL.md` is the source of the agent instructions. The Cursor rule, `agents/cursor/afterimage.mdc`, carries its body word for word, and `docs/agents.md` lists its rules. `tests/agents.test.mjs` checks that all three agree, and that every command and flag they name exists. Edit the skill first, then copy its body into the rule.

## Before you open a pull request

- `npm test` and `npm run test:e2e` both exit 0.
- New behaviour has a test.
- The docs say what the code does. If you change a command, flag or message, update `docs/commands.md`, and `docs/agents.md` and the skill if they quote it.
- An entry in `CHANGELOG.md` for anything a user would notice.

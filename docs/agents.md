# Agents

Afterimage works from a coding agent such as Claude Code or Cursor. Paste the setup prompt once, and from then on you can ask the agent to save, compare and deploy versions in plain words.

## Setup prompt

Open your agent in your prototype's project and paste this:

```text
Set up Afterimage, a version history for this prototype, in the project root. If the project has no package.json, run `npm init -y` first. Install Afterimage with `npm install --save-dev afterimage-cli`, then run `npx afterimage init`. If init stops because it can't tell which folder holds the prototype, ask me which folder it is (never guess), then run `npx afterimage init --source <folder>`, adding `--build "<command>"` if a build command writes that folder. If init or any later command stops with a different error, show me the message and stop. Show me any notes init prints after the list of files it changed. Add the Afterimage skill: in Claude Code, copy the folder `node_modules/afterimage-cli/agents/skill` to `.claude/skills/afterimage`, so that `.claude/skills/afterimage/SKILL.md` exists; in Cursor, copy `node_modules/afterimage-cli/agents/cursor/afterimage.mdc` to `.cursor/rules/afterimage.mdc`. Read `node_modules/afterimage-cli/agents/skill/SKILL.md` now and follow its rules from here on. Unless `afterimage/versions.json` already lists a version, save the current state with `npx afterimage save "First version"`. Then start `npx afterimage dev` as a background process, because it keeps running until it is stopped, wait for the line that starts with `Afterimage is running at`, and give me the exact URL on that line. The port is not always 4321.
```

When it finishes, the first version is saved and the viewer is open at the URL the agent gives you.

## Example prompts

### Save a version

```text
Save a version called Remember me with a note that it keeps people signed in for 30 days.
```

The agent runs:

```bash
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."
```

and tells you the version it saved, such as `v4`. If nothing changed since the last version, nothing is saved and the agent says so.

### Compare two versions

```text
What changed since v2?
```

The agent makes sure `npx afterimage dev` is running and gives you a link to the viewer comparing the latest version with v2. With v4 as the latest, on the default port, that is:

```text
http://localhost:4321/afterimage/?version=v4&mode=compare&base=v2
```

The port is the one dev printed, so it can differ. Add `&hl=1` to the link to highlight what changed. The viewer compares saved versions, so changes you haven't saved yet aren't in it.

### Deploy the history

```text
Get the version history ready to deploy.
```

The agent runs:

```bash
npx afterimage build
```

then checks that `afterimage/`, `afterimage.config.json`, `package.json`, `.gitattributes` and `vercel.json` or `netlify.toml` are committed, and tells you which aren't. The site is in `.afterimage/site/`, with your app at the root and the history at `/afterimage/`. Vercel and Netlify run the same build from the files init wrote. The agent doesn't commit, push or deploy unless you ask it to.

## Manual setup

The same steps without an agent, from your project's root.

**1. Install.** A plain HTML folder with no `package.json` needs one first:

```bash
npm init -y
```

Then install Afterimage as a dev dependency:

```bash
npm install --save-dev afterimage-cli
```

**2. Set up the project.** This writes `afterimage.config.json`, three scripts in `package.json`, lines in `.gitattributes` and `.gitignore`, `vercel.json` and `netlify.toml`:

```bash
npx afterimage init
```

When init can't tell which folder holds your prototype, it asks. You can also name the folder yourself, with the build command if a build writes it:

```bash
npx afterimage init --source dist --build "npm run build"
```

**3. Save a first version.**

```bash
npx afterimage save "First version"
```

**4. Open the history.** dev keeps running until you stop it with Ctrl-C. Open the URL it prints. The port starts at 4321 and moves when that one is busy.

```bash
npx afterimage dev
```

**5. Add the skill to your agent.** The package ships the commands and rules for agents, so a request like "save a version called Remember me" works. For Claude Code, copy the skill folder:

```bash
mkdir -p .claude/skills/afterimage
```

```bash
cp -R node_modules/afterimage-cli/agents/skill/. .claude/skills/afterimage/
```

For Cursor, copy the rule:

```bash
mkdir -p .cursor/rules
```

```bash
cp node_modules/afterimage-cli/agents/cursor/afterimage.mdc .cursor/rules/
```

Cursor also loads skills from `.claude/skills/` when it starts, so a project set up for Claude Code works there after a restart. Copy the files again after you update afterimage-cli.

The skill's rules, in short: never edit `afterimage/versions/`, since every version is fingerprinted. Commit `afterimage/`, since a fresh checkout can't recover a version that isn't in git. Save before risky changes, so there is a version to go back to. Only save what you'd publish, since every saved version is deployed.

# Agents

Afterimage works from a coding agent such as Claude Code or Cursor. Paste the setup prompt once. The agent installs Afterimage, puts the pill on your prototype and starts it. From then on you save and look back from the pill itself, and you can still ask the agent to save, compare and deploy versions in plain words.

## Setup prompt

Open your agent in your prototype's project and paste this:

```text
Add Afterimage so I can track this prototype's versions. Work in the project root. If the project has no package.json, run `npm init -y` first. Install Afterimage with `npm install --save-dev afterimage-cli`. Then run `npx afterimage init --agent claude --no-input` if you are Claude Code, or `npx afterimage init --agent cursor --no-input` if you are Cursor; any other agent runs `npx afterimage init --no-input` and adds the body of `node_modules/afterimage-cli/agents/skill/SKILL.md`, everything after its frontmatter, to this project's AGENTS.md. If init's message contains `no static build` (Next.js without `output: 'export'`, Astro with an adapter but without `output: 'static'`, or SvelteKit without `@sveltejs/adapter-static`), tell me what has to change and stop, without passing `--source`; once I tell you I've made the change, run this setup again from the init step. Otherwise, if init stops with `Say where the prototype is`, ask me which folder holds the prototype (never guess), then run the same init command again with `--source <folder>` added, plus `--build "<command>"` if a build command writes that folder. If init or any later command stops with a different error, show me the message and stop. If init prints a note that starts with `Add the Afterimage pill to your app`, make that change yourself; show me any other notes it prints after the list of files it changed. Read `node_modules/afterimage-cli/agents/skill/SKILL.md` now and follow it for the rest of this session. Unless `afterimage/versions.json` already lists a version, save the current state with `npx afterimage save "First version"`. Then start `npm run dev` as a background process (stop any dev server you started for this project earlier, since this one replaces it), because it keeps running until it is stopped, and wait for the line that starts with `Afterimage is running at`. Last, in two lines at most, give me the address my prototype is running at and tell me the pill at its bottom saves versions and shows them all; never give me a command to run.
```

When it finishes, the first version is saved and your prototype is running with the pill on it. The pill is the same bar the viewer has. Highlight outlines what changed since the version before, on the page you are on; Compare shows the two side by side; Version N of N lists every version. Turn it off again, or press Esc, and you are back on the live page. Save keeps the current state as the next version. Once you deploy, the same pill on the live site shows everyone the versions, without Save.

## Example prompts

### Save a version

```text
Save a version called Remember me with a note that it keeps people signed in for 30 days.
```

The agent runs:

```bash
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."
```

and tells you the version it saved, such as `v4`. If nothing changed since the last version, nothing is saved and the agent says so. The pill's Save button does the same without asking anyone.

### Compare two versions

```text
What changed since v2?
```

The agent makes sure `npm run dev` is running and gives you a link to the viewer comparing the latest version with v2. With v4 as the latest, on the default port, that is:

```text
http://localhost:4321/afterimage/?version=v4&mode=compare&base=v2
```

The port is the one dev printed, so it can differ. Add `&hl=1` to the link to highlight what changed. The viewer compares saved versions, so changes you haven't saved yet aren't in it. If v2 is the latest version, nothing has changed since it, and the agent says so instead of opening a comparison.

### Deploy the history

```text
Get the version history ready to deploy.
```

The agent runs:

```bash
npx afterimage build
```

then checks that `afterimage/`, `afterimage.config.json`, `package.json` and the lockfile, `.gitattributes`, and `vercel.json` or `netlify.toml` are committed, since the host only sees what is in git, and tells you which aren't. The site is in `.afterimage/site/`, with your app at the root and the history at `/afterimage/`. Vercel and Netlify run the same build from the files init wrote. The agent doesn't commit, push or deploy unless you ask it to.

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

**2. Set up the project.** This writes `afterimage.config.json`, Afterimage's scripts in `package.json` and a `dev` script that starts Afterimage beside your app, the pill's line in your pages, lines in `.gitattributes` and `.gitignore`, `vercel.json` and `netlify.toml`. For Next.js, Astro and SvelteKit it prints the one line to add the pill yourself:

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

**4. Run the prototype.** Your app starts with Afterimage beside it, and the pill sits at the bottom of the page. It keeps running until you stop it with Ctrl-C. A plain HTML folder is served at the address it prints after `Your prototype is at`.

```bash
npm run dev
```

If your `dev` script doesn't start with `afterimage dev`, run your own dev command through it: `npx afterimage dev -- next dev`.

**5. Add the skill to your agent.** The package ships the commands and rules for agents, so a request like "save a version called Remember me" works. For Claude Code, this copies the skill to `.claude/skills/afterimage/`:

```bash
npx afterimage init --agent claude
```

For Cursor, this copies the same instructions as a rule to `.cursor/rules/afterimage.mdc`:

```bash
npx afterimage init --agent cursor
```

Pick one. Cursor also loads skills from `.claude/skills/` when it starts, so a project used with both agents only needs the skill, and one with both copies would load the instructions twice. Claude Code loads a new skill in a new session, or after `/reload-skills`. Run the same command again after you update afterimage-cli: init asks before it replaces a copy you have changed.

The skill's rules:

- Never edit, move or delete anything in `afterimage/versions/`. Every version is fingerprinted when it is saved.
- Commit `afterimage/` with the project, and never add it to `.gitignore`. A fresh checkout can't recover a version that isn't in git.
- Save before risky changes. A version is the built page, kept to compare against and to share; the source belongs in git.
- Only save what you'd publish. Every saved version is deployed with the history.
- An unchanged prototype saves nothing.
- One save at a time.

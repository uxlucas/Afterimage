# Afterimage

A version history for prototypes, deployed with the prototype itself.

Afterimage keeps every version of your prototype you save and serves them all from one link, at `/afterimage/` on the site you already deploy. Step through the versions, see what changed between them, and compare any two. Share the link, and anyone can see how the prototype got here without a walkthrough.

[Getting started](docs/getting-started.md) · [Commands](docs/commands.md) · [Deploying](docs/deploying.md) · [Agents](docs/agents.md) · [Matching](docs/matching.md) · [Limits](docs/limits.md)

## Install

Afterimage needs Node 22 or later. From your prototype's project root:

```bash
npm install -D afterimage-cli
npx afterimage init
```

A plain HTML folder with no `package.json` needs `npm init -y` first.

`init` works out what your prototype is: a plain HTML folder, a Vite app, a Next.js static export, an Astro site, or SvelteKit with `@sveltejs/adapter-static`. It writes `afterimage.config.json`, three scripts in `package.json`, lines in `.gitattributes` and `.gitignore`, and host config for Vercel and Netlify, then lists every file it changed. When it can't tell which folder holds the prototype, it asks. You can also tell it:

```bash
npx afterimage init --source dist --build "npm run build"
```

## Setup prompt

Working with Claude Code, Cursor or another coding agent? Paste the setup prompt from [docs/agents.md](docs/agents.md) instead. It installs Afterimage and runs `init` with `--agent claude` or `--agent cursor`, which copies Afterimage's instructions into the project, where your agent reads them. It also passes `--no-input`, so init never waits on a question. Then it saves a first version and gives you the viewer's link. After that, "save a version called Remember me" works in plain words.

## Usage

Save a version whenever the prototype is worth keeping:

```bash
npx afterimage save "First version"
npx afterimage save "Remember me" --note "Keeps people signed in for 30 days."
```

A save runs your build first when the prototype has one, then stores the result as the next version: v1, v2, v3. If nothing changed since the last version, nothing is saved.

Open the history while you work:

```bash
npx afterimage dev
```

It prints the viewer's address, `http://localhost:4321/afterimage/` unless that port is busy. Your app keeps running on its own dev server. In the viewer, `[` and `]` step through versions, `H` highlights what changed, `C` compares two versions, and `?` lists every shortcut.

Commit `afterimage/` with the rest of the project, along with `afterimage.config.json`, `package.json` and your lockfile, `.gitattributes`, and `vercel.json` or `netlify.toml`. `afterimage/` holds every saved version, and a fresh checkout can't get back a version that isn't in git. `.gitattributes` stops git from changing a saved version's line endings, which would break its fingerprint on another machine.

## Deploying

```bash
npx afterimage build
```

This writes `.afterimage/site/`: your app at the root, as its own build makes it, and the history at `/afterimage/`. Serve it from the root of a domain, on any static host that meets [the requirements](docs/deploying.md#other-static-hosts).

On Vercel and Netlify you don't run it yourself. The `vercel.json` and `netlify.toml` that `init` wrote tell the host to run the same build, so a push deploys both. Every preview deployment carries the live prototype and the versions saved on its branch. [docs/deploying.md](docs/deploying.md) covers each host, other static hosts and what init changes for them.

## Limits

- Static output only. Apps that render pages on a server aren't supported: Next.js without `output: 'export'`, Astro with an adapter but without `output: 'static'`, SvelteKit without `@sveltejs/adapter-static`.
- The site has to be served from the root of its domain, since the history is always at `/afterimage/`. A site under a sub-path, such as a GitHub Pages project site, doesn't work.
- Versions load through a service worker, so the history needs https, or localhost while you work. Without one, plain HTML with relative paths still shows, but a built app inside the viewer can show up unstyled or on its own not-found page.
- Every saved version is public. Each one deploys with your site, and there is no command to take one back, so save only what you'd show.
- A version keeps every file of the prototype except source maps and hidden files (names starting with `.`). The live app at the root keeps every file its build wrote.
- An old version's code runs on your live site's address, so it can read and change the cookies and storage your live app uses.
- A few ways of leaving a page inside a version open the live app instead, such as reloading the frame from the browser's menu or a link that opens a new tab.
- The viewer has been tested in Chrome only so far. Firefox and Safari haven't been tested yet.

[docs/limits.md](docs/limits.md) has the full list.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and how the examples are made.

## License

MIT. See [LICENSE](LICENSE).

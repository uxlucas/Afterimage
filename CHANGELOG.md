# Changelog

## 0.2.0

- **The pill.** Afterimage now sits on the prototype itself. Save keeps the current state as the next version, and History opens every version over the page, in the same tab; Esc or the close button returns to the prototype. On a deployed site the same pill shows everyone the versions, without Save. It draws in a shadow root, so the app's CSS can't reach it, and it stays out of saved versions.
- **`init` adds the pill and wires `npm run dev`.** A plain HTML page gets one script tag, and a Vite app's `index.html` one import. For Next.js, Astro and SvelteKit it prints the one import to add. The `dev` script now starts Afterimage beside the app (`vite` becomes `afterimage dev -- vite`), and a plain HTML folder gets a `dev` script that serves it. Run `npx afterimage init` again on a project set up with 0.1.
- **`afterimage dev -- <your dev command>`** runs the app's own dev server with Afterimage beside it and stops when it stops. With no dev command, a plain HTML prototype is served at `/`. dev now starts before the first save, answers the pill's save on this machine only, and keeps its served copy outside the project, so a dev server watching the project can't stop it updating after a save on Windows.
- **The viewer closes itself when it is opened in the pill's layer**: Esc with nothing else open returns to the prototype.
- **The agent instructions** cover "add Afterimage so I can track my versions" from start to finish, and tell the agent to answer in a line instead of handing back commands.

## 0.1.1

- **`init` keeps Next.js's long cache on the live app.** For a project that depends on `next`, `vercel.json` gets a header rule and a new `netlify.toml` a `[[headers]]` block that serve `/_next/static/` with `public, max-age=31536000, immutable`. The host settings Afterimage needs for Next.js turn off each host's own Next.js handling, which set that header, and real deploys of 0.1.0 showed those files served with `max-age=0`. Run `npx afterimage init` again to add it to a project set up with 0.1.0; for an existing `netlify.toml` it prints the lines to add.
- **`afterimage dev` passes over a port Windows refuses.** Windows reserves port ranges for Hyper-V, WSL and Docker and refuses them with a permission error, which stopped `dev` instead of moving it to the next port, as a taken port does.

## 0.1.0

The first release.

- **`afterimage init`** detects a plain HTML folder, Vite, Next.js with `output: 'export'`, Astro, and SvelteKit with `@sveltejs/adapter-static`. It writes `afterimage.config.json`, the `afterimage:save`, `afterimage:dev` and `afterimage:build` scripts, the `.gitattributes` and `.gitignore` lines, and host config for Vercel and Netlify. It stops and says what to change for a Next.js, Astro or SvelteKit project that has no static build, asks for the prototype's folder when it can't tell, takes `--source` and `--build`, copies the agent instructions with `--agent claude|cursor`, and never asks with `--no-input`.
- **`afterimage save "Name" [--note "..."]`** builds the prototype and saves it as the next version, fingerprinted and byte for byte as built, plus the one script tag a save adds to each HTML page. An unchanged prototype saves nothing. One save runs at a time, and a failed save leaves the history as it was. It prints what each version adds and the history's total, and says so once the history passes 100 MB.
- **`afterimage dev [--port N]`** serves the viewer over the saved history on localhost and picks up each new save.
- **`afterimage build`** writes one static site with the app at the root and the history at `/afterimage/`, after checking every saved version against its fingerprint.
- **The viewer** steps through versions, highlights what changed, and compares any two in Wipe or Side by side, on desktop and phone. Every view has its own link.
- **A frame runtime** that lets built apps load inside a version, with their own files and routes, while the live app at the root loads as its own build makes it.
- **Generated names** from Svelte, Astro, Vite CSS modules, Next.js CSS modules built with Turbopack and React 19.3 `useId` are ignored when matching, so two builds of an unchanged page show no changes. Names from Emotion, Vue, the Svelte 4 hydration marker and React 18 and 19.1 `useId` are recognised by their shape, not yet checked against a real build. `data-afterimage-id` pins a match by hand.
- **Agent support:** a setup prompt and example prompts in `docs/agents.md`, a skill for Claude Code, and the same instructions as a Cursor rule.
- **Examples:** Northwind (plain HTML), Vite with React, Next.js static export, Astro and SvelteKit, each with a saved history.

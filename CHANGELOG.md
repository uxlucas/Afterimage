# Changelog

## 0.2.3

- **Scroll sync covers panels.** In an app that scrolls a panel instead of the page, Scroll synced in side by side, the wipe and holding B only moved the page, which never scrolls, so the two versions drifted apart. Now each panel follows the same panel in the other version, even when the page around it changed between versions.
- **Switching version crossfades in place.** The frame used to go dark, then blank, then draw the next version, and it jumped back to the top. Now the next version loads out of sight, lines up with where you were scrolled, page and panels, and fades in over the old one.
- **Wipe and side by side glide into each other.** Each half of the wipe slides into its own column and back, without frames covering each other or going blank on the way. The change check that used to start mid-glide and freeze it now waits until the frames land.
- **The pill hands over smoothly both ways.** Highlight and Compare now start on screen, after the viewer has taken the page's place, so the outlines fade in and the wipe sweeps in from the edge. Turning them off plays out before the page comes back, on the same route and scroll, panels included. The page's pill and the viewer's blend in place instead of swapping.
- **The pill changes shape instead of jumping.** Entering or leaving Compare, its segments glide to their new width and their content fades in.

## 0.2.2

- **Apps that scroll a panel instead of the page.** Many app shells keep the page still and scroll the content inside it. There, outlines stayed where they were drawn while the content scrolled away under them, and stepping to a change scrolled nothing. Now outlines follow their elements as the panel scrolls and stop at its edges, and stepping scrolls each panel that holds the change, so it lands in the middle. Outlines also no longer make a page like that scroll on its own.
- **Scrolling a panel is never a change.** Positions are recorded as if every panel were scrolled to the top, so two versions scrolled differently still match.

## 0.2.1

- **The pill is the viewer's own bar.** It sits at the bottom of the page and reads Version N of N, Highlight, Compare and Save. Each one opens the viewer straight in that state, on the page and scroll you are on, so Highlight looks like the outlines switching on in place. There is no History step and no close button: turn Highlight off, leave Compare or close the list (or press Esc) and you are back on the live page, on the route you left the viewer on.
- **No flash when it opens.** Pointing at the pill loads the viewer out of sight, and it only shows once it is on the right page. Before, a dark layer covered the page while the viewer loaded.
- **Hash-routed apps compare page with page.** In an app that changes page by its hash (`#/orders`), the older version now follows to the same page. Before, it stayed on the first page, and the two different pages counted as a thousand changes. Change counts are kept per page.
- **Moves caused by an edit are not changes of their own.** When a version has real edits, the elements that only moved or resized because of them (the cells beside a column that got wider, the rows under one that got taller) are no longer outlined or counted. A version whose only difference is a move still shows it. Counts the version list cached under the old rule are worked out again.

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

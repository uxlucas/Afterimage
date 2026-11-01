# Changelog

## 0.1.1

- **`init` keeps Next.js's long cache on the live app.** For a project that depends on `next`, `vercel.json` gets a header rule and a new `netlify.toml` a `[[headers]]` block that serve `/_next/static/` with `public, max-age=31536000, immutable`. The host settings Afterimage needs for Next.js turn off each host's own Next.js handling, which set that header, and real deploys of 0.1.0 showed those files served with `max-age=0`. Run `npx afterimage init` again to add it to a project set up with 0.1.0; for an existing `netlify.toml` it prints the lines to add.

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

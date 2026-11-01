import fs from 'node:fs/promises';
import path from 'node:path';

const found = (type, source, build, reason) => ({ type, source, build, reason });
const unknown = reason => found('unknown', null, null, reason);

async function readText(file) {
  try {
    // A byte order mark (common from Windows editors) would make a valid package.json fail JSON.parse.
    return (await fs.readFile(file, 'utf8')).replace(/^﻿/, '');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Framework configs are code, so they are only searched as text and never run.
async function readFirst(projectDir, names) {
  for (const name of names) {
    const text = await readText(path.join(projectDir, name));
    if (text !== null) return text;
  }
  return null;
}

// wrapped: the folder has a package.json that only holds afterimage-cli (see detectProject).
async function detectPlain(projectDir, wrapped = false) {
  const entries = await fs.readdir(projectDir, { withFileTypes: true });
  if (entries.some(entry => entry.isFile() && entry.name === 'index.html')) {
    return found('plain', '.', null, 'Found index.html at the top of this folder; it is the prototype.');
  }
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (await readText(path.join(projectDir, entry.name, 'index.html')) !== null) folders.push(entry.name);
  }
  if (folders.length === 1) return found('plain', folders[0], null, `Found index.html in ${folders[0]}/; it is the prototype.`);
  if (folders.length > 1) return unknown(`Found index.html in ${folders.length} folders (${folders.join(', ')}), so there is no single prototype folder.`);
  return unknown(wrapped ? 'Found a package.json with no framework and no build, and no index.html here.' : 'Found no package.json and no index.html here.');
}

// Astro's own server adapters, named in the message when the project depends on one.
const astroAdapters = ['@astrojs/vercel', '@astrojs/node', '@astrojs/netlify', '@astrojs/cloudflare'];

export async function detectProject(projectDir) {
  const packageText = await readText(path.join(projectDir, 'package.json'));
  if (packageText === null) return detectPlain(projectDir);

  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    return unknown('package.json is not valid JSON, so the framework could not be read.');
  }
  const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies };
  const has = name => name in dependencies;

  if (has('next')) {
    const config = await readFirst(projectDir, ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts']);
    if (config !== null && /\boutput\s*:\s*['"`]export['"`]/.test(config)) {
      return found('next-static', 'out', 'npm run build', "Found next with output: 'export'; it builds to out/.");
    }
    return found('next-server', null, null, "Found next without output: 'export' in next.config, so it needs a server and has no static build to save.");
  }
  if (has('@sveltejs/kit')) {
    // Every other adapter (adapter-auto, -node, -vercel, -netlify) builds for a server, so there is nothing to save.
    if (!has('@sveltejs/adapter-static')) {
      return found('sveltekit-server', null, null, 'Found SvelteKit without @sveltejs/adapter-static, so it has no static build to save.');
    }
    const config = await readFirst(projectDir, ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.cjs', 'svelte.config.ts']);
    const pages = config?.match(/\bpages\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? 'build';
    return found('sveltekit-static', pages, 'npm run build', `Found SvelteKit with adapter-static; it builds to ${pages}/.`);
  }
  if (has('astro')) {
    // An adapter (@astrojs/vercel, -node, -netlify, -cloudflare, or any other in the config) builds for a server: unless
    // the config says output: 'static', there is no dist/ of plain pages to save. With output: 'static' the pages are in
    // dist/ and can be saved. That is all it settles for @astrojs/vercel: it still writes .vercel/output on every build,
    // which Vercel deploys in place of the Afterimage site (init says so).
    const config = (await readFirst(projectDir, ['astro.config.mjs', 'astro.config.js', 'astro.config.cjs', 'astro.config.ts', 'astro.config.mts'])) ?? '';
    const named = astroAdapters.find(has);
    const inConfig = /\badapter\s*:/.test(config);
    const serverOutput = /\boutput\s*:\s*['"`]server['"`]/.test(config);
    if ((named || inConfig || serverOutput) && !/\boutput\s*:\s*['"`]static['"`]/.test(config)) {
      const reason = named ? `Found astro with ${named}, a server adapter, without output: 'static' in the astro config`
        : inConfig ? "Found an adapter in the astro config, which builds for a server, without output: 'static'"
          : "Found astro with output: 'server' in the astro config";
      return found('astro-server', null, null, `${reason}, so it has no static build to save.`);
    }
    return found('astro', 'dist', 'npm run build', 'Found astro in package.json; it builds to dist/.');
  }
  if (has('vite')) return found('vite', 'dist', 'npm run build', 'Found vite in package.json; it builds to dist/.');
  // A plain HTML folder gets a package.json from the setup prompt (npm init -y, then the install). One that holds
  // nothing but afterimage-cli and has no build is still that folder, so it is read the way a folder without one is.
  if (Object.keys(dependencies).every(name => name === 'afterimage-cli') && !manifest?.scripts?.build) return detectPlain(projectDir, true);
  return unknown('Found a package.json, but no framework Afterimage recognises (vite, next, astro or SvelteKit).');
}

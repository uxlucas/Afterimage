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

async function detectPlain(projectDir) {
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
  return unknown('Found no package.json and no index.html here.');
}

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
    if (!has('@sveltejs/adapter-static')) {
      return unknown('Found SvelteKit without @sveltejs/adapter-static, so it has no static build to save.');
    }
    const config = await readFirst(projectDir, ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.cjs', 'svelte.config.ts']);
    const pages = config?.match(/\bpages\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? 'build';
    return found('sveltekit-static', pages, 'npm run build', `Found SvelteKit with adapter-static; it builds to ${pages}/.`);
  }
  if (has('astro')) {
    // @astrojs/vercel is a server adapter: its build is Vercel's own output (.vercel/output), not a dist/ of plain files.
    // Only a config that says output: 'static' puts it back to static files.
    if (has('@astrojs/vercel')) {
      const config = await readFirst(projectDir, ['astro.config.mjs', 'astro.config.js', 'astro.config.cjs', 'astro.config.ts', 'astro.config.mts']);
      if (config === null || !/\boutput\s*:\s*['"`]static['"`]/.test(config)) {
        return found('astro-server', null, null, "Found astro with @astrojs/vercel, a server adapter, without output: 'static' in the astro config, so it has no static build to save.");
      }
    }
    return found('astro', 'dist', 'npm run build', 'Found astro in package.json; it builds to dist/.');
  }
  if (has('vite')) return found('vite', 'dist', 'npm run build', 'Found vite in package.json; it builds to dist/.');
  return unknown('Found a package.json, but no framework Afterimage recognises (vite, next, astro or SvelteKit).');
}

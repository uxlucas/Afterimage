// The host config for Vercel and Netlify. init plans it with its other steps: a plan only reads and asks, and returns
// { change, notes, apply }.
import path from 'node:path';
import { parseJson, readJsonText, readText, writer } from './project-files.js';

// What a host runs to deploy the history. It goes through the package script so the local bin resolves on any host.
const hostBuild = 'npm run afterimage:build';
const hostOutput = '.afterimage/site';

// Clean URLs for the live app at the root, on Vercel: /about is answered from about.html (Next's and SvelteKit's static
// exports write that and link to /about). Vercel only does so by default for a framework it builds itself (Next.js, until
// framework: null, below), and not for a plain folder. cleanUrls: true would give the same, site-wide, and
// redirect /afterimage/versions/vN/index.html to a path that is no longer inside the version folder, which the frame
// runtime and the viewer cannot follow. A rewrite is not a redirect, only applies where no file has the path (Vercel
// checks the filesystem first), and this one leaves /afterimage/ out altogether. tests/e2e/harness.mjs reads it.
export const cleanUrlRewrite = { source: '/:path((?!afterimage/|afterimage$).+)', destination: '/:path*.html' };

// What vercel.json needs for the history to deploy, and for the live app to stay as it is.
//
// Next.js: "framework": null ("Other") makes Vercel serve the output folder as plain files. With Next.js detected, Vercel's
// own builder takes over: @vercel/next finds .next/export-detail.json after the build and serves the export's folder (out/),
// not outputDirectory, so /afterimage/ would not deploy. Vercel detects the framework from package.json, so this is keyed
// on a dependency on next and not on the type init chose. It costs the live app the builder's _next/static caching and its
// .html stripping, which the rewrite below brings back for the stripping. Other presets (Vite, Astro, SvelteKit) run in
// @vercel/static-build, which uses outputDirectory ahead of the preset's own folder, and null would cost them their cache
// headers or SPA fallback, so they are left as they are.
// Source: https://github.com/vercel/vercel/blob/main/packages/next/src/index.ts
const hostSettings = (next) => (next ? { framework: null, buildCommand: hostBuild, outputDirectory: hostOutput } : { buildCommand: hostBuild, outputDirectory: hostOutput });

// /afterimage without its slash is answered by Vercel with the viewer's page and a 200, and the viewer's relative assets
// then load from the root. The redirect adds the slash. Vercel's redirect source matches that path exactly, so /afterimage/
// is not caught and nothing loops.
export const slashRedirect = { source: '/afterimage', destination: '/afterimage/' };

// A rule counts as ours when it points at <path>.html and keeps /afterimage out, however the rest is spelled.
const isCleanUrlRewrite = rule => typeof rule?.destination === 'string' && /^\/:\w+\*?\.html$/.test(rule.destination) && typeof rule.source === 'string' && rule.source.includes('afterimage');
const fromAfterimage = rule => typeof rule?.source === 'string' && rule.source.trim().replace(/\/+$/, '') === slashRedirect.source;
// Ours is a redirect from /afterimage to /afterimage/. One from there to anywhere else is the project's, and shadows the history.
const isSlashRedirect = rule => fromAfterimage(rule) && typeof rule.destination === 'string' && rule.destination.trim() === slashRedirect.destination;

const cleanUrlsNote = 'vercel.json has "cleanUrls": true. It also redirects the history\'s own pages (/afterimage/versions/vN/index.html), so the history will not open. Remove it: Afterimage\'s rewrite gives the live app clean URLs without touching /afterimage/.';
// @astrojs/vercel writes Vercel's own .vercel/output on every build, whatever the output mode (astro:build:done, no check
// of the environment): https://github.com/withastro/astro/blob/main/packages/integrations/vercel/src/index.ts. After a
// build Vercel's static builder deploys that folder in place of outputDirectory, so /afterimage/ would not be there. Not
// tried on a real deploy; the files are the project's, so init only says so.
const astroVercelNote = 'package.json depends on @astrojs/vercel. The adapter writes its own .vercel/output on every build, and Vercel deploys that folder instead of the Afterimage site, so /afterimage/ will not be there. A static site does not need the adapter: remove @astrojs/vercel (and its adapter line in the astro config) to deploy the history on Vercel.';
const trailingSlashNote = value => `vercel.json has "trailingSlash": ${value}. It redirects paths under /afterimage/ ${value ? 'to a trailing slash, so a version\'s pages are never asked for the way the worker expects' : 'away from the trailing slash, so the viewer\'s relative files load from the wrong folder'}, and the history will not open. Remove it. Afterimage left the rest of vercel.json as it was.`;

// Whether a list in vercel.json (rewrites, redirects) needs our entry added after the project's own, which keep their order.
// → { add } or { note } when the value is not a list, or neither when the entry is already there.
function planList(settings, key, entry, isPresent, purpose) {
  const list = settings[key];
  if (list === undefined) return { add: [entry] };
  if (!Array.isArray(list)) return { note: `vercel.json "${key}" is not a list, so Afterimage left it alone. Add this to it ${purpose}:\n${JSON.stringify(entry, null, 2)}` };
  return list.some(isPresent) ? {} : { add: [...list, entry] };
}

// What init asks before it switches the settings vercel.json already has (differs) to Afterimage's. One yes switches
// every key, so a question about only one would hide the other change.
function switchQuestion(settings, differs) {
  if (differs.includes('framework')) {
    const found = [
      settings.buildCommand != null && settings.buildCommand !== hostBuild && `builds with ${settings.buildCommand}`,
      settings.outputDirectory != null && settings.outputDirectory !== hostOutput && `serves ${settings.outputDirectory}`,
      `uses the ${settings.framework} framework preset, which can serve its own build instead of the history`
    ].filter(Boolean);
    return `vercel.json ${found.join(', ')}. Switch to Afterimage's settings? (y/N)`;
  }
  if (differs.length === 2) return `vercel.json builds with ${settings.buildCommand} and serves ${settings.outputDirectory}. Switch both to Afterimage's? (y/N)`;
  if (differs[0] === 'buildCommand') return `vercel.json already builds with ${settings.buildCommand}. Switch it to Afterimage's build? (y/N)`;
  return `vercel.json already serves ${settings.outputDirectory}. Switch it to Afterimage's output? (y/N)`;
}

export async function planVercel(cwd, { isTTY, ask }) {
  const file = path.join(cwd, 'vercel.json');
  const { bom, body: before } = await readJsonText(file);
  const settings = before === null ? {} : parseJson(before, 'vercel.json');
  const wanted = hostSettings(await usesNext(cwd));
  const notes = [];
  if (await dependsOn(cwd, '@astrojs/vercel')) notes.push(astroVercelNote);

  // null means "use the default" in vercel.json, so it is as free as a missing key. For framework it is the wanted
  // value itself ("Other"), so only a framework that is named differs.
  const differs = ['buildCommand', 'outputDirectory'].filter(key => settings[key] != null && settings[key] !== wanted[key]);
  if (Object.hasOwn(wanted, 'framework') && typeof settings.framework === 'string') differs.push('framework');
  const set = Object.keys(wanted).filter(key => (key === 'framework' ? !Object.hasOwn(settings, key) : settings[key] == null));

  // cleanUrls and trailingSlash redirect paths under /afterimage/ site-wide. They are the person's, so they stay and are
  // called out. A trailingSlash also makes both entries below pointless (or, set to false, loop with the redirect).
  const lists = {};
  if (settings.cleanUrls === true) notes.push(cleanUrlsNote);
  if (typeof settings.trailingSlash === 'boolean') {
    notes.push(trailingSlashNote(settings.trailingSlash));
  } else {
    if (settings.cleanUrls !== true) lists.rewrites = planList(settings, 'rewrites', cleanUrlRewrite, isCleanUrlRewrite, 'for clean URLs on the live app');
    const shadowing = Array.isArray(settings.redirects) && settings.redirects.find(rule => fromAfterimage(rule) && !isSlashRedirect(rule));
    if (shadowing) {
      // A second redirect from the same path would never run, so none is added.
      notes.push(`vercel.json redirects ${shadowing.source} to ${shadowing.destination}, which shadows the history: the viewer cannot open there. Afterimage left it alone. Remove it, or point it at ${slashRedirect.destination}.`);
    } else {
      lists.redirects = planList(settings, 'redirects', slashRedirect, isSlashRedirect, 'so /afterimage opens the viewer');
    }
  }
  const added = {};
  for (const [key, plan] of Object.entries(lists)) {
    if (plan.note) notes.push(plan.note);
    if (plan.add) {
      added[key] = plan.add;
      set.push(key);
    }
  }
  if (!differs.length && !set.length) return { change: null, notes, apply: null };

  if (differs.length) {
    const agreed = isTTY && /^y(es)?$/i.test((await ask(switchQuestion(settings, differs))).trim());
    if (!agreed) {
      // Values to set, and entries to add to lists the project may already have: pasting must never replace its own rules.
      const lines = [`Left vercel.json as it is. To deploy the history with Afterimage, set:\n${JSON.stringify(wanted, null, 2).slice(2, -2)}`];
      for (const [key, entry] of [['rewrites', cleanUrlRewrite], ['redirects', slashRedirect]]) {
        if (key in added) lines.push(`and add this to "${key}", keeping the rules already there:\n${JSON.stringify(entry, null, 2)}`);
      }
      return { change: null, notes: [lines.join('\n'), ...notes], apply: null };
    }
    set.unshift(...differs.filter(key => !set.includes(key)));
  }
  const order = [...Object.keys(wanted), 'rewrites', 'redirects'];
  const text = JSON.stringify({ ...settings, ...wanted, ...added }, null, 2);
  return {
    change: before === null ? 'Created vercel.json' : `Updated vercel.json (set ${order.filter(key => set.includes(key)).join(', ')})`,
    notes,
    apply: writer(file, `${bom}${text}\n`)
  };
}

// Whether the project depends on Next.js, however init was told where its prototype is. Netlify and Vercel detect the
// framework from package.json, not from what Afterimage decided.
export async function dependsOn(cwd, name) {
  const { body } = await readJsonText(path.join(cwd, 'package.json'));
  try {
    const manifest = JSON.parse(body ?? '{}');
    return name in { ...manifest?.dependencies, ...manifest?.devDependencies };
  } catch {
    return false;
  }
}

const usesNext = cwd => dependsOn(cwd, 'next');

// Netlify's Next.js runtime (OpenNext), which Netlify installs for a Next.js project, treats a static export as its own
// to deploy: after the build it copies the export's folder (out/) over the publish directory, so /afterimage/ would not
// deploy. NETLIFY_NEXT_PLUGIN_SKIP makes it step aside. Read in opennextjs-netlify's source (src/index.ts,
// src/build/content/static.ts), not tried on a real deploy. Netlify answers /about from about.html on its own.
const skipRuntime = 'NETLIFY_NEXT_PLUGIN_SKIP';

export async function planNetlify(cwd) {
  const file = path.join(cwd, 'netlify.toml');
  const before = await readText(file);
  const next = await usesNext(cwd);
  if (before === null) {
    const environment = next ? `\n[build.environment]\n  ${skipRuntime} = "true"\n` : '';
    return { change: 'Created netlify.toml', notes: [], apply: writer(file, `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n${environment}`) };
  }
  // TOML is not parsed or rewritten here: a hand edit is safer than a guessed merge.
  const hasCommand = new RegExp(`^\\s*command\\s*=\\s*["']${hostBuild}["']`, 'm').test(before);
  const hasPublish = new RegExp(`^\\s*publish\\s*=\\s*["']${hostOutput.replace('.', '\\.')}["']`, 'm').test(before);
  const hasSkip = new RegExp(`^\\s*${skipRuntime}\\s*=\\s*["']?(true|1)["']?\\s*$`, 'm').test(before);
  const wantsSkip = next && !hasSkip;
  if (hasCommand && hasPublish && !wantsSkip) return { change: null, notes: [], apply: null };
  const lines = [];
  if (!hasCommand || !hasPublish) lines.push(`Under [build], set:\n  command = "${hostBuild}"\n  publish = "${hostOutput}"`);
  if (wantsSkip) lines.push(`Under [build.environment], set (so Netlify's Next.js runtime leaves the history in place instead of deploying out/):\n  ${skipRuntime} = "true"`);
  return {
    change: null,
    notes: [`netlify.toml already exists, so Afterimage left it alone. ${lines.join('\n')}`],
    apply: null
  };
}

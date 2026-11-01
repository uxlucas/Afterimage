import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { configName, readConfig, writeConfig } from '../config.js';
import { detectProject } from '../detect.js';

export const usage = 'afterimage init [--source <folder>] [--build "<command>"] [--agent claude|cursor] [--no-input]';
export const summary = 'Set up Afterimage in this project: config, scripts, git rules and host config.';
// Read by the docs tests, which check every flag the agent files name.
export const options = { source: { type: 'string' }, build: { type: 'string' }, agent: { type: 'string' }, 'no-input': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } };

const scripts = {
  'afterimage:save': 'afterimage save',
  'afterimage:dev': 'afterimage dev',
  'afterimage:build': 'afterimage build'
};

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

// The skill and the Cursor rule the package ships, found from this file so they work from node_modules and a checkout.
const packagedAgentsDir = fileURLToPath(new URL('../../../agents/', import.meta.url));

// Where each agent reads Afterimage's instructions from. Init only writes there when --agent asks it to.
const agents = {
  claude: { from: 'skill', to: '.claude/skills/afterimage', what: 'skill', loads: 'Claude Code loads the skill in a new session, or after /reload-skills.' },
  cursor: { from: 'cursor/afterimage.mdc', to: '.cursor/rules/afterimage.mdc', what: 'rule', loads: null }
};

const skillHint = [
  'To let your coding agent save and compare versions, run one of:',
  ...Object.entries(agents).map(([name, agent]) => `  npx afterimage init --agent ${name}   copies the ${agent.what} to ${agent.to}${agent.what === 'skill' ? '/' : ''}`)
].join('\n');

const nextStep = 'Next: npx afterimage save "First version"';

// Windows editors often save JSON with a byte order mark. JSON.parse rejects it, so it is split off and put back.
const bomMark = '﻿';

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// → { bom, body } with body null when the file does not exist.
async function readJsonText(file) {
  const raw = await readText(file);
  if (raw === null) return { bom: '', body: null };
  const bom = raw.startsWith(bomMark) ? bomMark : '';
  return { bom, body: raw.slice(bom.length) };
}

async function isFolder(file) {
  try {
    return (await fs.stat(file)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function parseJson(text, name) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}\nFix it, then run "afterimage init" again.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object.\nFix it, then run "afterimage init" again.`);
  }
  return value;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// package.json keeps its own look (indent, line ending, final newline) so the diff in git is only the keys we add.
function writePackageText(original, value) {
  const indent = original?.match(/^([ \t]+)"/m)?.[1] ?? '  ';
  const eol = original?.includes('\r\n') ? '\r\n' : '\n';
  const text = JSON.stringify(value, null, indent).replace(/\n/g, eol);
  return original === null || /\n$/.test(original) ? text + eol : text;
}

// The code Node's own aborted prompts use. An ask function rejects with it when the user cancels.
const abortCode = 'ABORT_ERR';

// Reads one answer from the terminal. A closed stdin (Ctrl-D, EOF) counts as no answer instead of hanging, and
// Ctrl-C aborts the whole init. Tests pass their own ctx.ask.
async function askInTerminal(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise(resolve => rl.once('close', () => resolve('')));
  const interrupted = new Promise((_, reject) => rl.once('SIGINT', () => reject(Object.assign(new Error('Prompt cancelled.'), { code: abortCode }))));
  try {
    return await Promise.race([rl.question(`${question} `), closed, interrupted]);
  } finally {
    rl.close();
  }
}

const needSource = reason => new Error(`${reason}\nSay where the prototype is: afterimage init --source <folder>\nAdd --build "<command>" if a build command produces that folder.`);

// Decides source, build and type for a fresh config. Flags win over detection. A given source keeps detection's type
// when it names the same folder; otherwise the type is 'plain' for a folder of static files (no build) and 'unknown'
// when a custom build produces it.
async function chooseSetup(cwd, flags, { isTTY, ask }) {
  const detection = await detectProject(cwd);
  // What would give the project a static build to save. For Astro that is only about saving: the adapter still writes
  // .vercel/output, so deploying the history on Vercel needs it removed too (planVercel says so).
  const serverFix = {
    'next-server': "output: 'export' in next.config",
    'astro-server': "output: 'static' in the astro config (to save its static build; the history can only deploy on Vercel without @astrojs/vercel)"
  }[detection.type];
  if (serverFix && !flags.source) {
    throw new Error(`${detection.reason}\nSet ${serverFix} and run "afterimage init" again, or pass --source <folder> if a build writes static files somewhere else.`);
  }
  let source = flags.source;
  if (!source && detection.source === null) {
    if (!isTTY) throw needSource(detection.reason);
    source = (await ask('Which folder holds your prototype, or which folder does your build write to?')).trim();
    if (!source) throw needSource(detection.reason);
  }
  if (!source) {
    return { source: detection.source, build: flags.build ?? detection.build, type: detection.type };
  }
  source = projectRelative(cwd, source);
  const matches = detection.source !== null && source === projectRelative(cwd, detection.source);
  const build = flags.build ?? (matches ? detection.build : null);
  return { source, build, type: matches ? detection.type : build ? 'unknown' : 'plain' };
}

// Forward slashes, relative to the project, '.' for the project root. Anything outside the project is refused.
function projectRelative(cwd, folder) {
  const relative = path.relative(cwd, path.resolve(cwd, folder)).replace(/\\/g, '/');
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`${folder} is outside this project. Pick a folder inside it.`);
  }
  return relative || '.';
}

// Every step is split in two. A plan only reads and asks, and returns { change, notes, apply }. Nothing is written
// until every plan has succeeded, so a bad input leaves the project exactly as it was.
const writer = (file, text) => () => fs.writeFile(file, text);

async function planConfig(cwd, flags, ctx) {
  const before = await readText(path.join(cwd, configName));
  if (before !== null && !flags.source && flags.build === undefined) {
    return { config: await readConfig(cwd), change: null, notes: [], apply: null };
  }
  const existing = before === null ? null : await readConfig(cwd);
  let config;
  if (existing) {
    config = { ...existing, source: flags.source ? projectRelative(cwd, flags.source) : existing.source, build: flags.build ?? existing.build };
  } else {
    const chosen = await chooseSetup(cwd, flags, ctx);
    config = { source: projectRelative(cwd, chosen.source), build: chosen.build, history: 'afterimage', out: '.afterimage/site', exclude: [], type: chosen.type };
  }
  if (!config.build && !await isFolder(path.resolve(cwd, config.source))) {
    throw new Error(`${config.source} does not exist yet. If a build creates it, run init again with --build "<command>"; otherwise check the folder name.`);
  }
  if (existing && existing.source === config.source && existing.build === config.build) {
    return { config, change: null, notes: [], apply: null };
  }
  const detail = `source ${config.source}${config.build ? `, build "${config.build}"` : ''}`;
  return {
    config,
    change: `${existing ? 'Updated' : 'Created'} ${configName} (${detail})`,
    notes: [],
    apply: () => writeConfig(cwd, config)
  };
}

async function planPackage(cwd) {
  const file = path.join(cwd, 'package.json');
  const { bom, body: before } = await readJsonText(file);
  const manifest = before === null ? { private: true, scripts: {} } : parseJson(before, 'package.json');
  if (manifest.scripts !== undefined && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) {
    throw new Error('package.json "scripts" must be an object.\nFix it, then run "afterimage init" again.');
  }
  const existing = manifest.scripts ?? {};
  const added = Object.keys(scripts).filter(name => !Object.hasOwn(existing, name));
  const notes = [];
  if (Object.hasOwn(existing, 'afterimage:build') && existing['afterimage:build'] !== scripts['afterimage:build']) {
    notes.push(`package.json already has "afterimage:build": "${existing['afterimage:build']}". The host config runs that script, so it should be "${scripts['afterimage:build']}".`);
  }
  if (!added.length) return { change: null, notes, apply: null };
  manifest.scripts = { ...existing, ...Object.fromEntries(added.map(name => [name, scripts[name]])) };
  const what = `added ${plural(added.length, 'script')}`;
  return {
    change: `${before === null ? 'Created' : 'Updated'} package.json (${what})`,
    notes,
    apply: writer(file, bom + writePackageText(before, manifest))
  };
}

// Adds each line that is not already there, in the file's own line ending.
async function planLines(cwd, name, lines, isPresent) {
  const file = path.join(cwd, name);
  const before = await readText(file);
  const present = (before ?? '').split(/\r?\n/);
  const added = lines.filter(line => !present.some(existing => isPresent(existing, line)));
  if (!added.length) return { change: null, notes: [], apply: null };
  const eol = before?.includes('\r\n') ? '\r\n' : '\n';
  const gap = before && !/\n$/.test(before) ? eol : '';
  return {
    change: before === null ? `Created ${name}` : `Updated ${name} (added ${added.join(', ')})`,
    notes: [],
    apply: writer(file, `${before ?? ''}${gap}${added.join(eol)}${eol}`)
  };
}

// A rule counts as present when the pattern is there with -text, however the rest of the line reads.
const hasTextRule = (existing, rule) => {
  const [pattern] = rule.split(' ');
  const tokens = existing.trim().split(/\s+/);
  return tokens[0] === pattern && tokens.includes('-text');
};
const stripSlashes = line => line.trim().replace(/^\/+|\/+$/g, '');
const hasIgnore = (existing, line) => stripSlashes(existing) === stripSlashes(line);

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

async function planVercel(cwd, { isTTY, ask }) {
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
    // One yes switches every key, so a question about only one would hide the other change.
    const question = differs.includes('framework')
      ? `vercel.json ${[
        settings.buildCommand != null && settings.buildCommand !== hostBuild && `builds with ${settings.buildCommand}`,
        settings.outputDirectory != null && settings.outputDirectory !== hostOutput && `serves ${settings.outputDirectory}`,
        `uses the ${settings.framework} framework preset, which can serve its own build instead of the history`
      ].filter(Boolean).join(', ')}. Switch to Afterimage's settings? (y/N)`
      : differs.length === 2
        ? `vercel.json builds with ${settings.buildCommand} and serves ${settings.outputDirectory}. Switch both to Afterimage's? (y/N)`
        : differs[0] === 'buildCommand'
          ? `vercel.json already builds with ${settings.buildCommand}. Switch it to Afterimage's build? (y/N)`
          : `vercel.json already serves ${settings.outputDirectory}. Switch it to Afterimage's output? (y/N)`;
    const agreed = isTTY && /^y(es)?$/i.test((await ask(question)).trim());
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
async function dependsOn(cwd, name) {
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

async function planNetlify(cwd) {
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

// Every file of the package's copy for this agent, as [package path, project path], forward slashes.
async function agentFiles({ from, to }) {
  const source = path.join(packagedAgentsDir, from);
  if (!(await fs.stat(source)).isDirectory()) return [[from, to]];
  const names = (await fs.readdir(source, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  return names.map(entry => {
    const relative = path.relative(source, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/');
    return [`${from}/${relative}`, `${to}/${relative}`];
  }).sort(([a], [b]) => (a < b ? -1 : 1));
}

// A checkout with autocrlf can turn the copy's line endings, which is still the same copy, so it is not asked about.
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

async function planAgent(cwd, name, { isTTY, ask }) {
  if (!name) return { change: null, notes: [], apply: null };
  const changes = [];
  const notes = [];
  const writes = [];
  for (const [from, to] of await agentFiles(agents[name])) {
    const text = await fs.readFile(path.join(packagedAgentsDir, from), 'utf8');
    const before = await readText(path.join(cwd, to));
    if (before !== null && sameText(before, text)) continue;
    if (before !== null) {
      // The file is the person's now; they may have edited it.
      const agreed = isTTY && /^y(es)?$/i.test((await ask(`${to} differs from Afterimage's copy. Replace it? (y/N)`)).trim());
      if (!agreed) {
        notes.push(`${to} differs from Afterimage's copy, so Afterimage left it as it is. To replace it, run "npx afterimage init --agent ${name}" in a terminal and answer y.`);
        continue;
      }
    }
    changes.push(`${before === null ? 'Created' : 'Updated'} ${to}`);
    writes.push([path.join(cwd, to), text]);
  }
  return {
    change: changes.join('\n') || null,
    notes,
    apply: writes.length ? async () => {
      for (const [file, text] of writes) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
      }
    } : null
  };
}

export async function run(args, ctx) {
  const { cwd, stdout, stderr } = ctx;

  let parsed;
  try {
    parsed = parseArgs({ args, options });
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS')) throw error;
    stderr.write(`${error.message}\nUsage: ${usage}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(`Usage: ${usage}\n\n${summary}\n\n  --source <folder>      the folder that holds the prototype, or that your build writes to\n  --build "<command>"    the command that builds it, when there is one\n  --agent claude|cursor  also copy Afterimage's skill (Claude Code) or rule (Cursor) into this project\n  --no-input             ask nothing, even in a terminal, and print what is left to do instead\n`);
    return 0;
  }
  const flags = { source: parsed.values.source, build: parsed.values.build };
  if (flags.source !== undefined && !flags.source.trim()) {
    stderr.write(`--source needs a folder.\nUsage: ${usage}\n`);
    return 2;
  }
  const agent = parsed.values.agent;
  if (agent !== undefined && !Object.hasOwn(agents, agent)) {
    stderr.write(`--agent needs claude or cursor.\nUsage: ${usage}\n`);
    return 2;
  }
  // Prompts only happen with a real terminal. An agent's terminal can look like one, so --no-input rules them out.
  // Tests inject both pieces.
  const isTTY = !parsed.values['no-input'] && (ctx.isTTY ?? Boolean(process.stdin.isTTY));
  const prompt = { isTTY, ask: ctx.ask ?? askInTerminal };

  // Plan first, write after. package.json is read before the config step so a bad one stops init before any question,
  // and detection (which reads package.json) still sees the project as it was.
  let plans;
  try {
    const packagePlan = await planPackage(cwd);
    const configPlan = await planConfig(cwd, flags, prompt);
    plans = [
      configPlan,
      packagePlan,
      await planLines(cwd, '.gitattributes', [`${configPlan.config.history}/** -text`], hasTextRule),
      await planLines(cwd, '.gitignore', ['.afterimage/', 'node_modules/'], hasIgnore),
      await planVercel(cwd, prompt),
      await planNetlify(cwd),
      await planAgent(cwd, agent, prompt)
    ];
  } catch (error) {
    // Ctrl-C at a prompt. Nothing has been written yet, so stopping here is clean. 130 is the shell's code for SIGINT.
    if (error?.code !== abortCode) throw error;
    stderr.write('Stopped. Nothing was changed.\n');
    return 130;
  }
  for (const plan of plans) await plan.apply?.();

  const changes = plans.map(plan => plan.change).filter(Boolean);
  const notes = plans.flatMap(plan => plan.notes);

  if (changes.length) stdout.write(`${changes.join('\n')}\n`);
  else stdout.write(notes.length ? 'No files changed. Still left for you:\n' : 'Everything is already set up. Nothing changed.\n');
  if (notes.length) stdout.write(`${changes.length ? '\n' : ''}${notes.join('\n\n')}\n`);
  // With --agent the copy is in place, and a fresh one needs loading; without it, say how to add it.
  const agentLine = agent ? plans.at(-1).change && agents[agent].loads : skillHint;
  stdout.write(`\n${agentLine ? `${agentLine}\n` : ''}${nextStep}\n`);
  return 0;
}

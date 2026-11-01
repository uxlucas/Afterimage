import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { configName, readConfig, writeConfig } from '../config.js';
import { detectProject } from '../detect.js';

export const usage = 'afterimage init [--source <folder>] [--build "<command>"]';
export const summary = 'Set up Afterimage in this project: config, scripts, git rules and host config.';

const scripts = {
  'afterimage:save': 'afterimage save',
  'afterimage:dev': 'afterimage dev',
  'afterimage:build': 'afterimage build'
};

// What a host runs to deploy the history. It goes through the package script so the local bin resolves on any host.
const hostBuild = 'npm run afterimage:build';
const hostOutput = '.afterimage/site';

// Clean URLs for the live app at the root, on Vercel: /about is answered from about.html (Next's and SvelteKit's static
// exports write that and link to /about). Vercel only does so by default for a framework it builds itself, and the
// history is deployed as a plain folder (framework: null, below). cleanUrls: true would give the same, site-wide, and
// redirect /afterimage/versions/vN/index.html to a path that is no longer inside the version folder, which the frame
// runtime and the viewer cannot follow. A rewrite is not a redirect, only applies where no file has the path (Vercel
// checks the filesystem first), and this one leaves /afterimage/ out altogether. tests/e2e/harness.mjs reads it.
export const cleanUrlRewrite = { source: '/:path((?!afterimage/|afterimage$).+)', destination: '/:path*.html' };

// Task 12 ships the skill here; the setup prompt copies it into the agent's own folder.
const skillHint = 'Agent skill: node_modules/afterimage-cli/agents/skill/ (copy it to .claude/skills/afterimage/)';

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
  if (detection.type === 'next-server' && !flags.source) {
    throw new Error(`${detection.reason}\nSet output: 'export' in next.config and run "afterimage init" again, or pass --source <folder> if a build writes static files somewhere else.`);
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

// What vercel.json needs for the history to deploy, in the order it is written.
// framework: null ("Other") makes Vercel serve the output folder as plain files. With a framework detected, Vercel's own
// builder takes over instead: for Next.js, @vercel/next finds .next/export-detail.json after the build and serves the
// export's folder (out/), not outputDirectory, so /afterimage/ would not deploy. Next.js is the one read in the builder's
// source; the others are set the same way so no preset can do the same. The preset's own clean URLs go with it, which is
// what cleanUrlRewrite replaces.
const hostSettings = { framework: null, buildCommand: hostBuild, outputDirectory: hostOutput };
const hostKeys = [...Object.keys(hostSettings), 'rewrites'];
const hostValues = JSON.stringify({ ...hostSettings, rewrites: [cleanUrlRewrite] }, null, 2).slice(2, -2);

const sameRewrite = rewrite => rewrite?.source === cleanUrlRewrite.source && rewrite?.destination === cleanUrlRewrite.destination;

const cleanUrlsNote = 'vercel.json has "cleanUrls": true. It also redirects the history\'s own pages (/afterimage/versions/vN/index.html), so the history will not open. Remove it: Afterimage\'s rewrite gives the live app clean URLs without touching /afterimage/.';

async function planVercel(cwd, { isTTY, ask }) {
  const file = path.join(cwd, 'vercel.json');
  const { bom, body: before } = await readJsonText(file);
  const settings = before === null ? {} : parseJson(before, 'vercel.json');
  const notes = [];

  // null means "use the default" in vercel.json, so it is as free as a missing key. For framework it is the wanted
  // value itself ("Other"), so only a framework that is named differs.
  const differs = ['buildCommand', 'outputDirectory'].filter(key => settings[key] != null && settings[key] !== hostSettings[key]);
  if (typeof settings.framework === 'string') differs.push('framework');
  const missing = ['buildCommand', 'outputDirectory'].filter(key => settings[key] == null);
  if (!Object.hasOwn(settings, 'framework')) missing.push('framework');
  const set = [...missing];

  // The rewrite goes after the project's own, which keep their order. cleanUrls: true is left to the person (and called
  // out), as are rewrites that are not a list.
  let rewrites = null;
  if (settings.cleanUrls === true) {
    notes.push(cleanUrlsNote);
  } else if (settings.rewrites !== undefined && !Array.isArray(settings.rewrites)) {
    notes.push(`vercel.json "rewrites" is not a list, so Afterimage left it alone. Add this to it for clean URLs on the live app:\n${JSON.stringify(cleanUrlRewrite, null, 2)}`);
  } else if (!(settings.rewrites ?? []).some(sameRewrite)) {
    rewrites = [...(settings.rewrites ?? []), cleanUrlRewrite];
    set.push('rewrites');
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
      return { change: null, notes: [`Left vercel.json as it is. To deploy the history with Afterimage, set:\n${hostValues}`, ...notes], apply: null };
    }
    set.unshift(...differs.filter(key => !set.includes(key)));
  }
  const text = JSON.stringify({ ...settings, ...hostSettings, ...(rewrites && { rewrites }) }, null, 2);
  return {
    change: before === null ? 'Created vercel.json' : `Updated vercel.json (set ${hostKeys.filter(key => set.includes(key)).join(', ')})`,
    notes,
    apply: writer(file, `${bom}${text}\n`)
  };
}

// Whether the project depends on Next.js, however init was told where its prototype is. Netlify and Vercel detect the
// framework from package.json, not from what Afterimage decided.
async function usesNext(cwd) {
  const { body } = await readJsonText(path.join(cwd, 'package.json'));
  try {
    const manifest = JSON.parse(body ?? '{}');
    return 'next' in { ...manifest?.dependencies, ...manifest?.devDependencies };
  } catch {
    return false;
  }
}

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

export async function run(args, ctx) {
  const { cwd, stdout, stderr } = ctx;
  // Prompts only happen with a real terminal; tests inject both pieces.
  const prompt = { isTTY: ctx.isTTY ?? Boolean(process.stdin.isTTY), ask: ctx.ask ?? askInTerminal };

  let parsed;
  try {
    parsed = parseArgs({ args, options: { source: { type: 'string' }, build: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS')) throw error;
    stderr.write(`${error.message}\nUsage: ${usage}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(`Usage: ${usage}\n\n${summary}\n\n  --source <folder>    the folder that holds the prototype, or that your build writes to\n  --build "<command>"  the command that builds it, when there is one\n`);
    return 0;
  }
  const flags = { source: parsed.values.source, build: parsed.values.build };
  if (flags.source !== undefined && !flags.source.trim()) {
    stderr.write(`--source needs a folder.\nUsage: ${usage}\n`);
    return 2;
  }

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
      await planNetlify(cwd)
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
  stdout.write(`\n${skillHint}\n${nextStep}\n`);
  return 0;
}

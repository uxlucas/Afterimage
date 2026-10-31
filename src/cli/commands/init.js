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

// Task 12 ships the skill here; the setup prompt copies it into the agent's own folder.
const skillHint = 'Agent skill: node_modules/afterimage-cli/agents/skill/ (copy it to .claude/skills/afterimage/)';

const nextStep = 'Next: npx afterimage save "First version"';

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
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

// Reads one answer from the terminal. Tests pass their own ctx.ask.
async function askInTerminal(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`${question} `);
  } finally {
    rl.close();
  }
}

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
    if (!isTTY) {
      throw new Error(`${detection.reason}\nSay where the prototype is: afterimage init --source <folder>\nAdd --build "<command>" if a build command produces that folder.`);
    }
    source = (await ask('Which folder holds your prototype, or which folder does your build write to?')).trim();
    if (!source) throw new Error('No folder given, so nothing was set up.');
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

async function setupConfig(cwd, flags, ctx) {
  const file = path.join(cwd, configName);
  const before = await readText(file);
  if (before !== null && !flags.source && flags.build === undefined) {
    return { config: await readConfig(cwd), change: null };
  }
  let config;
  if (before !== null) {
    const existing = await readConfig(cwd);
    config = { ...existing, source: flags.source ? projectRelative(cwd, flags.source) : existing.source, build: flags.build ?? existing.build };
  } else {
    const chosen = await chooseSetup(cwd, flags, ctx);
    config = { source: projectRelative(cwd, chosen.source), build: chosen.build, history: 'afterimage', out: '.afterimage/site', exclude: [], type: chosen.type };
  }
  if (!config.build && !await isFolder(path.resolve(cwd, config.source))) {
    throw new Error(`${config.source} is not a folder here. Pass the folder that holds your prototype, or add --build "<command>" if a build creates it.`);
  }
  await writeConfig(cwd, config);
  const after = await readText(file);
  const detail = `source ${config.source}${config.build ? `, build "${config.build}"` : ''}`;
  if (before === null) return { config, change: `Created ${configName} (${detail})` };
  return { config, change: before === after ? null : `Updated ${configName} (${detail})` };
}

async function setupPackage(cwd) {
  const file = path.join(cwd, 'package.json');
  const before = await readText(file);
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
  if (!added.length) return { change: null, notes };
  manifest.scripts = { ...existing, ...Object.fromEntries(added.map(name => [name, scripts[name]])) };
  await fs.writeFile(file, writePackageText(before, manifest));
  const what = `added ${plural(added.length, 'script')}`;
  return { change: before === null ? `Created package.json (${what})` : `Updated package.json (${what})`, notes };
}

// Adds each line that is not already there, in the file's own line ending.
async function appendLines(cwd, name, lines, isPresent) {
  const file = path.join(cwd, name);
  const before = await readText(file);
  const present = (before ?? '').split(/\r?\n/);
  const added = lines.filter(line => !present.some(existing => isPresent(existing, line)));
  if (!added.length) return null;
  const eol = before?.includes('\r\n') ? '\r\n' : '\n';
  const gap = before && !/\n$/.test(before) ? eol : '';
  await fs.writeFile(file, `${before ?? ''}${gap}${added.join(eol)}${eol}`);
  return before === null ? `Created ${name}` : `Updated ${name} (added ${added.join(', ')})`;
}

// A rule counts as present when the pattern is there with -text, however the rest of the line reads.
const hasTextRule = (existing, rule) => {
  const [pattern] = rule.split(' ');
  const tokens = existing.trim().split(/\s+/);
  return tokens[0] === pattern && tokens.includes('-text');
};
const stripSlashes = line => line.trim().replace(/^\/+|\/+$/g, '');
const hasIgnore = (existing, line) => stripSlashes(existing) === stripSlashes(line);

const hostValues = `  "buildCommand": "${hostBuild}"\n  "outputDirectory": "${hostOutput}"`;

async function setupVercel(cwd, { isTTY, ask }) {
  const file = path.join(cwd, 'vercel.json');
  const before = await readText(file);
  const wanted = { buildCommand: hostBuild, outputDirectory: hostOutput };
  const settings = before === null ? {} : parseJson(before, 'vercel.json');
  // null means "use the default" in vercel.json, so it is as free as a missing key.
  const differs = Object.keys(wanted).filter(key => settings[key] != null && settings[key] !== wanted[key]);
  const missing = Object.keys(wanted).filter(key => settings[key] == null);
  if (!differs.length && !missing.length) return { change: null, notes: [] };

  if (differs.length) {
    const question = differs.includes('buildCommand')
      ? `vercel.json already builds with ${settings.buildCommand}. Switch it to Afterimage's build? (y/N)`
      : `vercel.json already serves ${settings.outputDirectory}. Switch it to Afterimage's output? (y/N)`;
    const agreed = isTTY && /^y(es)?$/i.test((await ask(question)).trim());
    if (!agreed) {
      return { change: null, notes: [`Left vercel.json as it is. To deploy the history with Afterimage, set:\n${hostValues.replace(/\n/g, ',\n')}`] };
    }
  }
  await fs.writeFile(file, `${JSON.stringify({ ...settings, ...wanted }, null, 2)}
`);
  return { change: before === null ? 'Created vercel.json' : 'Updated vercel.json (set buildCommand, outputDirectory)', notes: [] };
}

async function setupNetlify(cwd) {
  const file = path.join(cwd, 'netlify.toml');
  const before = await readText(file);
  if (before === null) {
    await fs.writeFile(file, `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n`);
    return { change: 'Created netlify.toml', notes: [] };
  }
  // TOML is not parsed or rewritten here: a hand edit is safer than a guessed merge.
  const hasCommand = new RegExp(`^\\s*command\\s*=\\s*["']${hostBuild}["']`, 'm').test(before);
  const hasPublish = new RegExp(`^\\s*publish\\s*=\\s*["']${hostOutput.replace('.', '\\.')}["']`, 'm').test(before);
  if (hasCommand && hasPublish) return { change: null, notes: [] };
  return {
    change: null,
    notes: [`netlify.toml already exists, so Afterimage left it alone. Under [build], set:\n  command = "${hostBuild}"\n  publish = "${hostOutput}"`]
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

  // Detection reads package.json, so it runs before init creates one.
  const { config, change: configChange } = await setupConfig(cwd, flags, prompt);
  const steps = [
    { change: configChange, notes: [] },
    await setupPackage(cwd),
    { change: await appendLines(cwd, '.gitattributes', [`${config.history}/** -text`], hasTextRule), notes: [] },
    { change: await appendLines(cwd, '.gitignore', ['.afterimage/', 'node_modules/'], hasIgnore), notes: [] },
    await setupVercel(cwd, prompt),
    await setupNetlify(cwd)
  ];
  const changes = steps.map(step => step.change).filter(Boolean);
  const notes = steps.flatMap(step => step.notes);

  stdout.write(changes.length ? `${changes.join('\n')}\n` : 'Everything is already set up. Nothing changed.\n');
  if (notes.length) stdout.write(`\n${notes.join('\n\n')}\n`);
  stdout.write(`\n${skillHint}\n${nextStep}\n`);
  return 0;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { configName, readConfig, writeConfig } from '../config.js';
import { detectProject } from '../detect.js';
import { dependsOn, planNetlify, planVercel } from '../hosts.js';
import { parseJson, readJsonText, readText, writer } from '../project-files.js';

export const usage = 'afterimage init [--source <folder>] [--build "<command>"] [--agent claude|cursor] [--no-input]';
export const summary = 'Set up Afterimage in this project: config, scripts, git rules and host config.';
// What both "afterimage init --help" and "afterimage help init" print.
export const help = `Usage: ${usage}\n\n${summary}\n\n  --source <folder>      the folder that holds the prototype, or that your build writes to\n  --build "<command>"    the command that builds it, when there is one\n  --agent claude|cursor  also copy Afterimage's skill (Claude Code) or rule (Cursor) into this project\n  --no-input             ask nothing, even in a terminal, and print what is left to do instead\n`;
// Read by the docs tests, which check every flag the agent files name.
export const options = { source: { type: 'string' }, build: { type: 'string' }, agent: { type: 'string' }, 'no-input': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } };

const scripts = {
  'afterimage:save': 'afterimage save',
  'afterimage:dev': 'afterimage dev',
  'afterimage:build': 'afterimage build'
};

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

// The dev script starts Afterimage beside the app when init could set it; otherwise the app's own command goes after --.
const nextStep = devReady => (devReady
  ? 'Next: npm run dev, then use the Afterimage pill on your prototype to save versions and see them all.'
  : 'Next: start your dev server through Afterimage with npx afterimage dev -- <your dev command>, then use the pill on your prototype to save versions and see them all.');

async function isFolder(file) {
  try {
    return (await fs.stat(file)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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
  // What would give the project a static build to save. For Astro with @astrojs/vercel that is only about saving: the
  // adapter still writes .vercel/output, so deploying the history on Vercel needs it removed too (planVercel says so).
  const serverFix = {
    'next-server': "output: 'export' in next.config",
    'astro-server': await dependsOn(cwd, '@astrojs/vercel')
      ? "output: 'static' in the astro config (to save its static build; the history can only deploy on Vercel without @astrojs/vercel)"
      : "output: 'static' in the astro config",
    'sveltekit-server': 'the adapter in svelte.config to @sveltejs/adapter-static (npm install -D @sveltejs/adapter-static)'
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

// Read and checked before anything else, so a bad package.json stops init before any question.
async function readPackage(cwd) {
  const file = path.join(cwd, 'package.json');
  const { bom, body: before } = await readJsonText(file);
  const manifest = before === null ? { private: true, scripts: {} } : parseJson(before, 'package.json');
  if (manifest.scripts !== undefined && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) {
    throw new Error('package.json "scripts" must be an object.\nFix it, then run "afterimage init" again.');
  }
  return { file, bom, before, manifest };
}

// The pill on the prototype needs afterimage dev running beside the app. So the project's own dev script starts it:
// "vite" becomes "afterimage dev -- vite", which runs both and stops both. A plain folder with no dev script gets
// "afterimage dev", which serves the folder itself. Run again, it changes nothing.
const devWrap = 'afterimage dev';
function devScript(existing, config) {
  if (typeof existing.dev === 'string') return existing.dev.trim().startsWith(devWrap) ? null : `${devWrap} -- ${existing.dev}`;
  return config.build ? null : devWrap;
}

function planPackage({ file, bom, before, manifest }, config) {
  const existing = manifest.scripts ?? {};
  const added = Object.keys(scripts).filter(name => !Object.hasOwn(existing, name));
  const notes = [];
  if (Object.hasOwn(existing, 'afterimage:build') && existing['afterimage:build'] !== scripts['afterimage:build']) {
    notes.push(`package.json already has "afterimage:build": "${existing['afterimage:build']}". The host config runs that script, so it should be "${scripts['afterimage:build']}".`);
  }
  const dev = devScript(existing, config);
  if (!added.length && !dev) return { change: null, notes, apply: null };
  const wraps = dev && Object.hasOwn(existing, 'dev');
  manifest.scripts = { ...existing, ...Object.fromEntries(added.map(name => [name, scripts[name]])), ...(dev ? { dev } : {}) };
  const count = added.length + (dev && !wraps ? 1 : 0);
  const what = [count ? `added ${plural(count, 'script')}` : null, wraps ? 'dev now starts Afterimage too' : null].filter(Boolean).join('; ');
  return {
    change: `${before === null ? 'Created' : 'Updated'} package.json (${what})`,
    notes,
    apply: writer(file, bom + writePackageText(before, manifest))
  };
}

// The overlay's one line. A plain page loads it from the history's own folder, which afterimage dev and the deployed
// site both serve; a Vite page imports it from the package, since Vite's dev server serves no /afterimage/.
const pillTag = '<script src="/afterimage/overlay.js" defer></script>';
const pillImport = "<script type=\"module\">import 'afterimage-cli/overlay';</script>";
const pillNotes = {
  'next-static': "Add the Afterimage pill to your app: create app/afterimage.tsx with\n  'use client';\n  import 'afterimage-cli/overlay';\n  export default function Afterimage() { return null; }\nand put <Afterimage /> inside <body> in app/layout.tsx.",
  astro: "Add the Afterimage pill to your app: put <script>import 'afterimage-cli/overlay';</script> in the layout every page uses.",
  'sveltekit-static': "Add the Afterimage pill to your app: put import 'afterimage-cli/overlay'; in the <script> of src/routes/+layout.svelte.",
  unknown: "Add the Afterimage pill to your app: import 'afterimage-cli/overlay' once in the code every page loads."
};

// Before the last </body>, or at the end of the file when it has none, on a line of its own. When </body> starts its
// line, the new line takes the indent of the line above it, so it sits with the page's other scripts.
function withLine(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const at = text.search(/<\/body>(?![\s\S]*<\/body>)/i);
  if (at === -1) return `${text}${text === '' || text.endsWith('\n') ? '' : eol}${line}${eol}`;
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, at))) return `${text.slice(0, at)}${eol}${line}${eol}${text.slice(at)}`;
  const above = text.slice(0, lineStart).replace(/\r?\n$/, '').split(/\r?\n/).pop();
  return `${text.slice(0, lineStart)}${above.match(/^[ \t]*/)[0]}${line}${eol}${text.slice(lineStart)}`;
}

// Every file under `dir` whose name passes `want`, never going into hidden folders, installed packages or `skip`
// (absolute folders), which a real project's node_modules makes worth not reading at all.
async function walk(dir, want, skip) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      if (!skip.includes(full)) found.push(...await walk(full, want, skip));
    } else if (entry.isFile() && want(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// Every .html page in the prototype's folder, minus the history and Afterimage's own output.
async function plainPages(cwd, config) {
  const skip = [config.history, config.out].map(folder => path.resolve(cwd, folder));
  const pages = await walk(path.resolve(cwd, config.source), name => /\.html?$/i.test(name), skip);
  return pages.map(full => ({ full, name: path.relative(cwd, full).replace(/\\/g, '/') })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

// Whether the app's own code already loads the overlay, so init stops asking once the line is in. Only source files
// are read: not installed packages, hidden folders, the history, or what a build wrote.
const codeFile = /\.(m?[jt]sx?|svelte|astro|vue|html?)$/i;
async function loadsPill(cwd, config) {
  const skip = [config.history, config.out, config.source].filter(folder => folder !== '.').map(folder => path.resolve(cwd, folder));
  for (const full of await walk(cwd, name => codeFile.test(name), skip)) {
    const text = await readText(full);
    if (text.includes('afterimage-cli/overlay') || text.includes('/afterimage/overlay.js')) return true;
  }
  return false;
}

async function planPill(cwd, config) {
  let pages = [];
  let line = pillTag;
  const noteFor = async type => ({ change: null, notes: await loadsPill(cwd, config) ? [] : [pillNotes[type] ?? pillNotes.unknown], apply: null });
  if (config.type === 'plain') {
    pages = await plainPages(cwd, config);
  } else if (config.type === 'vite') {
    const index = path.join(cwd, 'index.html');
    if (await readText(index) === null) return noteFor('unknown');
    pages = [{ full: index, name: 'index.html' }];
    line = pillImport;
  } else {
    return noteFor(config.type);
  }
  const writes = [];
  for (const page of pages) {
    const text = await readText(page.full);
    if (text.includes('/afterimage/overlay.js') || text.includes('afterimage-cli/overlay')) continue;
    writes.push({ ...page, text: withLine(text, line) });
  }
  if (!writes.length) return { change: null, notes: [], apply: null };
  const names = writes.map(page => page.name);
  return {
    change: names.length === 1 ? `Added the Afterimage pill to ${names[0]}` : `Added the Afterimage pill to ${names.length} pages (${names.join(', ')})`,
    notes: [],
    apply: async () => {
      for (const page of writes) await fs.writeFile(page.full, page.text);
    }
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
    stdout.write(help);
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
    const packageFile = await readPackage(cwd);
    const configPlan = await planConfig(cwd, flags, prompt);
    plans = [
      configPlan,
      planPackage(packageFile, configPlan.config),
      await planPill(cwd, configPlan.config),
      await planLines(cwd, '.gitattributes', [`${configPlan.config.history}/** -text`], hasTextRule),
      // The save's lock and stage folders too, which a killed save can leave in the history folder.
      await planLines(cwd, '.gitignore', ['.afterimage/', `${configPlan.config.history}/.afterimage-*`, 'node_modules/'], hasIgnore),
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
  const dev = (await readPackage(cwd)).manifest.scripts?.dev;
  stdout.write(`\n${agentLine ? `${agentLine}\n` : ''}${nextStep(typeof dev === 'string' && dev.trim().startsWith(devWrap))}\n`);
  return 0;
}

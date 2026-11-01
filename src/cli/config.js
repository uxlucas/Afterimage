import fs from 'node:fs/promises';
import path from 'node:path';

export const configName = 'afterimage.config.json';

const defaults = { source: '.', build: null, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'unknown' };

// Names that are the project's own files, not the prototype. They only matter when the prototype is the project root.
// The host configs are the ones init writes, and the lockfiles are every package manager's.
const projectNames = [
  'node_modules', 'afterimage', '.afterimage', 'package.json', 'package-lock.json', configName, 'vercel.json', 'netlify.toml',
  'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'
];
// And the project's own docs next to them: a README, a LICENSE, a CHANGELOG, a CONTRIBUTING guide and an agent's
// instructions (CLAUDE.md, AGENTS.md, GEMINI.md), as files, in any case, bare or with a text extension. Left in, they
// would be saved into every version and published at the live root. A page or a folder with one of these names
// (license.html, agents/) can be part of the prototype, so it stays.
const projectDoc = /^(readme|license|changelog|contributing|claude|agents|gemini)(\.(md|markdown|txt|rst))?$/i;

// Same shape readSnapshot expects: forward slashes, no leading ./, no trailing slash. "x/../site" is "site" and "src/.." is ".".
const cleanPath = value => {
  const cleaned = path.posix.normalize(value.replace(/\\/g, '/')).replace(/\/+$/, '').replace(/^\.\//, '');
  return cleaned || '.';
};

// Afterimage only works inside the project, so an absolute path or one that climbs out of it is a mistake.
const leavesProject = cleaned => cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned) || cleaned === '..' || cleaned.startsWith('../');

function validate(raw) {
  const fail = problem => { throw new Error(`${configName} ${problem}.`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object');
  const config = { ...defaults, ...raw };
  for (const key of ['source', 'history', 'out']) {
    if (typeof config[key] !== 'string' || !config[key]) fail(`needs "${key}" to be a non-empty string`);
  }
  if (config.build !== null && typeof config.build !== 'string') fail('needs "build" to be a string or null');
  if (typeof config.type !== 'string') fail('needs "type" to be a string');
  if (!Array.isArray(config.exclude) || config.exclude.some(entry => typeof entry !== 'string')) fail('needs "exclude" to be a list of strings');
  const [source, history, out] = ['source', 'history', 'out'].map(key => {
    const cleaned = cleanPath(config[key]);
    if (leavesProject(cleaned)) fail(`needs "${key}" to be a folder inside the project, not an absolute path or one that starts with ".."`);
    return cleaned;
  });
  return { source, build: config.build, history, out, exclude: [...config.exclude], type: config.type };
}

export async function readConfig(projectDir) {
  let text;
  try {
    text = await fs.readFile(path.join(projectDir, configName), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No ${configName} here. Run "afterimage init" first.`);
    throw error;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${configName} is not valid JSON: ${error.message}`);
  }
  return validate(raw);
}

export async function writeConfig(projectDir, config) {
  await fs.writeFile(path.join(projectDir, configName), `${JSON.stringify(validate(config), null, 2)}\n`);
}

// What the store leaves out when the prototype is the project root. A build folder has none of the project-level
// names inside it, so only the user's own excludes apply there, plus the history and out folders if a hand-written
// config puts them inside it. rootFiles are the files (not folders) at the top of the project as they are spelled on
// disk, so the docs among them are left out by their own spelling.
export function projectExcludes(config, rootFiles = []) {
  const source = cleanPath(config.source);
  if (source !== '.' && source !== '') {
    const inside = [config.history, config.out].map(cleanPath).filter(dir => dir.startsWith(`${source}/`));
    return [...new Set([...inside.map(dir => dir.slice(source.length + 1)), ...config.exclude])];
  }
  const docs = rootFiles.filter(name => projectDoc.test(name));
  return [...new Set([...projectNames, ...docs, config.history, config.out, ...config.exclude].map(cleanPath))];
}

// projectExcludes for the project as it is on disk now.
export async function sourceExcludes(projectDir, config) {
  const atRoot = cleanPath(config.source) === '.';
  if (!atRoot) return projectExcludes(config);
  const entries = await fs.readdir(path.resolve(projectDir, config.source), { withFileTypes: true });
  return projectExcludes(config, entries.filter(entry => entry.isFile()).map(entry => entry.name));
}

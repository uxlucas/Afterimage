import fs from 'node:fs/promises';
import path from 'node:path';

export const configName = 'afterimage.config.json';

const defaults = { source: '.', build: null, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'unknown' };

// Names that are the project's own files, not the prototype. They only matter when the prototype is the project root.
// The host configs are the ones init writes; a plain folder set up by init must still save.
const projectNames = ['node_modules', 'afterimage', '.afterimage', 'package.json', 'package-lock.json', configName, 'vercel.json', 'netlify.toml'];
// And the project's own docs next to them: a README, a LICENSE and an agent's instructions (CLAUDE.md, AGENTS.md), in
// any case and with any extension. Left in, a .md one would stop every save, and none of them is a page of the prototype.
const projectDoc = /^(readme|license|claude|agents)(\..+)?$/i;

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
// names inside it, so only the user's own excludes apply there. rootNames are the names at the top of the project as
// they are spelled on disk, so the docs among them are left out by their own spelling.
export function projectExcludes(config, rootNames = []) {
  if (cleanPath(config.source) !== '.' && cleanPath(config.source) !== '') return [...config.exclude];
  const docs = rootNames.filter(name => projectDoc.test(name));
  return [...new Set([...projectNames, ...docs, config.history, config.out, ...config.exclude].map(cleanPath))];
}

// projectExcludes for the project as it is on disk now.
export async function sourceExcludes(projectDir, config) {
  const atRoot = cleanPath(config.source) === '.';
  return projectExcludes(config, atRoot ? await fs.readdir(path.resolve(projectDir, config.source)) : []);
}

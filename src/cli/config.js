import fs from 'node:fs/promises';
import path from 'node:path';

export const configName = 'afterimage.config.json';

const defaults = { source: '.', build: null, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'unknown' };

// Names that are the project's own files, not the prototype. They only matter when the prototype is the project root.
const projectNames = ['node_modules', 'afterimage', '.afterimage', 'package.json', 'package-lock.json', configName];

// Same shape readSnapshot expects: forward slashes, no leading ./, no trailing slash.
const cleanPath = value => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

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
  const { source, build, history, out, exclude, type } = config;
  return { source, build, history, out, exclude: [...exclude], type };
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
// names inside it, so only the user's own excludes apply there.
export function projectExcludes(config) {
  if (cleanPath(config.source) !== '.' && cleanPath(config.source) !== '') return [...config.exclude];
  return [...new Set([...projectNames, config.history, config.out, ...config.exclude].map(cleanPath))];
}

import path from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig } from '../config.js';
import { assembleSite } from '../site.js';

export const usage = 'afterimage build';
export const summary = 'Build the prototype and write the deployable site with the history at /afterimage/.';

export async function run(args, { cwd, stdout, stderr, buildStdio, viewerDir, runtimeDir }) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { help: { type: 'boolean', short: 'h' } } });
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS')) throw error;
    stderr.write(`${error.message}\nUsage: ${usage}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(`Usage: ${usage}\n\n${summary}\n`);
    return 0;
  }

  const config = await readConfig(cwd);
  const { versions, warnings } = await assembleSite({ projectDir: path.resolve(cwd), config, viewerDir, runtimeDir, buildStdio });
  for (const warning of warnings) stderr.write(`${warning}\n`);
  stdout.write(`Built ${config.out} with ${versions} ${versions === 1 ? 'version' : 'versions'}. Serve it from any static host; the history is at /afterimage/.\n`);
  return 0;
}

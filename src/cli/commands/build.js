import path from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig } from '../config.js';
import { assembleSite } from '../site.js';

export const usage = 'afterimage build';
export const summary = 'Build the prototype and write the deployable site with the history at /afterimage/.';
// What both "afterimage build --help" and "afterimage help build" print.
export const help = `Usage: ${usage}\n\n${summary}\n`;
// Read by the docs tests, which check every flag the agent files name.
export const options = { help: { type: 'boolean', short: 'h' } };

// Not every static host can serve the history (a sub-path, no https, 403 for a missing file), so the message says where
// the requirements are. tests/docs.test.mjs checks the heading exists.
export const hostDocs = 'https://github.com/uxlucas/Afterimage/blob/main/docs/deploying.md#other-static-hosts';

export async function run(args, { cwd, stdout, stderr, buildStdio, viewerDir, runtimeDir }) {
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

  const config = await readConfig(cwd);
  const { versions, warnings } = await assembleSite({ projectDir: path.resolve(cwd), config, viewerDir, runtimeDir, buildStdio });
  for (const warning of warnings) stderr.write(`${warning}\n`);
  stdout.write(`Built ${config.out} with ${versions} ${versions === 1 ? 'version' : 'versions'}. The history is at /afterimage/.\nServe it from the root of a domain, on a static host that does what ${hostDocs} lists.\n`);
  return 0;
}

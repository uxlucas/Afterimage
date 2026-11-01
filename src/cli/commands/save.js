import path from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig, sourceExcludes } from '../config.js';
import { saveVersion } from '../history.js';
import { runBuild } from '../run-build.js';

export const usage = 'afterimage save "Name" [--note "..."]';
export const summary = 'Build the prototype and save it as the next version.';
// What both "afterimage save --help" and "afterimage help save" print.
export const help = `Usage: ${usage}\n\n${summary}\n\n  --note "..."  a note on the version, up to 500 characters; repeat it for more than one\n`;
// Read by the docs tests, which check every flag the agent files name.
export const options = { note: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } };

export async function run(args, { cwd, stdout, stderr, buildStdio }) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options });
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS')) throw error;
    stderr.write(`${error.message}\nUsage: ${usage}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(help);
    return 0;
  }
  const [name, ...extra] = parsed.positionals;
  if (!name || extra.length) {
    stderr.write(`${extra.length ? 'Save takes one name. Put it in quotes.' : 'Save needs a name for the version.'}\nUsage: ${usage}\n`);
    return 2;
  }

  const config = await readConfig(cwd);
  if (config.build) await runBuild(config.build, cwd, { stdio: buildStdio });
  const { version, unchanged } = await saveVersion(
    { historyDir: path.resolve(cwd, config.history), sourceDir: path.resolve(cwd, config.source), exclude: await sourceExcludes(cwd, config) },
    { name, notes: parsed.values.note ?? [] }
  );
  stdout.write(unchanged
    ? `Nothing changed since ${version.id} "${version.name}". Nothing was saved.\n`
    : `Saved ${version.id} "${version.name}".\n`);
  return 0;
}

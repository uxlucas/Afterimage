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

export async function run(args, { cwd, stdout, stderr, buildStdio, largeHistory = 100_000_000 }) {
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
  const { version, unchanged, bytes, history } = await saveProject({ projectDir: cwd, config, name, notes: parsed.values.note ?? [], buildStdio });
  if (unchanged) {
    stdout.write(`Nothing changed since ${version.id} "${version.name}". Nothing was saved.\n`);
    return 0;
  }
  stdout.write(`Saved ${version.id} "${version.name}".\n`);
  stdout.write(`${version.id} adds ${formatSize(bytes)}. History: ${history.versions} ${history.versions === 1 ? 'version' : 'versions'}, ${formatSize(history.bytes)}.\n`);
  // Every version is a full copy and every deploy carries all of them, so growth is said out loud rather than capped.
  if (history.bytes >= largeHistory) {
    stdout.write(`The history is ${formatSize(history.bytes)}, and every deploy carries all of it. Large images and video are the usual cause: ${sizeDocs}\n`);
  }
  return 0;
}

// Builds the prototype when it has a build, then saves it as the next version. Shared by this command and the overlay's
// Save button, which reaches it through afterimage dev.
export async function saveProject({ projectDir, config, name, notes = [], buildStdio }) {
  if (config.build) await runBuild(config.build, projectDir, { stdio: buildStdio });
  return saveVersion(
    { historyDir: path.resolve(projectDir, config.history), sourceDir: path.resolve(projectDir, config.source), exclude: await sourceExcludes(projectDir, config) },
    { name, notes }
  );
}

export const sizeDocs ='https://github.com/uxlucas/Afterimage/blob/main/docs/limits.md#history-size';

// Decimal units, as macOS Finder and npm count them.
export function formatSize(bytes) {
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 999_500) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 999_950_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

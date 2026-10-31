import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { projectExcludes } from './config.js';
import { readSnapshot, verifyHistory } from './history.js';
import { runBuild } from './run-build.js';

// The package's own viewer and runtime, found from this file so they work from node_modules and from a checkout.
export const packagedViewerDir = fileURLToPath(new URL('../../viewer-dist/', import.meta.url));
export const packagedRuntimeDir = fileURLToPath(new URL('../runtime/', import.meta.url));

const servedFolder = 'afterimage';
const keep = { recursive: true, force: true, maxRetries: 3 };
const lockedCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Windows and macOS ignore case by default, so two spellings of one folder must compare equal there.
const fold = value => (process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value);

// True when child is parent or lies under it. A folder named "..x" is inside; only ".." itself leaves.
export function isSameOrInside(child, parent) {
  const relative = path.relative(fold(parent), fold(child));
  return !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

// Out is replaced wholesale, so it must not be, hold or sit inside anything that is not generated output.
function checkOut({ outDir, projectDir, historyDir, sourceDir, includeApp }) {
  const replaces = dir => { throw new Error(`"out" (${outDir}) would replace ${dir}. Point "out" at a folder of its own.`); };
  if (isSameOrInside(projectDir, outDir)) replaces(projectDir);
  if (isSameOrInside(historyDir, outDir)) replaces(historyDir);
  if (isSameOrInside(outDir, historyDir)) throw new Error(`"out" (${outDir}) is inside the history folder, where saved versions live. Point "out" at a folder of its own.`);
  if (!includeApp) return;
  if (isSameOrInside(sourceDir, outDir)) replaces(sourceDir);
  // With the prototype at the project root, config.js already leaves out of the app; anywhere else it would copy itself.
  if (!isSameOrInside(projectDir, sourceDir) && isSameOrInside(outDir, sourceDir)) {
    throw new Error(`"out" (${outDir}) is inside the source folder, so each build would copy the last one into itself. Point "out" outside ${sourceDir}.`);
  }
}

// Leftovers of a build that crashed, matched by this file's own naming so nothing else is touched.
async function removeStale(outDir) {
  const pattern = new RegExp(`^${escapePattern(path.basename(outDir))}\\.tmp-[0-9a-f]{8}(\\.old)?$`);
  try {
    for (const name of await fs.readdir(path.dirname(outDir))) {
      if (pattern.test(name)) await fs.rm(path.join(path.dirname(outDir), name), keep);
    }
  } catch { /* best effort */ }
}

const collision = () => new Error(`The app already has an ${servedFolder} file or folder, and Afterimage serves the history at /${servedFolder}/. Rename it or add it to exclude.`);

// A top-level file called afterimage would stop readSnapshot with a less helpful message, so look for it first.
async function checkCollision(sourceDir, excluded) {
  let entries = [];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entries.some(entry => !entry.isDirectory() && entry.name.toLowerCase() === servedFolder && !excluded.includes(entry.name))) throw collision();
}

// Builds the deployable site: the app at the root, the viewer and every saved version under /afterimage/.
// With includeApp false (the dev server) only the afterimage/ folder is made. The old out stays in place until the
// new one is complete, so a failure anywhere leaves the previous site untouched.
// Returns warnings for the caller to print. fsOps lets tests make the swap fail; it is not part of the public signature.
export async function assembleSite({ projectDir, config, viewerDir = packagedViewerDir, runtimeDir = packagedRuntimeDir, includeApp = true, buildStdio, fsOps = {} }) {
  const ops = { rename: fs.rename, rm: fs.rm, ...fsOps };
  const historyDir = path.resolve(projectDir, config.history);
  const sourceDir = path.resolve(projectDir, config.source);
  const outDir = path.resolve(projectDir, config.out);
  const warnings = [];

  const manifest = await verifyHistory(historyDir);
  if (!manifest?.versions.length) throw new Error('Save a first version with: afterimage save "Name"');
  try {
    await fs.access(path.join(viewerDir, 'index.html'));
  } catch {
    throw new Error('The viewer is not built. Run "npm run build:viewer" first.');
  }
  // Without the runtime the viewer still loads, but every built app in it renders without its files, so a package
  // that lost it must fail here rather than ship.
  try {
    await fs.access(runtimeDir);
  } catch {
    throw new Error(`The frame runtime is missing (${runtimeDir}). Reinstall afterimage-cli.`);
  }
  checkOut({ outDir, projectDir: path.resolve(projectDir), historyDir, sourceDir, includeApp });
  // Asked twice: the user's build command can remove or create out, so the answer before it may be stale at the swap.
  const outExists = async () => {
    const found = await fs.lstat(outDir).catch(() => null);
    if (found && !found.isDirectory()) throw new Error(`"out" (${outDir}) exists and is not a folder. Remove it or point "out" at another path.`);
    return Boolean(found);
  };
  await outExists();
  await removeStale(outDir);

  let app;
  if (includeApp) {
    if (config.build) await runBuild(config.build, projectDir, { stdio: buildStdio, closing: 'Nothing was built.' });
    const excluded = projectExcludes(config);
    await checkCollision(sourceDir, excluded);
    // Same selection as a save, so the live root matches what a save captures.
    app = await readSnapshot(sourceDir, { exclude: excluded });
    // Case-insensitive: on Windows and macOS Afterimage/ is the same folder.
    if ([...app.keys()].some(name => name.split('/')[0].toLowerCase() === servedFolder)) throw collision();
  }

  await fs.mkdir(path.dirname(outDir), { recursive: true });
  const staging = path.join(path.dirname(outDir), `${path.basename(outDir)}.tmp-${randomUUID().slice(0, 8)}`);
  const previous = `${staging}.old`;
  // A locked file (a static server, an indexer) often clears on its own, so try once more before giving up.
  const rename = async (from, to) => {
    try {
      await ops.rename(from, to);
    } catch (error) {
      if (!lockedCodes.has(error.code)) throw error;
      await wait(250);
      try {
        await ops.rename(from, to);
      } catch (again) {
        if (!lockedCodes.has(again.code)) throw again;
        // The caller adds what became of the old site, which depends on how far the swap got.
        throw Object.assign(new Error(`Could not replace ${config.out}: a file in it is in use. Close anything serving it (like afterimage dev or a static server) and run build again.`, { cause: again }), { locked: true });
      }
    }
  };
  try {
    const served = path.join(staging, servedFolder);
    await fs.mkdir(served, { recursive: true });
    for (const [name, bytes] of app ?? []) {
      const target = path.join(staging, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    await fs.cp(viewerDir, served, { recursive: true });
    // Only what versions.json lists. The history folder also holds the save lock and stage folders.
    await fs.copyFile(path.join(historyDir, 'versions.json'), path.join(served, 'versions.json'));
    for (const { id } of manifest.versions) {
      await fs.cp(path.join(historyDir, 'versions', id), path.join(served, 'versions', id), { recursive: true });
    }
    // map.js is for node (history.js injects with it); frame.js and sw.js carry their own copies of what they need,
    // so the browser never loads it and it is not served.
    await fs.cp(runtimeDir, served, { recursive: true, filter: source => path.relative(runtimeDir, source) !== 'map.js' });

    // Windows cannot rename over an existing folder, so the old site steps aside first and comes back if the swap fails.
    const existing = await outExists();
    const unchanged = error => { if (error.locked) error.message += ' The previous site is unchanged.'; return error; };
    if (existing) await rename(outDir, previous).catch(error => { throw unchanged(error); });
    try {
      await rename(staging, outDir);
    } catch (error) {
      if (existing) {
        try {
          await ops.rename(previous, outDir);
        } catch {
          // Keep the original error as the story; only add where the old site is.
          throw new Error(`${error.message} The previous site could not be put back; it was left at ${previous}.`, { cause: error });
        }
      }
      throw existing ? unchanged(error) : error;
    }
    // The new site is already live, so failing to clear the old one is a warning, not a failed build.
    if (existing) {
      try {
        await ops.rm(previous, keep);
      } catch (error) {
        warnings.push(`Built, but could not remove the previous site at ${previous}: ${error.message}. It is safe to delete; the next build tries again.`);
      }
    }
  } catch (error) {
    await fs.rm(staging, keep).catch(() => {});
    throw error;
  }
  return { outDir, versions: manifest.versions.length, warnings };
}

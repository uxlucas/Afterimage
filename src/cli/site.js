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

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Out is replaced wholesale, so it must not be (or hold) anything that is not generated output.
function checkOut(outDir, protectedDirs) {
  for (const dir of protectedDirs) {
    if (dir === outDir || isInside(outDir, dir)) {
      throw new Error(`"out" (${outDir}) would replace ${dir}. Point "out" at a folder of its own.`);
    }
  }
}

// Builds the deployable site: the app at the root, the viewer and every saved version under /afterimage/.
// With includeApp false (the dev server) only the afterimage/ folder is made. The old out stays in place until the
// new one is complete, so a failure anywhere leaves the previous site untouched.
export async function assembleSite({ projectDir, config, viewerDir = packagedViewerDir, runtimeDir = packagedRuntimeDir, includeApp = true, buildStdio }) {
  const historyDir = path.resolve(projectDir, config.history);
  const sourceDir = path.resolve(projectDir, config.source);
  const outDir = path.resolve(projectDir, config.out);

  const manifest = await verifyHistory(historyDir);
  if (!manifest?.versions.length) throw new Error('Save a first version with: afterimage save "Name"');
  try {
    await fs.access(path.join(viewerDir, 'index.html'));
  } catch {
    throw new Error('The viewer is not built. Run "npm run build:viewer" first.');
  }
  checkOut(outDir, [path.resolve(projectDir), historyDir, ...(includeApp ? [sourceDir] : [])]);

  let app;
  if (includeApp) {
    if (config.build) await runBuild(config.build, projectDir, { stdio: buildStdio, closing: 'Nothing was built.' });
    // Same selection as a save, so the live root matches what a save captures.
    app = await readSnapshot(sourceDir, { exclude: projectExcludes(config) });
    // Case-insensitive: on Windows and macOS Afterimage/ is the same folder.
    if ([...app.keys()].some(name => name.split('/')[0].toLowerCase() === servedFolder)) {
      throw new Error(`The app already has an ${servedFolder}/ folder, and Afterimage serves the history there. Rename it or add it to exclude.`);
    }
  }

  await fs.mkdir(path.dirname(outDir), { recursive: true });
  const staging = path.join(path.dirname(outDir), `${path.basename(outDir)}.tmp-${randomUUID().slice(0, 8)}`);
  const previous = `${staging}.old`;
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
    // The runtime folder is filled by a later step; none yet is fine.
    try {
      await fs.cp(runtimeDir, served, { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Windows cannot rename over an existing folder, so the old site steps aside first and comes back if the swap fails.
    let movedAside = false;
    try {
      await fs.rename(outDir, previous);
      movedAside = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(staging, outDir);
    } catch (error) {
      if (movedAside) await fs.rename(previous, outDir);
      throw error;
    }
    await fs.rm(previous, keep);
  } catch (error) {
    await fs.rm(staging, keep);
    throw error;
  }
  return { outDir, versions: manifest.versions.length };
}

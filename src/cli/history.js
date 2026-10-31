import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateManifest } from '../engine/manifest.js';

const publicExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.wasm', '.txt', '.webmanifest', '.xml', '.pdf']);
// Source maps are build output nobody browses in a saved version, so they are left out instead of failing the save.
const skippedExtensions = new Set(['.map']);

// Finder, Explorer and macOS file copies leave these in any folder they touch. They are never part of a
// prototype, so they are skipped rather than saved or treated as an error.
export const isSystemFile = name => ['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(name) || name.startsWith('._');

// An exclude is a path relative to the folder being read. It matches that file, or anything under that folder.
const isExcluded = (relative, exclude) => exclude.some(entry => relative === entry || relative.startsWith(`${entry}/`));
const cleanExclude = entry => entry.replace(/^\.\//, '').replace(/\/+$/, '');

// Strict is for saved snapshots: anything save would have skipped (hidden files, source maps) means the folder was
// edited after saving, and a deploy copying it would publish that file.
export async function readSnapshot(directory, { exclude = [], strict = false } = {}) {
  const excluded = exclude.map(cleanExclude);
  const files = new Map();
  async function visit(relative = '') {
    const folder = path.join(directory, relative);
    if (!(await fs.lstat(folder)).isDirectory()) throw new Error(`Expected a regular directory: ${folder}`);
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      // Excludes come first so a project can leave out a folder (a linked node_modules, say) without it being inspected.
      if (isSystemFile(entry.name) || isExcluded(name, excluded)) continue;
      if (entry.name.startsWith('.')) {
        if (strict) throw new Error(`Unexpected hidden file in a saved version: ${name}`);
        continue;
      }
      if (entry.isSymbolicLink()) throw new Error(`Remove the link from the public prototype, or add it to exclude: ${name}`);
      const extension = path.extname(name).toLowerCase();
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && skippedExtensions.has(extension)) {
        if (strict) throw new Error(`Unexpected file in a saved version: ${name}`);
      } else if (entry.isFile() && publicExtensions.has(extension)) files.set(name, await fs.readFile(path.join(directory, name)));
      else throw new Error(`Unsupported file in the prototype: ${name}. Add it to exclude if it is not part of the prototype.`);
    }
  }
  await visit();
  if (!files.has('index.html')) throw new Error(`Missing index.html in ${directory}`);
  return files;
}

export function fingerprint(files) {
  const entries = [...files].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

const manifestPath = historyDir => path.join(historyDir, 'versions.json');

// No versions.json means nothing has been saved yet, which is a normal state and not an error.
export async function readHistory(historyDir) {
  let text;
  try {
    text = await fs.readFile(manifestPath(historyDir), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return validateManifest(JSON.parse(text));
}

export async function verifyHistory(historyDir) {
  const manifest = await readHistory(historyDir);
  const versionsDir = path.join(historyDir, 'versions');
  let directories = [];
  try {
    directories = await fs.readdir(versionsDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const expected = new Set((manifest?.versions ?? []).map(version => version.id));
  for (const name of directories) {
    if (!expected.has(name) && !isSystemFile(name)) throw new Error(`Unlisted snapshot found at ${path.join(versionsDir, name)}. Resolve it before saving or deploying.`);
  }
  for (const version of manifest?.versions ?? []) {
    const files = await readSnapshot(path.join(versionsDir, version.id), { strict: true });
    if (fingerprint(files) !== version.sha256) {
      throw new Error(`${version.id} has changed since it was saved. Restore its original files; saved versions are never edited.`);
    }
  }
  return manifest;
}

export async function saveVersion({ historyDir, sourceDir, exclude = [] }, { name, notes = [] }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
      !Array.isArray(notes) || notes.some(note => typeof note !== 'string' || !note.trim() || note.length > 500)) {
    throw new Error('Provide a version name up to 120 characters and notes up to 500 characters each.');
  }
  await fs.mkdir(historyDir, { recursive: true });
  const lockPath = path.join(historyDir, '.afterimage-save.lock');
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another save is active. If it crashed, delete .afterimage-save.lock in the history folder once no save is running.');
    throw error;
  }
  const stage = path.join(historyDir, `.afterimage-stage-${randomUUID()}`);
  let destination;
  let promoted = false;
  let committed = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const manifest = (await verifyHistory(historyDir)) ?? { schemaVersion: 1, versions: [] };
    const latest = manifest.versions[0];
    const files = await readSnapshot(sourceDir, { exclude });
    const sha256 = fingerprint(files);
    if (latest && sha256 === latest.sha256) return { version: latest, unchanged: true };
    const number = latest ? Number(latest.id.slice(1)) + 1 : 1;
    if (!Number.isSafeInteger(number)) throw new Error('Version number exceeds the supported range.');
    const version = {
      id: `v${number}`, name: name.trim(), label: `Version ${number}`,
      file: `versions/v${number}/index.html`, notes: notes.map(note => note.trim()),
      savedAt: new Date().toISOString(), sha256,
    };
    const stagedSnapshot = path.join(stage, 'snapshot');
    await fs.mkdir(stagedSnapshot, { recursive: true });
    for (const [name, bytes] of files) {
      const target = path.join(stagedSnapshot, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' });
    }
    if (fingerprint(await readSnapshot(sourceDir, { exclude })) !== sha256) {
      throw new Error('The prototype changed during the save. Run the command again after editing stops.');
    }
    manifest.versions.unshift(version);
    const stagedManifest = path.join(stage, 'versions.json');
    await fs.writeFile(stagedManifest, JSON.stringify(manifest, null, 2) + '\n');
    await fs.mkdir(path.join(historyDir, 'versions'), { recursive: true });
    destination = path.join(historyDir, 'versions', version.id);
    await fs.rename(stagedSnapshot, destination);
    promoted = true;
    // Publish the manifest last so readers never see a half-written snapshot.
    await fs.rename(stagedManifest, manifestPath(historyDir));
    committed = true;
    return { version, unchanged: false };
  } finally {
    try {
      if (promoted && !committed) await fs.rm(destination, { recursive: true, force: true });
      await fs.rm(stage, { recursive: true, force: true });
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

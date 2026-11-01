import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateManifest } from '../engine/manifest.js';
import { injectFrameScript } from '../runtime/map.js';

// Finder, Explorer and macOS file copies leave these in any folder they touch. They are never part of a
// prototype, so they are skipped rather than saved or treated as an error.
export const isSystemFile = name => ['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(name) || name.startsWith('._');

// An exclude is a path relative to the folder being read. It matches that file, or anything under that folder.
const isExcluded = (relative, exclude) => exclude.some(entry => relative === entry || relative.startsWith(`${entry}/`));
const cleanExclude = entry => entry.replace(/^\.\//, '').replace(/\/+$/, '');

// Every file under directory, by forward-slash path in name order, minus OS clutter, excludes and whatever
// skip(name, entry) leaves out. skip may also throw, to refuse a file outright.
async function readFiles(directory, exclude, skip) {
  const excluded = exclude.map(cleanExclude);
  const files = new Map();
  async function visit(relative = '') {
    const folder = path.join(directory, relative);
    if (!(await fs.lstat(folder)).isDirectory()) throw new Error(`Expected a regular directory: ${folder}`);
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      // Excludes come first so a project can leave out a folder (a linked node_modules, say) without it being inspected.
      if (isSystemFile(entry.name) || isExcluded(name, excluded) || skip(name, entry)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Remove the link from the public prototype, or add it to exclude: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.set(name, await fs.readFile(path.join(directory, name)));
      else throw new Error(`Not a regular file or folder: ${name}. Add it to exclude if it is not part of the prototype.`);
    }
  }
  await visit();
  if (!files.has('index.html')) throw new Error(`Missing index.html in ${directory}`);
  return files;
}

// What a saved version keeps: every file the prototype has, whatever its type, except hidden files and folders (an
// .env, a .git) and source maps, which are build output nobody browses in a saved version.
// Strict is for saved snapshots: anything save would have skipped means the folder was edited after saving, and a
// deploy copying it would publish that file.
export function readSnapshot(directory, { exclude = [], strict = false } = {}) {
  return readFiles(directory, exclude, (name, entry) => {
    const hidden = entry.name.startsWith('.');
    if (!hidden && !(entry.isFile() && path.extname(name).toLowerCase() === '.map')) return false;
    if (strict) throw new Error(`Unexpected ${hidden ? 'hidden file' : 'file'} in a saved version: ${name}`);
    return true;
  });
}

// What the live root gets: the app's own output as it is, source maps, dotfiles and host files (_redirects,
// .well-known/) included, because the app's own build ships them. A repository or installed packages are never site
// files. A plain folder (the prototype is the project root) also holds the project's hidden files (.env, .gitignore,
// .vscode/), which must never go public, so there only .well-known/ is kept.
export function readApp(directory, { exclude = [], plain = false } = {}) {
  return readFiles(directory, exclude, (name, entry) => {
    if (entry.isDirectory() && (entry.name === '.git' || entry.name === 'node_modules')) return true;
    return plain && entry.name.startsWith('.') && name !== '.well-known';
  });
}

export function fingerprint(files) {
  const entries = [...files].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

// Every saved page loads the frame runtime first, so a built app finds its files and its routes inside the viewer
// (src/runtime/sw.js says how). latin1 turns each byte into one character and back, so only the inserted tag
// changes. A UTF-16 page would be corrupted by single-byte text, so it is saved as it is.
function withFrameScript(files, id) {
  const isUtf16 = bytes => (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  return new Map([...files].map(([name, bytes]) => [name, path.extname(name).toLowerCase() === '.html' && !isUtf16(bytes)
    ? Buffer.from(injectFrameScript(bytes.toString('latin1'), id), 'latin1')
    : bytes]));
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
    const source = await readSnapshot(sourceDir, { exclude });
    const sourceSha = fingerprint(source);
    // The latest version's bytes carry its own id in the tag, so the same build is compared as it would have been
    // saved then. A version saved without the runtime (Northwind) matches the source as it is.
    if (latest && (fingerprint(withFrameScript(source, latest.id)) === latest.sha256 || sourceSha === latest.sha256)) {
      return { version: latest, unchanged: true };
    }
    const number = latest ? Number(latest.id.slice(1)) + 1 : 1;
    if (!Number.isSafeInteger(number)) throw new Error('Version number exceeds the supported range.');
    const files = withFrameScript(source, `v${number}`);
    const sha256 = fingerprint(files);
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
    if (fingerprint(await readSnapshot(sourceDir, { exclude })) !== sourceSha) {
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

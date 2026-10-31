import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveVersion, readHistory, verifyHistory, readSnapshot, fingerprint } from '../src/cli/history.js';
import { validateManifest } from '../src/engine/manifest.js';

const northwind = fileURLToPath(new URL('./fixtures/northwind-history/', import.meta.url));

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function write(root, files) {
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
}

// A source folder with a small prototype, plus a history folder that is empty or holds Northwind's three versions.
async function fixture(t, { seeded = true } = {}) {
  const root = await temp(t);
  const historyDir = path.join(root, 'history');
  const sourceDir = path.join(root, 'source');
  if (seeded) await fs.cp(northwind, historyDir, { recursive: true });
  else await fs.mkdir(historyDir);
  await write(sourceDir, { 'index.html': '<!doctype html><html><body>checkout</body></html>' });
  return { root, historyDir, sourceDir, options: { historyDir, sourceDir, exclude: [] } };
}

const leftovers = async historyDir => (await fs.readdir(historyDir)).filter(name => name.startsWith('.afterimage-'));

test('the first save creates versions.json with v1', async t => {
  const { historyDir, options } = await fixture(t, { seeded: false });
  assert.equal(await readHistory(historyDir), null);
  assert.equal(await verifyHistory(historyDir), null);
  const { version, unchanged } = await saveVersion(options, { name: 'First' });
  assert.equal(unchanged, false);
  const manifest = await readHistory(historyDir);
  assert.equal(manifest.versions.length, 1);
  assert.equal(manifest.versions[0].id, 'v1');
  assert.equal(manifest.versions[0].file, 'versions/v1/index.html');
  assert.deepEqual(manifest.versions[0], version);
  assert.deepEqual(await leftovers(historyDir), []);
});

test('a history folder that does not exist yet is created by the first save', async t => {
  const { root, sourceDir } = await fixture(t, { seeded: false });
  const historyDir = path.join(root, 'not', 'yet');
  await saveVersion({ historyDir, sourceDir, exclude: [] }, { name: 'First' });
  assert.equal((await readHistory(historyDir)).versions[0].id, 'v1');
});

test('a prototype at the project root leaves out everything that is not the prototype', async t => {
  const root = await temp(t);
  await write(root, {
    'index.html': '<html></html>', 'style.css': 'a{}', 'node_modules/x.js': 'x',
    'afterimage/versions.json': '{}', '.afterimage/site/index.html': 'site', 'package.json': '{}',
    'package-lock.json': '{}', 'afterimage.config.json': '{}', '.git/HEAD': 'ref', '.env': 'SECRET=1',
  });
  const exclude = ['node_modules', 'afterimage', '.afterimage', 'package.json', 'package-lock.json', 'afterimage.config.json'];
  const files = await readSnapshot(root, { exclude });
  assert.deepEqual([...files.keys()], ['index.html', 'style.css']);
});

test('an exclude matches a file or a whole folder, by path segment', async t => {
  const root = await temp(t);
  await write(root, { 'index.html': 'i', 'docs/a.txt': 'a', 'docs-extra/b.txt': 'b', 'docs.txt': 'c', 'src/docs/d.txt': 'd' });
  assert.deepEqual([...(await readSnapshot(root, { exclude: ['docs'] })).keys()], ['docs-extra/b.txt', 'docs.txt', 'index.html', 'src/docs/d.txt']);
  assert.deepEqual([...(await readSnapshot(root, { exclude: ['docs/a.txt', 'src/docs/'] })).keys()], ['docs-extra/b.txt', 'docs.txt', 'index.html']);
});

test('build output extras are skipped, unknown types fail by name', async t => {
  const root = await temp(t);
  await write(root, { 'index.html': 'i', 'app.js.map': '{}', '.nojekyll': '', 'site.webmanifest': '{}', 'sitemap.xml': '<x/>', 'doc.pdf': 'pdf' });
  assert.deepEqual([...(await readSnapshot(root)).keys()], ['doc.pdf', 'index.html', 'site.webmanifest', 'sitemap.xml']);
  await write(root, { 'data.parquet': 'p' });
  await assert.rejects(readSnapshot(root), error => error.message.includes('data.parquet') && error.message.includes('exclude'));
  assert.equal((await readSnapshot(root, { exclude: ['data.parquet'] })).has('data.parquet'), false);
});

test('Northwind fingerprints are unchanged', async t => {
  const { historyDir } = await fixture(t);
  const recorded = JSON.parse(await fs.readFile(path.join(northwind, 'versions.json'), 'utf8')).versions.map(version => version.sha256);
  assert.deepEqual(recorded, [
    '85dec3f7700c45aad83b2f37a6af079ba871fa6fb5770ee5fecd91278f4dedf7',
    '503442a80483fdbf97cacb84200d6b6b2574573f2d8b07390ca0401c2f3df916',
    '2080d5baa6b4a94b99a2fac69f1f6733bb33c98544f40f0e8175adf2097a2aac',
  ]);
  const manifest = await verifyHistory(historyDir);
  assert.deepEqual(manifest.versions.map(version => version.sha256), recorded);
});

test('a save keeps all assets and history, and the result survives another save and a deployment copy', async t => {
  const { root, historyDir, sourceDir, options } = await fixture(t);
  const initial = await verifyHistory(historyDir);
  await write(sourceDir, { 'assets/sample.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  const sourceHash = fingerprint(await readSnapshot(sourceDir));
  const title = 'Checkout "revision" <3';
  const { version, unchanged } = await saveVersion(options, { name: title, notes: ['First note', 'Second note'] });
  assert.equal(unchanged, false);
  assert.equal(version.id, 'v4');
  const saved = (await verifyHistory(historyDir)).versions[0];
  assert.equal(saved.name, title);
  assert.deepEqual(saved.notes, ['First note', 'Second note']);
  assert.equal(saved.sha256, sourceHash);
  assert.ok(Number.isFinite(Date.parse(saved.savedAt)));
  assert.equal(await fs.readFile(path.join(historyDir, 'versions', saved.id, 'assets', 'sample.svg'), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  await fs.appendFile(path.join(sourceDir, 'index.html'), '\n<!-- later edit -->');
  const next = await saveVersion(options, { name: 'Later edit' });
  assert.equal(next.version.id, 'v5');
  const final = await verifyHistory(historyDir);
  assert.deepEqual(final.versions.slice(2), initial.versions);
  assert.equal(final.versions[1].sha256, sourceHash);

  const deployed = path.join(root, 'deployment', 'afterimage');
  await fs.cp(historyDir, deployed, { recursive: true });
  assert.deepEqual(await verifyHistory(deployed), final);
  for (const entry of final.versions) assert.ok((await fs.readFile(path.join(deployed, entry.file), 'utf8')).includes('<html'));
});

test('An unchanged save leaves both the manifest bytes and modification time intact', async t => {
  const { historyDir, options } = await fixture(t);
  await saveVersion(options, { name: 'First save' });
  const file = path.join(historyDir, 'versions.json');
  const before = await fs.readFile(file);
  const stat = await fs.stat(file);
  const result = await saveVersion(options, { name: 'Duplicate save' });
  assert.equal(result.unchanged, true);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await fs.stat(file)).mtimeMs, stat.mtimeMs);
  assert.deepEqual(await leftovers(historyDir), []);
});

test('A changed or missing historical snapshot blocks saving and deployment checks', async t => {
  const { historyDir, options } = await fixture(t);
  const before = await fs.readFile(path.join(historyDir, 'versions.json'));
  await fs.appendFile(path.join(historyDir, 'versions', 'v1', 'index.html'), 'changed');
  await assert.rejects(saveVersion(options, { name: 'Must fail' }), /v1 has changed/);
  await assert.rejects(verifyHistory(historyDir), /v1 has changed/);
  assert.deepEqual(await fs.readFile(path.join(historyDir, 'versions.json')), before);
  await fs.unlink(path.join(historyDir, 'versions', 'v1', 'index.html'));
  await assert.rejects(verifyHistory(historyDir), /Missing index.html/);
});

test('Invalid source and invalid arguments leave the history untouched', async t => {
  const { historyDir, sourceDir, options } = await fixture(t);
  const before = await readHistory(historyDir);
  await assert.rejects(saveVersion(options, { name: '' }), /version name/);
  await assert.rejects(saveVersion(options, { name: 'Bad note', notes: [''] }), /version name/);
  await write(sourceDir, { 'data.parquet': 'p' });
  await assert.rejects(saveVersion(options, { name: 'Must fail' }), /data\.parquet/);
  assert.deepEqual(await readHistory(historyDir), before);
  assert.deepEqual(await leftovers(historyDir), []);
  await fs.unlink(path.join(sourceDir, 'data.parquet'));
  await fs.unlink(path.join(sourceDir, 'index.html'));
  await assert.rejects(saveVersion(options, { name: 'Must fail' }), /Missing index.html/);
});

test('Hidden files are skipped instead of saved, and links still fail', async t => {
  const { historyDir, sourceDir, options } = await fixture(t);
  await write(sourceDir, { '.env': 'TEST_SECRET=not-for-deployment', '.hidden/a.txt': 'a' });
  const { version } = await saveVersion(options, { name: 'With a secret next to it' });
  assert.deepEqual(await fs.readdir(path.join(historyDir, 'versions', version.id)), ['index.html']);
  try {
    await fs.symlink(path.join(sourceDir, 'index.html'), path.join(sourceDir, 'link.html'));
  } catch {
    return; // Windows without symlink rights: nothing to assert.
  }
  await assert.rejects(readSnapshot(sourceDir), /link\.html/);
  assert.equal((await readSnapshot(sourceDir, { exclude: ['link.html'] })).has('link.html'), false);
});

test('Files the operating system drops in folders are skipped, not saved and not fatal', async t => {
  const { historyDir, sourceDir, options } = await fixture(t);
  const junk = ['.DS_Store', '._index.html', 'Thumbs.db', 'desktop.ini'];
  const before = await readSnapshot(sourceDir);
  for (const name of junk) {
    await write(sourceDir, { [name]: 'os' });
    await write(historyDir, { [`versions/${name}`]: 'os', [`versions/v1/${name}`]: 'os' });
  }
  assert.deepEqual([...(await readSnapshot(sourceDir)).keys()], [...before.keys()]);
  await verifyHistory(historyDir);
  const { version } = await saveVersion(options, { name: 'Saved from a Mac' });
  const saved = await fs.readdir(path.join(historyDir, 'versions', version.id));
  assert.equal(saved.some(name => junk.includes(name)), false);
});

test('An active save lock prevents a second writer from changing the manifest', async t => {
  const { historyDir, options } = await fixture(t);
  const before = await readHistory(historyDir);
  await fs.writeFile(path.join(historyDir, '.afterimage-save.lock'), 'owned by another writer');
  await assert.rejects(saveVersion(options, { name: 'Must wait' }), /Another save is active/);
  assert.equal(await fs.readFile(path.join(historyDir, '.afterimage-save.lock'), 'utf8'), 'owned by another writer');
  assert.deepEqual(await readHistory(historyDir), before);
});

test('An unlisted snapshot is never overwritten', async t => {
  const { historyDir, options } = await fixture(t);
  const before = await readHistory(historyDir);
  const folder = path.join(historyDir, 'versions', 'v4');
  await write(folder, { 'index.html': 'keep this' });
  await assert.rejects(saveVersion(options, { name: 'Must fail' }), /Unlisted snapshot/);
  assert.equal(await fs.readFile(path.join(folder, 'index.html'), 'utf8'), 'keep this');
  assert.deepEqual(await readHistory(historyDir), before);
});

test('A snapshot with no manifest is never overwritten either', async t => {
  const { historyDir, options } = await fixture(t, { seeded: false });
  const folder = path.join(historyDir, 'versions', 'v1');
  await write(folder, { 'index.html': 'keep this' });
  await assert.rejects(saveVersion(options, { name: 'Must fail' }), /Unlisted snapshot/);
  assert.equal(await fs.readFile(path.join(folder, 'index.html'), 'utf8'), 'keep this');
  assert.equal(await readHistory(historyDir), null);
});

test('Manifest validation rejects duplicate IDs, unsafe paths and unsupported formats', async t => {
  const { historyDir, options } = await fixture(t);
  const manifest = await readHistory(historyDir);
  assert.throws(() => validateManifest({ schemaVersion: 2, versions: manifest.versions }), /unsupported/);
  assert.throws(() => validateManifest({ schemaVersion: 1, versions: [manifest.versions[0], manifest.versions[0]] }), /invalid entry/);
  assert.throws(() => validateManifest({ schemaVersion: 1, versions: [{ ...manifest.versions[0], file: '../private/index.html' }] }), /invalid entry/);
  await fs.writeFile(path.join(historyDir, 'versions.json'), '{broken');
  await assert.rejects(saveVersion(options, { name: 'Must fail' }), SyntaxError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli/main.js';
import { readConfig, writeConfig } from '../src/cli/config.js';
import { startDev } from '../src/cli/commands/dev.js';
import { frameTag } from '../src/runtime/map.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// Small stand-ins for the package's viewer and runtime, so these tests do not need a viewer build.
async function fixtures(t) {
  const root = await temp(t);
  const viewerDir = path.join(root, 'viewer');
  await fs.mkdir(path.join(viewerDir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(viewerDir, 'index.html'), '<title>viewer</title>');
  await fs.writeFile(path.join(viewerDir, 'assets/viewer.js'), 'viewer();');
  return { viewerDir, runtimeDir: path.join(root, 'runtime') };
}

async function run(cwd, args, extra = {}) {
  const out = [];
  const err = [];
  const code = await main(args, { cwd, stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, buildStdio: 'ignore', ...extra });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

// A project whose prototype is dist/index.html, with the first version already saved unless told otherwise.
async function project(t, { saved = true } = {}) {
  const root = await temp(t);
  await writeConfig(root, { source: 'dist', build: null, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'plain' });
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>One</h1>');
  if (saved) assert.equal((await run(root, ['save', 'First'])).code, 0);
  return root;
}

async function start(t, root, dirs, options = {}) {
  const events = { updates: [], errors: [] };
  const dev = await startDev({
    projectDir: root,
    config: await readConfig(root),
    port: 0,
    debounceMs: 20,
    onUpdate: update => events.updates.push(update),
    onError: error => events.errors.push(error),
    ...dirs,
    ...options
  });
  t.after(() => dev.close());
  return { dev, events };
}

// Waits for something the code under test does on its own, such as the watcher noticing a save.
async function until(condition, what) {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${what}.`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const get = (dev, pathname, init) => fetch(new URL(pathname, dev.url), init);
const exists = target => fs.access(target).then(() => true, () => false);

test('dev with no versions explains how to save one', async t => {
  const root = await project(t, { saved: false });
  const result = await run(root, ['dev'], await fixtures(t));
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'Save a first version with: afterimage save "Name"\n');
  assert.equal(result.stdout, '');
});

test('dev without a config says to run init', async t => {
  const result = await run(await temp(t), ['dev']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /afterimage init/);
});

test('dev takes only --port and refuses a port that is not one', async t => {
  const root = await project(t);
  for (const args of [['--port', 'abc'], ['--port', '0'], ['--port', '70000'], ['--port'], ['--bogus'], ['extra']]) {
    const result = await run(root, ['dev', ...args]);
    assert.equal(result.code, 2, args.join(' '));
    assert.match(result.stderr, /Usage: afterimage dev/);
  }
  const help = await run(root, ['dev', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: afterimage dev \[--port N\]/);
});

test('dev serves the history at /afterimage/ from its own folder and never touches out', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const { dev } = await start(t, root, dirs);

  assert.match(dev.url, /^http:\/\/localhost:\d+\/afterimage\/$/);
  const page = await get(dev, '/afterimage/');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<title>viewer</title>');
  const manifest = await (await get(dev, '/afterimage/versions.json')).json();
  assert.deepEqual(manifest.versions.map(version => version.id), ['v1']);
  assert.equal(await (await get(dev, '/afterimage/versions/v1/index.html')).text(), `${frameTag('v1')}<h1>One</h1>`);

  assert.equal((await get(dev, '/afterimage/nope.txt')).status, 404);
  const toViewer = await get(dev, '/afterimage', { redirect: 'manual' });
  assert.equal(toViewer.status, 302);
  assert.equal(toViewer.headers.get('location'), '/afterimage/');
  assert.equal((await get(dev, '/', { redirect: 'manual' })).headers.get('location'), '/afterimage/');

  // The app is not part of dev, and build's folder is left alone so the two can run together.
  assert.equal((await get(dev, '/index.html')).status, 404);
  assert.equal(await exists(path.join(root, '.afterimage/dev/afterimage/index.html')), true);
  assert.equal(await exists(path.join(root, '.afterimage/site')), false);
});

// A free port whose neighbour is free too, held on `host`. Returns null when this machine cannot listen on that host.
async function holdPort(host) {
  for (;;) {
    const holder = net.createServer();
    try {
      await new Promise((resolve, reject) => holder.once('error', reject).listen(0, host, resolve));
    } catch (error) {
      if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return null;
      throw error;
    }
    const port = holder.address().port;
    const neighbour = net.createServer();
    const free = await new Promise(resolve => neighbour.once('error', () => resolve(false)).listen(port + 1, host, () => resolve(true)));
    if (free) await new Promise(resolve => neighbour.close(resolve));
    if (free) return { holder, port };
    await new Promise(resolve => holder.close(resolve));
  }
}

// Windows lets 127.0.0.1 bind while another server holds the same port on a wildcard or IPv6 address, so each way of
// holding a port is tested.
for (const host of ['127.0.0.1', '0.0.0.0', '::', '::1']) {
  test(`a port held on ${host} moves to the next free one`, async t => {
    const held = await holdPort(host);
    if (!held) return t.skip(`${host} is not available here`);
    t.after(() => new Promise(resolve => held.holder.close(resolve)));
    const dirs = await fixtures(t);
    const root = await project(t);

    const { dev } = await start(t, root, dirs, { port: held.port });
    assert.equal(new URL(dev.url).port, String(held.port + 1));
    assert.equal((await get(dev, '/afterimage/')).status, 200);
  });
}

test('a request path that cannot be decoded, or holds a NUL, gets 400 and logs nothing', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const { dev } = await start(t, root, dirs);
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  assert.equal((await get(dev, '/afterimage/%00')).status, 400);
  assert.equal((await get(dev, '/afterimage/versions/%E0%A4%A')).status, 400);
  assert.deepEqual(logged, []);
});

test('several quick writes to versions.json produce one update', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const { events } = await start(t, root, dirs, { debounceMs: 300 });
  const manifestFile = path.join(root, 'afterimage/versions.json');
  const bytes = await fs.readFile(manifestFile);
  for (let i = 0; i < 5; i++) await fs.writeFile(manifestFile, bytes);
  await until(() => events.updates.length > 0, 'dev to notice the writes');
  // Anything the burst had left over would arrive within another debounce or two.
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(events.updates.length, 1);
  assert.deepEqual(events.errors, []);
});

test('a save made while dev runs shows up without restarting it', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const { dev, events } = await start(t, root, dirs);

  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Two</h1>');
  assert.equal((await run(root, ['save', 'Second'])).code, 0);
  await until(() => events.updates.length > 0, 'dev to notice the save');

  assert.equal(events.updates.at(-1).versions, 2);
  const manifest = await (await get(dev, '/afterimage/versions.json')).json();
  assert.deepEqual(manifest.versions.map(version => version.id), ['v2', 'v1']);
  assert.equal(await (await get(dev, '/afterimage/versions/v2/index.html')).text(), `${frameTag('v2')}<h1>Two</h1>`);
  assert.deepEqual(events.errors, []);
});

test('a damaged history reports the error and keeps serving the last good site', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const { dev, events } = await start(t, root, dirs);

  const history = path.join(root, 'afterimage');
  const manifestFile = path.join(history, 'versions.json');
  await fs.writeFile(path.join(history, 'versions/v1/index.html'), '<h1>Edited</h1>');
  await fs.writeFile(manifestFile, await fs.readFile(manifestFile));
  await until(() => events.errors.length > 0, 'dev to report the damage');

  assert.match(events.errors[0].message, /v1 has changed since it was saved/);
  assert.equal(events.updates.length, 0);
  assert.equal(await (await get(dev, '/afterimage/versions/v1/index.html')).text(), `${frameTag('v1')}<h1>One</h1>`);

  // Putting the file back and touching the manifest again recovers on its own.
  await fs.writeFile(path.join(history, 'versions/v1/index.html'), `${frameTag('v1')}<h1>One</h1>`);
  await fs.writeFile(manifestFile, await fs.readFile(manifestFile));
  await until(() => events.updates.length > 0, 'dev to recover');
});

test('close stops the server and the watcher, so the port and the folder are free again', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const { dev, events } = await start(t, root, dirs);
  const port = Number(new URL(dev.url).port);
  await get(dev, '/afterimage/'); // leaves a keep-alive connection behind

  await dev.close();
  await dev.close(); // closing twice is harmless
  await assert.rejects(get(dev, '/afterimage/'));

  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Two</h1>');
  assert.equal((await run(root, ['save', 'Second'])).code, 0);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(events.updates, []);

  const again = await startDev({ projectDir: root, config: await readConfig(root), port, ...dirs });
  t.after(() => again.close());
  assert.equal(new URL(again.url).port, String(port));
});

test('dev prints where it runs, announces updates, and stops cleanly', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const controller = new AbortController();
  const out = [];
  const err = [];
  const running = main(['dev', '--port', '4321'], {
    cwd: root, stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, signal: controller.signal, ...dirs
  });
  await until(() => out.length >= 2, 'dev to start');
  const url = /http:\/\/localhost:(\d+)\/afterimage\//.exec(out[0]);
  assert.ok(url, out[0]);
  assert.ok(Number(url[1]) >= 4321);
  assert.equal(out[0], `Afterimage is running at ${url[0]}\n`);
  assert.equal(out[1], 'Your app keeps running on its own dev server; this only serves the history.\n');

  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Two</h1>');
  assert.equal((await run(root, ['save', 'Second'])).code, 0);
  await until(() => out.length >= 3, 'the update line');
  assert.equal(out[2], 'Updated: 2 versions.\n');

  controller.abort();
  assert.equal(await running, 0);
  assert.deepEqual(err, []);
});

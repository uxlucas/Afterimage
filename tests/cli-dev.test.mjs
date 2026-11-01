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
  const runtimeDir = path.join(root, 'runtime');
  await fs.mkdir(runtimeDir);
  await fs.writeFile(path.join(runtimeDir, 'sw.js'), 'worker();');
  return { viewerDir, runtimeDir };
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

// The overlay on the prototype talks to dev through /afterimage/api/, from the app's own dev server on another port.
const app = 'http://localhost:5173';
const session = async dev => (await get(dev, '/afterimage/api/session', { headers: { Origin: app } })).json();
const saveFrom = (dev, body, origin = app) => get(dev, '/afterimage/api/save', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('dev starts with no versions, so the overlay can offer the first save', async t => {
  const root = await project(t, { saved: false });
  const { dev } = await start(t, root, await fixtures(t));
  assert.deepEqual(await session(dev), { afterimage: 1, versions: 0, latest: null, canSave: true });
  assert.equal((await get(dev, '/afterimage/versions.json')).status, 404);
});

test('the overlay saves through dev, and the save shows up in the history', async t => {
  const root = await project(t, { saved: false });
  const { dev } = await start(t, root, await fixtures(t));

  const first = await saveFrom(dev, { name: 'First', note: 'The first one.' });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('access-control-allow-origin'), app);
  assert.deepEqual(await first.json(), { saved: true, id: 'v1', name: 'First' });
  await until(async () => (await session(dev)).versions === 1, 'the history to update');
  assert.deepEqual((await session(dev)).latest, { id: 'v1', name: 'First' });
  const manifest = await (await get(dev, '/afterimage/versions.json')).json();
  assert.deepEqual(manifest.versions[0].notes, ['The first one.']);

  // The same prototype again saves nothing, and says which version it matches.
  assert.deepEqual(await (await saveFrom(dev, { name: 'Again' })).json(), { saved: false, id: 'v1', name: 'First' });

  // With no name, a version is named by its number.
  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Two</h1>');
  assert.deepEqual(await (await saveFrom(dev, {})).json(), { saved: true, id: 'v2', name: 'Version 2' });
});

test('a failed save says why, and saves nothing', async t => {
  const root = await project(t, { saved: false });
  const config = await readConfig(root);
  await writeConfig(root, { ...config, build: 'node -e "process.exit(4)"' });
  const { dev } = await start(t, root, await fixtures(t));
  const response = await saveFrom(dev, { name: 'Broken' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /The build failed \(exit code 4\)\. Nothing was saved\./);
  assert.equal((await session(dev)).versions, 0);
});

test('only pages on this machine can use the api', async t => {
  const root = await project(t, { saved: false });
  const { dev } = await start(t, root, await fixtures(t));

  for (const origin of ['https://example.com', 'http://localhost.example.com', 'null']) {
    const refused = await saveFrom(dev, { name: 'Sneaky' }, origin);
    assert.equal(refused.status, 403, origin);
    assert.equal(refused.headers.get('access-control-allow-origin'), null, origin);
  }
  assert.equal((await session(dev)).versions, 0);

  for (const origin of [app, 'http://127.0.0.1:3000', 'http://[::1]:8080', 'http://site.localhost:4000']) {
    const preflight = await get(dev, '/afterimage/api/save', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
    });
    assert.equal(preflight.status, 204, origin);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /content-type/i);
  }
  assert.equal((await get(dev, '/afterimage/api/save')).status, 405);
  assert.equal((await get(dev, '/afterimage/api/nope', { headers: { Origin: app } })).status, 404);
});

// Stamped, so a script tag dev served knows dev answers on its own origin. A built site's copy has no stamp, and its
// pill never asks for a helper there.
test('dev serves the overlay with the runtime, stamped as served by dev', async t => {
  const dirs = await fixtures(t);
  await fs.writeFile(path.join(dirs.runtimeDir, 'overlay.js'), 'overlay();');
  const { dev } = await start(t, await project(t, { saved: false }), dirs);
  const overlay = await get(dev, '/afterimage/overlay.js');
  assert.equal(overlay.status, 200);
  assert.match(overlay.headers.get('content-type'), /javascript/);
  assert.equal(await overlay.text(), 'window.__afterimageDev = true;\noverlay();');
});

test('with app, dev serves a plain prototype at the root beside the history', async t => {
  const root = await project(t);
  const { dev } = await start(t, root, await fixtures(t), { app: true });
  const page = await get(dev, '/');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<h1>One</h1>');
  // Live: an edit shows on the next load, without a save.
  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Edited</h1>');
  assert.equal(await (await get(dev, '/index.html')).text(), '<h1>Edited</h1>');
  assert.equal((await get(dev, '/afterimage/')).status, 200);
  assert.deepEqual(await session(dev), { afterimage: 1, versions: 1, latest: { id: 'v1', name: 'First' }, canSave: true });
});

test('dev -- <command> runs the app\'s own dev server, and stops with its exit code', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  await fs.writeFile(path.join(root, 'app-server.mjs'), "import fs from 'node:fs'; fs.writeFileSync('ran.txt', process.argv.slice(2).join(' ')); process.exit(3);");
  const result = await run(root, ['dev', '--', 'node', 'app-server.mjs', '--port', '5173'], dirs);
  assert.equal(result.code, 3);
  assert.equal(await fs.readFile(path.join(root, 'ran.txt'), 'utf8'), '--port 5173');
  assert.match(result.stdout, /^Afterimage is running at http:\/\/localhost:\d+\/afterimage\/\n/);
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

  // The app is not part of dev, and build's folder is left alone so the two can run together. The served copy lives
  // outside the project: a dev server watching the project (Vite does) holds its folders open on Windows, and the
  // copy could then never be replaced after a save.
  assert.equal((await get(dev, '/index.html')).status, 404);
  assert.equal(await exists(path.join(root, '.afterimage')), false);
});

// A free port whose neighbour is free too, held on `host`. Returns null when this machine cannot listen on that host.
// The neighbour is free on `host` and on 127.0.0.1, where dev listens: Windows reserves port ranges per address family
// (Hyper-V, WSL), so a neighbour free on ::1 can still be refused on 127.0.0.1.
async function holdPort(host) {
  const canListen = (port, on) => {
    const server = net.createServer();
    return new Promise(resolve => server.once('error', () => resolve(false)).listen(port, on, () => server.close(() => resolve(true))));
  };
  for (;;) {
    const holder = net.createServer();
    try {
      await new Promise((resolve, reject) => holder.once('error', reject).listen(0, host, resolve));
    } catch (error) {
      if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return null;
      throw error;
    }
    const port = holder.address().port;
    if (await canListen(port + 1, host) && await canListen(port + 1, '127.0.0.1')) return { holder, port };
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

// Windows refuses a port in a range Hyper-V, WSL or Docker reserved with EACCES, not EADDRINUSE, and nothing answers on
// it beforehand. Such a port is passed over like a taken one.
test('a port the system refuses moves to the next free one', async t => {
  const held = await holdPort('127.0.0.1');
  await new Promise(resolve => held.holder.close(resolve));
  const refused = held.port;
  const listen = net.Server.prototype.listen;
  t.mock.method(net.Server.prototype, 'listen', function (port, ...rest) {
    if (port !== refused) return listen.call(this, port, ...rest);
    process.nextTick(() => this.emit('error', Object.assign(new Error(`listen EACCES: permission denied 127.0.0.1:${port}`), { code: 'EACCES' })));
    return this;
  });
  const dirs = await fixtures(t);
  const root = await project(t);

  const { dev } = await start(t, root, dirs, { port: refused });
  assert.equal(new URL(dev.url).port, String(refused + 1));
  assert.equal((await get(dev, '/afterimage/')).status, 200);
});

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
  // A failed assertion must still stop dev, or the test run never ends.
  t.after(() => controller.abort());
  await until(() => out.length >= 2, 'dev to start');
  const url = /http:\/\/localhost:(\d+)\/afterimage\//.exec(out[0]);
  assert.ok(url, out[0]);
  assert.ok(Number(url[1]) >= 4321);
  assert.equal(out[0], `Afterimage is running at ${url[0]}\n`);
  // This prototype is plain HTML with no build, so dev serves it too.
  assert.equal(out[1], `Your prototype is at http://localhost:${url[1]}/\n`);

  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Two</h1>');
  assert.equal((await run(root, ['save', 'Second'])).code, 0);
  await until(() => out.length >= 3, 'the update line');
  assert.equal(out[2], 'Updated: 2 versions.\n');

  controller.abort();
  assert.equal(await running, 0);
  assert.deepEqual(err, []);
});

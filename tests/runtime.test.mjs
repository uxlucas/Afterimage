import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameTag, injectFrameScript, mapRequest, versionInPath } from '../src/runtime/map.js';
import { fingerprint, readSnapshot, saveVersion, verifyHistory } from '../src/cli/history.js';

const northwind = fileURLToPath(new URL('../examples/northwind/afterimage/', import.meta.url));
const tag = id => `<script src="/afterimage/frame.js" data-afterimage-version="${id}"></script>`;

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// ---- mapRequest ----

test('a root path from a version maps into that version folder', () => {
  assert.equal(mapRequest({ clientVersion: 'v3', url: '/assets/a.js' }), '/afterimage/versions/v3/assets/a.js');
  assert.equal(mapRequest({ clientVersion: 'v3', url: '/' }), '/afterimage/versions/v3/');
  assert.equal(mapRequest({ clientVersion: 'v3', url: '/two.html?tab=2#faq' }), '/afterimage/versions/v3/two.html?tab=2#faq');
  assert.equal(mapRequest({ clientVersion: 'v12', url: 'http://localhost:4321/_next/static/x.css' }), 'http://localhost:4321/afterimage/versions/v12/_next/static/x.css');
});

test('a request already under /afterimage/ passes through', () => {
  for (const url of ['/afterimage/versions/v3/assets/a.js', '/afterimage/frame.js', '/afterimage', 'http://localhost/afterimage/versions/v1/']) {
    assert.equal(mapRequest({ clientVersion: 'v3', url }), url);
  }
  // Only the folder itself, not a name that starts the same way.
  assert.equal(mapRequest({ clientVersion: 'v3', url: '/afterimages.css' }), '/afterimage/versions/v3/afterimages.css');
});

test('an unknown client passes through', () => {
  assert.equal(mapRequest({ clientVersion: undefined, url: '/assets/a.js' }), '/assets/a.js');
  assert.equal(mapRequest({ clientVersion: null, url: '/assets/a.js' }), '/assets/a.js');
  assert.equal(mapRequest({ clientVersion: '../v1', url: '/assets/a.js' }), '/assets/a.js');
});

test('versionInPath reads the version a document lives in', () => {
  assert.equal(versionInPath('/afterimage/versions/v3/index.html'), 'v3');
  assert.equal(versionInPath('/afterimage/versions/v10/about/'), 'v10');
  assert.equal(versionInPath('/afterimage/versions/v3'), null);
  assert.equal(versionInPath('/afterimage/'), null);
  assert.equal(versionInPath('/versions/v3/index.html'), null);
});

// ---- injectFrameScript ----

test('the tag is the first child of <head>, whatever its case or attributes', () => {
  assert.equal(frameTag('v3'), tag('v3'));
  assert.equal(injectFrameScript('<!doctype html><html><head><title>x</title></head></html>', 'v3'), `<!doctype html><html><head>${tag('v3')}<title>x</title></head></html>`);
  assert.equal(injectFrameScript('<HTML lang="en"><HEAD data-x="a>b">\n<meta charset="utf-8">', 'v3'), `<HTML lang="en"><HEAD data-x="a>b">${tag('v3')}\n<meta charset="utf-8">`);
  // <header> is not <head>.
  assert.equal(injectFrameScript('<html><header>hi</header></html>', 'v3'), `<html>${tag('v3')}<header>hi</header></html>`);
});

test('a byte order mark, a doctype and comments before <head> are stepped over', () => {
  const page = '\uFEFF<!-- built --><!DOCTYPE html>\n<!-- <head> in a comment -->\n<html>\n  <head>\n';
  assert.equal(injectFrameScript(page, 'v1'), `\uFEFF<!-- built --><!DOCTYPE html>\n<!-- <head> in a comment -->\n<html>\n  <head>${tag('v1')}\n`);
  // The same bytes read as latin1, which is how a save reads them.
  assert.equal(injectFrameScript('\xEF\xBB\xBF<p>hi</p>', 'v1'), `\xEF\xBB\xBF${tag('v1')}<p>hi</p>`);
});

test('a document with no <head> gets the tag after <html>, after the doctype, or at the start', () => {
  assert.equal(injectFrameScript('<!doctype html><html lang="en"><body>hi</body></html>', 'v2'), `<!doctype html><html lang="en">${tag('v2')}<body>hi</body></html>`);
  assert.equal(injectFrameScript('<!doctype html>\n<title>x</title><p>hi', 'v2'), `<!doctype html>${tag('v2')}\n<title>x</title><p>hi`);
  assert.equal(injectFrameScript('<h1>One</h1>', 'v2'), `${tag('v2')}<h1>One</h1>`);
  assert.equal(injectFrameScript('', 'v2'), tag('v2'));
});

test('injecting never touches another byte, and is never doubled', () => {
  const page = '<!doctype html>\r\n<html>\r\n<head>\r\n<meta charset="utf-8">\r\n</head><body>\u00e9</body></html>';
  const once = injectFrameScript(page, 'v4');
  assert.equal(once.replace(tag('v4'), ''), page);
  assert.equal(injectFrameScript(once, 'v4'), once);
  // A page that came from another saved version is re-labelled, not given a second tag.
  assert.equal(injectFrameScript(injectFrameScript(page, 'v1'), 'v4'), once);
});

// ---- saving ----

test('a save puts the frame script in every saved page, and the same build saved twice saves nothing', async t => {
  const root = await temp(t);
  const sourceDir = path.join(root, 'dist');
  const historyDir = path.join(root, 'afterimage');
  await fs.mkdir(path.join(sourceDir, 'about'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'index.html'), '<!doctype html><html><head><title>Home</title></head></html>');
  await fs.writeFile(path.join(sourceDir, 'about/index.html'), '<p>About</p>');
  await fs.writeFile(path.join(sourceDir, 'style.css'), '<head>');
  const options = { historyDir, sourceDir, exclude: [] };

  const first = await saveVersion(options, { name: 'First' });
  const saved = path.join(historyDir, 'versions/v1');
  assert.equal(await fs.readFile(path.join(saved, 'index.html'), 'utf8'), `<!doctype html><html><head>${tag('v1')}<title>Home</title></head></html>`);
  assert.equal(await fs.readFile(path.join(saved, 'about/index.html'), 'utf8'), `${tag('v1')}<p>About</p>`);
  assert.equal(await fs.readFile(path.join(saved, 'style.css'), 'utf8'), '<head>');
  // The fingerprint covers the bytes as saved, so the history verifies.
  assert.equal(first.version.sha256, fingerprint(await readSnapshot(saved)));
  await verifyHistory(historyDir);

  assert.equal((await saveVersion(options, { name: 'Again' })).unchanged, true);
  await fs.writeFile(path.join(sourceDir, 'about/index.html'), '<p>About us</p>');
  const second = await saveVersion(options, { name: 'Second' });
  assert.equal(second.version.id, 'v2');
  assert.equal(await fs.readFile(path.join(historyDir, 'versions/v2/about/index.html'), 'utf8'), `${tag('v2')}<p>About us</p>`);
  assert.equal(await fs.readFile(path.join(historyDir, 'versions/v2/index.html'), 'utf8'), `<!doctype html><html><head>${tag('v2')}<title>Home</title></head></html>`);
});

test('a page saved before the runtime existed still counts as unchanged', async t => {
  const root = await temp(t);
  const historyDir = path.join(root, 'history');
  await fs.cp(northwind, historyDir, { recursive: true });
  const sourceDir = path.join(historyDir, 'versions/v3');
  const copy = path.join(root, 'source');
  await fs.cp(sourceDir, copy, { recursive: true });
  const result = await saveVersion({ historyDir, sourceDir: copy, exclude: [] }, { name: 'Same as v3' });
  assert.equal(result.unchanged, true);
  assert.equal(result.version.id, 'v3');
});

test('Northwind still verifies, and checking it never adds the frame script', async () => {
  const before = await readSnapshot(path.join(northwind, 'versions/v1'));
  const manifest = await verifyHistory(northwind);
  assert.deepEqual(manifest.versions.map(version => version.id), ['v3', 'v2', 'v1']);
  for (const { id } of manifest.versions) {
    const page = await fs.readFile(path.join(northwind, 'versions', id, 'index.html'), 'latin1');
    assert.equal(page.includes('/afterimage/frame.js'), false, id);
  }
  assert.deepEqual(await readSnapshot(path.join(northwind, 'versions/v1')), before);
});

// ---- the service worker ----

// A stand-in for the worker's global scope: listeners, clients, caches and the network, all in memory.
function workerScope({ caches = new Map(), alive = [] } = {}) {
  const listeners = {};
  const fetched = [];
  const cacheStorage = {
    async open(name) {
      if (!caches.has(name)) caches.set(name, new Map());
      const store = caches.get(name);
      return {
        async put(key, response) { store.set(String(key.url ?? key), await response.text()); },
        async match(key) { const body = store.get(String(key.url ?? key)); return body === undefined ? undefined : new Response(body); },
        async keys() { return [...store.keys()].map(url => new Request(url)); },
        async delete(key) { return store.delete(String(key.url ?? key)); },
      };
    },
  };
  const scope = {
    location: new URL('http://localhost:4321/afterimage/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => alive.map(id => ({ id })) },
  };
  const network = async request => {
    fetched.push(request.url);
    return new Response(`body of ${new URL(request.url).pathname}`, { status: 200, headers: { 'Content-Type': 'text/javascript' } });
  };
  return { scope, cacheStorage, network, listeners, fetched, caches };
}

let loads = 0;
async function startWorker(world) {
  globalThis.self = world.scope;
  globalThis.caches = world.cacheStorage;
  globalThis.fetch = world.network;
  // A fresh module instance each time: the same as the browser starting the worker again.
  await import(`../src/runtime/sw.js?start=${++loads}`);
  return world.listeners;
}

// Dispatches a fetch event the way the browser would and returns what the page gets, or null when the worker
// left the request to the network.
async function dispatch(listeners, { url, mode = 'no-cors', clientId = '', resultingClientId = '' }) {
  let answer = null;
  const pending = [];
  listeners.fetch({
    // Request refuses mode navigate outside a browser, so a navigation is a plain object with the fields the worker reads.
    request: mode === 'navigate' ? { url, mode } : new Request(url, { mode }),
    clientId, resultingClientId,
    respondWith: value => { answer = Promise.resolve(value); },
    waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  return answer && await answer;
}

test('the worker maps a version document\'s requests into its folder, and passes everything else through', async t => {
  const saved = { self: globalThis.self, caches: globalThis.caches, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, saved));
  const world = workerScope({ alive: ['frame-1'] });
  const listeners = await startWorker(world);

  assert.equal(await dispatch(listeners, { url: 'http://localhost:4321/afterimage/versions/v3/index.html', mode: 'navigate', resultingClientId: 'frame-1' }), null);
  const mapped = await dispatch(listeners, { url: 'http://localhost:4321/assets/a.js', clientId: 'frame-1' });
  assert.equal(await mapped.text(), 'body of /afterimage/versions/v3/assets/a.js');
  assert.equal(mapped.headers.get('Content-Type'), 'text/javascript');
  // No URL of its own, so the page resolves relative imports against the path it asked for.
  assert.equal(mapped.url, '');

  assert.equal(await dispatch(listeners, { url: 'http://localhost:4321/afterimage/versions/v3/assets/b.js', clientId: 'frame-1' }), null);
  assert.equal(await dispatch(listeners, { url: 'https://fonts.example.com/a.woff2', clientId: 'frame-1' }), null);
  // The viewer itself, and any client the worker never saw navigate.
  assert.equal(await dispatch(listeners, { url: 'http://localhost:4321/afterimage/assets/viewer.js', clientId: 'viewer' }), null);
  const unknown = await dispatch(listeners, { url: 'http://localhost:4321/assets/a.js', clientId: 'stranger' });
  assert.equal(await unknown.text(), 'body of /assets/a.js');

  // A restarted worker has lost its memory, and still knows the frame from the cache.
  const again = await startWorker(world);
  const afterRestart = await dispatch(again, { url: 'http://localhost:4321/assets/a.js', clientId: 'frame-1' });
  assert.equal(await afterRestart.text(), 'body of /afterimage/versions/v3/assets/a.js');
});

test('two frames created at once both keep their version, before either is listed as a client', async t => {
  const saved = { self: globalThis.self, caches: globalThis.caches, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, saved));
  // The browser lists a client only once its document is ready, so neither frame is alive yet.
  const world = workerScope({ alive: [] });
  const listeners = await startWorker(world);
  await Promise.all([
    dispatch(listeners, { url: 'http://localhost:4321/afterimage/versions/v2/index.html', mode: 'navigate', resultingClientId: 'target' }),
    dispatch(listeners, { url: 'http://localhost:4321/afterimage/versions/v1/index.html', mode: 'navigate', resultingClientId: 'base' }),
  ]);
  assert.equal(await (await dispatch(listeners, { url: 'http://localhost:4321/assets/a.js', clientId: 'target' })).text(), 'body of /afterimage/versions/v2/assets/a.js');
  assert.equal(await (await dispatch(listeners, { url: 'http://localhost:4321/assets/a.js', clientId: 'base' })).text(), 'body of /afterimage/versions/v1/assets/a.js');
});

test('the worker forgets clients that are gone', async t => {
  const saved = { self: globalThis.self, caches: globalThis.caches, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, saved));
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const alive = ['frame-1'];
  const world = workerScope({ alive });
  const listeners = await startWorker(world);
  await dispatch(listeners, { url: 'http://localhost:4321/afterimage/versions/v1/', mode: 'navigate', resultingClientId: 'frame-1' });
  now += 5 * 60_000;
  alive.splice(0, 1, 'frame-2');
  await dispatch(listeners, { url: 'http://localhost:4321/afterimage/versions/v2/', mode: 'navigate', resultingClientId: 'frame-2' });
  const [store] = world.caches.values();
  assert.deepEqual([...store.values()].map(body => JSON.parse(body).id), ['v2']);
  const forgotten = await dispatch(listeners, { url: 'http://localhost:4321/assets/a.js', clientId: 'frame-1' });
  assert.equal(await forgotten.text(), 'body of /assets/a.js');
});

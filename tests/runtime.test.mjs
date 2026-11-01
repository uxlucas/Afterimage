import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as map from '../src/runtime/map.js';
import { fingerprint, readSnapshot, saveVersion, verifyHistory } from '../src/cli/history.js';
import { showsVersion } from '../src/viewer/frames.js';

const { frameTag, injectFrameScript } = map;
const northwind = fileURLToPath(new URL('../examples/northwind/afterimage/', import.meta.url));
const tag = id => `<script src="/afterimage/frame.js" data-afterimage-version="${id}"></script>`;
const workerSource = await fs.readFile(new URL('../src/runtime/sw.js', import.meta.url), 'utf8');
const frameSource = await fs.readFile(new URL('../src/runtime/frame.js', import.meta.url), 'utf8');

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// ---- the stand-ins for a browser ----

// A stand-in for the worker's global scope: listeners, clients, caches and the network, all in memory.
// brokenCaches makes every Cache API call fail, as it does with storage blocked or full.
function workerScope({ alive = [], brokenCaches = false } = {}) {
  const caches = new Map();
  const listeners = {};
  const cacheStorage = {
    async open(name) {
      if (brokenCaches) throw new Error('QuotaExceededError');
      if (!caches.has(name)) caches.set(name, new Map());
      const store = caches.get(name);
      const key = request => String(request.url ?? request);
      return {
        async put(request, response) {
          const body = await response.text();
          store.delete(key(request)); // like the Cache API, a put moves the entry to the end
          store.set(key(request), body);
        },
        async match(request) { const body = store.get(key(request)); return body === undefined ? undefined : new Response(body); },
        async keys() { return [...store.keys()].map(url => new Request(url)); },
        async delete(request) { return store.delete(key(request)); },
      };
    },
  };
  const scope = {
    location: new URL('http://localhost:4321/afterimage/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => alive.map(id => ({ id })) },
  };
  const network = async request => new Response(`body of ${new URL(request.url).pathname}`, { status: 200, headers: { 'Content-Type': 'text/javascript' } });
  return { scope, cacheStorage, network, listeners, caches, alive };
}

// Runs sw.js as the classic script it is, in a fresh context: the same as the browser starting the worker (again).
// Returns its listeners, and the context, which holds its top-level functions (the inline copy of map.js).
function startWorker(world) {
  const context = vm.createContext({ self: world.scope, caches: world.cacheStorage, fetch: world.network, Request, Response, URL });
  vm.runInContext(workerSource, context, { filename: 'sw.js' });
  return { listeners: world.listeners, context };
}

// Dispatches a fetch event the way the browser would and returns what the page gets, or null when the worker
// left the request to the network.
async function dispatch(listeners, { url, mode = 'no-cors', method = 'GET', redirect = 'follow', clientId = '', resultingClientId = '' }) {
  let answer = null;
  const pending = [];
  listeners.fetch({
    // Request refuses mode navigate outside a browser, so a navigation is a plain object with the fields the worker reads.
    request: mode === 'navigate' ? { url, mode, method } : new Request(url, { mode: method === 'GET' ? mode : 'same-origin', method, redirect }),
    clientId, resultingClientId,
    respondWith: value => { answer = Promise.resolve(value); },
    waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  return answer && await answer;
}

const bodyOf = async response => response && await response.text();

// ---- one mapping table, for map.js and for the copy inside sw.js ----

const copies = { 'map.js': map, 'the copy in sw.js': startWorker(workerScope()).context };

for (const [name, copy] of Object.entries(copies)) {
  test(`${name}: a root path from a version maps into that version folder`, () => {
    assert.equal(copy.mapRequest({ clientVersion: 'v3', url: '/assets/a.js' }), '/afterimage/versions/v3/assets/a.js');
    assert.equal(copy.mapRequest({ clientVersion: 'v3', url: '/' }), '/afterimage/versions/v3/');
    assert.equal(copy.mapRequest({ clientVersion: 'v3', url: '/two.html?tab=2#faq' }), '/afterimage/versions/v3/two.html?tab=2#faq');
    assert.equal(copy.mapRequest({ clientVersion: 'v12', url: 'http://localhost:4321/_next/static/x.css' }), 'http://localhost:4321/afterimage/versions/v12/_next/static/x.css');
    // Only the folder itself is served, not a name that starts the same way.
    assert.equal(copy.mapRequest({ clientVersion: 'v3', url: '/afterimages.css' }), '/afterimage/versions/v3/afterimages.css');
  });

  test(`${name}: a request already under /afterimage/, or from an unknown client, passes through`, () => {
    for (const url of ['/afterimage/versions/v3/assets/a.js', '/afterimage/frame.js', '/afterimage', 'http://localhost/afterimage/versions/v1/']) {
      assert.equal(copy.mapRequest({ clientVersion: 'v3', url }), url);
    }
    for (const clientVersion of [undefined, null, '', '../v1', 'v0', 'V3']) {
      assert.equal(copy.mapRequest({ clientVersion, url: '/assets/a.js' }), '/assets/a.js');
    }
    assert.equal(copy.isServedPath('/afterimage'), true);
    assert.equal(copy.isServedPath('/afterimage/x'), true);
    assert.equal(copy.isServedPath('/afterimages'), false);
  });

  test(`${name}: versionInPath reads the version a document lives in`, () => {
    assert.equal(copy.versionInPath('/afterimage/versions/v3/index.html'), 'v3');
    assert.equal(copy.versionInPath('/afterimage/versions/v10/about/'), 'v10');
    assert.equal(copy.versionInPath('/afterimage/versions/v3'), null);
    assert.equal(copy.versionInPath('/afterimage/'), null);
    assert.equal(copy.versionInPath('/versions/v3/index.html'), null);
  });
}

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
  // A page that came from another saved version is re-labelled, not given a second tag. Same without a <head>.
  assert.equal(injectFrameScript(injectFrameScript(page, 'v1'), 'v4'), once);
  for (const bare of ['<h1>One</h1>', '<!doctype html>\n<p>x', '<html><body>x</body></html>']) {
    assert.equal(injectFrameScript(injectFrameScript(bare, 'v1'), 'v4'), injectFrameScript(bare, 'v4'));
  }
});

test('the tag\'s text elsewhere in a page is content: it is left alone and the tag still goes in <head>', () => {
  const quoted = `<script>const s = '${tag('v1')}';</script>`;
  const page = `<!doctype html><html><head><title>x</title></head><body>${quoted}</body></html>`;
  const injected = injectFrameScript(page, 'v3');
  assert.equal(injected, `<!doctype html><html><head>${tag('v3')}<title>x</title></head><body>${quoted}</body></html>`);
  assert.equal(injected.replace(tag('v3'), ''), page);
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

const origin = 'http://localhost:4321';
const navigateTo = (listeners, version, clientId) => dispatch(listeners, { url: `${origin}/afterimage/versions/${version}/index.html`, mode: 'navigate', resultingClientId: clientId });
const asset = (listeners, clientId) => dispatch(listeners, { url: `${origin}/assets/a.js`, clientId });
const storedVersions = world => [...[...world.caches.values()][0].values()].map(body => JSON.parse(body).id);

test('the worker maps a version document\'s requests into its folder, and passes everything else through', async () => {
  const world = workerScope({ alive: ['frame-1'] });
  const { listeners } = startWorker(world);

  // A navigation into a version gets the host's page, with no URL of its own so the document keeps the one it asked for.
  const page = await navigateTo(listeners, 'v3', 'frame-1');
  assert.equal(await page.text(), 'body of /afterimage/versions/v3/index.html');
  assert.equal(page.url, '');
  // Navigations anywhere else are not the worker's to answer.
  assert.equal(await dispatch(listeners, { url: `${origin}/afterimage/`, mode: 'navigate', resultingClientId: 'viewer' }), null);
  const mapped = await asset(listeners, 'frame-1');
  assert.equal(await mapped.text(), 'body of /afterimage/versions/v3/assets/a.js');
  assert.equal(mapped.headers.get('Content-Type'), 'text/javascript');
  // No URL of its own, so the page resolves relative imports against the path it asked for.
  assert.equal(mapped.url, '');

  assert.equal(await dispatch(listeners, { url: `${origin}/afterimage/versions/v3/assets/b.js`, clientId: 'frame-1' }), null);
  assert.equal(await dispatch(listeners, { url: 'https://fonts.example.com/a.woff2', clientId: 'frame-1' }), null);
  // Only GET and HEAD are mapped; anything else goes to the network untouched.
  assert.equal(await dispatch(listeners, { url: `${origin}/api/save`, method: 'POST', clientId: 'frame-1' }), null);
  assert.equal(await bodyOf(await dispatch(listeners, { url: `${origin}/assets/a.js`, method: 'HEAD', clientId: 'frame-1' })), 'body of /afterimage/versions/v3/assets/a.js');
  // The viewer itself, and any client the worker never saw navigate.
  assert.equal(await dispatch(listeners, { url: `${origin}/afterimage/assets/viewer.js`, clientId: 'viewer' }), null);
  assert.equal(await bodyOf(await asset(listeners, 'stranger')), 'body of /assets/a.js');

  // A restarted worker has lost its memory, and still knows the frame from the cache.
  const again = startWorker(world);
  assert.equal(await bodyOf(await asset(again.listeners, 'frame-1')), 'body of /afterimage/versions/v3/assets/a.js');
});

test('two frames created at once both keep their version, before either is listed as a client', async () => {
  // The browser lists a client only once its document is ready, so neither frame is alive yet.
  const world = workerScope({ alive: [] });
  const { listeners } = startWorker(world);
  await Promise.all([navigateTo(listeners, 'v2', 'target'), navigateTo(listeners, 'v1', 'base')]);
  assert.equal(await bodyOf(await asset(listeners, 'target')), 'body of /afterimage/versions/v2/assets/a.js');
  assert.equal(await bodyOf(await asset(listeners, 'base')), 'body of /afterimage/versions/v1/assets/a.js');
});

test('the worker forgets a client once it has been listed and is gone, and never one it has not seen listed', async () => {
  const world = workerScope({ alive: [] });
  const { listeners } = startWorker(world);
  await navigateTo(listeners, 'v1', 'frame-1');
  world.alive.splice(0, Infinity, 'frame-1');
  await navigateTo(listeners, 'v2', 'frame-2');
  // frame-1 is closed; frame-2 is listed now; frame-3 is still being created.
  world.alive.splice(0, Infinity, 'frame-2');
  await navigateTo(listeners, 'v3', 'frame-3');
  assert.deepEqual(storedVersions(world).sort(), ['v2', 'v3']);
  assert.equal(await bodyOf(await asset(listeners, 'frame-1')), 'body of /assets/a.js');
  assert.equal(await bodyOf(await asset(listeners, 'frame-3')), 'body of /afterimage/versions/v3/assets/a.js');
});

test('clients that are never listed (abandoned navigations) are kept only up to a few, newest first', async () => {
  const world = workerScope({ alive: [] });
  const { listeners } = startWorker(world);
  for (let i = 1; i <= 20; i++) await navigateTo(listeners, `v${i}`, `frame-${i}`);
  assert.deepEqual(storedVersions(world), Array.from({ length: 16 }, (_, i) => `v${i + 5}`));
  assert.equal(await bodyOf(await asset(listeners, 'frame-20')), 'body of /afterimage/versions/v20/assets/a.js');
});

test('a redirect: manual request is still mapped, and its opaque redirect comes back as it is', async () => {
  const world = workerScope({ alive: ['frame-1'] });
  const asked = [];
  // What the browser gives a manual-redirect fetch that meets a redirect: status 0, which new Response refuses.
  const redirected = { type: 'opaqueredirect', status: 0, statusText: '', headers: new Headers(), body: null };
  world.network = async request => {
    asked.push([new URL(request.url).pathname, request.redirect]);
    return redirected;
  };
  const { listeners } = startWorker(world);
  await navigateTo(listeners, 'v2', 'frame-1');
  asked.length = 0;
  const answer = await dispatch(listeners, { url: `${origin}/old-path`, mode: 'same-origin', redirect: 'manual', clientId: 'frame-1' });
  assert.equal(answer, redirected);
  assert.deepEqual(asked, [['/afterimage/versions/v2/old-path', 'manual']]);
});

// A host without clean URLs: it answers each path in `files` with that status, and anything else with a 404.
// Returns what it saw: `asked`, the requests as "METHOD /path"; `cancelled`, the paths whose body was cancelled
// unread; `sent`, the responses it gave.
function fileHost(world, files) {
  const asked = [];
  const cancelled = [];
  const sent = [];
  world.network = async request => {
    const { pathname } = new URL(request.url);
    asked.push(`${request.method} ${pathname}`);
    const status = files[pathname] ?? 404;
    const text = status === 404 ? 'Not found' : `body of ${pathname}`;
    // Pulled only when read, so a body nobody reads is still open until it is cancelled.
    const body = status === 304 ? null : new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
      cancel() { cancelled.push(pathname); },
    });
    const response = new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
    sent.push(response);
    return response;
  };
  return { asked, cancelled, sent };
}

test('a page missing from a version is found the way a host with clean URLs finds it', async () => {
  const world = workerScope({ alive: ['frame-1'] });
  const v2 = '/afterimage/versions/v2';
  const { asked, cancelled } = fileHost(world, { [`${v2}/about.html`]: 200, [`${v2}/docs/index.html`]: 200, [`${v2}/broken`]: 500 });
  const { listeners } = startWorker(world);
  const open = file => dispatch(listeners, { url: `${origin}${v2}/${file}`, mode: 'navigate', resultingClientId: 'frame-1' });

  // about.html answers for /about, and the document keeps the URL it asked for, query and all.
  const about = await open('about?tab=2');
  assert.equal(about.status, 200);
  assert.equal(await about.text(), `body of ${v2}/about.html`);
  assert.equal(about.url, '');
  assert.deepEqual(asked.splice(0), [`GET ${v2}/about`, `GET ${v2}/about.html`]);
  // The 404 it replaced is not left open.
  assert.deepEqual(cancelled.splice(0), [`${v2}/about`]);
  // A folder with an index.html is a redirect to the path with a slash, as a host gives it.
  const docs = await open('docs?tab=2');
  assert.equal(docs.status, 301);
  assert.equal(docs.headers.get('Location'), `${origin}${v2}/docs/?tab=2`);
  assert.deepEqual(asked.splice(0), [`GET ${v2}/docs`, `GET ${v2}/docs.html`, `HEAD ${v2}/docs/index.html`]);
  assert.deepEqual(cancelled.splice(0).sort(), [`${v2}/docs`, `${v2}/docs.html`, `${v2}/docs/index.html`]);
  // Nowhere to be found: the host's own 404, and only the probes' bodies are cancelled.
  const missing = await open('missing');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Not found');
  asked.splice(0);
  assert.deepEqual(cancelled.splice(0).sort(), [`${v2}/missing.html`, `${v2}/missing/index.html`]);
  // A path ending in / or in a file name with an extension, and any answer but a 404, are the host's to give, with
  // no probes.
  for (const [file, status] of [['gone.html', 404], ['about.txt', 404], ['empty/', 404], ['broken', 500]]) {
    assert.equal((await open(file)).status, status, file);
    assert.deepEqual(asked.splice(0), [`GET ${v2}/${file}`], file);
  }
});

test('a clean URL a version asks for is found the same way, and redirected within the app\'s own paths', async () => {
  const world = workerScope({ alive: ['frame-1'] });
  const v2 = '/afterimage/versions/v2';
  const { asked, sent } = fileHost(world, { [`${v2}/about.html`]: 200, [`${v2}/docs/index.html`]: 200, [`${v2}/cached.css`]: 304 });
  const { listeners } = startWorker(world);
  await navigateTo(listeners, 'v2', 'frame-1');
  asked.splice(0);

  // Next's static export checks a page with HEAD /about before it prefetches the page's data.
  const about = await dispatch(listeners, { url: `${origin}/about`, method: 'HEAD', mode: 'cors', clientId: 'frame-1' });
  assert.equal(about.status, 200);
  assert.equal(about.url, '');
  assert.deepEqual(asked.splice(0), [`HEAD ${v2}/about`, `HEAD ${v2}/about.html`]);
  // The redirect goes to the path the page uses, so the browser follows it back through the worker.
  const docs = await dispatch(listeners, { url: `${origin}/docs`, mode: 'cors', clientId: 'frame-1' });
  assert.equal(docs.status, 301);
  assert.equal(docs.headers.get('Location'), `${origin}/docs/`);
  asked.splice(0);
  assert.equal((await dispatch(listeners, { url: `${origin}/api/missing`, mode: 'cors', clientId: 'frame-1' })).status, 404);
  // A missing asset costs one request.
  asked.splice(0);
  assert.equal((await dispatch(listeners, { url: `${origin}/assets/gone.js`, clientId: 'frame-1' })).status, 404);
  assert.deepEqual(asked.splice(0), [`GET ${v2}/assets/gone.js`]);
  // Any other 3xx the host gives (a 304 for the page's own conditional request) is rewrapped like every answer, so
  // it carries no version-folder URL.
  const cached = await dispatch(listeners, { url: `${origin}/cached.css`, clientId: 'frame-1' });
  assert.equal(cached.status, 304);
  assert.equal(sent.includes(cached), false);
});

test('when the Cache API fails, requests still go through instead of failing', async () => {
  const world = workerScope({ alive: [], brokenCaches: true });
  const { listeners } = startWorker(world);
  await navigateTo(listeners, 'v2', 'frame-1');
  // Memory still knows the frame.
  assert.equal(await bodyOf(await asset(listeners, 'frame-1')), 'body of /afterimage/versions/v2/assets/a.js');
  // A restarted worker cannot recall it, so it passes the request through rather than answer with an error.
  const again = startWorker(world);
  assert.equal(await bodyOf(await asset(again.listeners, 'frame-1')), 'body of /assets/a.js');
});

// ---- frame.js ----

// Runs frame.js the way a saved page loads it, at `path` in v2, with the Navigation API or without it, and controlled
// by the worker or not. Returns the page's globals and what frame.js asked the browser to do.
function loadPage(path, { withNavigation = true, controlled = true } = {}) {
  let url = new URL(`${origin}${path}`);
  const handlers = {};
  const redirects = [];
  const location = {
    get href() { return url.href; }, get origin() { return url.origin; }, get pathname() { return url.pathname; },
    get search() { return url.search; }, get hash() { return url.hash; },
    assign: target => redirects.push([target, 'assign']),
  };
  const history = { state: null, replaceState: (state, title, next) => { url = new URL(next, url); } };
  class Element {}
  const page = {
    document: { currentScript: { dataset: { afterimageVersion: 'v2' } }, readyState: 'complete' }, location, history, URL, Element,
    navigator: { serviceWorker: { controller: controlled ? {} : null } },
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  if (withNavigation) {
    page.navigation = {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      // Both promises reject, as they do when the redirect is cut short; frame.js must not leave them unhandled.
      navigate: (target, options) => {
        redirects.push([target, options.history]);
        return { committed: Promise.reject(new Error('aborted')), finished: Promise.reject(new Error('aborted')) };
      },
    };
  }
  page.window = page;
  vm.runInContext(frameSource, vm.createContext(page), { filename: 'frame.js' });
  return { page, location, handlers, redirects, Element };
}

const navigate = (frame, url, extra = {}) => {
  const event = {
    destination: { url, sameDocument: false }, cancelable: true, navigationType: 'push', downloadRequest: null, formData: null,
    prevented: false, preventDefault() { this.prevented = true; }, ...extra,
  };
  frame.handlers.navigate(event);
  return event.prevented;
};

test('frame.js marks the version and gives the app its own path', () => {
  for (const [file, own] of [['index.html', '/'], ['about/index.html', '/about/'], ['two.html?tab=2#faq', '/two.html?tab=2#faq']]) {
    const frame = loadPage(`/afterimage/versions/v2/${file}`);
    assert.equal(frame.page.__afterimageVersion, 'v2');
    assert.equal(frame.location.pathname + frame.location.search + frame.location.hash, own);
  }
  // Outside its version folder (a page opened somewhere else) it does nothing.
  const elsewhere = loadPage('/somewhere/index.html');
  assert.equal(elsewhere.page.__afterimageVersion, undefined);
  assert.equal(elsewhere.location.pathname, '/somewhere/index.html');
});

test('without a worker in control, frame.js leaves the page at its own URL, and the viewer still knows it', () => {
  const version = { id: 'v2', file: 'versions/v2/index.html' };
  const viewer = `${origin}/afterimage/?version=v2`;
  const frame = loadPage('/afterimage/versions/v2/index.html?lang=en', { controlled: false });
  // Relative files resolve against this URL, so they load from the version folder and not from the live app.
  assert.equal(frame.location.pathname + frame.location.search, '/afterimage/versions/v2/index.html?lang=en');
  assert.equal(frame.page.__afterimageVersion, 'v2');
  assert.equal(frame.page.__afterimageFile, '/afterimage/versions/v2/index.html');
  assert.equal(frame.page.__afterimagePath, '/afterimage/versions/v2/index.html?lang=en');
  frame.handlers.load();
  assert.equal(frame.page.__afterimagePath, '/afterimage/versions/v2/index.html?lang=en');
  assert.equal(showsVersion({ contentWindow: frame.page }, version, viewer), true);
  assert.equal(showsVersion({ contentWindow: frame.page }, { id: 'v1', file: 'versions/v1/index.html' }, viewer), false);
  // A hard link to another file of the version is still told apart from the version's own page.
  const other = loadPage('/afterimage/versions/v2/two.html', { controlled: false });
  assert.equal(other.location.pathname, '/afterimage/versions/v2/two.html');
  assert.equal(showsVersion({ contentWindow: other.page }, version, viewer), false);
  // Root-path navigations still move into the version.
  assert.equal(navigate(frame, `${origin}/about`), true);
  assert.deepEqual(frame.redirects, [[`${origin}/afterimage/versions/v2/about`, 'auto']]);
});

test('a controlled page the viewer compares is its own, at the app path frame.js gives it', () => {
  const frame = loadPage('/afterimage/versions/v2/index.html');
  frame.handlers.load();
  assert.equal(showsVersion({ contentWindow: frame.page }, { id: 'v2', file: 'versions/v2/index.html' }, `${origin}/afterimage/`), true);
});

test('frame.js sends root-path navigations into the version and leaves the rest alone', async () => {
  const frame = loadPage('/afterimage/versions/v2/index.html');
  assert.equal(navigate(frame, `${origin}/about`), true);
  assert.equal(navigate(frame, `${origin}/two.html?x=1`, { navigationType: 'replace' }), true);
  assert.deepEqual(frame.redirects, [[`${origin}/afterimage/versions/v2/about`, 'auto'], [`${origin}/afterimage/versions/v2/two.html?x=1`, 'replace']]);

  const untouched = [
    [`${origin}/about`, { destination: { url: `${origin}/about`, sameDocument: true } }],
    [`${origin}/about`, { navigationType: 'traverse' }],
    [`${origin}/about`, { cancelable: false }],
    [`${origin}/report.pdf`, { downloadRequest: 'report.pdf' }],
    [`${origin}/form`, { formData: {} }],
    [`${origin}/afterimage/versions/v1/index.html`],
    ['https://example.com/about'],
    // A blob: URL has this page's origin but no path to move. Redirecting it to itself would loop.
    [`blob:${origin}/9f2c-4e1a`],
    ['data:text/html,hi'],
  ];
  for (const [url, extra] of untouched) assert.equal(navigate(frame, url, extra), false, url);
  assert.equal(frame.redirects.length, 2);
  // Let the rejected redirect promises settle; an unhandled one would fail this file.
  await new Promise(resolve => setImmediate(resolve));
});

test('frame.js records where the app settles on its own, and stops following at the first touch', () => {
  for (const withNavigation of [true, false]) {
    for (const touch of ['pointerdown', 'keydown']) {
      const frame = loadPage('/afterimage/versions/v2/index.html?lang=en', { withNavigation });
      const moveTo = next => {
        frame.page.history.replaceState(null, '', next);
        frame.handlers.currententrychange?.();
      };
      assert.equal(frame.page.__afterimageFile, '/afterimage/versions/v2/index.html');
      assert.equal(frame.page.__afterimagePath, '/?lang=en');
      // The app redirects itself on load. With the Navigation API that is seen at once, without it at load.
      moveTo('/home');
      assert.equal(frame.page.__afterimagePath, withNavigation ? '/home' : '/?lang=en');
      frame.handlers.load();
      assert.equal(frame.page.__afterimagePath, '/home');
      // The person presses inside the frame, then the app moves on: that is no longer the app's own page.
      frame.handlers[touch]();
      moveTo('/about');
      frame.handlers.load();
      assert.equal(frame.page.__afterimagePath, '/home', `${touch}, navigation ${withNavigation}`);
    }
  }
});

test('without the Navigation API, frame.js catches plain link clicks a router did not take', () => {
  const frame = loadPage('/afterimage/versions/v2/index.html', { withNavigation: false });
  const click = (href, extra = {}) => {
    const link = { href, target: '', hasAttribute: () => false };
    const target = Object.assign(new frame.Element(), { closest: () => link });
    const event = { target, button: 0, defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    frame.handlers.click(event);
    return event.prevented;
  };
  assert.equal(click(`${origin}/two.html`), true);
  assert.equal(click(`${origin}/two.html`, { defaultPrevented: true }), false);
  assert.equal(click(`${origin}/two.html`, { metaKey: true }), false);
  assert.equal(click(`blob:${origin}/9f2c-4e1a`), false);
  assert.deepEqual(frame.redirects, [[`${origin}/afterimage/versions/v2/two.html`, 'assign']]);
});

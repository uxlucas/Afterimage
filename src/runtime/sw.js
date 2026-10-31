// The frame runtime's service worker, served at /afterimage/sw.js with scope /afterimage/.
//
// Approach: each saved page carries frame.js (added at save time), which rewrites the frame's URL with replaceState
// from /afterimage/versions/vN/<path> to /<path>, so the app's router sees its own paths. Built apps also ask for
// root paths (/assets/x.js, /_next/...). This worker answers those from the version's folder. Nothing in it knows
// any framework. The alternatives in the spec (a relative base set through the framework's config, rewriting paths
// at save time) need per-framework work and miss URLs built at runtime, so they were not used.
//
// Why this works, and its limits:
// - Scope. A navigation is routed by the destination URL's scope, so the frames (/afterimage/versions/vN/...) are
//   controlled and the live app at / never is. If the app registers its own worker at scope /, the longer
//   /afterimage/ scope still wins for the viewer and the frames, and ours never reaches the root.
// - Subresources. A controlled document's requests come here whatever their URL, also after replaceState moved
//   the document to /<path>. So a root path from a version maps into the version, and a request already under
//   /afterimage/ (a relative URL resolved before the rewrite, the runtime itself) passes through.
// - Response URL. A mapped answer is a new Response with no URL of its own, so the page treats it as coming from the
//   path it asked for. Otherwise a module would get the version folder as its base URL, and a split chunk's
//   "./index.js" would be a second copy of the entry module, run twice.
// - Versions per client. The worker learns a frame's version from the navigation that creates it
//   (resultingClientId on the request to /afterimage/versions/vN/...). It keeps that in memory and in the Cache API,
//   keyed by client id, because the browser stops idle workers and a restarted one has no memory. Unknown clients
//   (the viewer, anything that never navigated into a version) pass through.
// - Navigations. A frame going to /about is out of scope, so this worker never sees it. frame.js catches those
//   and sends them to /afterimage/versions/vN/about instead.
// - Timing. The viewer waits until this worker is active before it creates frames, and install/activate take over
//   at once (skipWaiting, clients.claim), so a frame's first request is already mapped.
// - Known limits. Reloading a frame from the browser's menu, or going back or forward across a hard link (to an
//   entry of another document), requests the rewritten /<path>, which is out of scope and loads the live app; the
//   viewer never does either itself. A router's own back and forward stay in the document and work. Links that open
//   a new tab (target=_blank) and POST forms reach the live app too. Without service workers (http on a non-localhost
//   address, a host that does not serve sw.js as JavaScript) the viewer still renders, and a built app that uses root
//   paths renders unstyled. Requests made by a version's own workers are not mapped.
import { isServedPath, mapRequest, versionInPath } from './map.js';

const store = 'afterimage-clients';
const keyFor = clientId => new URL(`/afterimage/__clients/${encodeURIComponent(clientId)}`, self.location.href).href;
// A frame being created is not in clients.matchAll() until its document is ready, so a client learned this recently
// is kept even when it is not listed yet. Frames load in parallel (the viewer shows two versions at once).
const settleMs = 60_000;
// clientId -> { id, at }: the version and when the worker learned it.
const versions = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function remember(clientId, entry) {
  const cache = await caches.open(store);
  await cache.put(keyFor(clientId), new Response(JSON.stringify(entry)));
  // Frames come and go as the viewer switches versions; drop what belongs to clients that are gone.
  const alive = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map(client => client.id));
  const gone = (known, { at }) => !alive.has(known) && Date.now() - at > settleMs;
  for (const [known, value] of [...versions]) if (gone(known, value)) versions.delete(known);
  for (const request of await cache.keys()) {
    const known = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
    const value = await read(await cache.match(request));
    if (!value || gone(known, value)) await cache.delete(request);
  }
}

async function read(response) {
  try {
    return response ? JSON.parse(await response.text()) : null;
  } catch {
    return null;
  }
}

async function recall(clientId) {
  const value = await read(await (await caches.open(store)).match(keyFor(clientId)));
  if (value) versions.set(clientId, value);
  return value?.id;
}

async function answer(request, id) {
  if (!id) return fetch(request);
  const response = await fetch(new Request(mapRequest({ clientVersion: id, url: request.url }), request));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    const id = versionInPath(url.pathname);
    if (id && event.resultingClientId) {
      const entry = { id, at: Date.now() };
      versions.set(event.resultingClientId, entry);
      event.waitUntil(remember(event.resultingClientId, entry));
    }
    return;
  }
  if (!event.clientId || isServedPath(url.pathname)) return;
  const known = versions.get(event.clientId)?.id;
  event.respondWith(known ? answer(request, known) : recall(event.clientId).then(id => answer(request, id)));
});

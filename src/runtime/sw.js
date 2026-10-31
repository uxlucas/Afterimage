// The frame runtime's service worker, served at /afterimage/sw.js with scope /afterimage/.
//
// Approach: each saved page carries frame.js (added at save time), which rewrites the frame's URL with replaceState
// from /afterimage/versions/vN/<path> to /<path>, so the app's router sees its own paths. Built apps also ask for
// root paths (/assets/x.js, /_next/...). This worker answers those from the version's folder. Nothing in it knows
// any framework. The alternatives in the spec (a relative base set through the framework's config, rewriting paths
// at save time) need per-framework work and miss URLs built at runtime, so they were not used.
//
// A classic worker, not a module one, so it runs wherever service workers do. It cannot import map.js (an ES module
// that history.js uses in node), so the three helpers below are an inline copy; tests/runtime.test.mjs runs the same
// table against both copies.
//
// Why this works:
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
// - History. The viewer moves a frame to another version with location.replace, so its own version switches add no
//   history entries for Back to land on.
//
// Known limits. Each of these reaches the live app at the root instead of the version:
// - Reloading a frame from the browser's menu, and going back or forward to an entry of a document the frame has
//   left: after a hard link, or after a router's pushState followed by a version switch. Those entries hold the
//   rewritten /<path>, which is out of scope. A router's own back and forward inside one document work.
// - Links that open elsewhere: target=_blank, _top and _parent (the navigation happens in another window, which
//   frame.js does not run in), and download links (a download is not a navigation frame.js can redirect).
// - POST forms, which cannot be re-sent to another URL.
// - The app's own iframes: their navigations are their own, and an about:blank child is not controlled.
// - Without the Navigation API (older Safari) frame.js sees only plain link clicks, not location.assign or forms.
// - Requests made by a version's own Web Workers.
// - Without service workers (http on a non-localhost address, a host that does not serve sw.js as JavaScript) the
//   viewer still renders, and a built app that uses root paths renders unstyled.
// And one that comes with versions sharing the live app's origin: an old version's code runs there. It can register
// a worker at scope / (its register('/sw.js') resolves against the root) and write cookies, localStorage and
// IndexedDB that the live app then reads.

const served = '/afterimage';
const versionId = /^v[1-9]\d*$/;

// ---- inline copy of map.js (keep in step; tests/runtime.test.mjs checks both) ----
function isServedPath(pathname) {
  return pathname === served || pathname.startsWith(`${served}/`);
}

function versionInPath(pathname) {
  const match = /^\/afterimage\/versions\/(v[1-9]\d*)\//.exec(pathname);
  return match ? match[1] : null;
}

function mapRequest({ clientVersion, url }) {
  if (typeof clientVersion !== 'string' || !versionId.test(clientVersion)) return url;
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
  const parsed = new URL(url, 'http://afterimage.invalid');
  if (isServedPath(parsed.pathname)) return url;
  parsed.pathname = `${served}/versions/${clientVersion}${parsed.pathname}`;
  return absolute ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}
// ---- end of the copy ----

const store = 'afterimage-clients';
const keyFor = clientId => new URL(`/afterimage/__clients/${encodeURIComponent(clientId)}`, self.location.href).href;
// A frame being created is not in clients.matchAll() until its document is ready, and the viewer creates two at once.
// So an entry is only dropped once its client has been listed and then is gone. Entries never listed (a navigation
// that was abandoned) are kept, but only the newest few, so the store stays small without any timing.
const unseenKept = 16;
// clientId -> { id, seen }: the version, and whether the client has been listed yet.
const versions = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function read(response) {
  try {
    return response ? JSON.parse(await response.text()) : null;
  } catch {
    return null;
  }
}

async function remember(clientId, entry) {
  const cache = await caches.open(store);
  await cache.put(keyFor(clientId), new Response(JSON.stringify(entry)));
  // Frames come and go as the viewer switches versions; drop what belongs to clients that are gone.
  const alive = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map(client => client.id));
  const unseen = [];
  for (const request of await cache.keys()) {
    const known = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
    const value = await read(await cache.match(request));
    if (!value) {
      await cache.delete(request);
    } else if (alive.has(known)) {
      if (!value.seen) await cache.put(request, new Response(JSON.stringify({ ...value, seen: true })));
      versions.set(known, { ...value, seen: true });
    } else if (value.seen) {
      await cache.delete(request);
      versions.delete(known);
    } else {
      unseen.push([request, known]);
    }
  }
  // keys() lists entries oldest first, so the end of the list is the newest.
  for (const [request, known] of unseen.slice(0, -unseenKept)) {
    await cache.delete(request);
    versions.delete(known);
  }
}

// Storage can be blocked or full; then the request is treated as one from an unknown client and passes through.
async function recall(clientId) {
  try {
    const value = await read(await (await caches.open(store)).match(keyFor(clientId)));
    if (value) versions.set(clientId, value);
    return value?.id;
  } catch {
    return undefined;
  }
}

// The init is spelled out: a Request passed as init would drop its body's streaming mode. Only GET and HEAD get here.
async function answer(request, id) {
  if (!id) return fetch(request);
  const { method, headers, mode, credentials, cache, redirect, referrer, referrerPolicy, integrity, signal } = request;
  const mapped = new Request(mapRequest({ clientVersion: id, url: request.url }), { method, headers, mode, credentials, cache, redirect, referrer, referrerPolicy, integrity, signal });
  const response = await fetch(mapped);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    const id = versionInPath(url.pathname);
    if (id && event.resultingClientId) {
      const entry = { id, seen: false };
      versions.set(event.resultingClientId, entry);
      event.waitUntil(remember(event.resultingClientId, entry).catch(() => {}));
    }
    return;
  }
  // A static site has nothing that takes a POST, so other methods pass through with their bodies untouched.
  if (!event.clientId || isServedPath(url.pathname) || (request.method !== 'GET' && request.method !== 'HEAD')) return;
  const known = versions.get(event.clientId)?.id;
  event.respondWith(known ? answer(request, known) : recall(event.clientId).then(id => answer(request, id)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { entryPath, frameWindow, replaceFrame, withoutHash, sameDocument, showsVersion } from '../src/viewer/frames.js';
import { createUrlWriter } from '../src/viewer/state/urlWriter.js';

// A frame whose window is same-origin, or one that navigated cross-origin: reading `document` throws there.
const sameOrigin = (href, readyState = 'complete') => ({ contentWindow: { document: { readyState }, location: { href } } });
const crossOrigin = () => ({
  contentWindow: {
    get document() { throw new Error('SecurityError: Blocked a frame with origin from accessing a cross-origin frame.'); },
    get location() { return { get href() { throw new Error('SecurityError'); } }; },
  },
});

test('frameWindow returns a same-origin window and null for anything else', () => {
  const frame = sameOrigin('http://localhost/versions/v2/index.html');
  assert.equal(frameWindow(frame), frame.contentWindow);
  assert.equal(frameWindow(crossOrigin()), null);
  assert.equal(frameWindow(null), null);
  assert.equal(frameWindow({ contentWindow: null }), null);
  assert.equal(frameWindow({ contentWindow: { document: null } }), null);
});

test('withoutHash keeps origin, path and query, and drops the fragment', () => {
  assert.equal(withoutHash('http://localhost:5173/versions/v2/index.html?a=1#pricing'), 'http://localhost:5173/versions/v2/index.html?a=1');
  assert.equal(withoutHash('http://localhost/x.html'), 'http://localhost/x.html');
  assert.equal(withoutHash('not a url'), null);
});

test('sameDocument ignores a hash change but not a path or query change', () => {
  const file = 'http://localhost/versions/v2/index.html';
  assert.equal(sameDocument(`${file}#section`, file), true);
  assert.equal(sameDocument(`${file}#/route/a`, `${file}#/route/b`), true);
  assert.equal(sameDocument(`${file}?tab=2`, file), false);
  assert.equal(sameDocument('http://localhost/versions/v1/index.html', file), false);
  assert.equal(sameDocument('bad', 'bad'), false);
});

test('showsVersion survives an anchor link, and is false for a cross-origin or unfinished frame', () => {
  const version = { file: 'versions/v2/index.html' };
  const page = 'http://localhost/index.html?version=v2';
  assert.equal(showsVersion(sameOrigin('http://localhost/versions/v2/index.html#faq'), version, page), true);
  assert.equal(showsVersion(sameOrigin('http://localhost/versions/v2/index.html', 'loading'), version, page), false);
  assert.equal(showsVersion(sameOrigin('http://localhost/versions/v1/index.html'), version, page), false);
  assert.equal(showsVersion(crossOrigin(), version, page), false);
  assert.equal(showsVersion(sameOrigin('http://localhost/versions/v2/index.html'), null, page), false);
});

test('entryPath is where frame.js puts a version\'s entry page', () => {
  assert.equal(entryPath('versions/v2/index.html'), '/');
  assert.equal(entryPath('versions/v12/nested/index.html'), '/nested/');
  assert.equal(entryPath('versions/v2/start.html'), '/start.html');
});

test('a frame with the runtime\'s mark shows a version only on that version\'s entry page', () => {
  const version = { id: 'v2', file: 'versions/v2/index.html' };
  const page = 'http://localhost/afterimage/index.html?version=v2';
  // The runtime rewrote the URL to the app's own path, so location is what the app sees.
  const marked = (href, id) => {
    const frame = sameOrigin(href);
    frame.contentWindow.location = new URL(href);
    frame.contentWindow.__afterimageVersion = id;
    return frame;
  };
  assert.equal(showsVersion(marked('http://localhost/', 'v2'), version, page), true);
  assert.equal(showsVersion(marked('http://localhost/#faq', 'v2'), version, page), true);
  // Another route or page of the same version is not the page being compared.
  assert.equal(showsVersion(marked('http://localhost/about', 'v2'), version, page), false);
  assert.equal(showsVersion(marked('http://localhost/?tab=2', 'v2'), version, page), false);
  assert.equal(showsVersion(marked('http://localhost/', 'v1'), version, page), false);
  assert.equal(showsVersion(marked('http://localhost/nested/', 'v2'), { id: 'v2', file: 'versions/v2/nested/index.html' }, page), true);
  // The live app at the root has no mark, and is not the version.
  assert.equal(showsVersion(sameOrigin('http://localhost/'), version, page), false);
});

test('a marked frame shows its version where the app settled on its own, and nowhere else', () => {
  const version = { id: 'v2', file: 'versions/v2/index.html' };
  const page = 'http://localhost/afterimage/?version=v2';
  // What frame.js leaves: the file the document came from, and the path the app settled on before any touch.
  const settled = (href, { path, file = '/afterimage/versions/v2/index.html', id = 'v2' }) => {
    const frame = sameOrigin(href);
    Object.assign(frame.contentWindow, { location: new URL(href), __afterimageVersion: id, __afterimagePath: path, __afterimageFile: file });
    return frame;
  };
  // The app redirected on load (replaceState to /home): that is its page now.
  assert.equal(showsVersion(settled('http://localhost/home', { path: '/home' }), version, page), true);
  assert.equal(showsVersion(settled('http://localhost/home#top', { path: '/home' }), version, page), true);
  // The person opened a route after the path froze.
  assert.equal(showsVersion(settled('http://localhost/about', { path: '/home' }), version, page), false);
  assert.equal(showsVersion(settled('http://localhost/about', { path: '/' }), version, page), false);
  // A hard link loaded another file of the version, which settled on its own path.
  assert.equal(showsVersion(settled('http://localhost/two.html', { path: '/two.html', file: '/afterimage/versions/v2/two.html' }), version, page), false);
  // Another version's frame.
  assert.equal(showsVersion(settled('http://localhost/home', { path: '/home', id: 'v1', file: '/afterimage/versions/v1/index.html' }), version, page), false);
});

test('replaceFrame moves a frame without a history entry, and sets src only on a frame with no window yet', () => {
  const replaced = [];
  const frame = { src: 'versions/v2/index.html', contentWindow: { location: { replace: url => replaced.push(url) } } };
  replaceFrame(frame, 'http://localhost/afterimage/versions/v1/index.html');
  assert.deepEqual(replaced, ['http://localhost/afterimage/versions/v1/index.html']);
  assert.equal(frame.src, 'versions/v2/index.html');
  const detached = { src: '', contentWindow: null };
  replaceFrame(detached, 'http://localhost/afterimage/versions/v1/index.html');
  assert.equal(detached.src, 'http://localhost/afterimage/versions/v1/index.html');
});

// ---- the URL writer ----

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout: handle => { timers.delete(handle); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}

function fakeBrowser({ search = '', hash = '', fail = false } = {}) {
  const location = { pathname: '/', search, hash };
  const calls = [];
  const history = {
    state: null,
    replaceState(state, title, url) {
      calls.push(url);
      if (fail) throw new Error('SecurityError: Attempt to use history.replaceState() more than 100 times per 10 seconds');
      const parsed = new URL(url, 'http://localhost');
      location.search = parsed.search;
      location.hash = parsed.hash;
    },
  };
  return { location, history, calls };
}

test('URL writes coalesce into one trailing write per ~200ms', () => {
  const clock = fakeClock();
  const browser = fakeBrowser();
  const writer = createUrlWriter({ ...browser, ...clock });
  writer.write('?version=v3&mode=explore');
  writer.write('?version=v2&mode=explore');
  writer.write('?version=v1&mode=explore');
  assert.deepEqual(browser.calls, []);
  clock.advance(199);
  assert.deepEqual(browser.calls, []);
  clock.advance(1);
  assert.deepEqual(browser.calls, ['?version=v1&mode=explore']);

  // Holding a key: a write every 16ms for a second still makes about five writes, not sixty.
  for (let i = 0; i < 60; i++) { writer.write(`?version=v${i % 2 ? 4 : 5}&mode=explore&n=${i}`); clock.advance(16); }
  clock.advance(200);
  assert.ok(browser.calls.length <= 7, `made ${browser.calls.length} writes`);
  assert.equal(browser.location.search, '?version=v4&mode=explore&n=59');
});

test('a write that matches the address bar is skipped', () => {
  const clock = fakeClock();
  const browser = fakeBrowser({ search: '?hl=1' });
  const writer = createUrlWriter({ ...browser, ...clock });
  writer.write('?hl=1');
  clock.advance(200);
  assert.deepEqual(browser.calls, []);
  const empty = fakeBrowser();
  const second = createUrlWriter({ ...empty, ...clock });
  second.write('');
  clock.advance(200);
  assert.deepEqual(empty.calls, []);
});

test('a throwing replaceState never escapes the writer', () => {
  const clock = fakeClock();
  const browser = fakeBrowser({ fail: true });
  const writer = createUrlWriter({ ...browser, ...clock });
  writer.write('?hl=1');
  assert.doesNotThrow(() => clock.advance(200));
  assert.equal(browser.calls.length, 1);
  writer.write('?hl=1&change=2');
  assert.doesNotThrow(() => writer.flush());
});

test('the hash is kept, also when the search empties to the bare path', () => {
  const clock = fakeClock();
  const browser = fakeBrowser({ search: '?hl=1', hash: '#pricing' });
  const writer = createUrlWriter({ ...browser, ...clock });
  writer.write('?hl=1&change=3');
  clock.advance(200);
  assert.deepEqual(browser.calls, ['?hl=1&change=3#pricing']);
  writer.write('');
  clock.advance(200);
  assert.deepEqual(browser.calls.at(-1), '/#pricing');
});

test('flush writes the pending search at once (pagehide, copy link) and leaves no timer behind', () => {
  const clock = fakeClock();
  const browser = fakeBrowser();
  const writer = createUrlWriter({ ...browser, ...clock });
  writer.write('?layout=side');
  writer.flush();
  assert.deepEqual(browser.calls, ['?layout=side']);
  assert.equal(clock.pending, 0);
  writer.flush();
  clock.advance(500);
  assert.equal(browser.calls.length, 1, 'nothing left to write');
  writer.write('?layout=side&hl=1');
  writer.cancel();
  clock.advance(500);
  assert.equal(browser.calls.length, 1, 'cancel drops the pending write');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReview } from '../src/engine/diff-records.js';
import { reviewKey, summarize, filterEntries, createReviewTimer, createDebounce, acceptResult, reviewSignature } from '../src/engine/review.js';
import { readCount, writeCount } from '../src/engine/review-cache.js';

const record = (key, overrides = {}) => ({ key, ancestors: [], text: 'Same text', attributes: '', style: 'color:black', rect: { x: 10, y: 20, width: 100, height: 40 }, ...overrides });
const version = (id, sha256) => ({ id, name: id, label: id, file: `versions/${id}/index.html`, notes: [], savedAt: null, sha256 });

// 109 changed, 12 added, 12 removed.
function syntheticReview() {
  const before = [
    ...Array.from({ length: 109 }, (_, i) => record(`c${i}`, { label: `Changed ${i}`, text: 'Old' })),
    ...Array.from({ length: 12 }, (_, i) => record(`r${i}`, { label: `Removed ${i}`, content: `Removed ${i}` })),
  ];
  const after = [
    ...Array.from({ length: 109 }, (_, i) => record(`c${i}`, { label: `Changed ${i}`, text: 'New' })),
    ...Array.from({ length: 12 }, (_, i) => record(`a${i}`, { label: `Added ${i}`, content: `Added ${i}` })),
  ];
  return buildReview(after, before);
}

test('reviewKey changes when size or a hash changes', () => {
  const target = version('v2', 'aaa'), base = version('v1', 'bbb');
  const wide = reviewKey({ target, base, width: 1280, height: 720 });
  assert.equal(wide, reviewKey({ target, base, width: 1280, height: 720 }));
  assert.notEqual(wide, reviewKey({ target, base, width: 390, height: 844 }));
  assert.notEqual(wide, reviewKey({ target: base, base: target, width: 1280, height: 720 }));
  assert.notEqual(wide, reviewKey({ target: version('v2', 'ccc'), base, width: 1280, height: 720 }));
  assert.notEqual(wide, reviewKey({ target, base: version('v1', 'ddd'), width: 1280, height: 720 }));
});

test('summarize counts kinds', () => {
  const { entries } = syntheticReview();
  assert.deepEqual(summarize(entries), { total: 133, changed: 109, added: 12, removed: 12 });
  assert.deepEqual(summarize([]), { total: 0, changed: 0, added: 0, removed: 0 });
});

test('filterEntries narrows by kind and keeps review order', () => {
  const { entries } = syntheticReview();
  const removed = filterEntries(entries, 'removed');
  assert.equal(removed.length, 12);
  assert.ok(removed.every(entry => entry.kind === 'removed'));
  assert.equal(filterEntries(entries, 'added').length, 12);
  assert.deepEqual(filterEntries(entries, 'all'), entries);
  assert.deepEqual(filterEntries(entries, 'all').map(entry => entry.key), entries.map(entry => entry.key));
});

test('filterEntries changed includes layout-only entries', () => {
  const before = [record('layout'), record('text')];
  const after = [record('layout', { rect: { x: 100, y: 20, width: 100, height: 40 } }), record('text', { text: 'Changed copy' })];
  const { entries } = buildReview(after, before);
  const changed = filterEntries(entries, 'changed');
  assert.equal(changed.length, 2);
  assert.ok(changed.some(entry => entry.layoutOnly));
});

test('acceptResult drops results for a stale key', () => {
  assert.equal(acceptResult('a', 'a'), true);
  assert.equal(acceptResult('a', 'b'), false);
});

test('createReviewTimer fires after 8000ms unless done', () => {
  const pending = [];
  const fake = {
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; pending.push(timer); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
  };
  let fired = 0;
  const timer = createReviewTimer({ onTimeout: () => { fired++; } }, fake);
  timer.start();
  assert.equal(pending[0].ms, 8000);
  pending[0].fn();
  assert.equal(fired, 1);

  const second = createReviewTimer({ onTimeout: () => { fired++; } }, fake);
  second.start();
  second.done();
  assert.equal(pending[1].cleared, true);

  const third = createReviewTimer({ onTimeout: () => { fired++; } }, fake);
  third.start();
  third.cancel();
  assert.equal(pending[2].cleared, true);
});

test('review cache is inert without localStorage', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined');
  assert.equal(readCount('k'), null);
  assert.doesNotThrow(() => writeCount('k', { total: 1, changed: 1, added: 0, removed: 0 }));
});

test('review cache round-trips, survives bad data and keeps at most 500 keys', () => {
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; },
    key: i => [...store.keys()][i] ?? null,
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  try {
    const summary = { total: 3, changed: 2, added: 1, removed: 0 };
    writeCount('one', summary);
    assert.deepEqual(readCount('one'), summary);
    store.set('afterimage-count:bad', '{nope');
    assert.equal(readCount('bad'), null);
    store.set('unrelated', 'keep');
    for (let i = 0; i < 520; i++) writeCount(`key-${i}`, { total: i, changed: i, added: 0, removed: 0 });
    const keys = [...store.keys()].filter(k => k.startsWith('afterimage-count:'));
    assert.equal(keys.length, 500);
    assert.equal(readCount('one'), null);
    assert.equal(readCount('key-0'), null);
    assert.equal(readCount('key-519').total, 519);
    assert.equal(store.get('unrelated'), 'keep');
  } finally {
    delete globalThis.localStorage;
  }
});

test('reviewSignature is stable for equal reviews and changes when a rect moves', () => {
  const before = [record('card')];
  const after = [record('card', { text: 'Edited' })];
  assert.equal(reviewSignature(buildReview(after, before)), reviewSignature(buildReview(after, before)));
  const moved = [record('card', { text: 'Edited', rect: { x: 10, y: 400, width: 100, height: 40 } })];
  assert.notEqual(reviewSignature(buildReview(after, before)), reviewSignature(buildReview(moved, before)));
});

// ---- final review fixes ----

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
  };
}

test('createDebounce runs once after a quiet 80ms', () => {
  const clock = fakeClock();
  let runs = 0;
  const debounce = createDebounce(() => { runs++; }, { waitMs: 80, maxWaitMs: 500 }, clock);
  debounce.schedule();
  clock.advance(40);
  debounce.schedule();
  clock.advance(79);
  assert.equal(runs, 0);
  clock.advance(1);
  assert.equal(runs, 1);
  clock.advance(1000);
  assert.equal(runs, 1, 'nothing more without a new schedule');
});

test('continuous mutation still runs the review every ~500ms (I2: no false "Couldn\'t check")', () => {
  const clock = fakeClock();
  const runs = [];
  let t = 0;
  const debounce = createDebounce(() => { runs.push(t); }, { waitMs: 80, maxWaitMs: 500 }, clock);
  // A JS animation mutates the page every 16ms for 8 seconds: a plain trailing debounce would never run.
  for (t = 0; t < 8000; t += 16) { debounce.schedule(); clock.advance(16); }
  assert.ok(runs.length >= 14, `ran ${runs.length} times`);
  assert.ok(runs[0] <= 512, `first run at ${runs[0]}ms`);
  debounce.cancel();
  const before = runs.length;
  clock.advance(1000);
  assert.equal(runs.length, before, 'cancel stops both timers');
});

test('writeCount only writes when the summary changed', () => {
  const store = new Map();
  let writes = 0;
  globalThis.localStorage = {
    get length() { return store.size; },
    key: i => [...store.keys()][i] ?? null,
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => { writes++; store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  try {
    const summary = { total: 3, changed: 2, added: 1, removed: 0 };
    writeCount('same', summary);
    writeCount('same', { ...summary });
    writeCount('same', { ...summary });
    assert.equal(writes, 1);
    writeCount('same', { ...summary, total: 4, changed: 3 });
    assert.equal(writes, 2);
    assert.equal(readCount('same').total, 4);
  } finally {
    delete globalThis.localStorage;
  }
});

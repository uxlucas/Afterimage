import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/engine/background-queue.js';
import { writeCount } from '../src/engine/review-cache.js';

const pair = id => ({ key: `${id}|base|1280|720`, id });
const summary = total => ({ total, changed: total, added: 0, removed: 0 });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// A run function whose calls stay pending until the test resolves them, one by one.
function manualRun() {
  const calls = [];
  const run = item => new Promise((resolve, reject) => { calls.push({ item, resolve, reject }); });
  return { calls, run, started: () => calls.map(call => call.item.id) };
}

function withStorage(fn) {
  const map = new Map();
  globalThis.localStorage = {
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: name => (map.has(name) ? map.get(name) : null),
    setItem: (name, value) => map.set(name, String(value)),
    removeItem: name => map.delete(name),
  };
  return Promise.resolve(fn(map)).finally(() => { delete globalThis.localStorage; });
}

test('wanting 5 pairs runs them one at a time, in order', async () => {
  const { calls, run, started } = manualRun();
  const queue = createQueue({ run });
  queue.want(['v5', 'v4', 'v3', 'v2', 'v1'].map(pair));
  await settle();
  assert.deepEqual(started(), ['v5'], 'only the first pair starts');

  for (let i = 0; i < 4; i++) {
    calls[i].resolve(summary(i));
    await settle();
    assert.equal(calls.length, i + 2, 'the next pair starts only after the previous one resolves');
  }
  calls[4].resolve(summary(4));
  await settle();
  assert.deepEqual(started(), ['v5', 'v4', 'v3', 'v2', 'v1']);
});

test('calling want again with 2 different pairs drops the unstarted ones', async () => {
  const { calls, run, started } = manualRun();
  const queue = createQueue({ run });
  queue.want(['v9', 'v8', 'v7', 'v6'].map(pair));
  await settle();
  queue.want(['v3', 'v2'].map(pair));
  calls[0].resolve(summary(1));
  await settle();
  calls[1].resolve(summary(1));
  await settle();
  calls[2]?.resolve(summary(1));
  await settle();
  assert.deepEqual(started(), ['v9', 'v3', 'v2'], 'v9 was in flight and finishes; v8 to v6 never run');
});

test('a pair that is wanted again while in flight does not run twice', async () => {
  const { calls, run, started } = manualRun();
  const queue = createQueue({ run });
  queue.want(['v5', 'v4'].map(pair));
  await settle();
  queue.want(['v5', 'v4'].map(pair));
  calls[0].resolve(summary(1));
  await settle();
  calls[1]?.resolve(summary(1));
  await settle();
  assert.deepEqual(started(), ['v5', 'v4']);
});

test('a pair that readCount already has never runs', () => withStorage(async () => {
  writeCount(pair('v4').key, summary(7));
  const { calls, run, started } = manualRun();
  const queue = createQueue({ run });
  queue.want(['v5', 'v4', 'v3'].map(pair));
  await settle();
  calls[0].resolve(summary(1));
  await settle();
  calls[1]?.resolve(summary(1));
  await settle();
  assert.deepEqual(started(), ['v5', 'v3']);
}));

test('a finished pair is written to the cache and reported', () => withStorage(async map => {
  const reported = [];
  const { calls, run } = manualRun();
  const queue = createQueue({ run, onResult: (item, result) => reported.push([item.id, result.total]) });
  queue.want([pair('v5')]);
  await settle();
  calls[0].resolve(summary(12));
  await settle();
  assert.deepEqual(reported, [['v5', 12]]);
  assert.equal(map.size, 1);
}));

test('a pair that fails is skipped and the queue moves on', async () => {
  const { calls, run, started } = manualRun();
  const queue = createQueue({ run });
  queue.want(['v5', 'v4'].map(pair));
  await settle();
  calls[0].reject(new Error('frame never loaded'));
  await settle();
  calls[1].resolve(summary(1));
  await settle();
  queue.want(['v5', 'v4'].map(pair));
  await settle();
  assert.deepEqual(started(), ['v5', 'v4'], 'a failed pair is not retried, a finished one is not rerun');
});

test('cancel() stops after the in-flight pair resolves', async () => {
  const reported = [];
  const { calls, run, started } = manualRun();
  const queue = createQueue({ run, onResult: item => reported.push(item.id) });
  queue.want(['v5', 'v4', 'v3'].map(pair));
  await settle();
  queue.cancel();
  calls[0].resolve(summary(1));
  await settle();
  queue.want(['v2'].map(pair));
  await settle();
  assert.deepEqual(started(), ['v5']);
  assert.deepEqual(reported, [], 'nothing is reported after cancel');
});

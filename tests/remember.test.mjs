import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberRetracted } from '../src/viewer/state/remember.js';

const memoryStorage = () => {
  const data = {};
  return {
    data,
    getItem: name => data[name] ?? null,
    setItem: (name, value) => { data[name] = value; },
    removeItem: name => { delete data[name]; },
  };
};

test('a put-away pill is remembered under an afterimage- key, and forgotten when it comes back', () => {
  const storage = memoryStorage();
  const memory = rememberRetracted(() => storage);
  assert.equal(memory.read(), false);
  memory.write(true);
  assert.deepEqual(storage.data, { 'afterimage-retracted': '1' });
  assert.equal(rememberRetracted(() => storage).read(), true); // a later visit
  memory.write(false);
  assert.deepEqual(storage.data, {});
});

test('when storage is unavailable the pill starts out and nothing crashes', () => {
  const broken = rememberRetracted(() => { throw new Error('SecurityError'); });
  assert.equal(broken.read(), false);
  assert.doesNotThrow(() => broken.write(true));
  const full = rememberRetracted(() => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} }));
  assert.doesNotThrow(() => full.write(true));
});

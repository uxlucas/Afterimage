import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWork, workHeldFor } from '../src/viewer/motionHold.js';

test('work waits out a move on the stage, and the longest hold wins', () => {
  assert.equal(workHeldFor(0), 0);
  holdWork(300, 1000);
  assert.equal(workHeldFor(1100), 200);
  holdWork(50, 1100); // a shorter move meanwhile doesn't cut the first one short
  assert.equal(workHeldFor(1100), 200);
  assert.equal(workHeldFor(1400), 0);
});

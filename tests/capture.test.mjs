import test from 'node:test';
import assert from 'node:assert/strict';
import { stableId } from '../src/engine/capture.js';

test('only data-afterimage-id pins a match; the old data-tm-id is gone', () => {
  assert.equal(stableId({ dataset: { afterimageId: 'card' } }), 'card');
  assert.equal(stableId({ dataset: { tmId: 'card' } }), undefined);
});

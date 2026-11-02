import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecords, buildReview } from '../src/engine/diff-records.js';

const record = (key, overrides = {}) => ({ key, ancestors: [], text: 'Same text', attributes: '', style: 'color:black', rect: { x: 10, y: 20, width: 100, height: 40 }, ...overrides });

test('Unchanged content and subpixel layout noise produce no highlight', () => {
  assert.deepEqual(compareRecords([record('title', { rect: { x: 11, y: 20, width: 101, height: 40 } })], [record('title')]), { current: [], previous: [] });
});
test('Text and style changes are detected even when geometry is unchanged', () => {
  const result = compareRecords([record('title', { text: 'New heading', style: 'color:red' })], [record('title')]);
  assert.deepEqual(result.current[0].reasons, ['content', 'style']);
  assert.equal(result.previous[0].kind, 'changed');
});
test('Position and size changes highlight both versions', () => {
  const result = compareRecords([record('button', { rect: { x: 40, y: 90, width: 160, height: 44 } })], [record('button')]);
  assert.deepEqual(result.current[0].reasons, ['layout']);
  assert.equal(result.previous[0].rect.y, 20);
});
test('Added and removed regions are reported on the version that contains them', () => {
  const result = compareRecords([record('new')], [record('old')]);
  assert.equal(result.current[0].kind, 'added');
  assert.equal(result.previous[0].kind, 'removed');
});
test('An added section groups its child highlights into one region', () => {
  const result = compareRecords([record('shipping'), record('address', { ancestors: ['shipping'] })], []);
  assert.deepEqual(result.current.map(change => change.key), ['shipping']);
});
test('A page background change does not hide a changed heading', () => {
  const old = [record('page', { page: true }), record('title', { ancestors: ['page'] })];
  const result = compareRecords([record('page', { page: true, style: 'background:black' }), record('title', { ancestors: ['page'], text: 'New' })], old);
  assert.equal(result.current.length, 2);
});

test('Grouped layout changes retain nested text edits in the explanation', () => {
  const before = [record('card', { label: 'Delivery', content: 'Delivery $12' }), record('price', { ancestors: ['card'], label: 'Price', text: '$12' })];
  const after = [record('card', { label: 'Delivery', rect: { x: 80, y: 20, width: 100, height: 40 } }), record('price', { ancestors: ['card'], label: 'Price', text: '$18' })];
  const { entries } = buildReview(after, before);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].layoutOnly, false);
  assert.ok(entries[0].details.some(detail => detail.before === '$12' && detail.after === '$18'));
});

test('Style-only changes name the property and retain both values', () => {
  const { entries } = buildReview([record('page', { page: true, label: 'Page background', style: 'new', styles: { backgroundColor: 'rgb(0, 0, 0)' } })], [record('page', { page: true, styles: { backgroundColor: 'rgb(255, 255, 255)' } })]);
  assert.equal(entries[0].kindLabel, 'Appearance changed');
  assert.deepEqual(entries[0].details[0], { label: 'Background color', before: 'rgb(255, 255, 255)', after: 'rgb(0, 0, 0)', color: true });
});

test('Dense comparisons keep every added and removed region with no silent cap', () => {
  const before = Array.from({ length: 200 }, (_, i) => record(`old-${i}`, { content: `Old item ${i}` }));
  const after = Array.from({ length: 200 }, (_, i) => record(`new-${i}`, { content: `New item ${i}` }));
  const { entries } = buildReview(after, before);
  assert.equal(entries.length, 400);
  assert.equal(entries.at(-1).number, 400);
  assert.equal(entries.filter(entry => entry.kind === 'removed').length, 200);
  assert.equal(entries.at(-1).details[0].before, 'Old item 199');
});

test('Elements that only moved because of a real edit are not changes of their own', () => {
  // A note added under an order total widens its column: every other cell of the table shifts sideways.
  const cells = Array.from({ length: 40 }, (_, i) => `cell-${i}`);
  const before = [record('total'), ...cells.map(key => record(key))];
  const after = [record('total', { text: '€704.46 Rec. price' }), record('note', { ancestors: ['total'] }), ...cells.map(key => record(key, { rect: { x: 18, y: 20, width: 100, height: 40 } }))];
  const { entries, comparison } = buildReview(after, before);
  assert.deepEqual(entries.map(entry => entry.key), ['total', 'note']);
  assert.deepEqual(comparison.current.map(change => change.key), ['total', 'note']);
  assert.deepEqual(comparison.previous.map(change => change.key), ['total']);
});

test('A cell that only grew to hold an added note is not a second change', () => {
  // The note is its own entry; the cell around it only got wider.
  const before = [record('total')];
  const after = [record('total', { rect: { x: 10, y: 20, width: 120, height: 40 } }), record('note', { ancestors: ['total'] })];
  const { entries, comparison } = buildReview(after, before);
  assert.deepEqual(entries.map(entry => entry.key), ['note']);
  assert.deepEqual(entries.map(entry => entry.number), [1]);
  assert.deepEqual(comparison.current.map(change => change.key), ['note']);
  assert.deepEqual(comparison.previous, []);
});

test('A version whose only difference is layout still reports the move', () => {
  const { entries, comparison } = buildReview([record('card', { rect: { x: 10, y: 20, width: 240, height: 40 } })], [record('card')]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].layoutOnly, true);
  assert.equal(entries[0].kindLabel, 'Moved or resized');
  assert.deepEqual(comparison.current.map(change => change.key), ['card']);
});

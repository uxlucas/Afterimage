import test from 'node:test';
import assert from 'node:assert/strict';
import { bindClearOnClick, clickClearsSelection } from '../src/viewer/stage/overlay.js';

const region = { left: 100, top: 100, right: 300, bottom: 200 };
const card = { left: 320, top: 100, right: 516, bottom: 180 };
const click = (x, y, extra = {}) => clickClearsSelection({
  x, y, moved: 0, viewport: { width: 1000, height: 800 }, region, card, slop: 8, ...extra,
});

test('a click away from the region and its card clears the selection', () => {
  assert.equal(click(600, 500), true);
});

test('a click inside the selected region keeps it, so its control still works', () => {
  assert.equal(click(150, 150), false);
});

test('a click on the outline just outside the region keeps it', () => {
  assert.equal(click(95, 150), false);
  assert.equal(click(91, 150), true);
});

test('a click on the card keeps the selection', () => {
  assert.equal(click(400, 140), false);
});

test('a page-wide change has no region to protect, only its card', () => {
  assert.equal(click(150, 150, { region: null }), true);
  assert.equal(click(400, 140, { region: null }), false);
});

test('a drag, such as selecting text, keeps the selection', () => {
  assert.equal(click(600, 500, { moved: 5 }), false);
  assert.equal(click(600, 500, { moved: 4 }), true);
});

test('a click on a scrollbar keeps the selection', () => {
  assert.equal(click(1005, 400), false);
  assert.equal(click(500, 805), false);
});

// Just enough of a frame's document for bindClearOnClick: an overlay with no boxes, so any real click is away.
function fakeFrame() {
  const listeners = {};
  const overlay = { contains: () => false, querySelector: () => null };
  const doc = {
    defaultView: { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: () => {} },
    querySelector: () => overlay,
    documentElement: { clientWidth: 1000, clientHeight: 800 },
  };
  return { doc, fire: (type, event) => listeners[type]({ target: {}, ...event }) };
}

test('a click from the keyboard (Enter on a prototype button) keeps the selection', () => {
  globalThis.CSS ??= { escape: value => value };
  const { doc, fire } = fakeFrame();
  let cleared = 0;
  bindClearOnClick(doc, 'card', () => { cleared++; });
  fire('click', { detail: 0, clientX: 0, clientY: 0 });
  assert.equal(cleared, 0);
});

test('an earlier press does not count as a drag for a later click', () => {
  globalThis.CSS ??= { escape: value => value };
  const { doc, fire } = fakeFrame();
  let cleared = 0;
  bindClearOnClick(doc, 'card', () => { cleared++; });
  fire('pointerdown', { clientX: 600, clientY: 500 });
  fire('click', { detail: 1, clientX: 600, clientY: 500 });
  fire('click', { detail: 1, clientX: 50, clientY: 50 }); // no press of its own: not a drag from 600,500
  assert.equal(cleared, 2);
});

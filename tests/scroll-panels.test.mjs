import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollOffset } from '../src/engine/capture.js';
import { placeRegion, revealPlan } from '../src/viewer/stage/overlay.js';

// Apps like an admin shell keep the page still and scroll a panel inside it. These fakes are just enough layout for
// that: a document, a panel that scrolls, and an element in it. Rects are client (viewport) coordinates.
function layout({ panelScroll = 0, windowScroll = 0, elementTop = 900 } = {}) {
  const html = { tagName: 'HTML', parentElement: null, scrollTop: 0, scrollLeft: 0 };
  const body = { tagName: 'BODY', parentElement: html, scrollTop: 0, scrollLeft: 0 };
  // The panel sits 100px down the screen and is 400px tall, with 2000px of content.
  const panel = {
    tagName: 'MAIN', parentElement: body, scrollTop: panelScroll, scrollLeft: 0, scrollHeight: 2000, clientHeight: 400,
    style: { overflowX: 'hidden', overflowY: 'auto' },
    getBoundingClientRect: () => ({ left: 0, top: 100 - windowScroll, right: 800, bottom: 500 - windowScroll, width: 800, height: 400 }),
  };
  const row = { tagName: 'TR', parentElement: panel, scrollTop: 0, scrollLeft: 0, style: { overflowX: 'visible', overflowY: 'visible' } };
  // elementTop is where the element sits in the panel's content; what shows is that, less the panel's scroll.
  const element = {
    tagName: 'SPAN', parentElement: row, isConnected: true, scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => {
      const top = 100 + elementTop - panelScroll - windowScroll;
      return { left: 40, top, right: 140, bottom: top + 20, width: 100, height: 20 };
    },
  };
  const win = { scrollX: 0, scrollY: windowScroll, innerHeight: 800, getComputedStyle: el => el.style ?? { overflowX: 'visible', overflowY: 'visible' } };
  const doc = { body, documentElement: html, defaultView: win };
  for (const node of [html, body, panel, row, element]) node.ownerDocument = doc;
  return { panel, element, win };
}

test('a position inside a scrolled panel is the same at any scroll', () => {
  const still = layout({ panelScroll: 0 });
  const scrolled = layout({ panelScroll: 640 });
  assert.deepEqual(scrollOffset(still.element), { x: 0, y: 0 });
  assert.deepEqual(scrollOffset(scrolled.element), { x: 0, y: 640 });
  // What capture adds to the client rect, so both captures put the element at the same place.
  const at = ({ element, win }) => element.getBoundingClientRect().top + win.scrollY + scrollOffset(element).y;
  assert.equal(at(still), at(scrolled));
});

test('an outline follows its element when the panel scrolls, and is cut at the panel edge', () => {
  const { element, win } = layout({ panelScroll: 640, elementTop: 900 });
  const { rect, clip } = placeRegion({ element, rect: { x: 0, y: 0, width: 1, height: 1 } }, win);
  assert.deepEqual(rect, { x: 40, y: 360, width: 100, height: 20 });
  assert.deepEqual(clip, { x: 0, y: 100, width: 800, height: 400 });
});

test('an outline whose element is gone keeps its captured place', () => {
  const { element, win } = layout();
  element.isConnected = false;
  const captured = { x: 1, y: 2, width: 3, height: 4 };
  assert.deepEqual(placeRegion({ element, rect: captured }, win), { rect: captured, clip: null });
});

test('stepping to a change below the fold scrolls the panel that holds it, so it sits in the middle', () => {
  const { panel, element, win } = layout({ panelScroll: 0, elementTop: 1500 });
  const plan = revealPlan(element, win);
  // The panel shows 400px: the 20px element goes 190px from its top. Then the page itself has nothing to move.
  assert.deepEqual(plan, [{ target: panel, top: 1500 - 190 }, { target: win, top: 0 }]);
});

test('on a page that scrolls itself, stepping scrolls the page as before', () => {
  const { element, win } = layout({ elementTop: 300 });
  element.parentElement = element.ownerDocument.body;
  const plan = revealPlan(element, win);
  assert.deepEqual(plan, [{ target: win, top: 100 + 300 - 390 }]);
});

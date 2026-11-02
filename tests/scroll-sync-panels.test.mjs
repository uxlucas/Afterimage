import test from 'node:test';
import assert from 'node:assert/strict';
import { counterpart, levelPanels, linkScroll, matchScroll, panelTops, setPanelTops } from '../src/viewer/stage/scrollSync.js';

// An app shell as two builds make it: the page stays still and a panel (<main>) scrolls. `extra` adds an element
// before the panel's parent, as a later version might, so the panel's path differs between the two.
function shell({ contentHeight = 4000, extra = false } = {}) {
  const docListeners = new Set();
  const node = (tagName, parentElement, props = {}) => {
    const element = { tagName, parentElement, children: [], scrollTop: 0, scrollHeight: 0, clientHeight: 0, style: { overflowY: 'visible' }, ...props };
    parentElement?.children.push(element);
    return element;
  };
  const html = node('HTML', null);
  const body = node('BODY', html);
  const app = node('DIV', body);
  if (extra) node('ASIDE', app);
  const layout = node('DIV', app);
  node('NAV', layout);
  const queue = [];
  const panel = node('MAIN', layout, { scrollHeight: contentHeight, clientHeight: 600, style: { overflowY: 'auto' } });
  // Setting scrollTop clamps like a browser and fires a scroll event at the panel.
  let top = 0;
  Object.defineProperty(panel, 'scrollTop', {
    get: () => top,
    set: value => {
      const next = Math.min(panel.scrollHeight - panel.clientHeight, Math.max(0, value));
      if (next === top) return;
      top = next;
      queue.push(panel);
    },
  });
  const all = [];
  const walk = element => { for (const child of element.children) { all.push(child); walk(child); } };
  walk(body);
  const doc = {
    body, documentElement: html,
    querySelectorAll: () => all,
    addEventListener: (type, handler) => { if (type === 'scroll') docListeners.add(handler); },
    removeEventListener: (type, handler) => { if (type === 'scroll') docListeners.delete(handler); },
  };
  const win = {
    scrollY: 0, document: doc, getComputedStyle: element => element.style,
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
  };
  doc.defaultView = win;
  Object.assign(doc, { scrollingElement: html });
  html.scrollHeight = 800; html.clientHeight = 800;
  for (const element of [html, body, ...all]) element.ownerDocument = doc;
  const frame = { contentWindow: win, addEventListener() {}, removeEventListener() {} };
  // Delivers queued scroll events the way a browser does: at the document, capture first, with the panel as target.
  const flush = () => { while (queue.length) { const target = queue.shift(); for (const handler of [...docListeners]) handler({ target }); } };
  return { doc, panel, frame, flush, scroll: value => { panel.scrollTop = value; } };
}

test('counterpart finds the same panel in the other version, even when the page around it moved', () => {
  const a = shell(), same = shell(), shifted = shell({ extra: true });
  assert.equal(counterpart(a.panel, same.doc), same.panel);
  assert.equal(counterpart(a.panel, shifted.doc), shifted.panel);
});

test('scrolling a panel in one version scrolls the same panel in the other, without the two chasing each other', () => {
  const before = shell({ contentHeight: 4000 }), after = shell({ contentHeight: 5800, extra: true });
  const stop = linkScroll(before.frame, after.frame);
  after.scroll(2600); // halfway down its 5200px of scroll
  after.flush();
  assert.equal(before.panel.scrollTop, 1700); // halfway down 3400px
  before.flush(); // the echo of that move must not move the first panel back
  assert.equal(after.panel.scrollTop, 2600);
  stop();
  after.scroll(0);
  after.flush();
  assert.equal(before.panel.scrollTop, 1700, 'unlinked: panels no longer follow');
});

test('levelPanels puts the other version\'s panels where this one\'s are, and puts them back', () => {
  const target = shell(), base = shell();
  target.scroll(1200);
  base.scroll(300);
  const restore = levelPanels(target.doc, base.doc);
  assert.equal(base.panel.scrollTop, 1200);
  restore();
  assert.equal(base.panel.scrollTop, 300);
});

test('panel scroll goes across the page and the viewer as a list, one top per scrolling panel in page order', () => {
  const live = shell(), viewer = shell();
  live.scroll(1300);
  assert.deepEqual(panelTops(live.doc), [1300]);
  setPanelTops(viewer.doc, panelTops(live.doc));
  assert.equal(viewer.panel.scrollTop, 1300);
  setPanelTops(viewer.doc, [Number.NaN, 5]); // junk from a message changes nothing it can't place
  assert.equal(viewer.panel.scrollTop, 1300);
});

test('matchScroll puts a frame where another is, page and panels, for a version swapped in place', () => {
  const old = shell({ contentHeight: 4000 }), next = shell({ contentHeight: 5800 });
  old.scroll(1700); // halfway
  const moves = [];
  next.doc.defaultView.scrollTo = options => moves.push(options);
  matchScroll(next.doc.defaultView, old.doc.defaultView);
  assert.equal(next.panel.scrollTop, 2600);
  assert.deepEqual(moves, [{ top: 0, behavior: 'instant' }]); // the page itself doesn't scroll in an app shell
});

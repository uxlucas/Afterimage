// Keeps two same-origin frames at the same relative scroll position: the page, and every panel that scrolls inside
// it (an app shell keeps the page still and scrolls its content). Plain DOM, outside React.
import { syncedTop } from '../state/versions.js';
import { frameWindow, quietly } from '../frames.js';

const ECHO_PX = 1;

// clientHeight, not innerHeight: innerHeight includes a horizontal scrollbar, which would put the computed
// bottom past the real one and nudge the two frames back and forth at the bottom edge.
function maxScroll(win) {
  const root = win.document.scrollingElement ?? win.document.documentElement;
  return Math.max(0, root.scrollHeight - win.document.documentElement.clientHeight);
}

// A panel that scrolls: overflow auto or scroll, with more content than room.
function scrolls(element) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return /^(auto|scroll|overlay)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
}
const panelsOf = doc => [...(doc.querySelectorAll?.('*') ?? [])].filter(scrolls);

// Where an element sits under <body>: each step's tag and its place among its parent's children.
function pathOf(element) {
  const path = [];
  for (let node = element; node.parentElement && node.tagName !== 'BODY'; node = node.parentElement) {
    path.unshift([node.tagName, [...node.parentElement.children].indexOf(node)]);
  }
  return path;
}

// The panel in `doc` that is `panel` in the other version: the one at the same place under <body>, or, when the page
// around it changed between versions, the panel at the same place among the page's scrolling panels. null if none.
export function counterpart(panel, doc) {
  let node = doc.body;
  for (const [tag, index] of pathOf(panel)) {
    node = node?.children[index];
    if (node?.tagName !== tag) { node = null; break; }
  }
  if (node && scrolls(node)) return node;
  const index = panelsOf(panel.ownerDocument).indexOf(panel);
  return index === -1 ? null : panelsOf(doc)[index] ?? null;
}

const maxPanel = panel => Math.max(0, panel.scrollHeight - panel.clientHeight);

// Puts every panel of `toDoc` where its counterpart in `fromDoc` is, by ratio. Returns a function that puts them back:
// peeking at the previous version in place lines its panels up only while it shows.
export function levelPanels(fromDoc, toDoc) {
  const moved = [];
  for (const panel of panelsOf(fromDoc)) {
    const other = counterpart(panel, toDoc);
    if (!other) continue;
    moved.push([other, other.scrollTop]);
    other.scrollTop = syncedTop(panel.scrollTop, maxPanel(panel), maxPanel(other));
  }
  return () => { for (const [other, top] of moved) other.scrollTop = top; };
}

// Puts `win` where `from` is: the page by ratio, and each panel where its counterpart is. For a version swapped in
// place, so it opens where the one before it was.
export function matchScroll(win, from) {
  const maxOf = w => Math.max(0, (w.document.scrollingElement ?? w.document.documentElement).scrollHeight - w.document.documentElement.clientHeight);
  win.scrollTo({ top: syncedTop(from.scrollY, maxOf(from), maxOf(win)), behavior: 'instant' });
  levelPanels(from.document, win.document);
}

// Where the page's scrolling panels are, in page order: what the live page and the viewer hand each other, so an app
// shell opens and closes on the rows it showed. The live page (runtime/overlay.js) keeps its own copy of these two.
export const panelTops = doc => panelsOf(doc).map(panel => Math.round(panel.scrollTop));
export function setPanelTops(doc, tops) {
  if (!Array.isArray(tops)) return;
  panelsOf(doc).forEach((panel, index) => { if (Number.isFinite(tops[index])) panel.scrollTop = tops[index]; });
}

// Scrolling either frame moves the other. Moving a frame makes it fire its own scroll event; that echo is
// recognised by the position we sent it to and ignored, so the two never chase each other. A real scroll that
// lands somewhere else still goes through. Frames are re-linked on every load, since a load replaces the window.
// On link, and whenever one of them loads, `frameB` (or the frame that just loaded) is put level with the other.
export function linkScroll(frameA, frameB, { enabled = true } = {}) {
  if (!enabled || !frameA || !frameB) return () => {};
  const expected = new WeakMap(); // window or panel -> the top we last moved it to
  let listening = [];

  // A frame that went cross-origin has no window we may read; it just stops following.
  const windowOf = frame => {
    const win = frameWindow(frame);
    return win?.document.documentElement ? win : null;
  };

  const follow = (from, to) => {
    const fromWin = windowOf(from), toWin = windowOf(to);
    if (!fromWin || !toWin) return;
    const top = syncedTop(fromWin.scrollY, maxScroll(fromWin), maxScroll(toWin));
    if (Math.abs(toWin.scrollY - top) < ECHO_PX) return; // already there: no scroll, so no echo to wait for
    expected.set(toWin, top);
    toWin.scrollTo({ top, behavior: 'instant' });
  };

  const followPanel = (panel, toDoc) => {
    const other = counterpart(panel, toDoc);
    if (!other) return;
    const top = syncedTop(panel.scrollTop, maxPanel(panel), maxPanel(other));
    if (Math.abs(other.scrollTop - top) < ECHO_PX) return;
    expected.set(other, top);
    other.scrollTop = top;
  };
  const followPanels = (from, to) => {
    const fromWin = windowOf(from), toWin = windowOf(to);
    if (!fromWin || !toWin) return;
    for (const panel of panelsOf(fromWin.document)) followPanel(panel, toWin.document);
  };
  // A panel's scroll doesn't bubble; the document hears it while capturing. The page's own scroll is the window's.
  const onPanelScroll = (from, to) => event => {
    const panel = event.target, doc = windowOf(from)?.document;
    if (!doc || !panel || panel === doc) return;
    const echo = expected.get(panel);
    if (echo !== undefined) {
      expected.delete(panel);
      if (Math.abs(panel.scrollTop - echo) < ECHO_PX) return;
    }
    const toWin = windowOf(to);
    if (toWin) followPanel(panel, toWin.document);
  };

  const onScroll = (from, to) => () => {
    const win = windowOf(from);
    if (!win) return;
    const echo = expected.get(win);
    if (echo !== undefined) {
      expected.delete(win);
      if (Math.abs(win.scrollY - echo) < ECHO_PX) return;
    }
    follow(from, to);
  };

  const attach = () => {
    stopListening();
    for (const [from, to] of [[frameA, frameB], [frameB, frameA]]) {
      const win = windowOf(from);
      if (!win) continue;
      const handler = onScroll(from, to);
      win.addEventListener('scroll', handler, { passive: true });
      const panelHandler = onPanelScroll(from, to);
      win.document.addEventListener?.('scroll', panelHandler, { capture: true, passive: true });
      listening.push(() => {
        win.removeEventListener('scroll', handler);
        win.document.removeEventListener?.('scroll', panelHandler, { capture: true });
      });
    }
  };
  function stopListening() {
    for (const stop of listening) quietly(stop);
    listening = [];
  }

  const onLoad = loaded => () => {
    attach();
    follow(loaded === frameA ? frameB : frameA, loaded);
    followPanels(loaded === frameA ? frameB : frameA, loaded);
  };
  const loadA = onLoad(frameA), loadB = onLoad(frameB);
  frameA.addEventListener('load', loadA);
  frameB.addEventListener('load', loadB);

  attach();
  follow(frameA, frameB);
  followPanels(frameA, frameB);

  return () => {
    stopListening();
    frameA.removeEventListener('load', loadA);
    frameB.removeEventListener('load', loadB);
  };
}

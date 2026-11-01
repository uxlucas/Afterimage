// Keeps two same-origin frames at the same relative scroll position. Plain DOM, outside React.
import { syncedTop } from '../state/versions.js';
import { frameWindow, quietly } from '../frames.js';

const ECHO_PX = 1;

// clientHeight, not innerHeight: innerHeight includes a horizontal scrollbar, which would put the computed
// bottom past the real one and nudge the two frames back and forth at the bottom edge.
function maxScroll(win) {
  const root = win.document.scrollingElement ?? win.document.documentElement;
  return Math.max(0, root.scrollHeight - win.document.documentElement.clientHeight);
}

// Scrolling either frame moves the other. Moving a frame makes it fire its own scroll event; that echo is
// recognised by the position we sent it to and ignored, so the two never chase each other. A real scroll that
// lands somewhere else still goes through. Frames are re-linked on every load, since a load replaces the window.
// On link, and whenever one of them loads, `frameB` (or the frame that just loaded) is put level with the other.
export function linkScroll(frameA, frameB, { enabled = true } = {}) {
  if (!enabled || !frameA || !frameB) return () => {};
  const expected = new WeakMap(); // window -> the top we last moved it to
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
    for (const [win, handler] of listening) quietly(() => win.removeEventListener('scroll', handler));
    listening = [];
    for (const [from, to] of [[frameA, frameB], [frameB, frameA]]) {
      const win = windowOf(from);
      if (!win) continue;
      const handler = onScroll(from, to);
      win.addEventListener('scroll', handler, { passive: true });
      listening.push([win, handler]);
    }
  };

  const onLoad = loaded => () => {
    attach();
    follow(loaded === frameA ? frameB : frameA, loaded);
  };
  const loadA = onLoad(frameA), loadB = onLoad(frameB);
  frameA.addEventListener('load', loadA);
  frameB.addEventListener('load', loadB);

  attach();
  follow(frameA, frameB);

  return () => {
    for (const [win, handler] of listening) quietly(() => win.removeEventListener('scroll', handler));
    listening = [];
    frameA.removeEventListener('load', loadA);
    frameB.removeEventListener('load', loadB);
  };
}

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { frameWindow, quietly, showsVersion } from '../frames.js';
import { route } from '../state/route.js';
import { showsLivePage } from '../state/model.js';
import { panelTops, setPanelTops } from '../stage/scrollSync.js';

const READY_TIMEOUT_MS = 10000;
const POLL_MS = 40;
const SHOWN_TIMEOUT_MS = 400; // a page that never says it swapped (an older pill) still gets the view it asked for
const SETTLE_MS = 280; // outlines, the divider and the pill finish leaving before the page takes over

// The viewer framed by the pill on a live prototype (runtime/overlay.js). The page loads it hidden as soon as the
// pill is pointed at, and asks for one state when a button is pressed:
//   viewer → page  { type: 'afterimage:listening' }       sent once the viewer can take a request (a click can come first)
//   page → viewer  { type: 'afterimage:open', view: 'highlight' | 'compare' | 'versions', route, scrollY, panels }
//   viewer → page  { type: 'afterimage:ready' }           the latest version shows that route at that scroll, as the
//                                                          page shows it: reveal
//   page → viewer  { type: 'afterimage:shown' }           the swap is on screen: the viewer moves into the view asked
//                                                          for, where its transitions can be seen
//   viewer → page  { type: 'afterimage:close', route, scrollY, panels }   back on the live page, settled: hide
// panels: the scroll of each panel that scrolls (an app shell's content), in page order.
// Nothing in them is private, so they go to any parent, and a request from any parent only changes the view.
export const framed = typeof window !== 'undefined' && window.parent !== window;

// Hands the page back, on the route and scroll the prototype shows now.
export function leaveForPage(targetRef) {
  const win = frameWindow(targetRef.current);
  let panels = [];
  if (win) quietly(() => { panels = panelTops(win.document); });
  window.parent.postMessage({ type: 'afterimage:close', route: route.get(), scrollY: win?.scrollY ?? 0, panels }, '*');
}

export function usePageHost({ state, dispatch, versions, targetRef }) {
  const reduced = useReducedMotion();
  const asked = useRef(false); // the page opened the viewer, and it hasn't handed the page back since
  const away = useRef(false); // and the viewer has shown something the live page can't since then

  useEffect(() => {
    if (!framed) return undefined;
    let poll = 0, fallback = 0;
    let pending = null; // the view the page asked for, until the swap is on screen
    const applyView = () => {
      clearTimeout(fallback);
      if (pending === null) return;
      dispatch({ type: 'openFromPage', view: pending });
      pending = null;
    };
    const onMessage = event => {
      const data = event.data;
      if (event.source !== window.parent) return;
      if (data?.type === 'afterimage:shown') { applyView(); return; }
      if (data?.type !== 'afterimage:open') return;
      clearTimeout(poll);
      clearTimeout(fallback);
      if (typeof data.route === 'string') route.set(data.route);
      asked.current = true;
      away.current = false;
      // First the viewer shows just what the page shows, so the swap can't be seen.
      pending = data.view;
      dispatch({ type: 'openFromPage', view: 'page' });
      const scrollY = Number(data.scrollY) || 0;
      const giveUp = Date.now() + READY_TIMEOUT_MS;
      // Ready once the prototype frame shows the latest version on the page's route. Its scroll then matches the
      // page's, and one more beat lets that paint before the page swaps itself for the viewer.
      const check = () => {
        const win = frameWindow(targetRef.current);
        if (showsVersion(targetRef.current, versions[0]) && win.location.hash === route.get()) {
          win.scrollTo(0, scrollY);
          quietly(() => setPanelTops(win.document, data.panels));
          poll = setTimeout(() => {
            window.parent.postMessage({ type: 'afterimage:ready' }, '*');
            fallback = setTimeout(applyView, SHOWN_TIMEOUT_MS);
          }, POLL_MS);
        } else if (Date.now() < giveUp) {
          poll = setTimeout(check, POLL_MS);
        }
      };
      poll = setTimeout(check, 0);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'afterimage:listening' }, '*');
    return () => { clearTimeout(poll); clearTimeout(fallback); window.removeEventListener('message', onMessage); };
  }, [dispatch, versions, targetRef]);

  // Turning everything off (Highlight off, Compare left, the list closed, back on the latest) is being back on the
  // live page, so the page takes over again. No close button needed. What was on leaves on screen first, so the page
  // takes over from a view that already looks like it.
  useEffect(() => {
    if (!framed || !asked.current) return undefined;
    if (!showsLivePage(state, versions)) { away.current = true; return undefined; }
    if (!away.current) return undefined;
    const timer = setTimeout(() => {
      asked.current = false;
      away.current = false;
      leaveForPage(targetRef);
    }, reduced ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [state, versions, targetRef, reduced]);
}

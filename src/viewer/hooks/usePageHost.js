import { useEffect, useRef } from 'react';
import { frameWindow, showsVersion } from '../frames.js';
import { route } from '../state/route.js';
import { showsLivePage } from '../state/model.js';

const READY_TIMEOUT_MS = 10000;
const POLL_MS = 40;

// The viewer framed by the pill on a live prototype (runtime/overlay.js). The page loads it hidden as soon as the
// pill is pointed at, and asks for one state when a button is pressed:
//   viewer → page  { type: 'afterimage:listening' }       sent once the viewer can take a request (a click can come first)
//   page → viewer  { type: 'afterimage:open', view: 'highlight' | 'compare' | 'versions', route, scrollY }
//   viewer → page  { type: 'afterimage:ready' }           the latest version shows that route at that scroll: reveal
//   viewer → page  { type: 'afterimage:close', route, scrollY }   the visitor is back on the live page: hide
// Nothing in them is private, so they go to any parent, and a request from any parent only changes the view.
export const framed = typeof window !== 'undefined' && window.parent !== window;

// Hands the page back, on the route and scroll the prototype shows now.
export function leaveForPage(targetRef) {
  const win = frameWindow(targetRef.current);
  window.parent.postMessage({ type: 'afterimage:close', route: route.get(), scrollY: win?.scrollY ?? 0 }, '*');
}

export function usePageHost({ state, dispatch, versions, targetRef }) {
  const asked = useRef(false); // the page opened the viewer, and it hasn't handed the page back since
  const away = useRef(false); // and the viewer has shown something the live page can't since then

  useEffect(() => {
    if (!framed) return undefined;
    let poll = 0;
    const onMessage = event => {
      const data = event.data;
      if (event.source !== window.parent || data?.type !== 'afterimage:open') return;
      clearTimeout(poll);
      if (typeof data.route === 'string') route.set(data.route);
      asked.current = true;
      away.current = false;
      dispatch({ type: 'openFromPage', view: data.view });
      const scrollY = Number(data.scrollY) || 0;
      const giveUp = Date.now() + READY_TIMEOUT_MS;
      // Ready once the prototype frame shows the latest version on the page's route. Its scroll then matches the
      // page's, and one more beat lets that paint before the page swaps itself for the viewer.
      const check = () => {
        const win = frameWindow(targetRef.current);
        if (showsVersion(targetRef.current, versions[0]) && win.location.hash === route.get()) {
          win.scrollTo(0, scrollY);
          poll = setTimeout(() => window.parent.postMessage({ type: 'afterimage:ready' }, '*'), POLL_MS);
        } else if (Date.now() < giveUp) {
          poll = setTimeout(check, POLL_MS);
        }
      };
      poll = setTimeout(check, 0);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'afterimage:listening' }, '*');
    return () => { clearTimeout(poll); window.removeEventListener('message', onMessage); };
  }, [dispatch, versions, targetRef]);

  // Turning everything off (Highlight off, Compare left, the list closed, back on the latest) is being back on the
  // live page, so the page takes over again. No close button needed.
  useEffect(() => {
    if (!framed || !asked.current) return;
    if (!showsLivePage(state, versions)) { away.current = true; return; }
    if (!away.current) return;
    asked.current = false;
    away.current = false;
    leaveForPage(targetRef);
  }, [state, versions, targetRef]);
}

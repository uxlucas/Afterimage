import { useEffect, useSyncExternalStore } from 'react';
import { frameWindow, quietly, withRoute } from '../frames.js';
import { route } from '../state/route.js';

// The route as React state, for what has to render again when it changes (the counts in the version list).
export function useRoute() {
  return useSyncExternalStore(route.subscribe, route.get);
}

// Keeps both versions on one route. A hash-routed app changes page by its hash, which leaves the document in place,
// so without this the older version would sit on its first page while the newer one shows another, and every element
// of the two pages would count as a change. A route followed in either frame becomes the route, the other frame
// follows, and the viewer's own address keeps it. Moving a hash fires the app's own hashchange; replace adds no history.
export function useRouteSync({ targetRef, baseRef }) {
  // Read during render so a base frame that mounts later (the first Compare) re-runs the effect.
  const targetEl = targetRef.current, baseEl = baseRef.current;

  useEffect(() => {
    const frames = [targetRef, baseRef].map(ref => ref.current).filter(Boolean);
    let teardown = [];

    const moveTo = next => {
      for (const frame of frames) {
        const win = frameWindow(frame);
        // A frame still on its blank first document is loading its version, with the route in its address already.
        if (!win || win.location.protocol === 'about:' || win.location.hash === next) continue;
        quietly(() => win.location.replace(withRoute(win.location.href, next)));
      }
      quietly(() => history.replaceState(history.state, '', withRoute(location.href, next)));
    };

    function attach() {
      teardown.forEach(stop => stop());
      teardown = [];
      for (const frame of frames) {
        const win = frameWindow(frame);
        if (!win) continue;
        const follow = () => route.set(win.location.hash);
        win.addEventListener('hashchange', follow);
        teardown.push(() => quietly(() => win.removeEventListener('hashchange', follow)));
      }
    }
    // A frame that loads a version starts on the route already (Frame puts it in the address); one that was moved by
    // something else, such as a link to another document, is brought back to it when it comes back.
    const onLoad = () => {
      attach();
      moveTo(route.get());
    };

    for (const frame of frames) frame.addEventListener('load', onLoad);
    const unsubscribe = route.subscribe(moveTo);
    attach();
    moveTo(route.get());
    return () => {
      unsubscribe();
      teardown.forEach(stop => stop());
      for (const frame of frames) frame.removeEventListener('load', onLoad);
    };
  }, [targetRef, baseRef, targetEl, baseEl]);
}

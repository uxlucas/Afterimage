// The route both versions show inside the prototype: the hash of a hash-routed app ('#/orders'), or '' for the page a
// version opens on. It lives in the viewer's own address after its query (/afterimage/?version=v2#/orders), so a link
// or the pill on the prototype opens the same page, and every frame the viewer loads starts there.
// A store, not React state: frames read it when they load a version, and the review keys its counts by it.

export function createRoute(initial = '') {
  let current = initial;
  const listeners = new Set();
  return {
    get: () => current,
    set(next) {
      if (next === current) return;
      current = next;
      for (const listener of listeners) listener(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const route = createRoute(typeof location === 'undefined' ? '' : location.hash);

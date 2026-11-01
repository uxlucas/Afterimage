// Writes the view into the address bar. Pure: history, location and the timer functions are passed in.
// Safari and Firefox throw a SecurityError past their replaceState rate limits (holding J or ], scrubbing),
// and an uncaught throw in a React effect takes the whole app down. So:
// - writes coalesce into one trailing write every `delayMs`, carrying the latest search;
// - a write that matches the address bar is skipped;
// - the write itself is wrapped, and the hash is kept.
// `flush()` writes the pending search at once, for pagehide and for Copy link.
export function createUrlWriter({
  history,
  location,
  delayMs = 200,
  setTimeout: set = globalThis.setTimeout,
  clearTimeout: clear = globalThis.clearTimeout,
}) {
  let pending = null;
  let handle = null;

  function stop() {
    if (handle !== null) clear(handle);
    handle = null;
  }

  function flush() {
    stop();
    if (pending === null) return;
    const search = pending;
    pending = null;
    if (search === location.search) return;
    try {
      history.replaceState(history.state, '', (search || location.pathname) + location.hash);
    } catch {
      // Rate-limited or blocked. The next write carries the latest state anyway.
    }
  }

  return {
    // `search` is '' for the default view, otherwise a string starting with '?'.
    write(search) {
      pending = search;
      if (handle === null) handle = set(flush, delayMs);
    },
    flush,
    cancel() {
      stop();
      pending = null;
    },
  };
}

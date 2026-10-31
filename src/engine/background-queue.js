// Works out change counts for versions the visitor isn't looking at, one comparison at a time.
// Pure scheduling: no React, no DOM. `run` does the expensive part and resolves with a summary.
//
// A pair is anything with a `key` (reviewKey of the two versions and the viewport size).
// `want(pairs)` replaces the wish list: the newest wish wins, and whatever isn't wished for any more
// is dropped before it starts. A pair already in the cache, in flight, finished or failed never runs.
import { readCount, writeCount } from './review-cache.js';

export function createQueue({ run, onResult = () => {}, read = pair => readCount(pair.key), write = writeCount }) {
  let wanted = [];
  let inFlight = null;
  let cancelled = false;
  const settled = new Set(); // finished or failed in this queue's life, so a re-wish doesn't rerun it

  function skip(pair) {
    return settled.has(pair.key) || pair.key === inFlight || read(pair) !== null;
  }

  function finish(pair, summary) {
    settled.add(pair.key);
    inFlight = null;
    if (summary) {
      write(pair.key, summary);
      if (!cancelled) onResult(pair, summary);
    }
    pump();
  }

  function pump() {
    if (cancelled || inFlight !== null) return;
    while (wanted.length) {
      const pair = wanted.shift();
      if (skip(pair)) continue;
      inFlight = pair.key;
      let pending;
      try {
        pending = Promise.resolve(run(pair));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(summary => finish(pair, summary), () => finish(pair, null));
      return;
    }
  }

  return {
    want(pairs) {
      if (cancelled) return;
      const seen = new Set();
      wanted = pairs.filter(pair => {
        if (seen.has(pair.key)) return false;
        seen.add(pair.key);
        return true;
      });
      pump();
    },
    cancel() {
      cancelled = true;
      wanted = [];
    },
  };
}

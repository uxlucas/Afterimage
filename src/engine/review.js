// Pure helpers around the review engine. No React, no DOM: node:test covers all of it.

// route is the hash route both versions show (#/orders in a hash-routed app); the entry page keeps the bare key.
export function reviewKey({ target, base, width, height, route = '' }) {
  return [target.sha256, base.sha256, width, height, ...(route ? [route] : [])].join('|');
}

export function summarize(entries) {
  const count = kind => entries.filter(entry => entry.kind === kind).length;
  return { total: entries.length, changed: count('changed'), added: count('added'), removed: count('removed') };
}

export function filterEntries(entries, filter) {
  return filter === 'all' ? entries : entries.filter(entry => entry.kind === filter);
}

// A result is only good if it was computed for the inputs that are current now.
export function acceptResult(currentKey, resultKey) {
  return currentKey === resultKey;
}

// Moves a review that never produces a result to `failed`. Timer functions are injectable for tests.
export function createReviewTimer({ timeoutMs = 8000, onTimeout }, { setTimeout: set = globalThis.setTimeout, clearTimeout: clear = globalThis.clearTimeout } = {}) {
  let handle = null;
  const stop = () => {
    if (handle !== null) clear(handle);
    handle = null;
  };
  return {
    start() {
      stop();
      handle = set(() => { handle = null; onTimeout(); }, timeoutMs);
    },
    done: stop,
    cancel: stop,
  };
}

// Cheap identity for a result, so a re-capture that found the same thing can keep the old reference.
export function reviewSignature({ entries, comparison }) {
  const rects = changes => changes.map(({ key, kind, rect }) => [key, kind, rect.x, rect.y, rect.width, rect.height]);
  return JSON.stringify([
    entries.map(({ key, kind, label, kindLabel, details }) => [key, kind, label, kindLabel, details]),
    rects(comparison.current),
    rects(comparison.previous),
  ]);
}

// Runs `fn` once things go quiet for `waitMs`, but never later than `maxWaitMs` after the first call it is
// holding back. A prototype that mutates continuously (a JS animation) would otherwise starve a plain trailing
// debounce, and the review would time out as "Couldn't check". Timer functions are injectable for tests.
export function createDebounce(fn, { waitMs = 80, maxWaitMs = 500 } = {}, { setTimeout: set = globalThis.setTimeout, clearTimeout: clear = globalThis.clearTimeout } = {}) {
  let trailing = null;
  let deadline = null;
  const cancel = () => {
    if (trailing !== null) clear(trailing);
    if (deadline !== null) clear(deadline);
    trailing = null;
    deadline = null;
  };
  const fire = () => {
    cancel();
    fn();
  };
  return {
    schedule() {
      if (trailing !== null) clear(trailing);
      trailing = set(fire, waitMs);
      if (deadline === null) deadline = set(fire, maxWaitMs);
    },
    cancel,
  };
}

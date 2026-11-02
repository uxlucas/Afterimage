// Remembers the change count per comparison so the version list can show it before a review runs.
// localStorage can be missing or throw (private windows, blocked storage), so every access is guarded.

const PREFIX = 'afterimage-count:';
const LIMIT = 500;
// Which counting rules made a count. Raised when they change, so the list never shows a count the review would not.
// 2: moves caused by a real edit stop counting.
const RULES = 2;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readCount(key) {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (!raw) return null;
    const { summary, rules } = JSON.parse(raw);
    return rules === RULES && summary && typeof summary.total === 'number' ? summary : null;
  } catch {
    return null;
  }
}

const sameSummary = (a, b) => Boolean(a && b) && ['total', 'changed', 'added', 'removed'].every(name => a[name] === b[name]);

export function writeCount(key, summary) {
  try {
    const store = storage();
    if (!store) return;
    // A re-run that found the same counts (most of them) leaves storage alone.
    if (sameSummary(readCount(key), summary)) return;
    store.setItem(PREFIX + key, JSON.stringify({ summary, at: Date.now(), rules: RULES }));
    const entries = [];
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (!name?.startsWith(PREFIX)) continue;
      let at = 0;
      try { at = JSON.parse(store.getItem(name)).at ?? 0; } catch { /* unreadable entries go first */ }
      entries.push({ name, at, order: i });
    }
    if (entries.length <= LIMIT) return;
    // Oldest first out. Ties (same millisecond) fall back to storage order.
    entries.sort((a, b) => a.at - b.at || a.order - b.order);
    for (const { name } of entries.slice(0, entries.length - LIMIT)) store.removeItem(name);
  } catch {
    // Storage is a convenience; never let it break a review.
  }
}

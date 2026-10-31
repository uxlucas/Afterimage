// Version math. Pure: no React, no DOM, no clock. Versions are newest first.

export function versionNumber(version) {
  return Number(version.id.slice(1));
}

export function indexOfVersion(versions, id) {
  return versions.findIndex(version => version.id === id);
}

// The next older entry in the history, or null for the first version.
export function previousVersion(versions, id) {
  const index = indexOfVersion(versions, id);
  return index === -1 ? null : versions[index + 1] ?? null;
}

// Every version older than `id`, newest first. Empty for the first version or an unknown id.
export function olderThan(versions, id) {
  const index = indexOfVersion(versions, id);
  return index === -1 ? [] : versions.slice(index + 1);
}

// The target a Compare scrub may land on: anything newer than the base. At or below the base it stops on the
// version just after the base, so scrubbing the target never moves the base. No base: any id.
export function clampTarget(versions, id, baseId) {
  if (!baseId) return id;
  const base = indexOfVersion(versions, baseId);
  return indexOfVersion(versions, id) < base ? id : versions[base - 1]?.id ?? id;
}

// The base a Compare drag may land on: anything older than the target, else the version just before the
// target. Null when the target is the first version.
export function clampBase(versions, id, targetId) {
  return olderThan(versions, targetId).some(version => version.id === id) ? id : previousVersion(versions, targetId)?.id ?? null;
}

// The index of the position nearest `x`. A `prefer`red index wins whenever it is no more than `bias` further
// away than the nearest, so a small target next to a bigger one is still easy to pick. -1 for no positions.
export function nearestTick(positions, x, prefer = -1, bias = 0) {
  let best = -1;
  for (let index = 0; index < positions.length; index++) {
    if (best === -1 || Math.abs(x - positions[index]) < Math.abs(x - positions[best])) best = index;
  }
  if (prefer >= 0 && prefer < positions.length && Math.abs(x - positions[prefer]) <= Math.abs(x - positions[best]) + bias) return prefer;
  return best;
}

// Where to scroll a page that can scroll `toMax` so it sits at the same relative place as a page at
// `fromTop` of `fromMax`. Pages of different heights line up by ratio, not by pixels.
export function syncedTop(fromTop, fromMax, toMax) {
  if (!(fromMax > 0) || !(toMax > 0)) return 0;
  return Math.min(toMax, Math.max(0, (fromTop / fromMax) * toMax));
}

export function tickWindow(versions, selectedId, baseId, max = 12) {
  const oldestFirst = [...versions].reverse();
  const total = oldestFirst.length;
  const found = oldestFirst.findIndex(version => version.id === selectedId);
  const selectedIndex = found === -1 ? total - 1 : found;
  const size = Math.min(max, total);
  const centred = size => Math.max(0, Math.min(selectedIndex - Math.floor(size / 2), total - size));
  const baseIndex = baseId ? oldestFirst.findIndex(version => version.id === baseId) : -1;
  const low = baseIndex === -1 ? -1 : Math.min(baseIndex, selectedIndex);
  const high = baseIndex === -1 ? -1 : Math.max(baseIndex, selectedIndex);

  // A base older than the window is pinned as the first tick, with a gap after it standing for the versions
  // skipped; the rest of the window stays around the selected version. The base is never faded out.
  let start = centred(size);
  let indices = Array.from({ length: size }, (_, offset) => start + offset);
  let gapAfter = -1;
  if (baseIndex !== -1 && baseIndex < start && size > 1) {
    start = centred(size - 1);
    indices = [baseIndex, ...Array.from({ length: size - 1 }, (_, offset) => start + offset)];
    gapAfter = 0;
  }

  const ticks = indices.map(index => {
    const version = oldestFirst[index];
    let role = 'plain';
    if (index === selectedIndex) role = 'selected';
    else if (index === baseIndex) role = 'base';
    else if (baseIndex !== -1 && index > low && index < high) role = 'range';
    return { id: version.id, number: versionNumber(version), role };
  });

  const end = indices[indices.length - 1] + 1;
  return { ticks, fadeStart: gapAfter === -1 && start > 0, fadeEnd: end < total, gapAfter };
}

// The tick nearest to a pointer at `x` along a strip where the first tick sits at 0 and the last
// at `width`, evenly spaced. Points outside the strip clamp to its ends.
export function tickAt(windowTicks, x, width) {
  const count = windowTicks.length;
  if (count === 0) return null;
  if (count === 1 || !(width > 0)) return windowTicks[0].id;
  const index = Math.round((x / width) * (count - 1));
  return windowTicks[Math.min(count - 1, Math.max(0, index))].id;
}

export function parseVersionInput(text, versions) {
  const numbers = versions.map(versionNumber);
  const lowest = Math.min(...numbers);
  const highest = Math.max(...numbers);
  const pick = { ok: false, hint: lowest === highest ? `Pick ${lowest}` : `Pick ${lowest} to ${highest}` };
  const trimmed = String(text ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return pick;
  const number = Number(trimmed);
  if (number < lowest || number > highest) return pick;
  const id = `v${number}`;
  if (!versions.some(version => version.id === id)) return { ok: false, hint: `No version ${number}` };
  return { ok: true, id };
}

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function dayKey(date) {
  return date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate();
}

function dayLabel(date, now) {
  const today = dayKey(now);
  if (dayKey(date) === today) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  return (date.getFullYear() === now.getFullYear() ? monthDay : monthDayYear).format(date);
}

// Groups keep the order they arrive in; versions with no usable date go last.
export function groupByDay(versions, now) {
  const groups = [];
  const unknown = [];
  const byKey = new Map();
  for (const version of versions) {
    const date = version.savedAt ? new Date(version.savedAt) : null;
    if (!date || Number.isNaN(date.getTime())) {
      unknown.push(version);
      continue;
    }
    const key = dayKey(date);
    let group = byKey.get(key);
    if (!group) {
      group = { label: dayLabel(date, now), versions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.versions.push(version);
  }
  if (unknown.length) groups.push({ label: 'Date unknown', versions: unknown });
  return groups;
}

const savedFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// "Oct 30, 14:12": en-US month names, 24-hour time, the viewer's own timezone.
export function formatSaved(savedAt) {
  if (!savedAt) return null;
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(savedFormat.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`;
}

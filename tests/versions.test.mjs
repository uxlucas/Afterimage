import test from 'node:test';
import assert from 'node:assert/strict';
import {
  versionNumber, tickWindow, tickAt, parseVersionInput, groupByDay, formatSaved, previousVersion, syncedTop, olderThan, clampTarget, clampBase, nearestTick,
} from '../src/viewer/state/versions.js';

// Newest first, like the manifest.
function makeVersions(count, { skip = [] } = {}) {
  const list = [];
  for (let n = count; n >= 1; n--) {
    if (skip.includes(n)) continue;
    list.push({ id: `v${n}`, name: `Version ${n}`, label: `Version ${n}`, file: `versions/v${n}/index.html`, notes: [], savedAt: null, sha256: 'a'.repeat(64) });
  }
  return list;
}

const numbers = ticks => ticks.map(tick => tick.number);

test('versionNumber reads the number from the id', () => {
  assert.equal(versionNumber({ id: 'v12' }), 12);
});

test('previousVersion is the next older entry', () => {
  const versions = makeVersions(3);
  assert.equal(previousVersion(versions, 'v3').id, 'v2');
  assert.equal(previousVersion(versions, 'v1'), null);
  assert.equal(previousVersion(versions, 'v9'), null);
});

test('tickWindow with few versions shows all of them and no fades', () => {
  const window = tickWindow(makeVersions(4), 'v4', null);
  assert.deepEqual(numbers(window.ticks), [1, 2, 3, 4]);
  assert.equal(window.fadeStart, false);
  assert.equal(window.fadeEnd, false);
  assert.equal(window.ticks[3].role, 'selected');
  assert.equal(window.ticks[0].role, 'plain');
});

test('tickWindow at the newest of many fades only the old edge', () => {
  const window = tickWindow(makeVersions(60), 'v60', null);
  assert.deepEqual(numbers(window.ticks), Array.from({ length: 12 }, (_, i) => 49 + i));
  assert.equal(window.fadeStart, true);
  assert.equal(window.fadeEnd, false);
});

test('tickWindow in the middle is centred and fades both edges', () => {
  const window = tickWindow(makeVersions(60), 'v12', null);
  assert.deepEqual(numbers(window.ticks), Array.from({ length: 12 }, (_, i) => 6 + i));
  assert.equal(window.fadeStart, true);
  assert.equal(window.fadeEnd, true);
});

test('tickWindow at the oldest fades only the new edge', () => {
  const window = tickWindow(makeVersions(60), 'v1', null);
  assert.deepEqual(numbers(window.ticks), Array.from({ length: 12 }, (_, i) => 1 + i));
  assert.equal(window.fadeStart, false);
  assert.equal(window.fadeEnd, true);
});

test('tickWindow marks the base and the range between base and selected', () => {
  const window = tickWindow(makeVersions(60), 'v60', 'v56');
  const roles = Object.fromEntries(window.ticks.map(tick => [tick.number, tick.role]));
  assert.equal(roles[56], 'base');
  assert.equal(roles[57], 'range');
  assert.equal(roles[58], 'range');
  assert.equal(roles[59], 'range');
  assert.equal(roles[60], 'selected');
  assert.equal(roles[55], 'plain');
});

test('tickWindow marks the range when the base is newer than the selected version', () => {
  const window = tickWindow(makeVersions(10), 'v3', 'v6');
  const roles = Object.fromEntries(window.ticks.map(tick => [tick.number, tick.role]));
  assert.equal(roles[3], 'selected');
  assert.equal(roles[4], 'range');
  assert.equal(roles[5], 'range');
  assert.equal(roles[6], 'base');
});

test('tickAt maps the ends of the strip to the first and last tick', () => {
  const { ticks } = tickWindow(makeVersions(60), 'v30', null);
  assert.equal(tickAt(ticks, 0, 55), ticks[0].id);
  assert.equal(tickAt(ticks, 55, 55), ticks[11].id);
});

test('tickAt picks the nearest tick in between', () => {
  const { ticks } = tickWindow(makeVersions(60), 'v30', null);
  // 12 ticks over 55px: one every 5px.
  assert.equal(tickAt(ticks, 12, 55), ticks[2].id);
  assert.equal(tickAt(ticks, 13, 55), ticks[3].id);
  assert.equal(tickAt(ticks, 27.4, 55), ticks[5].id);
});

test('tickAt clamps outside the strip and handles a single tick', () => {
  const { ticks } = tickWindow(makeVersions(4), 'v4', null);
  assert.equal(tickAt(ticks, -40, 15), 'v1');
  assert.equal(tickAt(ticks, 400, 15), 'v4');
  const single = tickWindow(makeVersions(1), 'v1', null).ticks;
  assert.equal(tickAt(single, 0, 0), 'v1');
  assert.equal(tickAt(single, 10, 0), 'v1');
  assert.equal(tickAt([], 10, 10), null);
});

test('parseVersionInput accepts a number with spaces', () => {
  assert.deepEqual(parseVersionInput(' 12 ', makeVersions(60)), { ok: true, id: 'v12' });
});

test('parseVersionInput rejects numbers outside the history', () => {
  const versions = makeVersions(60);
  assert.deepEqual(parseVersionInput('75', versions), { ok: false, hint: 'Pick 1 to 60' });
  assert.deepEqual(parseVersionInput('0', versions), { ok: false, hint: 'Pick 1 to 60' });
});

test('parseVersionInput rejects text and empty input', () => {
  const versions = makeVersions(60);
  assert.deepEqual(parseVersionInput('abc', versions), { ok: false, hint: 'Pick 1 to 60' });
  assert.deepEqual(parseVersionInput('', versions), { ok: false, hint: 'Pick 1 to 60' });
});

test('parseVersionInput names a gap in the history', () => {
  assert.deepEqual(parseVersionInput('7', makeVersions(10, { skip: [7] })), { ok: false, hint: 'No version 7' });
});

test('groupByDay groups by local day, newest first, unknown last', () => {
  const now = new Date(2026, 9, 31, 15, 0);
  const at = (month, day, hour) => new Date(2026, month, day, hour).toISOString();
  const versions = makeVersions(5);
  versions[0].savedAt = at(9, 31, 9);
  versions[1].savedAt = at(9, 31, 8);
  versions[2].savedAt = at(9, 30, 20);
  versions[3].savedAt = at(9, 28, 12);
  versions[4].savedAt = null;
  const groups = groupByDay(versions, now);
  assert.deepEqual(groups.map(group => group.label), ['Today', 'Yesterday', 'Oct 28', 'Date unknown']);
  assert.deepEqual(groups[0].versions.map(v => v.id), ['v5', 'v4']);
  assert.deepEqual(groups[3].versions.map(v => v.id), ['v1']);
});

test('groupByDay adds the year for dates in other years', () => {
  const now = new Date(2026, 0, 5, 12, 0);
  const versions = makeVersions(1);
  versions[0].savedAt = new Date(2025, 11, 20, 12).toISOString();
  assert.equal(groupByDay(versions, now)[0].label, 'Dec 20, 2025');
});

test('formatSaved returns null without a date', () => {
  assert.equal(formatSaved(null), null);
  assert.equal(formatSaved('not a date'), null);
});

test('formatSaved uses en-US month names and 24-hour time in the viewer timezone', () => {
  const date = new Date(2026, 9, 30, 14, 12);
  assert.equal(formatSaved(date.toISOString()), 'Oct 30, 14:12');
});

test('syncedTop maps scroll by ratio between pages of different heights', () => {
  assert.equal(syncedTop(500, 1000, 2000), 1000);
  assert.equal(syncedTop(1000, 1000, 400), 400);
});

test('syncedTop is 0 when the source cannot scroll', () => {
  assert.equal(syncedTop(0, 0, 900), 0);
  assert.equal(syncedTop(30, 0, 900), 0);
});

test('syncedTop clamps to the target range', () => {
  assert.equal(syncedTop(1200, 1000, 800), 800);
  assert.equal(syncedTop(-40, 1000, 800), 0);
  assert.equal(syncedTop(500, 1000, 0), 0);
});

test('olderThan lists the versions before an id, newest first', () => {
  const versions = makeVersions(5);
  assert.deepEqual(olderThan(versions, 'v3').map(v => v.id), ['v2', 'v1']);
  assert.deepEqual(olderThan(versions, 'v1'), []);
  assert.deepEqual(olderThan(versions, 'v9'), []);
});

test('parseVersionInput over the older versions gives the range error for a newer number', () => {
  const versions = makeVersions(60);
  assert.deepEqual(parseVersionInput('60', olderThan(versions, 'v60')), { ok: false, hint: 'Pick 1 to 59' });
  assert.deepEqual(parseVersionInput('56', olderThan(versions, 'v60')), { ok: true, id: 'v56' });
});

test('parseVersionInput names the single version when only one fits', () => {
  const versions = makeVersions(2);
  assert.deepEqual(parseVersionInput('2', olderThan(versions, 'v2')), { ok: false, hint: 'Pick 1' });
});

// Ruling 16: scrubbing the target in Compare never moves the baseline.
test('clampTarget keeps the target newer than the base', () => {
  const versions = makeVersions(10);
  assert.equal(clampTarget(versions, 'v9', 'v5'), 'v9');
  assert.equal(clampTarget(versions, 'v5', 'v5'), 'v6');
  assert.equal(clampTarget(versions, 'v2', 'v5'), 'v6');
  assert.equal(clampTarget(versions, 'v2', null), 'v2');
});

test('clampBase keeps the base older than the target', () => {
  const versions = makeVersions(10);
  assert.equal(clampBase(versions, 'v3', 'v8'), 'v3');
  assert.equal(clampBase(versions, 'v8', 'v8'), 'v7');
  assert.equal(clampBase(versions, 'v10', 'v8'), 'v7');
  assert.equal(clampBase(versions, 'v2', 'v1'), null);
});

// Ruling 17: in Compare the base always shows.
test('tickWindow pins a base outside the window as the first tick, with a gap after it', () => {
  const window = tickWindow(makeVersions(60), 'v60', 'v40');
  assert.deepEqual(numbers(window.ticks), [40, ...Array.from({ length: 11 }, (_, i) => 50 + i)]);
  assert.equal(window.gapAfter, 0);
  assert.equal(window.ticks[0].role, 'base');
  assert.ok(window.ticks.slice(1, -1).every(tick => tick.role === 'range'));
  assert.equal(window.ticks[11].role, 'selected');
  assert.equal(window.fadeStart, false); // the base is never faded out
  assert.equal(window.fadeEnd, false);
});

test('tickWindow pins the base in the middle of a long history and still fades the new edge', () => {
  const window = tickWindow(makeVersions(60), 'v30', 'v5');
  assert.equal(window.ticks[0].number, 5);
  assert.equal(window.gapAfter, 0);
  assert.ok(window.ticks.some(tick => tick.number === 30 && tick.role === 'selected'));
  assert.equal(window.ticks.length, 12);
  assert.equal(window.fadeEnd, true);
});

test('tickWindow does not pin a base that is already in the window', () => {
  const window = tickWindow(makeVersions(60), 'v60', 'v56');
  assert.deepEqual(numbers(window.ticks), Array.from({ length: 12 }, (_, i) => 49 + i));
  assert.equal(window.gapAfter, -1);
  assert.equal(window.fadeStart, true);
});

test('tickWindow without a base has no gap', () => {
  assert.equal(tickWindow(makeVersions(60), 'v60', null).gapAfter, -1);
});

test('tickWindow pins a base just short of the window, the gap standing for the one skipped version', () => {
  const window = tickWindow(makeVersions(60), 'v60', 'v48');
  assert.deepEqual(numbers(window.ticks), [48, ...Array.from({ length: 11 }, (_, i) => 50 + i)]);
  assert.equal(window.gapAfter, 0);
});

test('nearestTick picks the closest position', () => {
  const positions = [0, 5, 10, 15];
  assert.equal(nearestTick(positions, -8), 0);
  assert.equal(nearestTick(positions, 6), 1);
  assert.equal(nearestTick(positions, 40), 3);
});

test('nearestTick lets a preferred tick win ties and near-ties', () => {
  const positions = [0, 5]; // base at 0, selected at 5: the adjacent v59 -> v60 case
  assert.equal(nearestTick(positions, 2.5, 0, 2), 0);
  assert.equal(nearestTick(positions, 3.5, 0, 2), 0);
  assert.equal(nearestTick(positions, 4.5, 0, 2), 1);
  assert.equal(nearestTick(positions, 5, 0, 2), 1);
  assert.equal(nearestTick([], 3), -1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUrl, toSearch } from '../src/viewer/state/url.js';

function makeVersions(count) {
  const list = [];
  for (let n = count; n >= 1; n--) {
    list.push({ id: `v${n}`, name: `Version ${n}`, label: `Version ${n}`, file: `versions/v${n}/index.html`, notes: [], savedAt: null, sha256: 'a'.repeat(64) });
  }
  return list;
}

const versions = makeVersions(2); // [v2, v1]
const defaults = { versionId: 'v2', mode: 'explore', baseId: null, layout: 'wipe', highlights: false, changeIndex: null };

test('empty search is the latest version in explore with no base', () => {
  assert.deepEqual(parseUrl('', versions), { versionId: 'v2', mode: 'explore', baseId: null });
});

// The baseline is always older, so a reversed pair is read the right way round.
test('a compare link with a newer baseline swaps the pair', () => {
  assert.deepEqual(parseUrl('?version=v1&mode=compare&base=v2', versions), { versionId: 'v2', mode: 'compare', baseId: 'v1' });
});

test('a reversed pair swaps on a longer history too', () => {
  const many = makeVersions(60);
  assert.deepEqual(parseUrl('?version=v40&mode=compare&base=v56', many), { versionId: 'v56', mode: 'compare', baseId: 'v40' });
  assert.deepEqual(parseUrl('?version=v60&mode=compare&base=v56', many), { versionId: 'v60', mode: 'compare', baseId: 'v56' });
});

test('an unknown version falls back to latest', () => {
  assert.equal(parseUrl('?version=v9', versions).versionId, 'v2');
});

test('a base equal to the version becomes the previous version', () => {
  assert.deepEqual(parseUrl('?mode=compare&base=v2&version=v2', versions), { versionId: 'v2', mode: 'compare', baseId: 'v1' });
});

test('compare on the first version falls back to explore', () => {
  assert.deepEqual(parseUrl('?version=v1&mode=compare', versions), { versionId: 'v1', mode: 'explore', baseId: null });
});

test('compare with no base uses the previous version', () => {
  assert.deepEqual(parseUrl('?mode=compare', versions), { versionId: 'v2', mode: 'compare', baseId: 'v1' });
});

test('an unknown base uses the previous version', () => {
  assert.equal(parseUrl('?mode=compare&base=v9', versions).baseId, 'v1');
});

test('base is ignored in explore', () => {
  assert.equal(parseUrl('?mode=explore&base=v1', versions).baseId, null);
});

test('layout, highlights and change are read when present', () => {
  assert.deepEqual(parseUrl('?mode=compare&layout=side&hl=1&change=3', versions), {
    versionId: 'v2', mode: 'compare', baseId: 'v1', layout: 'side', highlights: true, changeIndex: 2,
  });
});

test('junk values are ignored', () => {
  const parsed = parseUrl('?layout=weird&hl=0&change=0&mode=nope', versions);
  assert.deepEqual(parsed, { versionId: 'v2', mode: 'explore', baseId: null });
  assert.equal(parseUrl('?change=abc', versions).changeIndex, undefined);
});

test('toSearch returns an empty string for the default latest state', () => {
  assert.equal(toSearch(defaults, versions), '');
});

test('toSearch round-trips explore on an older version', () => {
  const state = { ...defaults, versionId: 'v1' };
  assert.equal(toSearch(state, versions), '?version=v1&mode=explore');
  assert.equal(parseUrl(toSearch(state, versions), versions).versionId, 'v1');
});

test('toSearch writes a reversed pair as given, and reading it back swaps it', () => {
  const state = { ...defaults, versionId: 'v1', mode: 'compare', baseId: 'v2' };
  const search = toSearch(state, versions);
  assert.equal(search, '?version=v1&mode=compare&base=v2');
  assert.deepEqual(parseUrl(search, versions), { versionId: 'v2', mode: 'compare', baseId: 'v1' });
});

test('toSearch round-trips compare on the latest version', () => {
  const state = { ...defaults, mode: 'compare', baseId: 'v1' };
  const search = toSearch(state, versions);
  assert.equal(search, '?version=v2&mode=compare&base=v1');
  assert.deepEqual(parseUrl(search, versions), { versionId: 'v2', mode: 'compare', baseId: 'v1' });
});

test('toSearch writes layout, highlights and a 1-based change', () => {
  const state = { ...defaults, mode: 'compare', baseId: 'v1', layout: 'side', highlights: true, changeIndex: 2 };
  const search = toSearch(state, versions);
  assert.equal(search, '?version=v2&mode=compare&base=v1&layout=side&hl=1&change=3');
  const parsed = parseUrl(search, versions);
  assert.equal(parsed.layout, 'side');
  assert.equal(parsed.highlights, true);
  assert.equal(parsed.changeIndex, 2);
});

test('toSearch leaves wipe and highlights-off out', () => {
  const state = { ...defaults, versionId: 'v1', mode: 'compare', baseId: 'v2' };
  assert.ok(!toSearch(state, versions).includes('layout'));
  assert.ok(!toSearch(state, versions).includes('hl'));
});

// The selected change indexes the filtered list, so a link has to carry the filter to point at the same change.
test('a change filter round-trips with the change it indexes', () => {
  const state = { ...defaults, changeFilter: 'added', highlights: true, changeIndex: 1 };
  const search = toSearch(state, versions);
  assert.equal(search, '?hl=1&filter=added&change=2');
  const parsed = parseUrl(search, versions);
  assert.equal(parsed.changeFilter, 'added');
  assert.equal(parsed.changeIndex, 1);
});

test('the all filter and unknown filters stay out of links', () => {
  assert.ok(!toSearch({ ...defaults, changeFilter: 'all' }, versions).includes('filter'));
  assert.equal(parseUrl('?filter=everything', versions).changeFilter, undefined);
});

test('zoom is written and read side by side only', () => {
  const side = { ...defaults, mode: 'compare', baseId: 'v1', layout: 'side', zoom: '75' };
  assert.equal(toSearch(side, versions), '?version=v2&mode=compare&base=v1&layout=side&zoom=75');
  assert.equal(parseUrl('?mode=compare&layout=side&zoom=100', versions).zoom, '100');
  assert.equal(toSearch({ ...side, zoom: 'fit' }, versions), '?version=v2&mode=compare&base=v1&layout=side');
  assert.equal(toSearch({ ...side, layout: 'wipe' }, versions), '?version=v2&mode=compare&base=v1');
  assert.equal(parseUrl('?zoom=250', versions).zoom, undefined);
});

test('a put-away pill never reaches the link, and a link never puts it away', () => {
  const versions = makeVersions(3);
  assert.equal(toSearch({ versionId: 'v3', mode: 'explore', retracted: true }, versions), '');
  assert.equal(parseUrl('?retracted=1', versions).retracted, undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, comparisonBase, clampChange, showsLivePage } from '../src/viewer/state/model.js';

function makeVersions(count) {
  const list = [];
  for (let n = count; n >= 1; n--) {
    list.push({ id: `v${n}`, name: `Version ${n}`, label: `Version ${n}`, file: `versions/v${n}/index.html`, notes: [], savedAt: null, sha256: 'a'.repeat(64) });
  }
  return list;
}

const versions = makeVersions(5); // v5 .. v1
const run = (state, action) => reducer(versions)(state, action);
const start = () => initialState(versions, '');

test('initialState is the documented default', () => {
  assert.deepEqual(start(), {
    versionId: 'v5', mode: 'explore', baseId: null, layout: 'wipe', highlights: false,
    changeIndex: null, changeFilter: 'all', panelOpen: false,
    folders: { versions: false, changes: false }, syncScroll: true, zoom: 'fit', peek: false, pick: 0, retracted: false,
  });
});

test('initialState merges the URL over the defaults', () => {
  const state = initialState(versions, '?version=v3&mode=compare&base=v1&layout=side&hl=1&change=2');
  assert.equal(state.versionId, 'v3');
  assert.equal(state.mode, 'compare');
  assert.equal(state.baseId, 'v1');
  assert.equal(state.layout, 'side');
  assert.equal(state.highlights, true);
  assert.equal(state.changeIndex, 1);
  assert.equal(state.panelOpen, false);
});

test('reducer is pure and returns a new object', () => {
  const before = start();
  const frozen = JSON.stringify(before);
  const after = run(before, { type: 'selectVersion', id: 'v2' });
  assert.notEqual(after, before);
  assert.equal(JSON.stringify(before), frozen);
});

test('stepVersion moves older and newer, and clamps at both ends', () => {
  let state = start();
  state = run(state, { type: 'stepVersion', delta: 1 });
  assert.equal(state.versionId, 'v5');
  state = run(state, { type: 'stepVersion', delta: -1 });
  assert.equal(state.versionId, 'v4');
  state = { ...state, versionId: 'v1' };
  state = run(state, { type: 'stepVersion', delta: -1 });
  assert.equal(state.versionId, 'v1');
});

test('selectVersion in explore resets changeIndex and keeps the changes folder', () => {
  const state = { ...start(), changeIndex: 3, folders: { versions: false, changes: true } };
  const next = run(state, { type: 'selectVersion', id: 'v3' });
  assert.equal(next.versionId, 'v3');
  assert.equal(next.changeIndex, null);
  assert.equal(next.folders.changes, true);
});

test('selectVersion ignores unknown ids', () => {
  const state = start();
  assert.equal(run(state, { type: 'selectVersion', id: 'v99' }).versionId, 'v5');
});

test('selecting the base version in compare moves the base to its previous version', () => {
  let state = run(start(), { type: 'setMode', mode: 'compare' });
  assert.equal(state.baseId, 'v4');
  state = run(state, { type: 'selectVersion', id: 'v4' });
  assert.equal(state.versionId, 'v4');
  assert.equal(state.baseId, 'v3');
});

test('selecting the base when it is the first version falls back to explore', () => {
  let state = run({ ...start(), versionId: 'v2' }, { type: 'setMode', mode: 'compare' });
  assert.equal(state.baseId, 'v1');
  state = run(state, { type: 'selectVersion', id: 'v1' });
  assert.equal(state.mode, 'explore');
  assert.equal(state.baseId, null);
});

test('selecting a version newer than the base keeps the base', () => {
  let state = run({ ...start(), versionId: 'v3' }, { type: 'setMode', mode: 'compare' });
  state = run({ ...state, baseId: 'v1' }, { type: 'selectVersion', id: 'v5' });
  assert.equal(state.mode, 'compare');
  assert.equal(state.baseId, 'v1');
});

// The baseline is always older than the target.
test('selecting a version older than the base moves the base to its previous version', () => {
  let state = run(start(), { type: 'setMode', mode: 'compare' });
  assert.equal(state.baseId, 'v4');
  state = run(state, { type: 'selectVersion', id: 'v2' });
  assert.equal(state.mode, 'compare');
  assert.equal(state.versionId, 'v2');
  assert.equal(state.baseId, 'v1');
});

test('stepping the target down onto the base keeps the base older', () => {
  let state = run({ ...start(), versionId: 'v4' }, { type: 'setMode', mode: 'compare' });
  state = run(state, { type: 'stepVersion', delta: -1 });
  assert.equal(state.versionId, 'v3');
  assert.equal(state.baseId, 'v2');
});

test('goLatest selects the newest version and resets the change', () => {
  const state = { ...start(), versionId: 'v2', changeIndex: 1 };
  const next = run(state, { type: 'goLatest' });
  assert.equal(next.versionId, 'v5');
  assert.equal(next.changeIndex, null);
});

test('setMode compare picks the previous version as base and explore clears it', () => {
  let state = run({ ...start(), versionId: 'v3', changeIndex: 1 }, { type: 'setMode', mode: 'compare' });
  assert.equal(state.mode, 'compare');
  assert.equal(state.baseId, 'v2');
  assert.equal(state.changeIndex, null);
  state = run(state, { type: 'setMode', mode: 'explore' });
  assert.equal(state.mode, 'explore');
  assert.equal(state.baseId, null);
});

test('setMode compare on the first version stays in explore', () => {
  const state = run({ ...start(), versionId: 'v1' }, { type: 'setMode', mode: 'compare' });
  assert.equal(state.mode, 'explore');
  assert.equal(state.baseId, null);
});

test('setBase changes the baseline in compare and resets the change', () => {
  let state = run(start(), { type: 'setMode', mode: 'compare' });
  state = run({ ...state, changeIndex: 2 }, { type: 'setBase', id: 'v2' });
  assert.equal(state.baseId, 'v2');
  assert.equal(state.changeIndex, null);
});

test('setBase ignores the selected version and unknown ids', () => {
  const state = run(start(), { type: 'setMode', mode: 'compare' });
  assert.equal(run(state, { type: 'setBase', id: 'v5' }).baseId, 'v4');
  assert.equal(run(state, { type: 'setBase', id: 'v99' }).baseId, 'v4');
});

test('setBase rejects a version that is not older than the target', () => {
  const state = run({ ...start(), versionId: 'v3' }, { type: 'setMode', mode: 'compare' });
  assert.equal(run(state, { type: 'setBase', id: 'v4' }), state);
  assert.equal(run(state, { type: 'setBase', id: 'v3' }), state);
  assert.equal(run(state, { type: 'setBase', id: 'v1' }).baseId, 'v1');
});

test('setBase outside compare does nothing', () => {
  const state = { ...start(), versionId: 'v3' };
  assert.equal(run(state, { type: 'setBase', id: 'v1' }), state);
});

// A second Compare press keeps the chosen base.
test('setMode compare while already comparing returns the same state', () => {
  let state = run(start(), { type: 'setMode', mode: 'compare' });
  state = run(state, { type: 'setBase', id: 'v2' });
  assert.equal(run(state, { type: 'setMode', mode: 'compare' }), state);
});

test('setFilter changes the filter and resets changeIndex', () => {
  const state = { ...start(), changeIndex: 4 };
  const next = run(state, { type: 'setFilter', filter: 'added' });
  assert.equal(next.changeFilter, 'added');
  assert.equal(next.changeIndex, null);
});

test('stepChange wraps in both directions', () => {
  let state = run(start(), { type: 'stepChange', delta: 1, total: 3 });
  assert.equal(state.changeIndex, 0);
  state = { ...state, changeIndex: 2 };
  assert.equal(run(state, { type: 'stepChange', delta: 1, total: 3 }).changeIndex, 0);
  state = { ...state, changeIndex: 0 };
  assert.equal(run(state, { type: 'stepChange', delta: -1, total: 3 }).changeIndex, 2);
});

test('stepChange backwards from nothing selected lands on the last change', () => {
  assert.equal(run(start(), { type: 'stepChange', delta: -1, total: 3 }).changeIndex, 2);
});

test('stepChange with no changes does nothing', () => {
  assert.equal(run(start(), { type: 'stepChange', delta: 1, total: 0 }).changeIndex, null);
});

test('selectChange sets the index', () => {
  assert.equal(run(start(), { type: 'selectChange', index: 4 }).changeIndex, 4);
});

test('toggleFolder with phone closes the other folder', () => {
  let state = run(start(), { type: 'toggleFolder', folder: 'versions', phone: true });
  assert.deepEqual(state.folders, { versions: true, changes: false });
  state = run(state, { type: 'toggleFolder', folder: 'changes', phone: true });
  assert.deepEqual(state.folders, { versions: false, changes: true });
});

test('toggleFolder without phone lets both folders stay open', () => {
  let state = run(start(), { type: 'toggleFolder', folder: 'versions', phone: false });
  state = run(state, { type: 'toggleFolder', folder: 'changes', phone: false });
  assert.deepEqual(state.folders, { versions: true, changes: true });
  state = run(state, { type: 'toggleFolder', folder: 'versions', phone: false });
  assert.deepEqual(state.folders, { versions: false, changes: true });
});

test('simple toggles flip their flag', () => {
  let state = start();
  state = run(state, { type: 'toggleHighlights' });
  assert.equal(state.highlights, true);
  state = run(state, { type: 'setLayout', layout: 'side' });
  assert.equal(state.layout, 'side');
  state = run(state, { type: 'toggleSync' });
  assert.equal(state.syncScroll, false);
  state = run(state, { type: 'setPeek', peek: true });
  assert.equal(state.peek, true);
  state = run(state, { type: 'togglePanel' });
  assert.equal(state.panelOpen, true);
  state = run(state, { type: 'closePanel' });
  assert.equal(state.panelOpen, false);
});

test('unknown actions return the same state', () => {
  const state = start();
  assert.equal(run(state, { type: 'nope' }), state);
});

test('comparisonBase is the previous version in explore, the base in compare, null for the first', () => {
  assert.equal(comparisonBase(versions, { ...start(), versionId: 'v3' }).id, 'v2');
  assert.equal(comparisonBase(versions, { ...start(), versionId: 'v1' }), null);
  assert.equal(comparisonBase(versions, { ...start(), versionId: 'v2', mode: 'compare', baseId: 'v5' }).id, 'v5');
});

test('stepVersion at either end changes nothing, so it does not reset the selected change', () => {
  const newest = { ...start(), changeIndex: 3 };
  assert.equal(run(newest, { type: 'stepVersion', delta: 1 }), newest);
  const oldest = { ...start(), versionId: 'v1', changeIndex: 2 };
  assert.equal(run(oldest, { type: 'stepVersion', delta: -1 }), oldest);
  // a step that does move still resets it
  assert.equal(run(newest, { type: 'stepVersion', delta: -1 }).changeIndex, null);
});

test('setPeek to what it already is returns the same state', () => {
  const state = start();
  assert.equal(run(state, { type: 'setPeek', peek: false }), state);
  const held = run(state, { type: 'setPeek', peek: true });
  assert.equal(run(held, { type: 'setPeek', peek: true }), held);
});

// ---- final review fixes ----

test('clampChange drops a change number past the list, but only once the review is ready', () => {
  assert.equal(clampChange(98, 15, 'ready'), null, '?change=99 with 15 changes');
  assert.equal(clampChange(15, 15, 'ready'), null);
  assert.equal(clampChange(14, 15, 'ready'), 14);
  assert.equal(clampChange(0, 0, 'ready'), null);
  assert.equal(clampChange(null, 15, 'ready'), null);
  // Still checking, or the check failed: the link's number is kept for when the list arrives.
  assert.equal(clampChange(98, 0, 'checking'), 98);
  assert.equal(clampChange(98, 0, 'idle'), 98);
  assert.equal(clampChange(98, 0, 'failed'), 98);
});

test('clampChange as an action leaves the state alone when nothing is out of range', () => {
  const state = { ...start(), changeIndex: 98, highlights: true };
  const clamped = run(state, { type: 'clampChange', total: 15, status: 'ready' });
  assert.equal(clamped.changeIndex, null);
  const fine = { ...start(), changeIndex: 3 };
  assert.equal(run(fine, { type: 'clampChange', total: 15, status: 'ready' }), fine);
  assert.equal(run(state, { type: 'clampChange', total: 0, status: 'checking' }), state);
});

test('picking a change counts every pick, the same one again too; J/K steps do not', () => {
  const picked = run(start(), { type: 'selectChange', index: 2 });
  const again = run(picked, { type: 'selectChange', index: 2 });
  assert.equal(again.changeIndex, 2);
  assert.notEqual(again.pick, picked.pick, 'a re-pick of the same change is a new pick');
  const stepped = run(again, { type: 'stepChange', delta: 1, total: 5 });
  assert.equal(stepped.changeIndex, 3);
  assert.equal(stepped.pick, again.pick, 'a step is not a pick');
});

test('crossing to phone with both folders open keeps one, since a phone shows one at a time', () => {
  const both = { ...start(), folders: { versions: true, changes: true } };
  assert.deepEqual(run(both, { type: 'oneFolder' }).folders, { versions: false, changes: true });
  const one = { ...start(), folders: { versions: true, changes: false } };
  assert.equal(run(one, { type: 'oneFolder' }), one);
});

test('clearChange drops the selection and keeps highlights on', () => {
  const picked = run(run(start(), { type: 'toggleHighlights' }), { type: 'selectChange', index: 2 });
  const cleared = run(picked, { type: 'clearChange' });
  assert.equal(cleared.changeIndex, null);
  assert.equal(cleared.highlights, true);
});

test('clearChange with nothing selected returns the same state', () => {
  const state = start();
  assert.equal(run(state, { type: 'clearChange' }), state);
});

test('setZoom sets the side by side zoom level', () => {
  assert.equal(run(start(), { type: 'setZoom', zoom: '100' }).zoom, '100');
  assert.equal(run(start(), { type: 'setZoom', zoom: '250' }).zoom, 'fit');
});

test('putting the pill away closes the panel and leaves highlights as they were', () => {
  const open = { ...start(), panelOpen: true, highlights: true };
  const away = run(open, { type: 'setRetracted', retracted: true });
  assert.equal(away.retracted, true);
  assert.equal(away.panelOpen, false);
  assert.equal(away.highlights, true);
  const back = run(away, { type: 'setRetracted', retracted: false });
  assert.equal(back.retracted, false);
  assert.equal(back.highlights, true);
  assert.equal(run(back, { type: 'setRetracted', retracted: false }), back);
});

test('toggleRetracted puts the pill away and brings it back', () => {
  const away = run(start(), { type: 'toggleRetracted' });
  assert.equal(away.retracted, true);
  assert.equal(run(away, { type: 'toggleRetracted' }).retracted, false);
});

// The viewer framed over a live prototype: the page's own pill opens it in one state, and leaving every state the
// page can't show (an older version, compare, highlights, the panel) hands the page back.
test('openFromPage opens straight into what the page pill asked for, from wherever the viewer was left', () => {
  const messy = { ...start(), versionId: 'v2', mode: 'compare', baseId: 'v1', changeIndex: 3, peek: true, retracted: true, panelOpen: true };
  const highlight = run(messy, { type: 'openFromPage', view: 'highlight' });
  assert.equal(highlight.versionId, 'v5');
  assert.equal(highlight.mode, 'explore');
  assert.equal(highlight.baseId, null);
  assert.equal(highlight.highlights, true);
  assert.equal(highlight.panelOpen, false);
  assert.equal(highlight.changeIndex, null);
  assert.equal(highlight.peek, false);
  assert.equal(highlight.retracted, false);

  const compare = run(start(), { type: 'openFromPage', view: 'compare' });
  assert.equal(compare.mode, 'compare');
  assert.equal(compare.baseId, 'v4');
  assert.equal(compare.highlights, false);

  const list = run({ ...start(), highlights: true }, { type: 'openFromPage', view: 'versions' });
  assert.equal(list.panelOpen, true);
  assert.equal(list.folders.versions, true);
  assert.equal(list.highlights, false);
});

test('openFromPage on a single version has nothing to compare, so it opens the version list instead', () => {
  const one = makeVersions(1);
  const state = reducer(one)(initialState(one, ''), { type: 'openFromPage', view: 'compare' });
  assert.equal(state.mode, 'explore');
  assert.equal(state.panelOpen, true);
});

// The viewer first matches the live page exactly, so the page can swap itself for it unseen; the view asked for comes
// after, where its transitions show.
test('openFromPage with the page view looks like the live page, even on a first version', () => {
  const messy = { ...start(), versionId: 'v2', mode: 'compare', baseId: 'v1', highlights: true, panelOpen: true, peek: true };
  const page = run(messy, { type: 'openFromPage', view: 'page' });
  assert.equal(showsLivePage(page, versions), true);
  assert.equal(page.peek, false);
  const one = makeVersions(1);
  assert.equal(showsLivePage(reducer(one)(initialState(one, ''), { type: 'openFromPage', view: 'page' }), one), true);
});

test('showsLivePage is true only for the latest version with nothing on top', () => {
  assert.equal(showsLivePage(start(), versions), true);
  assert.equal(showsLivePage({ ...start(), highlights: true }, versions), false);
  assert.equal(showsLivePage({ ...start(), panelOpen: true }, versions), false);
  assert.equal(showsLivePage(run(start(), { type: 'setMode', mode: 'compare' }), versions), false);
  assert.equal(showsLivePage(run(start(), { type: 'selectVersion', id: 'v3' }), versions), false);
  // A layout, zoom or filter choice is remembered for next time, not a reason to stay.
  assert.equal(showsLivePage({ ...start(), layout: 'side', changeFilter: 'added' }, versions), true);
});

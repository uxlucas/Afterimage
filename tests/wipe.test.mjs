import test from 'node:test';
import assert from 'node:assert/strict';
import { wipeToShow, visibleRange } from '../src/viewer/stage/wipe.js';
import { cardPlacement } from '../src/viewer/stage/overlay.js';
import { filterWord, stepperLabel } from '../src/viewer/pill/stepper.js';

const W = 1000;
const rect = (x, width) => ({ x, y: 300, width, height: 40 });

test('an added region on the hidden (Before) side moves the divider just left of it (Ruling 25)', () => {
  // divider at 50%: an added region centred at 25% is under the Before layer
  const goal = wipeToShow({ wipe: 50, kind: 'added', rect: rect(200, 100), width: W });
  assert.ok(goal < 20 && goal > 15, `goal ${goal}`);
  // already right of the divider: left alone
  assert.equal(wipeToShow({ wipe: 50, kind: 'added', rect: rect(600, 100), width: W }), 50);
});

test('a removed region on the hidden (After) side moves the divider just right of it', () => {
  const goal = wipeToShow({ wipe: 50, kind: 'removed', rect: rect(700, 100), width: W });
  assert.ok(goal > 80 && goal < 85, `goal ${goal}`);
  assert.equal(wipeToShow({ wipe: 50, kind: 'removed', rect: rect(100, 100), width: W }), 50);
});

test('a changed region shows on either side, so the divider stays put', () => {
  assert.equal(wipeToShow({ wipe: 50, kind: 'changed', rect: rect(100, 100), width: W }), 50);
  assert.equal(wipeToShow({ wipe: 50, kind: 'changed', rect: rect(800, 100), width: W }), 50);
});

test('the divider never goes past 5% or 95%', () => {
  assert.equal(wipeToShow({ wipe: 50, kind: 'added', rect: rect(0, 60), width: W }), 5);
  assert.equal(wipeToShow({ wipe: 50, kind: 'removed', rect: rect(900, 100), width: W }), 95);
  // a page-wide region: as far as the clamp allows
  assert.equal(wipeToShow({ wipe: 50, kind: 'removed', rect: rect(0, 1000), width: W }), 50, 'centre at 50% is not past the divider');
  assert.equal(wipeToShow({ wipe: 40, kind: 'removed', rect: rect(0, 1000), width: W }), 95);
});

test('horizontal scroll is taken into account, and no size means no move', () => {
  assert.ok(wipeToShow({ wipe: 50, kind: 'added', rect: rect(1200, 100), width: W, scrollX: 1000 }) < 20);
  assert.equal(wipeToShow({ wipe: 50, kind: 'added', rect: rect(200, 100), width: 0 }), 50);
});

test('visibleRange is the part of the page each frame shows in the wipe', () => {
  assert.deepEqual(visibleRange({ layout: 'wipe', wipe: 30, width: W, onBase: true }), { min: 0, max: 300 });
  assert.deepEqual(visibleRange({ layout: 'wipe', wipe: 30, width: W, onBase: false }), { min: 300, max: 1000 });
  assert.equal(visibleRange({ layout: 'side', wipe: 30, width: W, onBase: true }), null);
  assert.equal(visibleRange({ layout: 'wipe', wipe: 30, width: W, onBase: true, peek: true }), null);
});

const card = { cardWidth: 196, cardHeight: 90, gap: 14, room: 220, edge: 8, below: 10, clientWidth: W, docHeight: 3000, viewHeight: 800 };

test('without bounds the card goes right of the region, as before', () => {
  const { left, top } = cardPlacement({ ...card, rect: rect(100, 100) });
  assert.equal(left, 214);
  assert.equal(top, 275);
});

test('a card on the Before side stays left of the divider (review-checks.md:62)', () => {
  // region at 300..400 on the base, divider at 450: right of the region would straddle the divider
  const { left } = cardPlacement({ ...card, rect: rect(300, 100), bounds: { min: 0, max: 450 } });
  assert.ok(left + 196 <= 450, `card ends at ${left + 196}`);
  assert.ok(left >= 0);
});

test('a card on the After side stays right of the divider', () => {
  // region at 600..850 on the target, divider at 500: no room on the right, and left of the region
  // (where it went before) would sit under the Before layer
  const unbounded = cardPlacement({ ...card, rect: rect(600, 250) });
  assert.ok(unbounded.left < 500, 'the old placement was under the Before side');
  const { left } = cardPlacement({ ...card, rect: rect(600, 250), bounds: { min: 500, max: 1000 } });
  assert.ok(left >= 500, `card starts at ${left}`);
});

test('a narrow visible part puts the card below the region, inside that part', () => {
  const { left, top } = cardPlacement({ ...card, rect: rect(40, 160), bounds: { min: 0, max: 240 } });
  assert.equal(top, 350);
  assert.ok(left >= 8 && left + 196 <= 240, `card spans ${left}..${left + 196}`);
});

test('the pill names a filter that is not All (Ruling 26)', () => {
  assert.equal(filterWord('all'), '');
  assert.equal(filterWord('added'), 'added');
  assert.equal(filterWord('removed'), 'removed');
  assert.equal(filterWord('changed'), 'changed');
  assert.equal(stepperLabel({ ready: true, changeIndex: 0, total: 2, filter: 'added' }), 'Highlights on, change 1 of 2 added. Turn highlights off');
  assert.equal(stepperLabel({ ready: true, changeIndex: null, total: 15, filter: 'all' }), 'Highlights on, change none selected of 15. Turn highlights off');
  assert.equal(stepperLabel({ ready: false, changeIndex: null, total: 0, filter: 'removed' }), 'Highlights on. Turn highlights off');
});

test('visibleRange side by side is the panned slice of the page once zoomed in', () => {
  assert.equal(visibleRange({ layout: 'side', width: 1440, pan: 0, visible: 1440 }), null);
  assert.deepEqual(visibleRange({ layout: 'side', width: 1440, pan: 300, visible: 705 }), { min: 300, max: 1005 });
});

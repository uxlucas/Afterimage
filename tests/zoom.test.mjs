import test from 'node:test';
import assert from 'node:assert/strict';
import { sideScale, clampPan, panForZoom, panToShow, stepZoom } from '../src/viewer/stage/zoom.js';

const W = 1440, COLUMN = 705, FIT = COLUMN / W;

test('Fit keeps the whole page in the column; 75% and 100% are real sizes', () => {
  assert.equal(sideScale('fit', FIT), FIT);
  assert.equal(sideScale('75', FIT), 0.75);
  assert.equal(sideScale('100', FIT), 1);
});

test('a level smaller than Fit shows the page at Fit, so it never leaves empty space', () => {
  assert.equal(sideScale('75', 0.9), 0.9);
});

test('pan stays within the page', () => {
  assert.equal(clampPan(-50, W, COLUMN), 0);
  assert.equal(clampPan(2000, W, COLUMN), W - COLUMN);
  assert.equal(clampPan(300, W, COLUMN), 300);
  assert.equal(clampPan(300, W, W), 0); // Fit: nothing to pan
});

test('zooming keeps the anchored page point under the same spot in the column', () => {
  // At Fit the point at x 720 sits at 720 * FIT on screen. After zooming to 100% it should still be there.
  const pan = panForZoom({ pan: 0, anchor: 720, from: FIT, to: 1, width: W, column: COLUMN });
  assert.ok(Math.abs((720 - pan) * 1 - 720 * FIT) < 1e-9);
});

test('zooming at an edge of the page keeps that edge in place', () => {
  assert.equal(panForZoom({ pan: 0, anchor: 0, from: FIT, to: 1, width: W, column: COLUMN }), 0);
  assert.equal(panForZoom({ pan: 0, anchor: W, from: FIT, to: 1, width: W, column: COLUMN }), W - COLUMN);
});

test('zooming back to Fit returns the pan to 0', () => {
  assert.equal(panForZoom({ pan: 400, anchor: 700, from: 1, to: FIT, width: W, column: COLUMN }), 0);
});

test('a change already in view keeps the pan', () => {
  assert.equal(panToShow({ pan: 100, rect: { x: 200, width: 300 }, width: W, visible: COLUMN }), 100);
});

test('a change out of view is centred, within the page', () => {
  assert.equal(panToShow({ pan: 0, rect: { x: 900, width: 100 }, width: W, visible: COLUMN }), 950 - COLUMN / 2);
  assert.equal(panToShow({ pan: 0, rect: { x: 1300, width: 100 }, width: W, visible: COLUMN }), W - COLUMN);
});

test('a change wider than the column shows from its left edge, with a margin', () => {
  assert.equal(panToShow({ pan: 0, rect: { x: 300, width: 1000 }, width: W, visible: COLUMN }), 300 - 24);
});

test('stepZoom moves one level and stops at the ends', () => {
  assert.equal(stepZoom('fit', 1), '75');
  assert.equal(stepZoom('75', 1), '100');
  assert.equal(stepZoom('100', 1), '100');
  assert.equal(stepZoom('75', -1), 'fit');
  assert.equal(stepZoom('fit', -1), 'fit');
});

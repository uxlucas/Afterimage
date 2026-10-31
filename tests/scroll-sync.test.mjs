import test from 'node:test';
import assert from 'node:assert/strict';
import { linkScroll } from '../src/viewer/stage/scrollSync.js';

// A window that scrolls like a browser one: scrollTo moves it and queues a scroll event, which fires on flush().
function fakeWindow({ scrollHeight, clientHeight, queue }) {
  const listeners = new Set();
  const documentElement = { scrollHeight, clientHeight };
  const win = {
    scrollY: 0,
    scrollToCalls: 0,
    document: { documentElement, scrollingElement: documentElement },
    addEventListener(type, handler) { if (type === 'scroll') listeners.add(handler); },
    removeEventListener(type, handler) { if (type === 'scroll') listeners.delete(handler); },
    scrollTo({ top }) {
      win.scrollToCalls += 1;
      const max = documentElement.scrollHeight - documentElement.clientHeight;
      const next = Math.min(max, Math.max(0, top));
      if (next === win.scrollY) return;
      win.scrollY = next;
      queue.push(win);
    },
    userScroll(top) { win.scrollY = top; queue.push(win); },
    get listenerCount() { return listeners.size; },
    fire() { for (const handler of [...listeners]) handler(); },
  };
  return win;
}

function fakeFrame(win) {
  const listeners = new Set();
  return {
    contentWindow: win,
    addEventListener(type, handler) { if (type === 'load') listeners.add(handler); },
    removeEventListener(type, handler) { if (type === 'load') listeners.delete(handler); },
    load(nextWin) { this.contentWindow = nextWin; for (const handler of [...listeners]) handler(); },
    get listenerCount() { return listeners.size; },
  };
}

function setup() {
  const queue = [];
  const flush = () => {
    let events = 0;
    while (queue.length) {
      if (++events > 50) throw new Error('scroll events kept coming: echo loop');
      queue.shift().fire();
    }
    return events;
  };
  const a = fakeWindow({ scrollHeight: 2000, clientHeight: 1000, queue }); // max 1000
  const b = fakeWindow({ scrollHeight: 3000, clientHeight: 1000, queue }); // max 2000
  return { queue, flush, a, b, frameA: fakeFrame(a), frameB: fakeFrame(b) };
}

test('linkScroll moves the other frame by ratio and ignores the echo', () => {
  const { flush, a, b, frameA, frameB } = setup();
  linkScroll(frameA, frameB);
  a.userScroll(500);
  const events = flush();
  assert.equal(b.scrollY, 1000);
  assert.equal(a.scrollY, 500);
  assert.equal(a.scrollToCalls, 0); // b's echo never bounced back to a
  assert.equal(events, 2); // a's scroll, then b's echo, then quiet
  b.userScroll(2000);
  flush();
  assert.equal(a.scrollY, 1000);
});

test('linkScroll still follows a real scroll that arrives before an echo', () => {
  const { flush, a, b, frameA, frameB } = setup();
  linkScroll(frameA, frameB);
  a.scrollY = 500;
  a.fire(); // a's scroll handler runs: b is sent to 1000, its echo is queued
  b.scrollY = 400; // the visitor scrolls b before its echo fires
  flush();
  assert.equal(a.scrollY, 200);
});

test('linkScroll levels a frame when it loads, and listens to its new window', () => {
  const { queue, flush, a, b, frameA, frameB } = setup();
  linkScroll(frameA, frameB);
  a.userScroll(250);
  flush();
  const reloaded = fakeWindow({ scrollHeight: 1400, clientHeight: 1000, queue }); // max 400
  frameB.load(reloaded);
  flush();
  assert.equal(reloaded.scrollY, 100); // 250 / 1000 of 400
  assert.equal(b.listenerCount, 0); // the old window is let go
  reloaded.userScroll(400);
  flush();
  assert.equal(a.scrollY, 1000);
});

test('linkScroll levels the second frame with the first on link', () => {
  const { flush, a, b, frameA, frameB } = setup();
  a.scrollY = 1000;
  linkScroll(frameA, frameB);
  flush();
  assert.equal(b.scrollY, 2000);
});

test('unlink removes every listener and stops following', () => {
  const { flush, a, b, frameA, frameB } = setup();
  const unlink = linkScroll(frameA, frameB);
  assert.equal(a.listenerCount, 1);
  assert.equal(frameB.listenerCount, 1);
  unlink();
  assert.equal(a.listenerCount, 0);
  assert.equal(b.listenerCount, 0);
  assert.equal(frameA.listenerCount, 0);
  assert.equal(frameB.listenerCount, 0);
  a.userScroll(800);
  flush();
  assert.equal(b.scrollY, 0);
});

test('linkScroll disabled does nothing', () => {
  const { flush, a, b, frameA, frameB } = setup();
  const unlink = linkScroll(frameA, frameB, { enabled: false });
  assert.equal(a.listenerCount, 0);
  a.userScroll(800);
  flush();
  assert.equal(b.scrollY, 0);
  unlink();
});

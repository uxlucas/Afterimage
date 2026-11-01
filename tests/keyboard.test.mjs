import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor, isTextField, bindShortcuts, bindFrames, createTipGate, resolveShortcut } from '../src/viewer/keyboard.js';

const body = { tagName: 'BODY' };
const key = (value, extra = {}) => ({
  type: 'keydown', key: value, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  defaultPrevented: false, isComposing: false, target: body, ...extra,
});
const keyup = (value, extra = {}) => key(value, { type: 'keyup', ...extra });
const input = type => ({ tagName: 'INPUT', ...(type === undefined ? {} : { type }) });

test('shortcutFor maps each shortcut key to its action', () => {
  assert.deepEqual(shortcutFor(key('[')), { type: 'stepVersion', delta: -1 });
  assert.deepEqual(shortcutFor(key(']')), { type: 'stepVersion', delta: 1 });
  assert.equal(shortcutFor(key('g')), 'focusVersion');
  assert.deepEqual(shortcutFor(key('l')), { type: 'goLatest' });
  assert.deepEqual(shortcutFor(key('h')), { type: 'toggleHighlights' });
  assert.deepEqual(shortcutFor(key('j')), { type: 'stepChange', delta: 1 });
  assert.deepEqual(shortcutFor(key('k')), { type: 'stepChange', delta: -1 });
  assert.deepEqual(shortcutFor(key('c')), { type: 'setMode', mode: 'compare' });
  assert.deepEqual(shortcutFor(key('v')), { type: 'togglePanel' });
  assert.equal(shortcutFor(key('?', { shiftKey: true })), 'help');
});

test('letters work with caps lock or shift held', () => {
  assert.deepEqual(shortcutFor(key('J', { shiftKey: true })), { type: 'stepChange', delta: 1 });
  assert.deepEqual(shortcutFor(key('L')), { type: 'goLatest' });
});

test('Esc is an escape token; the app decides which layer it closes', () => {
  assert.equal(shortcutFor(key('Escape')), 'escape');
});

test('B peeks while held: keydown on, keyup off, repeats ignored', () => {
  assert.deepEqual(shortcutFor(key('b')), { type: 'setPeek', peek: true });
  assert.equal(shortcutFor(key('b', { repeat: true })), null);
  assert.deepEqual(shortcutFor(keyup('b')), { type: 'setPeek', peek: false });
});

test('releasing B always lets go, even if focus moved into a field meanwhile', () => {
  assert.deepEqual(shortcutFor(keyup('b', { target: input('text') })), { type: 'setPeek', peek: false });
  assert.deepEqual(shortcutFor(keyup('B', { ctrlKey: true })), { type: 'setPeek', peek: false });
});

test('other keys do nothing on keyup', () => {
  assert.equal(shortcutFor(keyup('j')), null);
  assert.equal(shortcutFor(keyup('Escape')), null);
});

test('holding a key repeats steps, but not toggles', () => {
  assert.deepEqual(shortcutFor(key(']', { repeat: true })), { type: 'stepVersion', delta: 1 });
  assert.deepEqual(shortcutFor(key('k', { repeat: true })), { type: 'stepChange', delta: -1 });
  assert.equal(shortcutFor(key('v', { repeat: true })), null);
  assert.equal(shortcutFor(key('h', { repeat: true })), null);
  assert.equal(shortcutFor(key('Escape', { repeat: true })), null);
});

test('unmapped keys return null', () => {
  assert.equal(shortcutFor(key('x')), null);
  assert.equal(shortcutFor(key('Enter')), null);
  assert.equal(shortcutFor(key('{')), null);
});

test('text fields block every shortcut', () => {
  for (const target of [
    input('text'), input('email'), input('password'), input('search'), input('number'), input('tel'), input('url'), input(undefined),
    { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true },
  ]) {
    for (const value of ['[', ']', 'g', 'l', 'h', 'j', 'k', 'c', 'v', 'b', '?', 'Escape']) {
      assert.equal(shortcutFor(key(value, { target })), null, `${value} in ${target.tagName} ${target.type ?? ''}`);
    }
  }
});

test('inputs that are not text entry do not block (checkbox exception)', () => {
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']) {
    assert.deepEqual(shortcutFor(key('j', { target: input(type) })), { type: 'stepChange', delta: 1 }, type);
  }
  assert.equal(shortcutFor(key('Escape', { target: input('radio') })), 'escape');
});

test('isTextField follows the same rule', () => {
  assert.equal(isTextField(input('Email')), true);
  assert.equal(isTextField(input('checkbox')), false);
  assert.equal(isTextField({ tagName: 'BUTTON' }), false);
  assert.equal(isTextField(null), false);
});

test('Ctrl, Meta and Alt turn every shortcut off', () => {
  for (const flag of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(shortcutFor(key('j', { [flag]: true })), null, flag);
    assert.equal(shortcutFor(key('Escape', { [flag]: true })), null, flag);
  }
});

test('a key the page already handled is left alone, and so is IME composition', () => {
  assert.equal(shortcutFor(key('Escape', { defaultPrevented: true })), null);
  assert.equal(shortcutFor(key('j', { defaultPrevented: true })), null);
  assert.equal(shortcutFor(key('Escape', { isComposing: true })), null);
});

// ---- binding ----

class FakeKey extends Event {
  constructor(type, init) {
    super(type, { cancelable: true, bubbles: true });
    for (const [name, value] of Object.entries({ repeat: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target: body, ...init })) {
      Object.defineProperty(this, name, { value, configurable: true });
    }
  }
}
const fakeWindow = () => Object.assign(new EventTarget(), { document: new EventTarget() });
const press = (win, value, init = {}) => {
  const event = new FakeKey('keydown', { key: value, ...init });
  win.dispatchEvent(event);
  return event;
};

test('bindShortcuts hands actions to the handler, and unbind stops it', () => {
  const win = fakeWindow();
  const seen = [];
  const unbind = bindShortcuts(win, action => { seen.push(action); });
  press(win, ']');
  press(win, 'x');
  win.dispatchEvent(new FakeKey('keydown', { key: 'b' }));
  win.dispatchEvent(new FakeKey('keyup', { key: 'b' }));
  assert.deepEqual(seen, [{ type: 'stepVersion', delta: 1 }, { type: 'setPeek', peek: true }, { type: 'setPeek', peek: false }]);
  unbind();
  press(win, ']');
  assert.equal(seen.length, 3);
});

test('bindShortcuts consumes the keys it used, but never Esc', () => {
  const win = fakeWindow();
  bindShortcuts(win, () => {});
  assert.equal(press(win, 'j').defaultPrevented, true);
  assert.equal(press(win, 'x').defaultPrevented, false);
  assert.equal(press(win, 'Escape').defaultPrevented, false);
});

test('a handler that declines leaves the event alone', () => {
  const win = fakeWindow();
  bindShortcuts(win, () => false);
  assert.equal(press(win, 'j').defaultPrevented, false);
});

test('bindShortcuts releases the peek when the window blurs or hides', () => {
  const win = fakeWindow();
  const seen = [];
  bindShortcuts(win, action => { seen.push(action); });
  win.dispatchEvent(new Event('blur'));
  win.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(seen, [{ type: 'setPeek', peek: false }, { type: 'setPeek', peek: false }]);
});

test('bindFrames follows a frame to its new window on every load, and lets the old one go', () => {
  const first = fakeWindow();
  const second = fakeWindow();
  const frame = Object.assign(new EventTarget(), { contentWindow: first });
  const seen = [];
  const unbind = bindFrames([frame, null], action => { if (action.type !== 'setPeek') seen.push(action); });
  press(first, 'j');
  assert.equal(seen.length, 1);

  frame.contentWindow = second;
  frame.dispatchEvent(new Event('load'));
  press(first, 'j');
  assert.equal(seen.length, 1, 'old window is unbound');
  press(second, 'j');
  assert.equal(seen.length, 2, 'new window is bound');

  // a reload that reuses the same window must not double up
  frame.dispatchEvent(new Event('load'));
  press(second, 'k');
  assert.equal(seen.length, 3);

  unbind();
  press(second, 'j');
  frame.dispatchEvent(new Event('load'));
  press(second, 'j');
  assert.equal(seen.length, 3, 'nothing left bound after unbind');
});

// ---- the one-time tip ----

const memoryStorage = (seed = {}) => {
  const data = { ...seed };
  return { getItem: name => data[name] ?? null, setItem: (name, value) => { data[name] = value; }, data };
};

test('the tip shows the first time and is remembered under an afterimage- key', () => {
  const storage = memoryStorage();
  assert.equal(createTipGate(() => storage)(), true);
  assert.deepEqual(Object.keys(storage.data), ['afterimage-shortcut-tip']);
  // a later visit, with a fresh page
  assert.equal(createTipGate(() => storage)(), false);
});

test('within one session the tip claims only once', () => {
  const claim = createTipGate(() => memoryStorage());
  assert.equal(claim(), true);
  assert.equal(claim(), false);
});

test('when storage throws the tip still shows once per session and nothing crashes', () => {
  const broken = () => { throw new Error('SecurityError'); };
  const claim = createTipGate(broken);
  assert.equal(claim(), true);
  assert.equal(claim(), false);
  const readOnly = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(createTipGate(() => readOnly)(), true);
  const throwsOnRead = { getItem: () => { throw new Error('nope'); }, setItem: () => {} };
  assert.equal(createTipGate(() => throwsOnRead)(), true);
});

test('AltGr (reported as Ctrl+Alt) still lets a shortcut through; plain Ctrl+Alt and Meta do not', () => {
  const altGr = { ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph' };
  assert.deepEqual(shortcutFor(key('[', altGr)), { type: 'stepVersion', delta: -1 });
  assert.deepEqual(shortcutFor(key(']', altGr)), { type: 'stepVersion', delta: 1 });
  assert.equal(shortcutFor(key('j', { ctrlKey: true, altKey: true, getModifierState: () => false })), null);
  assert.equal(shortcutFor(key('j', { metaKey: true, getModifierState: name => name === 'AltGraph' })), null);
});

test('a frame load lets go of the peek, in case the B keyup fell between navigation and load', () => {
  const win = fakeWindow();
  const frame = Object.assign(new EventTarget(), { contentWindow: win });
  const seen = [];
  bindFrames([frame], action => { seen.push(action); });
  assert.deepEqual(seen, []);
  frame.dispatchEvent(new Event('load'));
  assert.deepEqual(seen, [{ type: 'setPeek', peek: false }]);
});

// ---- what a shortcut does ----

const base = { mode: 'explore', panelOpen: false, highlights: false, changeFilter: 'all', versionId: 'v2' };
const versions = [{ id: 'v2' }, { id: 'v1' }];
const entry = kind => ({ key: kind, kind });
const envOf = (state = {}, extra = {}) => ({
  state: { ...base, ...state }, versions, entries: [entry('changed'), entry('added'), entry('removed')],
  phone: false, helpOpen: false, hasField: true, ...extra,
});
const gone = { consumed: false, dispatch: [], effect: null };

test('Esc closes whatever is on top, in order: sheet, panel, compare, then nothing', () => {
  const all = envOf({ panelOpen: true, mode: 'compare' }, { helpOpen: true });
  assert.deepEqual(resolveShortcut('escape', all), { consumed: true, dispatch: [], effect: 'closeHelp' });
  const noSheet = envOf({ panelOpen: true, mode: 'compare' });
  assert.deepEqual(resolveShortcut('escape', noSheet), { consumed: true, dispatch: [], effect: 'closePanel' });
  const compareOnly = envOf({ mode: 'compare' });
  assert.deepEqual(resolveShortcut('escape', compareOnly), { consumed: true, dispatch: [{ type: 'setMode', mode: 'explore' }], effect: 'leaveCompare' });
  assert.deepEqual(resolveShortcut('escape', envOf()), gone);
});

test('with the sheet open, only Esc, ? and letting go of B act', () => {
  const env = envOf({}, { helpOpen: true });
  assert.deepEqual(resolveShortcut({ type: 'stepVersion', delta: 1 }, env), gone);
  assert.deepEqual(resolveShortcut('focusVersion', env), gone);
  assert.equal(resolveShortcut('help', env).effect, 'toggleHelp');
  assert.deepEqual(resolveShortcut({ type: 'setPeek', peek: false }, env).dispatch, [{ type: 'setPeek', peek: false }]);
});

test('G focuses the version field, in Compare too', () => {
  assert.deepEqual(resolveShortcut('focusVersion', envOf()), { consumed: true, dispatch: [], effect: 'focusField' });
  assert.equal(resolveShortcut('focusVersion', envOf({ mode: 'compare' })).effect, 'focusField');
  assert.deepEqual(resolveShortcut('focusVersion', envOf({}, { hasField: false })), gone);
});

test('G on a phone opens the panel for the keyboard, and does nothing if it is already open', () => {
  assert.deepEqual(resolveShortcut('focusVersion', envOf({}, { phone: true })), { consumed: true, dispatch: [], effect: 'openPanelByKeyboard' });
  assert.equal(resolveShortcut('focusVersion', envOf({ mode: 'compare' }, { phone: true })).effect, 'openPanelByKeyboard');
  assert.equal(resolveShortcut('focusVersion', envOf({ panelOpen: true }, { phone: true })).effect, null);
});

test('J and K step through the filtered list, and do nothing when it is empty', () => {
  const j = { type: 'stepChange', delta: 1 };
  assert.deepEqual(resolveShortcut(j, envOf({ highlights: true })).dispatch, [{ ...j, total: 3 }]);
  assert.deepEqual(resolveShortcut(j, envOf({ highlights: true, changeFilter: 'removed' })).dispatch, [{ ...j, total: 1 }]);
  // highlights off: stepping turns them on first
  assert.deepEqual(resolveShortcut(j, envOf()).dispatch, [{ type: 'toggleHighlights' }, { ...j, total: 3 }]);
  // no changes in view: not consumed, and highlights are left alone
  assert.deepEqual(resolveShortcut(j, envOf({ changeFilter: 'removed' }, { entries: [entry('added')] })), gone);
  assert.deepEqual(resolveShortcut({ type: 'stepChange', delta: -1 }, envOf({}, { entries: [] })), gone);
});

test('L at the latest version does nothing; elsewhere it goes there', () => {
  const l = { type: 'goLatest' };
  assert.deepEqual(resolveShortcut(l, envOf({ versionId: 'v2' })), gone);
  assert.deepEqual(resolveShortcut(l, envOf({ versionId: 'v1' })), { consumed: true, dispatch: [l], effect: null });
});

test('V toggles the panel; other actions pass straight through', () => {
  assert.equal(resolveShortcut({ type: 'togglePanel' }, envOf()).effect, 'togglePanel');
  const c = { type: 'setMode', mode: 'compare' };
  assert.deepEqual(resolveShortcut(c, envOf()), { consumed: true, dispatch: [c], effect: null });
});

// ---- final review fixes ----

test('a text field inside a shadow root blocks shortcuts (composedPath)', () => {
  const host = { tagName: 'MY-SEARCH' };
  const inner = input('text');
  assert.equal(shortcutFor(key('j', { target: host, composedPath: () => [inner, host, body] })), null);
  assert.deepEqual(shortcutFor(key('j', { target: host, composedPath: () => [host, body] })), { type: 'stepChange', delta: 1 });
  // without composedPath the target still decides
  assert.equal(shortcutFor(key('j', { target: inner })), null);
});

test('H on the first version does nothing, so hl=1 is never written there', () => {
  const h = { type: 'toggleHighlights' };
  assert.deepEqual(resolveShortcut(h, envOf({ versionId: 'v1' })), gone);
  assert.deepEqual(resolveShortcut(h, envOf({ versionId: 'v2' })), { consumed: true, dispatch: [h], effect: null });
});

test('V closing the panel from inside it hands focus back like Esc; from elsewhere it just toggles', () => {
  const v = { type: 'togglePanel' };
  assert.equal(resolveShortcut(v, envOf({ panelOpen: true }, { focusInPanel: true })).effect, 'closePanel');
  assert.equal(resolveShortcut(v, envOf({ panelOpen: true }, { focusInPanel: false })).effect, 'togglePanel');
  assert.equal(resolveShortcut(v, envOf({ panelOpen: false }, { focusInPanel: true })).effect, 'togglePanel');
});

test('bindFrames skips a cross-origin frame and survives one that went cross-origin while bound', () => {
  const crossWindow = new EventTarget();
  Object.defineProperty(crossWindow, 'document', { get() { throw new Error('SecurityError'); } });
  crossWindow.addEventListener = () => { throw new Error('SecurityError'); };
  const blocked = Object.assign(new EventTarget(), { contentWindow: crossWindow });
  assert.doesNotThrow(() => bindFrames([blocked], () => {})());

  // Bound while same-origin, then the window starts throwing (it navigated cross-origin).
  const win = fakeWindow();
  const frame = Object.assign(new EventTarget(), { contentWindow: win });
  const unbind = bindFrames([frame], () => {});
  win.removeEventListener = () => { throw new Error('SecurityError'); };
  win.addEventListener = () => { throw new Error('SecurityError'); };
  Object.defineProperty(win, 'document', { get() { throw new Error('SecurityError'); } });
  assert.doesNotThrow(() => frame.dispatchEvent(new Event('load')));
  assert.doesNotThrow(() => unbind());
});

// ---- putting the pill away ----

const expand = { type: 'setRetracted', retracted: false };

test('. puts the pill away and brings it back', () => {
  assert.deepEqual(shortcutFor(key('.')), { type: 'toggleRetracted' });
  assert.equal(shortcutFor(key('.', { repeat: true })), null);
  const dot = { type: 'toggleRetracted' };
  assert.deepEqual(resolveShortcut(dot, envOf({ retracted: true })), { consumed: true, dispatch: [dot], effect: null });
});

test('H, J and K bring a put-away pill back, with highlights on', () => {
  const h = { type: 'toggleHighlights' };
  assert.deepEqual(resolveShortcut(h, envOf({ retracted: true })).dispatch, [expand, h]);
  // highlights were on: they show again, not toggle off
  assert.deepEqual(resolveShortcut(h, envOf({ retracted: true, highlights: true })).dispatch, [expand]);
  // the first version still has nothing to highlight
  assert.deepEqual(resolveShortcut(h, envOf({ retracted: true, versionId: 'v1' })), gone);
  const j = { type: 'stepChange', delta: 1 };
  assert.deepEqual(resolveShortcut(j, envOf({ retracted: true })).dispatch, [expand, h, { ...j, total: 3 }]);
  assert.deepEqual(resolveShortcut(j, envOf({ retracted: true, highlights: true })).dispatch, [expand, { ...j, total: 3 }]);
});

test('V and G bring a put-away pill back to do their job', () => {
  assert.deepEqual(resolveShortcut({ type: 'togglePanel' }, envOf({ retracted: true })), { consumed: true, dispatch: [expand], effect: 'togglePanel' });
  // the field is not on screen yet: it takes focus once the pill is back
  assert.deepEqual(resolveShortcut('focusVersion', envOf({ retracted: true }, { hasField: false })), { consumed: true, dispatch: [expand], effect: 'focusFieldWhenBack' });
  assert.deepEqual(resolveShortcut('focusVersion', envOf({ retracted: true }, { phone: true })), { consumed: true, dispatch: [expand], effect: 'openPanelByKeyboard' });
});

test('stepping versions, latest and Compare work without bringing the pill back', () => {
  for (const action of [{ type: 'stepVersion', delta: -1 }, { type: 'setMode', mode: 'compare' }]) {
    assert.deepEqual(resolveShortcut(action, envOf({ retracted: true })).dispatch, [action]);
  }
  assert.deepEqual(resolveShortcut({ type: 'goLatest' }, envOf({ retracted: true, versionId: 'v1' })).dispatch, [{ type: 'goLatest' }]);
});

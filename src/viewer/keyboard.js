import { filterEntries } from '../engine/review.js';
import { previousVersion } from './state/versions.js';
import { frameWindow, quietly } from './frames.js';

// Keyboard shortcuts. Pure mapping plus the binding to a window; no React.
// The same handler is bound to the viewer's window and to each prototype frame's window, because after a click
// on the prototype the keys go to its frame.

// Inputs that are not text entry: a checkbox or a button still lets the shortcuts through.
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

export function isTextField(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(String(target.type ?? '').toLowerCase());
  return false;
}

// Held keys keep stepping; everything else (toggles, Esc) acts once per press.
const REPEATS = new Set(['[', ']', 'j', 'k']);

const KEYS = {
  '[': { type: 'stepVersion', delta: -1 },
  ']': { type: 'stepVersion', delta: 1 },
  g: 'focusVersion',
  l: { type: 'goLatest' },
  h: { type: 'toggleHighlights' },
  // The handler fills in `total` from the changes it is showing.
  j: { type: 'stepChange', delta: 1 },
  k: { type: 'stepChange', delta: -1 },
  c: { type: 'setMode', mode: 'compare' },
  v: { type: 'togglePanel' },
  b: { type: 'setPeek', peek: true },
  '.': { type: 'toggleRetracted' },
  '?': 'help',
  Escape: 'escape',
};

// event -> Action | 'focusVersion' | 'help' | 'escape' | null
export function shortcutFor(event) {
  const name = event.key?.length === 1 ? event.key.toLowerCase() : event.key;

  // Letting go of B always lets go, wherever focus has got to.
  if (event.type === 'keyup') return name === 'b' ? { type: 'setPeek', peek: false } : null;

  // AltGr is reported as Ctrl+Alt; on some layouts [ and ] need it.
  const altGraph = event.getModifierState?.('AltGraph') === true;
  if (event.metaKey || ((event.ctrlKey || event.altKey) && !altGraph)) return null;
  if (event.defaultPrevented || event.isComposing) return null; // the page used the key itself
  // Inside a shadow root the event is retargeted to the host; composedPath()[0] is the field itself.
  if (isTextField(event.target) || isTextField(event.composedPath?.()[0])) return null;
  if (event.repeat && !REPEATS.has(name)) return null;
  const action = Object.hasOwn(KEYS, name) ? KEYS[name] : undefined;
  if (action === undefined) return null;
  return typeof action === 'string' ? action : { ...action };
}

const release = { type: 'setPeek', peek: false };

// What a shortcut does, decided from what the viewer shows. Pure: the caller carries it out.
//   token: what shortcutFor returned (an Action, or 'focusVersion' | 'help' | 'escape')
//   env: { state, versions, entries, phone, helpOpen, hasField, focusInPanel }  (entries: the review's, unfiltered)
//   -> { consumed, dispatch: Action[], effect: string | null }
// Effects: closeHelp, toggleHelp, closePanel, leaveCompare, togglePanel, openPanelByKeyboard, focusField, focusFieldWhenBack.
// consumed false means the key did nothing, so it isn't swallowed.
export function resolveShortcut(token, { state, versions, entries, phone, helpOpen, hasField, focusInPanel = false }) {
  const act = (effect = null, ...dispatch) => ({ consumed: true, dispatch, effect });
  const none = { consumed: false, dispatch: [], effect: null };

  // The sheet is on top: it takes Esc and ?, and nothing moves underneath it. Letting go of B still works.
  if (helpOpen && token !== 'escape' && token !== 'help' && token.type !== 'setPeek') return none;

  if (token === 'help') return act('toggleHelp');

  // Esc closes whatever is on top: the sheet, then the panel, then Compare.
  if (token === 'escape') {
    if (helpOpen) return act('closeHelp');
    if (state.panelOpen) return act('closePanel');
    if (state.mode === 'compare') return act('leaveCompare', { type: 'setMode', mode: 'explore' });
    return none;
  }

  // A put-away pill comes back for the keys that need it: G, V, and the change keys, since changes only show with it.
  const back = state.retracted ? [{ type: 'setRetracted', retracted: false }] : [];

  if (token === 'focusVersion') {
    if (phone) return act(state.panelOpen ? null : 'openPanelByKeyboard', ...back); // no field on a phone: open the panel
    if (state.retracted) return act('focusFieldWhenBack', ...back);
    return hasField ? act('focusField') : none;
  }

  switch (token.type) {
    case 'stepChange': {
      // The same list the pill, the panel and the page outlines walk.
      const total = filterEntries(entries, state.changeFilter).length;
      if (total === 0) return none;
      // Stepping is invisible with highlights off, so it turns them on.
      return state.highlights
        ? act(null, ...back, { ...token, total })
        : act(null, ...back, { type: 'toggleHighlights' }, { ...token, total });
    }
    case 'goLatest':
      return state.versionId === versions[0].id ? none : act(null, token);
    // The first version has nothing to highlight, and its Highlight control is disabled.
    // With the pill put away, H brings it back showing highlights rather than turning them off unseen.
    case 'toggleHighlights':
      if (previousVersion(versions, state.versionId) === null) return none;
      return state.retracted && state.highlights ? act(null, ...back) : act(null, ...back, token);
    // Closing the panel from inside it hands focus back to the pill, as Esc does.
    case 'togglePanel':
      return act(state.panelOpen && focusInPanel ? 'closePanel' : 'togglePanel', ...back);
    default:
      return act(null, token);
  }
}

// Listens for shortcuts on one window. `handle(action, event)` returns false when it did nothing with the key;
// otherwise the key counts as used and its default is prevented, except Esc, which is never ours to swallow.
// Holding B must never stick, so losing focus or being hidden lets go of it.
export function bindShortcuts(targetWindow, handle) {
  const onKey = event => {
    const action = shortcutFor(event);
    if (action === null) return;
    const used = handle(action, event) !== false;
    if (used && action !== 'escape' && event.type === 'keydown') event.preventDefault();
  };
  const onLeave = () => { handle(release, null); };
  const doc = targetWindow.document;
  targetWindow.addEventListener('keydown', onKey);
  targetWindow.addEventListener('keyup', onKey);
  targetWindow.addEventListener('blur', onLeave);
  doc?.addEventListener('visibilitychange', onLeave);
  // A frame's window can turn cross-origin while bound; removing listeners from it then throws.
  return () => {
    quietly(() => targetWindow.removeEventListener('keydown', onKey));
    quietly(() => targetWindow.removeEventListener('keyup', onKey));
    quietly(() => targetWindow.removeEventListener('blur', onLeave));
    quietly(() => doc?.removeEventListener('visibilitychange', onLeave));
  };
}

// Binds each frame's current window, and again after every load, since a load can replace the window. The
// window it leaves is unbound first, so nothing piles up across version switches.
export function bindFrames(frames, handle) {
  const stops = frames.filter(Boolean).map(frame => {
    let unbind = null;
    // Only a same-origin window can be listened to; a frame that went elsewhere is skipped until it comes back.
    const attach = () => {
      unbind?.();
      unbind = null;
      const win = frameWindow(frame);
      if (!win) return;
      try {
        unbind = bindShortcuts(win, handle);
      } catch {
        unbind = null;
      }
    };
    // A B keyup can land between navigation and load, with no window listening; a load lets go of the peek.
    const onLoad = () => {
      attach();
      handle(release, null);
    };
    attach();
    frame.addEventListener('load', onLoad);
    return () => {
      frame.removeEventListener('load', onLoad);
      unbind?.();
      unbind = null;
    };
  });
  return () => stops.forEach(stop => stop());
}

// The shortcut tip shows once: the first time the panel opens. The visitor's browser remembers it was shown.
// If storage is unavailable (private window, blocked site data) it shows once per session instead; never an error.
export function createTipGate(getStorage, key = 'afterimage-shortcut-tip') {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    try {
      const storage = getStorage();
      if (storage.getItem(key)) return false;
      storage.setItem(key, '1');
    } catch {
      // storage is unavailable: the tip still shows, this once
    }
    return true;
  };
}

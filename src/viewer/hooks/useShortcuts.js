import { useCallback, useEffect, useRef } from 'react';
import { bindFrames, bindShortcuts, resolveShortcut } from '../keyboard.js';
import { leaveForPage } from './usePageHost.js';

// Binds the shortcuts to the viewer's window and to each prototype frame, and carries out what
// resolveShortcut decides. `env` is read fresh on every key, so the bindings only change when the frames do.
// Returns false from the handler when a key did nothing, so it isn't swallowed.
export function useShortcuts(env) {
  const latest = useRef(env);
  useEffect(() => { latest.current = env; });

  const handle = useCallback(token => {
    const { state, dispatch, versions, review, phone, targetRef, helpOpen, setHelpOpen, togglePanel, closePanel, fieldRef, handoffRef, noteDockFocus, focusFieldWhenBack } = latest.current;
    const focusInPanel = Boolean(document.activeElement?.closest?.('.panel'));
    const result = resolveShortcut(token, { state, versions, entries: review.entries, phone, helpOpen, hasField: Boolean(fieldRef.current), focusInPanel, framed: window.parent !== window });
    if (!result.consumed) return false;

    switch (result.effect) {
      case 'closeHelp': setHelpOpen(false); break;
      case 'toggleHelp': setHelpOpen(!helpOpen); break;
      case 'closePanel': closePanel({ refocus: true }); break;
      case 'leaveCompare': handoffRef.current = true; break; // the Compare button takes focus, as when ✕ is pressed
      case 'togglePanel': togglePanel(); break;
      case 'openPanelByKeyboard': togglePanel({ detail: 0 }); break;
      case 'focusField':
        fieldRef.current.focus({ preventScroll: true });
        fieldRef.current.select();
        break;
      case 'focusFieldWhenBack': focusFieldWhenBack.current = true; break;
      // The page's pill (runtime/overlay.js) hides the viewer and shows the live page again.
      case 'leaveViewer': leaveForPage(targetRef); break;
      default:
    }
    // Focus on the pill follows it into the chip and back.
    if (result.dispatch.some(action => action.type === 'setRetracted' || action.type === 'toggleRetracted')) noteDockFocus();
    for (const action of result.dispatch) dispatch(action);
    return true;
  }, []);

  useEffect(() => bindShortcuts(window, handle), [handle]);

  // A frame that loads a different version, or appears and goes with Compare, is bound again.
  const { targetRef, baseRef } = env;
  const { versionId, baseId, mode } = env.state;
  useEffect(
    () => bindFrames([targetRef.current, baseRef.current], handle),
    [handle, targetRef, baseRef, versionId, baseId, mode],
  );
}

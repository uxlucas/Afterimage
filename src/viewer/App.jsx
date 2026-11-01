import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { filterEntries } from '../engine/review.js';
import { comparisonBase, initialState, reducer } from './state/model.js';
import { toSearch } from './state/url.js';
import { rememberRetracted } from './state/remember.js';
import { urlWriter } from './urlSync.js';
import { useReview } from './hooks/useReview.js';
import { usePhone } from './hooks/useMedia.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { createTipGate } from './keyboard.js';
import { useTransitions } from './motion.js';
import Stage from './stage/Stage.jsx';
import Pill from './pill/Pill.jsx';
import Chip from './pill/Chip.jsx';
import Panel from './panel/Panel.jsx';
import ShortcutHelp from './ShortcutHelp.jsx';

const claimTip = createTipGate(() => window.localStorage);
const retractMemory = rememberRetracted(() => window.localStorage);

// The pill and the panel above it, as one object. While the panel is open the two slide together to the
// bottom-right corner, out of the middle of the prototype; on a phone the panel is a sheet above the pill.
// Put away, the pill becomes a chip that slides to the same corner, and the page shows no outlines.
function Dock({ state, dispatch, versions, review, phone, targetRef, baseRef }) {
  const t = useTransitions();
  const versionRef = useRef(null);
  const openedByKeyboard = useRef(false);

  // A click with no pointer (detail 0) is Enter or Space: that visitor gets focus moved into the panel.
  const togglePanel = useCallback(event => {
    openedByKeyboard.current = event?.detail === 0;
    dispatch({ type: 'togglePanel' });
  }, [dispatch]);

  const closePanel = useCallback(({ refocus }) => {
    dispatch({ type: 'closePanel' });
    if (refocus) versionRef.current?.focus({ preventScroll: true });
  }, [dispatch]);

  const open = state.panelOpen;
  const fieldRef = useRef(null); // the version number field
  const handoffRef = useRef(false); // set to hand focus to Compare's counterpart when Compare ends
  const [helpOpen, setHelpOpen] = useState(false);

  // The first time the panel opens it carries a one-line shortcut hint, and stays for as long as it is open.
  // A phone has no keyboard: no hint, and the one-time claim is kept for a visit that does.
  const [tip, setTip] = useState(false);
  useLayoutEffect(() => {
    if (!open || phone) setTip(false);
    else if (claimTip()) setTip(true);
  }, [open, phone]);

  // Putting the pill away or bringing it back moves focus along with it, if focus was on it: to the chip, or to ⌄.
  // G with the pill away focuses the version field once the pill is back.
  const retracted = state.retracted;
  const retractRef = useRef(null);
  const chipRef = useRef(null);
  const focusAcross = useRef(false);
  const focusFieldWhenBack = useRef(false);
  const noteDockFocus = useCallback(() => {
    focusAcross.current = Boolean(document.activeElement?.closest?.('.pill-dock'));
  }, []);
  const setRetracted = useCallback(next => {
    noteDockFocus();
    dispatch({ type: 'setRetracted', retracted: next });
  }, [dispatch, noteDockFocus]);
  useLayoutEffect(() => {
    if (!retracted && focusFieldWhenBack.current && fieldRef.current) {
      fieldRef.current.focus({ preventScroll: true });
      fieldRef.current.select();
    } else if (focusAcross.current) {
      (retracted ? chipRef : retractRef).current?.focus({ preventScroll: true });
    }
    focusAcross.current = false;
    focusFieldWhenBack.current = false;
  }, [retracted]);

  useShortcuts({ state, dispatch, versions, review, phone, targetRef, baseRef, helpOpen, setHelpOpen, togglePanel, closePanel, fieldRef, handoffRef, noteDockFocus, focusFieldWhenBack });

  // A phone shows one folder at a time: crossing to phone width with both open keeps one.
  const bothFolders = state.folders.versions && state.folders.changes;
  useLayoutEffect(() => {
    if (phone && bothFolders) dispatch({ type: 'oneFolder' });
  }, [phone, bothFolders, dispatch]);

  return (
    <>
      <div className="pill-dock" data-phone={phone || undefined} data-open={open || undefined} data-retracted={retracted || undefined}>
        <motion.div className="dock-body" layout="position" transition={t.layout}>
          <AnimatePresence>
            {open && (
              <Panel
                key="panel"
                state={state}
                dispatch={dispatch}
                versions={versions}
                review={review}
                phone={phone}
                targetRef={targetRef}
                autoFocus={openedByKeyboard.current}
                tip={tip}
                onClose={closePanel}
              />
            )}
          </AnimatePresence>
          {retracted ? (
            <Chip state={state} versions={versions} chipRef={chipRef} onShow={() => setRetracted(false)} />
          ) : (
            <Pill
              state={state}
              dispatch={dispatch}
              versions={versions}
              review={review}
              phone={phone}
              onOpenPanel={togglePanel}
              onRetract={() => setRetracted(true)}
              versionRef={versionRef}
              fieldRef={fieldRef}
              handoffRef={handoffRef}
              retractRef={retractRef}
            />
          )}
        </motion.div>
      </div>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

export default function App({ versions }) {
  const reduce = useMemo(() => reducer(versions), [versions]);
  const [state, dispatch] = useReducer(reduce, location.search, search => ({ ...initialState(versions, search), retracted: retractMemory.read() }));
  const targetRef = useRef(null);
  const baseRef = useRef(null);
  const phone = usePhone();

  // The address bar follows the view, coalesced and guarded: a rate-limited replaceState must never
  // throw out of this effect, which would take the app down.
  const search = toSearch(state, versions);
  useEffect(() => { urlWriter.write(search); }, [search]);
  useEffect(() => { retractMemory.write(state.retracted); }, [state.retracted]);
  useEffect(() => {
    const flush = () => urlWriter.flush();
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const target = versions.find(entry => entry.id === state.versionId) ?? versions[0];
  const base = comparisonBase(versions, state);
  const review = useReview({ targetFrame: targetRef, baseFrame: baseRef, target, base, enabled: base != null });

  // A change number past the list (?change=99) selects nothing once the review knows the list.
  const filteredTotal = useMemo(() => filterEntries(review.entries, state.changeFilter).length, [review.entries, state.changeFilter]);
  useLayoutEffect(() => {
    dispatch({ type: 'clampChange', total: filteredTotal, status: review.status });
  }, [filteredTotal, review.status, state.changeIndex]);

  if (import.meta.env.DEV) window.__afterimage = { state, dispatch, review };

  return (
    <>
      <Stage state={state} dispatch={dispatch} versions={versions} review={review} targetRef={targetRef} baseRef={baseRef} phone={phone} />
      <Dock state={state} dispatch={dispatch} versions={versions} review={review} phone={phone} targetRef={targetRef} baseRef={baseRef} />
    </>
  );
}

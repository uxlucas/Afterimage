import { useId, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { olderThan, previousVersion, versionNumber } from '../state/versions.js';
import { useTransitions } from '../motion.js';
import VersionField from './VersionField.jsx';
import TickStrip from './TickStrip.jsx';
import HighlightSegment from './HighlightSegment.jsx';
import LayoutToggle from './LayoutToggle.jsx';
import { framed } from '../hooks/usePageHost.js';
import './pill.css';

function CompareIcon() {
  return (
    <svg className="pill-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M10 4v12" />
    </svg>
  );
}

function RetractIcon() {
  return (
    <svg className="pill-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="pill-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

// The always-visible tool: which version this is, the little timeline, highlights, and compare.
// It never shows version names, only numbers, so its width holds still as you move around.
// The Dock places it (and the panel above it); `versionRef` is the Version control, where focus returns when the panel closes.
// In Compare the same pill swaps segments: `[56] → [60]`, a range on the tick strip, and Wipe | Side by side with ✕.
export default function Pill({ state, dispatch, versions, review, phone, onOpenPanel, onRetract, versionRef, fieldRef, handoffRef, retractRef }) {
  const t = useTransitions();
  const inputId = useId();
  const baseInputId = useId();
  const latest = versions[0];
  const target = versions.find(version => version.id === state.versionId) ?? latest;
  const isLatest = target.id === latest.id;
  const first = previousVersion(versions, target.id) === null;
  const number = versionNumber(target);
  const total = versionNumber(latest);
  const base = state.mode === 'compare' ? versions.find(version => version.id === state.baseId) ?? null : null;
  const comparing = base !== null;
  const older = olderThan(versions, target.id);
  // ↑ is newer, ↓ is older, held to versions older than the target.
  const stepBase = delta => {
    const index = older.findIndex(version => version.id === base.id);
    const next = older[Math.min(older.length - 1, Math.max(0, index - delta))];
    if (next && next.id !== base.id) dispatch({ type: 'setBase', id: next.id });
  };

  // Compare and Go to latest swap when the version changes. If the one leaving holds focus (Enter on
  // Go to latest), hand focus to the one arriving before the old one goes inert, so nobody loses their place.
  const compareRef = useRef(null);
  const latestRef = useRef(null);
  const [reachLatest, setReachLatest] = useState(!isLatest);
  useLayoutEffect(() => {
    const from = isLatest ? latestRef.current : compareRef.current;
    const to = isLatest ? compareRef.current : latestRef.current;
    if (from && to && document.activeElement === from && !to.disabled) {
      to.inert = false;
      to.focus({ preventScroll: true });
    }
    setReachLatest(!isLatest);
  }, [isLatest]);

  // Entering or leaving Compare swaps the last segment. If the button that did it had focus, hand focus to its
  // counterpart (✕ on the way in; Compare, or Go to latest, on the way out).
  const closeRef = useRef(null);
  const ownHandoff = useRef(false);
  const modeHandoff = handoffRef ?? ownHandoff; // the shortcut for leaving Compare sets this from outside
  const handOff = event => { modeHandoff.current = event.currentTarget === document.activeElement; };
  useLayoutEffect(() => {
    if (!modeHandoff.current) return;
    modeHandoff.current = false;
    const to = comparing ? closeRef.current : isLatest ? compareRef.current : latestRef.current;
    if (to) { to.inert = false; to.focus({ preventScroll: true }); }
  }, [comparing]); // eslint-disable-line react-hooks/exhaustive-deps

  const dot = <span className="pill-dot" data-latest={isLatest || undefined} aria-hidden="true" />;

  const baseNumber = comparing ? versionNumber(base) : null;
  let versionSegment;
  if (comparing && phone) {
    versionSegment = (
      <div className="pill-seg version-seg">
        <button
          type="button"
          ref={versionRef}
          className="pill-btn version-btn"
          aria-expanded={state.panelOpen}
          aria-label={`v${baseNumber} to v${number}. Show versions`}
          onClick={onOpenPanel}
        >
          <span className="num">v{baseNumber}</span>
          <span className="muted" aria-hidden="true">→</span>
          <span className="num">v{number}</span>
        </button>
      </div>
    );
  } else if (comparing) {
    versionSegment = (
      <div className="pill-seg version-seg compare-versions">
        <VersionField
          versions={versions}
          version={base}
          dispatch={dispatch}
          inputId={baseInputId}
          choices={older}
          onPick={id => dispatch({ type: 'setBase', id })}
          onStep={stepBase}
          label="Before, version number"
          baseline
        />
        <button
          type="button"
          ref={versionRef}
          className="pill-btn arrow-btn"
          aria-expanded={state.panelOpen}
          aria-label={`v${baseNumber} to v${number}. Show versions`}
          onClick={onOpenPanel}
        >
          <span aria-hidden="true">→</span>
        </button>
        <VersionField versions={versions} version={target} dispatch={dispatch} inputId={inputId} label="After, version number" fieldRef={fieldRef} />
      </div>
    );
  }

  return (
    <div className="pill" role="group" aria-label="Version history" data-compare={comparing || undefined}>
      {versionSegment ?? (phone ? (
        <div className="pill-seg version-seg">
          <button
            type="button"
            ref={versionRef}
            className="pill-btn version-btn"
            aria-expanded={state.panelOpen}
            aria-label={`v${number} of ${total}${isLatest ? ', latest' : ''}. Show versions`}
            onClick={onOpenPanel}
          >
            {dot}
            <span className="num">v{number}</span>
          </button>
        </div>
      ) : (
        <div className="pill-seg version-seg">
          <button
            type="button"
            ref={versionRef}
            className="pill-btn version-btn"
            aria-expanded={state.panelOpen}
            aria-label={isLatest ? 'Version, latest. Show versions' : 'Version, older. Show versions'}
            onClick={onOpenPanel}
          >
            {dot}
            <span>Version</span>
          </button>
          <VersionField versions={versions} version={target} dispatch={dispatch} inputId={inputId} fieldRef={fieldRef} />
          <label className="version-of" htmlFor={inputId}>of <span className="num">{total}</span></label>
        </div>
      ))}

      {!phone && <TickStrip versions={versions} state={state} dispatch={dispatch} />}

      <span className="pill-sep" aria-hidden="true" />

      <HighlightSegment state={state} dispatch={dispatch} review={review} disabled={first} phone={phone} />

      {comparing ? (
        <motion.div className="pill-seg compare-seg" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: t.enter }}>
          {!phone && <LayoutToggle layout={state.layout} dispatch={dispatch} />}
          <button
            type="button"
            ref={closeRef}
            className="pill-btn close-btn"
            aria-label="Leave compare"
            onClick={event => { handOff(event); dispatch({ type: 'setMode', mode: 'explore' }); }}
          >
            <CloseIcon />
          </button>
        </motion.div>
      ) : (
        // Compare and Go to latest share one slot, sized to the wider of the two.
        <div className="pill-seg swap-seg">
          <motion.button
            type="button"
            ref={compareRef}
            className="pill-btn compare-btn"
            aria-label={phone ? 'Compare' : undefined}
            disabled={first}
            inert={reachLatest || undefined}
            onClick={event => { handOff(event); dispatch({ type: 'setMode', mode: 'compare' }); }}
            initial={false}
            animate={{ opacity: isLatest ? (first ? 0.4 : 1) : 0 }}
            transition={isLatest ? t.enter : t.exit}
          >
            {phone ? <CompareIcon /> : 'Compare'}
          </motion.button>
          <motion.button
            type="button"
            ref={latestRef}
            className="pill-btn latest-btn"
            aria-label="Go to latest"
            inert={!reachLatest || undefined}
            onClick={() => dispatch({ type: 'goLatest' })}
            initial={false}
            animate={{ opacity: isLatest ? 0 : 1 }}
            transition={isLatest ? t.exit : t.enter}
          >
            {phone ? 'Latest' : 'Go to latest'}
          </motion.button>
        </div>
      )}

      {/* Over a live page, turning everything off is what puts the viewer away. */}
      {!framed && (
        <button type="button" ref={retractRef} className="pill-btn retract-btn" aria-label="Hide Afterimage" onClick={onRetract}>
          <RetractIcon />
        </button>
      )}
    </div>
  );
}
